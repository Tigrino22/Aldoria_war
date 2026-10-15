import { UNITS, type UnitCounts } from './config';
import { emptyUnits } from './formulas';

/**
 * Provinces : le territoire est découpé en provinces de taille et de forme variables, avec la Terre sainte au centre.
 * Chaque province a un bastion ; une tribu qui y plante sa bannière et la tient assez longtemps contrôle la province et gagne
 * son bonus. Pour attaquer le Sanctuaire de la Terre sainte, il faut contrôler des provinces qui la bordent ; la tribu qui tient
 * la Terre sainte assez longtemps gagne le monde. Ce module ne contient que les règles pures, partagées avec la carte.
 */

export type ProvinceKind = 'province' | 'holy';
export type ProvinceBonus = 'wood' | 'clay' | 'iron' | 'wheat' | 'recruit' | 'speed';
export const PROVINCE_BONUSES: ProvinceBonus[] = ['wood', 'clay', 'iron', 'wheat', 'recruit', 'speed'];
export const PROVINCE_BONUS_LABEL: Record<ProvinceBonus, string> = {
  wood: 'Bois',
  clay: 'Argile',
  iron: 'Fer',
  wheat: 'Blé',
  recruit: 'Recrutement',
  speed: 'Vitesse des troupes',
};

/**
 * Niveau d'une province, selon sa distance à la Terre sainte : 3 pour celles qui la bordent, 2 pour leurs voisines, 1 pour
 * les terres du bord. Plus le niveau est haut, plus le bastion est gardé et plus le bonus est fort (valeurs dans l'administration).
 */
export type ProvinceTier = 1 | 2 | 3;
export const PROVINCE_TIERS: ProvinceTier[] = [1, 2, 3];
export const TIER_LABEL: Record<ProvinceTier, string> = { 1: 'Niveau 1', 2: 'Niveau 2', 3: 'Niveau 3' };

/** Réglages d'un niveau : garde neutre du bastion (population), muraille et bonus (%) de la province. */
export interface TierRules {
  tier: ProvinceTier;
  garrison: number;
  wall: number;
  bonus: number;
  /** Trésor reçu par chaque membre à la prise de contrôle : part de l'entrepôt remplie (%), 0 = aucun. */
  treasure: number;
}

/**
 * Niveau de chaque province (indices dans la liste) : 3 pour celles qui bordent la Terre sainte (il faut les tenir pour l'attaquer),
 * puis les autres coupées en deux selon la distance de leur point à la Terre sainte : la moitié la plus proche en niveau 2, le reste
 * en niveau 1. La Terre sainte elle-même reçoit 0.
 */
export function provinceTiers(seeds: { x: number; y: number }[], neighbours: Set<number>[], holyIndex: number): (ProvinceTier | 0)[] {
  if (holyIndex < 0) return seeds.map(() => 1);
  const holy = seeds[holyIndex];
  const out: (ProvinceTier | 0)[] = seeds.map((_, i) => (i === holyIndex ? 0 : neighbours[holyIndex].has(i) ? 3 : 1));
  const rest = seeds
    .map((s, i) => ({ i, d: Math.hypot(s.x - holy.x, s.y - holy.y) }))
    .filter(({ i }) => out[i] === 1)
    .sort((a, b) => a.d - b.d || a.i - b.i);
  rest.slice(0, Math.ceil(rest.length / 2)).forEach(({ i }) => (out[i] = 2));
  return out;
}

/** Garde neutre du Sanctuaire (population) et muraille : la Terre sainte est bien plus dure que tous les bastions. */
export const HOLY_GARRISON = 8000;
export const HOLY_WALL = 20;

/** Une province pour environ tant de cases. */
export const TILES_PER_PROVINCE = 450;

/** Nombre de provinces ordinaires sur une carte de `mapSize` × `mapSize` (la Terre sainte en plus). */
export const provinceCount = (mapSize: number) => Math.max(5, Math.round((mapSize * mapSize) / TILES_PER_PROVINCE));

/** Garde d'un bastion : 40 % de lanciers, 40 % de hallebardiers, 20 % d'épéistes (comme la Citadelle). */
export function bastionGarrison(population: number): UnitCounts {
  const units = emptyUnits();
  units.spearman = Math.floor((population * 0.4) / UNITS.spearman.population);
  units.halberdier = Math.floor((population * 0.4) / UNITS.halberdier.population);
  units.swordsman = Math.floor((population * 0.2) / UNITS.swordsman.population);
  return units;
}

export interface ProvinceSeed {
  id: number;
  x: number;
  y: number;
  /** Plus le poids est grand, plus la province s'étend. */
  weight: number;
}

/**
 * Tire les points des provinces : la Terre sainte au centre (petite), puis les autres, bien espacées, avec un poids au hasard
 * de 0,7 à 1,4 pour varier les tailles. La première entrée est la Terre sainte.
 */
export function generateSeeds(mapSize: number, rng: () => number = Math.random): { x: number; y: number; weight: number; kind: ProvinceKind }[] {
  const n = provinceCount(mapSize);
  const c = (mapSize - 1) / 2;
  const out: { x: number; y: number; weight: number; kind: ProvinceKind }[] = [{ x: Math.round(c), y: Math.round(c), weight: 0.55, kind: 'holy' }];
  const spacing = Math.sqrt((mapSize * mapSize) / n);
  const holyClear = Math.max(6, spacing * 0.75);
  for (let minGap = spacing * 0.8; out.length <= n && minGap > 1; minGap *= 0.9) {
    for (let attempt = 0; attempt < 4000 && out.length <= n; attempt++) {
      const x = Math.floor(rng() * mapSize);
      const y = Math.floor(rng() * mapSize);
      if (Math.hypot(x - c, y - c) < holyClear) continue;
      if (out.some((s) => Math.hypot(s.x - x, s.y - y) < minGap)) continue;
      out.push({ x, y, weight: 0.7 + rng() * 0.7, kind: 'province' });
    }
  }
  return out;
}

/** Hachage déterministe d'un point de grille, dans [0, 1). */
function hash(ix: number, iy: number, k: number): number {
  let h = Math.imul(ix, 374761393) ^ Math.imul(iy, 668265263) ^ Math.imul(k + 1, 2147483647);
  h = Math.imul(h ^ (h >>> 13), 1274126177);
  h ^= h >>> 16;
  return (h >>> 0) / 4294967296;
}

/** Bruit doux (interpolé entre les points d'une grille de `scale` cases), pour faire onduler les frontières. */
function noise(x: number, y: number, k: number, scale = 7): number {
  const fx = x / scale;
  const fy = y / scale;
  const ix = Math.floor(fx);
  const iy = Math.floor(fy);
  const tx = fx - ix;
  const ty = fy - iy;
  const sx = tx * tx * (3 - 2 * tx);
  const sy = ty * ty * (3 - 2 * ty);
  const a = hash(ix, iy, k) + (hash(ix + 1, iy, k) - hash(ix, iy, k)) * sx;
  const b = hash(ix, iy + 1, k) + (hash(ix + 1, iy + 1, k) - hash(ix, iy + 1, k)) * sx;
  return a + (b - a) * sy;
}

/** Amplitude des ondulations des frontières, en cases. */
const WOBBLE = 3;

/**
 * Province de chaque case : `grid[y * mapSize + x]` = indice dans `seeds` de la province qui la possède. Chaque case revient au
 * point le plus proche, la distance étant divisée par le poids et légèrement bruitée. Calcul identique côté serveur et carte.
 */
export function provinceGrid(mapSize: number, seeds: ProvinceSeed[]): Int16Array {
  const grid = new Int16Array(mapSize * mapSize).fill(-1);
  for (let y = 0; y < mapSize; y++) {
    for (let x = 0; x < mapSize; x++) {
      let best = -1;
      let bestScore = Infinity;
      for (let i = 0; i < seeds.length; i++) {
        const s = seeds[i];
        const score = Math.hypot(x - s.x, y - s.y) / s.weight + WOBBLE * (noise(x, y, s.id) - 0.5) * 2;
        if (score < bestScore) {
          bestScore = score;
          best = i;
        }
      }
      grid[y * mapSize + x] = best;
    }
  }
  // Le point d'une province lui appartient toujours.
  seeds.forEach((s, i) => {
    if (s.x >= 0 && s.y >= 0 && s.x < mapSize && s.y < mapSize) grid[s.y * mapSize + s.x] = i;
  });
  return grid;
}

/** Voisines de chaque province (indices dans `seeds`) : deux provinces sont voisines si deux de leurs cases se touchent. */
export function provinceNeighbours(grid: Int16Array, mapSize: number, count: number): Set<number>[] {
  const out = Array.from({ length: count }, () => new Set<number>());
  for (let y = 0; y < mapSize; y++) {
    for (let x = 0; x < mapSize; x++) {
      const a = grid[y * mapSize + x];
      if (a < 0) continue;
      if (x + 1 < mapSize) {
        const b = grid[y * mapSize + x + 1];
        if (b >= 0 && b !== a) {
          out[a].add(b);
          out[b].add(a);
        }
      }
      if (y + 1 < mapSize) {
        const b = grid[(y + 1) * mapSize + x];
        if (b >= 0 && b !== a) {
          out[a].add(b);
          out[b].add(a);
        }
      }
    }
  }
  return out;
}

/** Instant où la bannière plantée à `since` donne le contrôle (heures de tenue). */
export const controlAt = (since: string | Date, holdHours: number) => new Date(new Date(since).getTime() + holdHours * 3_600_000);

/** Vue d'une province pour la carte et la page Provinces. */
export interface ProvinceView {
  id: number;
  name: string;
  kind: ProvinceKind;
  x: number;
  y: number;
  weight: number;
  bonus: ProvinceBonus | null;
  /** Niveau de la province (0 pour la Terre sainte). */
  tier: ProvinceTier | 0;
  /** Bonus de la province pour la tribu qui la contrôle, en %, selon son niveau. */
  bonusPercent: number;
  bastion: { id: number; name: string; x: number; y: number; wall: number } | null;
  /** Tribu dont la bannière flotte sur le bastion, et depuis quand. */
  holder: { tribeId: number; tag: string; name: string } | null;
  holderSince: string | null;
  /** Instant où la tribu qui tient la bannière contrôle (ou contrôlera) la province. */
  controlAt: string | null;
  controlled: boolean;
  /** Provinces voisines (ids). */
  neighbours: number[];
}

export interface WorldVictoryView {
  tribeId: number | null;
  tribeName: string;
  tribeTag: string;
  at: string;
}

export interface ProvincesState {
  enabled: boolean;
  mapSize: number;
  holdHours: number;
  holyAccess: number;
  holyHoldDays: number;
  /** Garde, muraille et bonus de chaque niveau. */
  tiers: TierRules[];
  provinces: ProvinceView[];
  /** Tribu du joueur : provinces contrôlées qui bordent la Terre sainte, et accès à son Sanctuaire. */
  mine: { tribeId: number; holyNeighbours: number; canAttackHoly: boolean } | null;
  victory: WorldVictoryView | null;
}
