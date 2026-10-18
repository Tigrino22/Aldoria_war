import {
  type Resources,
  type UnitCounts,
  UNIT_KEYS,
  UNITS,
  emptyUnits,
  RESOURCES,
  ramsToBreakWall,
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
export const attackBeats = (r: { attackPower: number; defensePower: number }, marginPct = 0) =>
  r.attackPower > r.defensePower && r.attackPower >= (1 + Math.max(env.npcAttackMargin, marginPct) / 100) * r.defensePower;

const noTroops = (u: UnitCounts) => UNIT_KEYS.every((k) => u[k] === 0);

/** Béliers utiles contre une muraille : de quoi l'abattre entièrement (N × (N + 1) / 2 pour le niveau N), pas un de plus ; aucun sans muraille. */
export const ramsFor = (available: number, wall: number) => Math.min(available, ramsToBreakWall(Math.max(0, Math.floor(wall))));

/** Valeur en ressources de troupes. */
const valueOf = (units: UnitCounts) => UNIT_KEYS.reduce((sum, k) => sum + units[k] * RESOURCES.reduce((t, r) => t + UNITS[k].cost[r], 0), 0);

const STRIKE_FRACTIONS = [0, 0.25, 0.5, 0.75, 1];

/**
 * Assaut taillé sur les statistiques des troupes, face à des défenseurs espionnés. La défense de chaque unité dépend de la part d'infanterie
 * et de cavalerie de l'attaque (le lancier arrête la cavalerie, le hallebardier l'infanterie) : le PNJ essaie les mélanges d'épéistes
 * et de cavaliers (par quarts) et garde celui qui gagne avec la marge voulue en perdant le moins de ressources (pertes du vainqueur :
 * (défense / attaque)^1,5 de ses troupes, sans arrondi). Plus l'assaut est fort, moins il perd : face à des défenseurs, c'est souvent toute l'armée,
 * moins les unités que la défense arrête le mieux.
 * Les béliers partent juste assez nombreux pour abattre la muraille. `minShare` : part minimale de la force d'attaque disponible à engager.
 * Null si aucun mélange ne gagne.
 */
export function planStrike(available: UnitCounts, defenders: UnitCounts, wall: number, opts: { minShare?: number; marginPct?: number } = {}): UnitCounts | null {
  const full = available.swordsman * UNITS.swordsman.attack + available.cavalry * UNITS.cavalry.attack;
  const rams = ramsFor(available.ram, wall);
  let best: { units: UnitCounts; loss: number; power: number } | null = null;
  for (const a of STRIKE_FRACTIONS) {
    for (const b of STRIKE_FRACTIONS) {
      const units = { ...emptyUnits(), swordsman: Math.floor(available.swordsman * a), cavalry: Math.floor(available.cavalry * b), ram: rams };
      const power = units.swordsman * UNITS.swordsman.attack + units.cavalry * UNITS.cavalry.attack;
      if (power === 0 || power < (opts.minShare ?? 0) * full) continue;
      const r = resolveCombat({ attackers: units, defenders: [defenders], wallLevel: wallDuringCombat(wall, units.ram) });
      if (!attackBeats(r, opts.marginPct)) continue;
      const loss = Math.pow(r.defensePower / r.attackPower, 1.5) * valueOf(units);
      if (!best || loss < best.loss) best = { units, loss, power };
    }
  }
  return best?.units ?? null;
}

/** Troupes survivantes d'un assaut gagné (pour estimer le butin qu'elles rapportent). */
function survivorsOf(units: UnitCounts, defenders: UnitCounts, wall: number): UnitCounts {
  const r = resolveCombat({ attackers: units, defenders: [defenders], wallLevel: wallDuringCombat(wall, units.ram) });
  const out = emptyUnits();
  for (const k of UNIT_KEYS) out[k] = units[k] - r.attackerLosses[k];
  return out;
}

/** Parts d'armée essayées face à un village sans troupes : la plus petite qui suffit. */
const EMPTY_SHARES = [0.25, 0.35, 0.5, 0.7, 1];

/** Part `share` des troupes disponibles, béliers comptés au plus juste pour la muraille. */
function shareOf(available: UnitCounts, share: number, wall: number): UnitCounts {
  const units = emptyUnits();
  for (const k of UNIT_KEYS) units[k] = Math.floor(available[k] * share);
  units.ram = Math.min(units.ram, ramsFor(available.ram, wall));
  return units;
}

/** Troupes qui battent la défense estimée (voir `planStrike`), ou face à un village sans troupes la plus petite part (au moins `minShare`) qui suffit. Null si rien ne suffit. */
export function pickWinningUnits(available: UnitCounts, defenders: UnitCounts, wall: number, minShare = 0, marginPct = 0): UnitCounts | null {
  if (!noTroops(defenders)) return planStrike(available, defenders, wall, { minShare, marginPct });
  for (const share of EMPTY_SHARES.filter((x) => x >= minShare)) {
    const units = shareOf(available, share, wall);
    if (UNIT_KEYS.every((k) => units[k] === 0)) continue;
    const r = resolveCombat({ attackers: units, defenders: [defenders], wallLevel: wallDuringCombat(wall, units.ram) });
    if (attackBeats(r, marginPct)) return units;
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

/** Capacité de transport (en ressources) d'un groupe d'unités. */
export function carryOf(units: UnitCounts): number {
  return UNIT_KEYS.reduce((sum, k) => sum + units[k] * UNITS[k].carry, 0);
}

/** Butin minimal qui justifie d'envoyer des troupes piller (hors riposte et conquête). */
export const MIN_LOOT = 200;

/**
 * Choisit les troupes d'un pillage. Face à des défenseurs, l'assaut taillé sur les statistiques des troupes (`planStrike`).
 * Face à un village sans troupes, la plus petite part qui peut emporter l'essentiel du stock. Renvoie aussi le butin attendu,
 * celui que les survivants peuvent rapporter.
 */
export function pickRaidUnits(
  available: UnitCounts,
  defenders: UnitCounts,
  wall: number,
  stock: Resources,
  minShare = 0,
  marginPct = 0,
): { units: UnitCounts; loot: number } | null {
  const total = stock.wood + stock.clay + stock.iron + stock.wheat;
  let best: UnitCounts | null = null;
  if (!noTroops(defenders)) best = planStrike(available, defenders, wall, { minShare, marginPct });
  else {
    for (const share of EMPTY_SHARES.filter((x) => x >= minShare)) {
      const units = shareOf(available, share, wall);
      if (UNIT_KEYS.every((k) => units[k] === 0)) continue;
      const r = resolveCombat({ attackers: units, defenders: [defenders], wallLevel: wallDuringCombat(wall, units.ram) });
      if (!attackBeats(r, marginPct)) continue;
      best = units;
      if (carryOf(units) >= 0.8 * total) break;
    }
  }
  return best ? { units: best, loot: Math.min(carryOf(survivorsOf(best, defenders, wall)), total) } : null;
}

/** Points de loyauté qu'un noble fait tomber en moyenne (entre 20 et 35 par attaque gagnée). */
const NOBLE_DROP = 25;

/**
 * Taille du train de nobles à envoyer sur une loyauté estimée : assez de nobles pour la faire tomber à zéro d'un seul passage
 * (quatre pour une loyauté pleine), un seul quand il ne reste qu'à achever la conquête.
 */
export function nobleTrain(loyalty: number, max: number): number {
  return Math.max(1, Math.min(max, Math.ceil(Math.max(0, loyalty) / NOBLE_DROP)));
}

/** Loyauté d'un village estimée depuis le dernier rapport d'attaque qui l'a vue (`null` : jamais vue, donc pleine), avec sa remontée depuis. */
export function estimateLoyalty(seen: { after: number; at: Date } | null, now: Date, regenPerHour: number): number {
  if (!seen) return 100;
  const hours = Math.max(0, now.getTime() - seen.at.getTime()) / 3_600_000;
  return Math.min(100, seen.after + hours * regenPerHour);
}
