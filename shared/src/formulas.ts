import {
  BUILDINGS,
  BuildingKey,
  CANCEL_GRACE_SECONDS,
  CANCEL_REFUND_SHARE,
  Buildings,
  HIDDEN_SHARE,
  MERCHANT_CAPACITY,
  MERCHANT_SPEED,
  RAMS_PER_WALL_LEVEL_DESTROYED,
  RAMS_PER_WALL_LEVEL_IN_COMBAT,
  RESOURCES,
  Resources,
  UNITS,
  UNIT_KEYS,
  UnitCounts,
  UnitKey,
  WALL_BONUS_PER_LEVEL,
} from './config';

export const emptyResources = (): Resources => ({ wood: 0, clay: 0, iron: 0, wheat: 0 });

export const emptyUnits = (): UnitCounts => ({ spearman: 0, swordsman: 0, scout: 0, cavalry: 0, ram: 0, noble: 0 });

export function normalizeUnits(raw: Partial<UnitCounts> | null | undefined): UnitCounts {
  const units = emptyUnits();
  for (const key of UNIT_KEYS) units[key] = Math.max(0, Math.floor(Number(raw?.[key] ?? 0)));
  return units;
}

export const totalUnits = (units: UnitCounts) => UNIT_KEYS.reduce((sum, k) => sum + units[k], 0);

export function addUnits(a: UnitCounts, b: UnitCounts): UnitCounts {
  const out = emptyUnits();
  for (const k of UNIT_KEYS) out[k] = a[k] + b[k];
  return out;
}

export function subtractUnits(a: UnitCounts, b: UnitCounts): UnitCounts {
  const out = emptyUnits();
  for (const k of UNIT_KEYS) out[k] = a[k] - b[k];
  return out;
}

export const hasUnits = (available: UnitCounts, wanted: UnitCounts) =>
  UNIT_KEYS.every((k) => wanted[k] <= available[k]);

export const canAfford = (stock: Resources, cost: Resources) => RESOURCES.every((r) => stock[r] >= cost[r]);

export function scaleResources(cost: Resources, factor: number): Resources {
  const out = emptyResources();
  for (const r of RESOURCES) out[r] = Math.round(cost[r] * factor);
  return out;
}

/** Coût pour passer un bâtiment au niveau `level`. */
export function buildingCost(key: BuildingKey, level: number): Resources {
  const def = BUILDINGS[key];
  return scaleResources(def.baseCost, Math.pow(def.costFactor, level - 1));
}

/** Durée (en secondes réelles) pour construire le niveau `level`. */
export function buildingTime(key: BuildingKey, level: number, townhallLevel: number, worldSpeed: number): number {
  const def = BUILDINGS[key];
  const raw = def.baseTime * Math.pow(def.timeFactor, level - 1) * Math.pow(0.95, Math.max(0, townhallLevel - 1));
  return Math.max(1, Math.round(raw / worldSpeed));
}

/** Production horaire d'un bâtiment de ressource, à vitesse x1. */
export function resourceProduction(level: number): number {
  return level <= 0 ? 5 : Math.round(30 * Math.pow(1.2, level - 1));
}

export function warehouseCapacity(level: number): number {
  return Math.round(1000 * Math.pow(1.23, Math.max(0, level - 1)));
}

export const hiddenResources = (warehouseLevel: number) => Math.round(warehouseCapacity(warehouseLevel) * HIDDEN_SHARE);

export function upkeepOf(units: UnitCounts): number {
  return UNIT_KEYS.reduce((sum, k) => sum + units[k] * UNITS[k].upkeep, 0);
}

/** Production horaire réelle (vitesse du monde incluse). Le blé est net de l'entretien des troupes. */
export function productionRates(buildings: Buildings, upkeep: number, worldSpeed: number): Resources {
  return {
    wood: resourceProduction(buildings.woodcutter) * worldSpeed,
    clay: resourceProduction(buildings.claypit) * worldSpeed,
    iron: resourceProduction(buildings.ironmine) * worldSpeed,
    wheat: (resourceProduction(buildings.farm) - upkeep) * worldSpeed,
  };
}

/** Durée (en secondes réelles) de recrutement d'une unité. */
export function recruitTime(unit: UnitKey, barracksLevel: number, worldSpeed: number): number {
  const raw = UNITS[unit].time * Math.pow(0.94, Math.max(0, barracksLevel - 1));
  return Math.max(1, raw / worldSpeed);
}

export const wallBonus = (wallLevel: number) => 1 + WALL_BONUS_PER_LEVEL * wallLevel;

export function meetsRequirements(buildings: Buildings, requires: Partial<Buildings>): boolean {
  return Object.entries(requires).every(([k, lvl]) => buildings[k as BuildingKey] >= (lvl ?? 0));
}

export function villagePoints(buildings: Buildings): number {
  let points = 0;
  for (const key of Object.keys(buildings) as BuildingKey[]) {
    const lvl = buildings[key];
    points += (lvl * (lvl + 1)) / 2;
  }
  return points;
}

export function distance(a: { x: number; y: number }, b: { x: number; y: number }): number {
  return Math.hypot(a.x - b.x, a.y - b.y);
}

/** Vitesse (minutes par case) de l'unité la plus lente du groupe. */
export function slowestSpeed(units: UnitCounts): number {
  let slowest = 0;
  for (const k of UNIT_KEYS) if (units[k] > 0) slowest = Math.max(slowest, UNITS[k].speed);
  return slowest;
}

/** Durée de trajet en secondes réelles. */
export function travelTime(units: UnitCounts, from: { x: number; y: number }, to: { x: number; y: number }, worldSpeed: number) {
  const seconds = (distance(from, to) * slowestSpeed(units) * 60) / worldSpeed;
  return Math.max(1, Math.round(seconds));
}

/** Durée (en secondes réelles) d'un trajet de marchands. */
export function merchantTravelTime(from: { x: number; y: number }, to: { x: number; y: number }, worldSpeed: number) {
  return Math.max(1, Math.round((distance(from, to) * MERCHANT_SPEED * 60) / worldSpeed));
}

/** Nombre de marchands d'un marché. */
export const merchantCount = (marketLevel: number) => (marketLevel <= 0 ? 0 : Math.round(marketLevel * (1 + marketLevel / 10)));

export const merchantsNeeded = (res: Resources) =>
  Math.ceil(RESOURCES.reduce((sum, r) => sum + res[r], 0) / MERCHANT_CAPACITY);

/** Niveau de muraille pris en compte pendant le combat, une fois les béliers passés. */
export const wallDuringCombat = (wall: number, rams: number) => Math.max(0, wall - Math.floor(rams / RAMS_PER_WALL_LEVEL_IN_COMBAT));

/** Niveau de muraille après une victoire, selon les béliers survivants. */
export const wallAfterRams = (wall: number, survivingRams: number) =>
  Math.max(0, wall - Math.floor(survivingRams / RAMS_PER_WALL_LEVEL_DESTROYED));

/** Pertes d'éclaireurs : tous si la défense en a autant ou plus, sinon (défense / attaque)^1.5. */
export function scoutLosses(attacking: number, defending: number): number {
  if (attacking <= 0) return 0;
  if (defending >= attacking) return attacking;
  return Math.round(attacking * Math.pow(defending / attacking, 1.5));
}

export function carryCapacity(units: UnitCounts): number {
  return UNIT_KEYS.reduce((sum, k) => sum + units[k] * UNITS[k].carry, 0);
}

/** Répartit la capacité de transport le plus équitablement possible entre les ressources disponibles. */
export function plunder(available: Resources, capacity: number): Resources {
  const loot = emptyResources();
  let remaining = Math.floor(capacity);
  let open = RESOURCES.filter((r) => Math.floor(available[r]) > 0);
  while (remaining > 0 && open.length > 0) {
    const share = Math.max(1, Math.floor(remaining / open.length));
    for (const r of open) {
      const left = Math.floor(available[r]) - loot[r];
      const take = Math.min(share, left, remaining);
      loot[r] += take;
      remaining -= take;
      if (remaining <= 0) break;
    }
    open = open.filter((r) => Math.floor(available[r]) - loot[r] > 0);
  }
  return loot;
}

/** Stade visuel d'un bâtiment : 0 = emplacement vide, puis 1 (niv. 1-6), 2 (niv. 7-13), 3 (niv. 14-20). */
export function buildingStage(level: number): 0 | 1 | 2 | 3 {
  if (level <= 0) return 0;
  if (level <= 6) return 1;
  if (level <= 13) return 2;
  return 3;
}

/** Part des ressources rendue quand on annule une file : tout pendant le délai de grâce, ensuite une partie. */
export const refundShare = (secondsSinceQueued: number) => (secondsSinceQueued <= CANCEL_GRACE_SECONDS ? 1 : CANCEL_REFUND_SHARE);
