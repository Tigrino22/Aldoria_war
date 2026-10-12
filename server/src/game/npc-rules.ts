import {
  BUILDINGS,
  BUILDING_KEYS,
  type BuildingKey,
  type Buildings,
  type Resources,
  type UnitCounts,
  UNIT_KEYS,
  UNITS,
  emptyUnits,
  meetsRequirements,
  resolveCombat,
  wallDuringCombat,
} from '@aldoria/shared';

import { env } from '../env';
import { armyTarget, FARM_LEAD, type VillageRole } from './npc-roles';

export { FARM_LEAD, NOBLES_PER_CONQUEST } from './npc-roles';

// Règles pures des PNJ : pas de base de données ni d'horloge ici, pour pouvoir les tester facilement.

export type NpcProfile = 'builder' | 'raider' | 'conqueror';
export const NPC_PROFILES: NpcProfile[] = ['builder', 'raider', 'conqueror'];
/** Profils tirés au sort pour un PNJ solitaire : 2 bâtisseurs, 2 pillards et 1 conquérant sur 5 en moyenne. */
export const SOLO_PROFILES: NpcProfile[] = ['builder', 'builder', 'raider', 'raider', 'conqueror'];

export const PROFILE_LABEL: Record<NpcProfile, string> = {
  builder: 'Bâtisseur',
  raider: 'Pillard',
  conqueror: 'Conquérant',
};

/** Heure (0-23) dans un fuseau donné. */
export function hourIn(date: Date, timeZone: string): number {
  const parts = new Intl.DateTimeFormat('en-GB', { hour: 'numeric', hourCycle: 'h23', timeZone }).formatToParts(date);
  return Number(parts.find((p) => p.type === 'hour')?.value ?? 0);
}

/** Heures calmes : par défaut de 22 h à 8 h, les PNJ n'attaquent ni n'espionnent les joueurs. */
export function isQuiet(date: Date, timeZone: string, start: number, end: number): boolean {
  const h = hourIn(date, timeZone);
  return start <= end ? h >= start && h < end : h >= start || h < end;
}

/** Niveaux gagnés par jour de monde : le plafond atteint 20 au bout de 18 jours (difficulté ×1). */
export const NPC_LEVELS_PER_DAY = 1;
/** Niveau maximal que les PNJ visent selon l'âge du monde : ils suivent un rythme régulier, sans dépasser le niveau 20. */
export function npcCap(worldDays: number, difficulty: number): number {
  return Math.max(2, Math.min(20, 2 + Math.floor(Math.max(0, worldDays) * NPC_LEVELS_PER_DAY * difficulty)));
}

/** Importance donnée à chaque bâtiment : plus le poids est fort, plus le PNJ le monte haut. */
const BUILD_WEIGHTS: Record<NpcProfile, Record<BuildingKey, number>> = {
  builder: { townhall: 1, woodcutter: 1.2, claypit: 1.2, ironmine: 1.1, farm: 1.7, warehouse: 1, market: 0.4, barracks: 0.8, wall: 1.1 },
  raider: { townhall: 0.9, woodcutter: 0.9, claypit: 0.9, ironmine: 1.3, farm: 1.6, warehouse: 0.7, market: 0.1, barracks: 1.4, wall: 0.4 },
  // Les nobles demandent hôtel de ville et caserne au niveau 10 : le conquérant les monte en priorité.
  conqueror: { townhall: 1.5, woodcutter: 1, claypit: 1, ironmine: 1.2, farm: 1.7, warehouse: 0.9, market: 0.1, barracks: 1.5, wall: 0.5 },
};

/** Le prochain bâtiment à monter : le plus en retard par rapport à son poids, sous le plafond, conditions remplies. */
export function chooseBuilding(profile: NpcProfile, levels: Buildings, cap: number): BuildingKey | null {
  let best: BuildingKey | null = null;
  let bestScore = Infinity;
  for (const key of BUILDING_KEYS) {
    const level = levels[key];
    if (level >= Math.min(key === 'farm' ? cap + FARM_LEAD : cap, BUILDINGS[key].maxLevel)) continue;
    if (!meetsRequirements(levels, BUILDINGS[key].requires)) continue;
    // Le marché ne sert à rien à un PNJ avant que le reste ne soit bien avancé.
    if (key === 'market' && cap < 6) continue;
    const score = level / BUILD_WEIGHTS[profile][key];
    if (score < bestScore) {
      bestScore = score;
      best = key;
    }
  }
  return best;
}

/** Unité à recruter en priorité : celle qui manque le plus par rapport à la cible, parmi celles qu'il peut recruter. */
export function nextRecruit(
  profile: NpcProfile,
  role: VillageRole,
  buildings: Buildings,
  owned: UnitCounts,
  cap: number,
  difficulty: number,
  maxBatch = 40,
): { unit: (typeof UNIT_KEYS)[number]; count: number }[] {
  const target = armyTarget(profile, role, cap, difficulty);
  return UNIT_KEYS.filter((k) => target[k] > owned[k] && meetsRequirements(buildings, UNITS[k].requires))
    .map((k) => ({ unit: k, deficit: target[k] - owned[k], ratio: (target[k] - owned[k]) / target[k] }))
    .sort((a, b) => b.ratio - a.ratio)
    .map(({ unit, deficit }) => ({ unit, count: Math.max(1, Math.min(maxBatch, Math.ceil(deficit / 2))) }));
}

/** Éclaireurs envoyés selon le nombre d'échecs de suite : 10, puis 25, puis 60. */
export const SCOUT_WAVES = [10, 25, 60] as const;
/** Plus petite mission d'espionnage qu'un PNJ envoie chez un joueur ou un autre PNJ : avec moins, elle n'est pas crédible et il attend d'en avoir assez. */
export const MIN_SCOUT_WAVE = 5;
/** Part des éclaireurs du village engagée en temps de guerre (guerre de tribu, riposte, offensive). */
export const WAR_SCOUT_SHARE = 0.75;

export interface ScoutWaveContext {
  /** Éclaireurs vus chez la cible lors du dernier renseignement du PNJ (espionnage ou attaque), s'il en a un. */
  knownScouts?: number;
  /** Guerre, riposte ou offensive : le PNJ engage le gros de ses éclaireurs. */
  war?: boolean;
}

/**
 * Éclaireurs envoyés en mission, dans la limite de ceux dont le village dispose : 10 d'abord, puis 25 et 60 après chaque échec (tous les éclaireurs tués).
 * Une défense qui compte autant d'éclaireurs que l'attaque les tue tous : si le PNJ en a déjà vu chez la cible, il en envoie au moins le double (plus 5),
 * de quoi passer avec un tiers de pertes. En guerre, il double la vague et engage au moins les trois quarts de ses éclaireurs.
 * Renvoie 0 quand le village ne peut pas réunir `MIN_SCOUT_WAVE` éclaireurs : pas de mission à 1 ou 2 éclaireurs.
 */
export function scoutWave(failures: number, available: number, ctx: ScoutWaveContext = {}): number {
  let n: number = SCOUT_WAVES[Math.min(SCOUT_WAVES.length - 1, Math.max(0, failures))];
  if (ctx.knownScouts && ctx.knownScouts > 0) n = Math.max(n, ctx.knownScouts * 2 + 5);
  if (ctx.war) n = Math.max(n * 2, Math.ceil(available * WAR_SCOUT_SHARE));
  n = Math.min(Math.max(0, available), n);
  return n < MIN_SCOUT_WAVE ? 0 : n;
}

/** Échecs d'espionnage consécutifs après lesquels un PNJ laisse une cible tranquille un temps. */
export const SCOUT_MAX_FAILURES = 3;
/** Durée (en heures de jeu) pendant laquelle une cible abandonnée est laissée tranquille, à partir du dernier échec. */
export const SCOUT_PAUSE_GAME_HOURS = 12;
/** Durée (en heures de jeu) pendant laquelle les échecs sont retenus : après la pause, le PNJ reprend avec la vague où il s'était arrêté. */
export const SCOUT_MEMORY_GAME_HOURS = 36;

export interface ScoutFailures {
  count: number;
  /** Date (ms) du dernier échec. */
  lastAt: number;
}

/** Échecs consécutifs par village, du plus récent au plus ancien : un renseignement obtenu remet le compte à zéro. `reports` est trié du plus récent au plus ancien. */
export function consecutiveScoutFailures(reports: { villageId: number; ok: boolean; at: number }[]): Map<number, ScoutFailures> {
  const failures = new Map<number, ScoutFailures>();
  const done = new Set<number>();
  for (const r of reports) {
    if (done.has(r.villageId)) continue;
    if (r.ok) {
      done.add(r.villageId);
      continue;
    }
    const known = failures.get(r.villageId);
    if (known) known.count++;
    else failures.set(r.villageId, { count: 1, lastAt: r.at });
  }
  return failures;
}

/** Une cible qui a résisté trois fois (ou plus) est laissée tranquille pendant la pause qui suit le dernier échec. */
export const scoutPaused = (f: ScoutFailures | undefined, now: Date, worldSpeed: number) =>
  !!f && f.count >= SCOUT_MAX_FAILURES && now.getTime() - f.lastAt < (SCOUT_PAUSE_GAME_HOURS * 3_600_000) / worldSpeed;

/**
 * Un PNJ attaque dès que son armée bat l'armée espionnée : la marge de sécurité (`npcAttackMargin`, en % de la défense estimée) vaut 0 par défaut.
 * La victoire est celle du combat (force d'attaque strictement supérieure).
 */
export const attackBeats = (r: { attackPower: number; defensePower: number }) => r.attackPower > r.defensePower && r.attackPower >= (1 + env.npcAttackMargin / 100) * r.defensePower;

const noTroops = (u: UnitCounts) => UNIT_KEYS.every((k) => u[k] === 0);

/** Parts d'armée essayées : une seule (toute l'armée) face à des défenseurs, car un petit détachement perd trop de soldats ; toutes face à un village sans troupes. */
const sharesFor = (defenders: UnitCounts, minShare: number) => (noTroops(defenders) ? [0.25, 0.35, 0.5, 0.7, 1] : [1]).filter((x) => x >= minShare);

/** Toute l'armée disponible si elle bat la défense estimée avec la marge voulue, sauf face à un village sans troupes : alors la plus petite part (au moins `minShare`) qui suffit. Null si elle ne suffit pas. */
export function pickWinningUnits(available: UnitCounts, defenders: UnitCounts, wall: number, minShare = 0): UnitCounts | null {
  for (const share of sharesFor(defenders, minShare)) {
    const units = emptyUnits();
    for (const k of UNIT_KEYS) units[k] = Math.floor(available[k] * share);
    if (UNIT_KEYS.every((k) => units[k] === 0)) continue;
    const r = resolveCombat({ attackers: units, defenders: [defenders], wallLevel: wallDuringCombat(wall, units.ram) });
    if (attackBeats(r)) return units;
  }
  return null;
}
// ---------- Tribus de PNJ ----------

export const NPC_TRIBE_NAMES: { name: string; tag: string }[] = [
  { name: 'Légion de Fer', tag: 'FER' },
  { name: 'Ordre du Corbeau', tag: 'COR' },
  { name: 'Compagnie des Loups', tag: 'LOU' },
  { name: 'Garde de Brumevent', tag: 'BRU' },
  { name: 'Fils de la Tempête', tag: 'TEM' },
  { name: 'Bannière Écarlate', tag: 'ECA' },
  { name: 'Veilleurs du Nord', tag: 'VEI' },
  { name: 'Faucons Dorés', tag: 'FAU' },
];

const TRIBE_PREFIXES = ['Compagnie', 'Ordre', 'Légion', 'Garde', 'Fils', 'Veilleurs', 'Lames', 'Confrérie', 'Maison', 'Clan', 'Cercle', 'Hérauts'];
const TRIBE_SUFFIXES = ['du Cormoran', 'de l’Aube', 'des Cendres', 'du Lion Pâle', 'de la Marche', 'du Gué Noir', 'des Sept Tours', 'de Valcrête', 'du Chêne Gris', 'de l’Étoile', 'du Dernier Feu', 'des Hautes Landes'];

/** Noms de tribu possibles : les huit d'origine, puis toutes les combinaisons « Ordre du Cormoran », etc. Le tag reprend les trois premières lettres du dernier mot. */
export function npcTribeNameCandidates(): { name: string; tag: string }[] {
  const out = [...NPC_TRIBE_NAMES];
  for (const p of TRIBE_PREFIXES) {
    for (const x of TRIBE_SUFFIXES) {
      const last = x.split(' ').pop()!.normalize('NFD').replace(/[^A-Za-z]/g, '');
      out.push({ name: `${p} ${x}`, tag: `${p[0]}${last.slice(0, 2)}`.toUpperCase() });
    }
  }
  return out;
}

/** Profils des membres d'une tribu : un chef pillard, un conquérant, puis bâtisseurs et pillards en alternance. */
export function tribeMemberProfiles(size: number): NpcProfile[] {
  const rest: NpcProfile[] = ['conqueror', 'builder', 'raider', 'builder'];
  return Array.from({ length: size }, (_, i) => (i === 0 ? 'raider' : rest[(i - 1) % rest.length]));
}

export interface TribeRelations {
  allies: number[];
  rivals: number[];
}

/**
 * Alliances et rivalités entre tribus : elles s'allient deux par deux (blocs), et chaque bloc est rival des blocs voisins.
 * Une tribu seule dans son bloc n'a pas d'alliée. Avec un seul bloc, personne n'est rival.
 */
export function tribeRelations(ids: number[]): Map<number, TribeRelations> {
  const sorted = [...ids].sort((a, b) => a - b);
  const blocs = Math.ceil(sorted.length / 2);
  const bloc = (i: number) => Math.floor(i / 2);
  const out = new Map<number, TribeRelations>();
  sorted.forEach((id, i) => {
    const allies: number[] = [];
    const rivals: number[] = [];
    sorted.forEach((other, j) => {
      if (j === i) return;
      if (bloc(j) === bloc(i)) allies.push(other);
      else if (blocs > 1 && (bloc(j) === (bloc(i) + 1) % blocs || bloc(j) === (bloc(i) + blocs - 1) % blocs)) rivals.push(other);
    });
    out.set(id, { allies, rivals });
  });
  return out;
}

/** Un PNJ n'attaque sans provocation qu'un joueur dont les points sont entre 70 % et 150 % des siens. */
export function pointRatioOk(npcPoints: number, targetPoints: number): boolean {
  if (npcPoints <= 0) return false;
  const ratio = targetPoints / npcPoints;
  return ratio >= 0.7 && ratio <= 1.5;
}

/** Capacité de transport (en ressources) d'un groupe d'unités. */
export function carryOf(units: UnitCounts): number {
  return UNIT_KEYS.reduce((sum, k) => sum + units[k] * UNITS[k].carry, 0);
}

/** Butin minimal qui justifie d'envoyer des troupes piller (hors riposte et conquête). */
export const MIN_LOOT = 200;

/**
 * Choisit les troupes d'un pillage. Face à des défenseurs, toute l'armée part (si elle gagne avec la marge voulue) pour limiter les pertes.
 * Face à un village sans troupes, la plus petite part qui peut emporter l'essentiel du stock. Renvoie aussi le butin attendu.
 */
export function pickRaidUnits(
  available: UnitCounts,
  defenders: UnitCounts,
  wall: number,
  stock: Resources,
  minShare = 0,
): { units: UnitCounts; loot: number } | null {
  const total = stock.wood + stock.clay + stock.iron + stock.wheat;
  let best: UnitCounts | null = null;
  for (const share of sharesFor(defenders, minShare)) {
    const units = emptyUnits();
    for (const k of UNIT_KEYS) units[k] = Math.floor(available[k] * share);
    if (UNIT_KEYS.every((k) => units[k] === 0)) continue;
    const r = resolveCombat({ attackers: units, defenders: [defenders], wallLevel: wallDuringCombat(wall, units.ram) });
    if (!attackBeats(r)) continue;
    best = units;
    if (carryOf(units) >= 0.8 * total) break;
  }
  return best ? { units: best, loot: Math.min(carryOf(best), total) } : null;
}
