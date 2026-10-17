import {
  type Resources,
  type UnitCounts,
  UNIT_KEYS,
  UNITS,
  emptyUnits,
  resolveCombat,
  wallDuringCombat,
} from '@aldoria/shared';

import { env } from '../env';
import { ROLE_LABEL, type VillageRole } from './npc-roles';

// Règles pures des PNJ : pas de base de données ni d'horloge ici, pour pouvoir les tester facilement.

/** Type d'un PNJ : défensif ou offensif (le rôle de son premier village, voir npc-roles.ts). */
export type NpcProfile = VillageRole;
export const NPC_PROFILES: NpcProfile[] = ['defense', 'offense'];
/** Types tirés au sort pour un PNJ solitaire : autant de défensifs que d'offensifs. */
export const SOLO_PROFILES: NpcProfile[] = ['defense', 'offense'];

export const PROFILE_LABEL: Record<NpcProfile, string> = ROLE_LABEL;

/** Type d'un PNJ enregistré en base : les anciens bâtisseurs deviennent défensifs, les pillards et conquérants offensifs. */
export const npcType = (raw: unknown): NpcProfile => (raw === 'offense' || raw === 'raider' || raw === 'conqueror' ? 'offense' : 'defense');

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

/** Éclaireurs envoyés selon le nombre d'échecs de suite : 50 d'emblée, pour passer les éclaireurs d'un joueur, puis 100 et 200. */
export const SCOUT_WAVES = [50, 100, 200] as const;
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
 * Éclaireurs envoyés en mission, dans la limite de ceux dont le village dispose : 50 d'abord, puis 100 et 200 après chaque échec (tous les éclaireurs tués).
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

/**
 * Réaction d'un PNJ dont l'espionnage a échoué : il attend, réessaie avec plus d'éclaireurs, envoie une petite troupe pour intimider
 * le défenseur, ou frappe à l'aveugle avec une vraie attaque. Le tirage `roll` est entre 0 et 1.
 */
export type ScoutFailureMove = 'wait' | 'rescout' | 'harass' | 'strike';
export const SCOUT_FAILURE_MOVES: readonly (readonly [ScoutFailureMove, number])[] = [
  ['wait', 0.35],
  ['rescout', 0.25],
  ['harass', 0.25],
  ['strike', 0.15],
];
export function afterScoutFailure(roll: number): ScoutFailureMove {
  let acc = 0;
  for (const [move, p] of SCOUT_FAILURE_MOVES) {
    acc += p;
    if (roll < acc) return move;
  }
  return SCOUT_FAILURE_MOVES[SCOUT_FAILURE_MOVES.length - 1][0];
}

/** Troupe d'intimidation : un dixième des épéistes et cavaliers du village, entre 10 et 40 unités. Null s'il y en a moins de 10. */
export function harassUnits(available: UnitCounts): UnitCounts | null {
  const pool = available.swordsman + available.cavalry;
  if (pool < 10) return null;
  const n = Math.min(40, Math.max(10, Math.round(pool / 10)));
  const units = emptyUnits();
  units.cavalry = Math.min(available.cavalry, Math.round((n * available.cavalry) / pool));
  units.swordsman = Math.min(available.swordsman, n - units.cavalry);
  return units;
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

/** Types des membres d'une tribu : un chef offensif, puis défensifs et offensifs en alternance. */
export function tribeMemberProfiles(size: number): NpcProfile[] {
  return Array.from({ length: size }, (_, i) => (i % 2 === 0 ? 'offense' : 'defense'));
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
