import { UNITS, type UnitCounts } from './config';
import { emptyUnits } from './formulas';

/**
 * Croisades : deux soirs par semaine (par défaut), une Citadelle annoncée à l'avance s'ouvre pendant une heure.
 * Les tribus font tomber sa muraille avec leurs béliers, détruisent sa garnison, plantent leur bannière avec un noble
 * et doivent la tenir jusqu'à la fermeture des portes. Ce module ne contient que les règles pures, partagées avec le client.
 */

export const CRUSADE_GLORY = {
  /** Une gloire pour tant de places de population ennemies tuées à la Citadelle (en attaque comme en défense). */
  killsPerGlory: 10,
  /** Attaque qui fait tomber la muraille à zéro la première. */
  breach: 100,
  /** Chaque prise de la bannière. */
  capture: 150,
  /** Chaque membre du camp vainqueur qui a combattu. */
  victory: 300,
  /** La gloire de victoire baisse d'un quart à chaque victoire consécutive de la même tribu (pour qu'une tribu ne rafle pas tout). */
  streakFactor: 0.75,
} as const;

/** Durée d'une saison de gloire, en jours réels : le classement de gloire repart de zéro à chaque saison. */
export const CRUSADE_SEASON_DAYS = 28;
/** Durée de la relique (bonus de production du camp vainqueur), en jours réels. */
export const RELIC_DAYS = 7;
/** Muraille de la Citadelle : il faut 210 béliers pour l'abattre entièrement. */
export const CITADEL_WALL = 20;

/** Gloire gagnée pour des ennemis tués à la Citadelle (population). */
export const gloryForKills = (population: number) => Math.floor(Math.max(0, population) / CRUSADE_GLORY.killsPerGlory);

/** Gloire de victoire après `streak` victoires consécutives déjà remportées par la même tribu. */
export const victoryGlory = (streak: number) => Math.round(CRUSADE_GLORY.victory * Math.pow(CRUSADE_GLORY.streakFactor, Math.max(0, streak)));

/**
 * Garnison de la Citadelle pour une population visée : 40 % de lanciers, 40 % de hallebardiers et 20 % d'épéistes,
 * pour qu'elle tienne aussi bien contre l'infanterie que contre la cavalerie.
 */
export function citadelGarrison(population: number): UnitCounts {
  const pop = Math.max(0, Math.floor(population));
  const units = emptyUnits();
  units.spearman = Math.floor((pop * 0.4) / UNITS.spearman.population);
  units.halberdier = Math.floor((pop * 0.4) / UNITS.halberdier.population);
  units.swordsman = Math.floor((pop * 0.2) / UNITS.swordsman.population);
  return units;
}

/** Bornes de la garnison (population), pour qu'un monde jeune garde un vrai défi et qu'un monde énorme garde un objectif atteignable. */
export const GARRISON_MIN = 4000;
export const GARRISON_MAX = 250_000;

/** Population de la garnison : une part de l'armée offensive de la tribu la plus forte du monde. */
export const garrisonPopulation = (strongestOffense: number, percent: number) =>
  Math.round(Math.min(GARRISON_MAX, Math.max(GARRISON_MIN, (strongestOffense * percent) / 100)));

/**
 * Vagues de la Garde : pendant l'assaut, tant qu'aucune bannière ne flotte sur la Citadelle, la Garde envoie des renforts
 * toutes les 15 minutes (15 % de la garnison de départ, même composition). Une Citadelle vidée par une première attaque
 * se regarnit : il faut enchaîner vite ou planter la bannière.
 */
export const GUARD_WAVE_MINUTES = 15;
export const GUARD_WAVE_SHARE = 0.15;

/** Nombre de vagues de la Garde déjà dues à l'instant `now` (aucune à l'ouverture, aucune à la fermeture des portes). */
export function guardWavesDue(c: { opensAt: string | Date; closesAt: string | Date }, now: Date): number {
  const open = new Date(c.opensAt).getTime();
  const close = new Date(c.closesAt).getTime();
  const step = GUARD_WAVE_MINUTES * 60_000;
  const until = Math.min(now.getTime(), close - 1);
  return until < open ? 0 : Math.floor((until - open) / step);
}

/** Heure de la prochaine vague de la Garde après `now`, ou null s'il n'y en a plus avant la fermeture. */
export function nextGuardWave(c: { opensAt: string | Date; closesAt: string | Date }, now: Date): Date | null {
  const open = new Date(c.opensAt).getTime();
  const step = GUARD_WAVE_MINUTES * 60_000;
  const next = open + (guardWavesDue(c, now) + 1) * step;
  return next < new Date(c.closesAt).getTime() ? new Date(next) : null;
}

/** Trésor de la Citadelle, par ressource : deux ressources par place de garnison, à partager entre ceux qui ont combattu. */
export const treasureFor = (garrisonPop: number) => Math.round(garrisonPop * 2);

/** Partage du trésor au prorata de la gloire (le reste de l'arrondi est perdu). */
export function shareTreasure(total: number, glory: Map<number, number>): Map<number, number> {
  const sum = [...glory.values()].reduce((a, b) => a + Math.max(0, b), 0);
  const out = new Map<number, number>();
  for (const [id, g] of glory) out.set(id, sum > 0 ? Math.floor((total * Math.max(0, g)) / sum) : 0);
  return out;
}

/** Titres que l'on gagne aux Croisades et que l'on peut afficher à côté de son nom. */
export const CRUSADE_TITLES = {
  crusader: 'Croisé',
  breaker: 'Briseur de murailles',
  bearer: 'Porte-étendard',
  champion: 'Champion de la Croisade',
  keeper: 'Gardien de la Citadelle',
  hero: 'Héros de la saison',
} as const;
export type CrusadeTitleKey = keyof typeof CRUSADE_TITLES;
export const CRUSADE_TITLE_HELP: Record<CrusadeTitleKey, string> = {
  crusader: 'Avoir combattu à une Croisade',
  breaker: 'Avoir fait tomber la muraille de la Citadelle',
  bearer: 'Avoir planté la bannière de son camp sur la Citadelle',
  champion: 'Avoir gagné le plus de gloire lors d’une Croisade',
  keeper: 'Avoir remporté une Croisade avec son camp',
  hero: 'Avoir fini premier du classement de gloire d’une saison',
};

/** Statut d'une croisade à un instant donné. */
export type CrusadePhase = 'announced' | 'open' | 'ended';
export function crusadePhase(c: { opensAt: string | Date; closesAt: string | Date; ended?: boolean }, now: Date): CrusadePhase {
  if (c.ended) return 'ended';
  const open = new Date(c.opensAt).getTime();
  const close = new Date(c.closesAt).getTime();
  if (now.getTime() < open) return 'announced';
  if (now.getTime() < close) return 'open';
  return 'ended';
}

/** Une arrivée à la Citadelle n'est permise que pendant la fenêtre d'assaut. */
export const arrivesInWindow = (arriveAt: Date, c: { opensAt: string | Date; closesAt: string | Date }) =>
  arriveAt.getTime() >= new Date(c.opensAt).getTime() && arriveAt.getTime() < new Date(c.closesAt).getTime();

/** Jours de la semaine (0 = dimanche … 6 = samedi), tels que les écrit l'administration : « 3,6 ». */
export function parseWeekdays(text: string): number[] | null {
  const days = String(text)
    .split(/[,; ]+/)
    .filter(Boolean)
    .map(Number);
  if (days.length === 0 || days.some((d) => !Number.isInteger(d) || d < 0 || d > 6)) return null;
  return [...new Set(days)].sort((a, b) => a - b);
}

/** Heure « 20:30 » en minutes depuis minuit, ou null. */
export function parseClock(text: string): number | null {
  const m = /^(\d{1,2})[:h](\d{2})$/.exec(String(text).trim());
  if (!m) return null;
  const h = Number(m[1]);
  const min = Number(m[2]);
  if (h > 23 || min > 59) return null;
  return h * 60 + min;
}

export const WEEKDAY_NAMES = ['dimanche', 'lundi', 'mardi', 'mercredi', 'jeudi', 'vendredi', 'samedi'];

/** Décalage (minutes) du fuseau `timeZone` par rapport à UTC à l'instant `date`. */
function zoneOffset(date: Date, timeZone: string): number {
  const parts = new Intl.DateTimeFormat('en-US', { timeZone, hourCycle: 'h23', year: 'numeric', month: 'numeric', day: 'numeric', hour: 'numeric', minute: 'numeric', second: 'numeric' }).formatToParts(date);
  const get = (t: string) => Number(parts.find((p) => p.type === t)?.value ?? 0);
  const asUtc = Date.UTC(get('year'), get('month') - 1, get('day'), get('hour') % 24, get('minute'), get('second'));
  return Math.round((asUtc - Math.floor(date.getTime() / 1000) * 1000) / 60_000);
}

/** Prochaine ouverture strictement après `after` : un des jours voulus à l'heure voulue, dans le fuseau du monde. */
export function nextOpening(after: Date, weekdays: number[], minutesOfDay: number, timeZone: string): Date {
  for (let d = 0; d <= 8; d++) {
    const day = new Date(after.getTime() + d * 86_400_000);
    const parts = new Intl.DateTimeFormat('en-US', { timeZone, year: 'numeric', month: 'numeric', day: 'numeric', weekday: 'short' }).formatToParts(day);
    const get = (t: string) => parts.find((p) => p.type === t)?.value ?? '';
    const weekday = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'].indexOf(get('weekday'));
    if (!weekdays.includes(weekday)) continue;
    const guess = Date.UTC(Number(get('year')), Number(get('month')) - 1, Number(get('day')), Math.floor(minutesOfDay / 60), minutesOfDay % 60);
    // L'heure locale voulue, convertie en UTC avec le décalage du fuseau ce jour-là (heure d'été comprise).
    const at = new Date(guess - zoneOffset(new Date(guess), timeZone) * 60_000);
    if (at.getTime() > after.getTime()) return at;
  }
  throw new Error('Aucun jour de croisade');
}

// ---------- Vues échangées avec le client ----------

export interface CrusadeSide {
  tribeId: number | null;
  tribeTag: string | null;
  tribeName: string | null;
  playerName: string | null;
}

export interface CrusadeSummary {
  id: number;
  name: string;
  x: number;
  y: number;
  villageId: number | null;
  season: number;
  phase: CrusadePhase;
  announcedAt: string;
  opensAt: string;
  closesAt: string;
  /** Muraille actuelle (20 au départ). */
  wall: number;
  breachedAt: string | null;
  /** Camp qui tient la bannière (pendant l'assaut), null si la Citadelle est encore neutre ou à terre. */
  holder: (CrusadeSide & { since: string }) | null;
  /** Vainqueur, une fois les portes fermées. */
  winner: CrusadeSide | null;
  treasure: number;
}

export interface CrusadeScoreRow {
  rank: number;
  playerId: number;
  username: string;
  tribeTag: string | null;
  title: string | null;
  glory: number;
  kills: number;
  breaches: number;
  captures: number;
}

export interface CrusadeLogEntry {
  at: string;
  kind: 'announce' | 'open' | 'breach' | 'capture' | 'fall' | 'win' | 'hold' | 'guard';
  text: string;
}

export interface CrusadeState {
  enabled: boolean;
  /** Jours et heure habituels, pour l'affichage. */
  schedule: { weekdays: number[]; time: string; minutes: number; noticeHours: number; timeZone: string };
  current: CrusadeSummary | null;
  /** Prochaine ouverture prévue quand aucune croisade n'est annoncée. */
  nextOpening: string | null;
  scores: CrusadeScoreRow[];
  log: CrusadeLogEntry[];
  me: { glory: number; kills: number; tribeId: number | null } | null;
  history: CrusadeSummary[];
  relicBonus: number;
}

export interface GloryRankingRow {
  rank: number;
  id: number;
  name: string;
  tag: string | null;
  title?: string | null;
  isNpc?: boolean;
  glory: number;
  crusades: number;
  wins?: number;
}

export interface PlayerTitleView {
  key: CrusadeTitleKey;
  label: string;
  help: string;
  earnedAt: string | null;
}
