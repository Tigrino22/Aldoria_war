// Simulation d'un village piloté par le gestionnaire (vitesse x1, sans pillage ni attaque), pour comparer des modèles.
import {
  BUILD_QUEUE_LIMIT, BUILDINGS, RESOURCES, STARTING_BUILDINGS, STARTING_RESOURCES, UNITS, UNIT_KEYS,
  buildingCost, buildingTime, emptyUnits, populationCapacity, populationOf, productionRates, recruitTime, villagePoints, warehouseCapacity,
  type BuildingKey, type Buildings, type Resources,
} from '../../shared/src/index';
import { costOf, nextBuilding, nextTroopLot, reserveFor, troopBudget, type Plan } from '../../server/src/manager/rules';

export interface Snapshot { day: number; points: number; pop: number; attack: number; defInf: number; defCav: number; levels: string; idle: number }

export function simulate(plan: Plan, days: number[], tickSec = 60): Snapshot[] {
  const b: Buildings = { ...STARTING_BUILDINGS };
  const res: Resources = { ...STARTING_RESOURCES };
  const units = emptyUnits();
  const queue: { key: BuildingKey; level: number; finish: number }[] = [];
  let recruit: { unit: (typeof UNIT_KEYS)[number]; left: number; per: number; next: number } | null = null;
  const out: Snapshot[] = [];
  const end = Math.max(...days) * 86400;
  let wasted = 0;
  let troopsUntil = 0;
  for (let t = 0; t <= end; t += tickSec) {
    // Production
    const rate = productionRates(b, 1);
    const cap = warehouseCapacity(b.warehouse);
    for (const r of RESOURCES) { const add = (rate[r] * tickSec) / 3600; const nv = Math.min(cap, res[r] + add); wasted += res[r] + add - nv; res[r] = nv; }
    // Fins de construction
    while (queue.length && queue[0].finish <= t) { const q = queue.shift()!; b[q.key] = q.level; }
    // Recrutement
    while (recruit && recruit.next <= t) { units[recruit.unit]++; recruit.left--; recruit.next += recruit.per; if (recruit.left <= 0) recruit = null; }
    // Gestionnaire (toutes les 60 s)
    const eff: Buildings = { ...b };
    for (const q of queue) eff[q.key] = Math.max(eff[q.key], q.level);
    let next = nextBuilding(plan.buildings, eff);
    if (next && queue.length < BUILD_QUEUE_LIMIT) {
      const cost = buildingCost(next.building, next.level);
      if (RESOURCES.every((r) => res[r] >= cost[r])) {
        for (const r of RESOURCES) res[r] -= cost[r];
        const start = queue.length ? queue[queue.length - 1].finish : t;
        queue.push({ key: next.building, level: next.level, finish: start + buildingTime(next.building, next.level, eff.townhall, 1) });
        eff[next.building] = next.level;
        next = nextBuilding(plan.buildings, eff);
      }
    }
    if (!recruit && b.barracks >= 1) {
      const budget = troopBudget(res, reserveFor(costOf(next), 0, warehouseCapacity(b.warehouse)));
      const free = populationCapacity(b.farm) - populationOf(units);
      const dip = t >= troopsUntil ? { stock: { ...res }, rates: productionRates(b, 1), share: plan.troopsShare } : undefined;
      const lot = nextTroopLot(plan.troops, units, b, budget, free, 1, dip);
      if (lot) {
        if (lot.dipSeconds > 0) troopsUntil = t + lot.dipSeconds;
        const cost = UNITS[lot.unit].cost;
        for (const r of RESOURCES) res[r] -= cost[r] * lot.count;
        const per = recruitTime(lot.unit, b.barracks, 1);
        recruit = { unit: lot.unit, left: lot.count, per, next: t + per };
      }
    }
    if (days.some((d) => d * 86400 === t)) {
      const all = { ...units }; if (recruit) all[recruit.unit] += recruit.left;
      out.push({
        day: t / 86400, points: villagePoints(b), pop: populationOf(units),
        attack: UNIT_KEYS.reduce((s, k) => s + units[k] * UNITS[k].attack, 0),
        defInf: UNIT_KEYS.reduce((s, k) => s + units[k] * UNITS[k].defenseInfantry, 0),
        defCav: UNIT_KEYS.reduce((s, k) => s + units[k] * UNITS[k].defenseCavalry, 0),
        levels: (Object.keys(BUILDINGS) as BuildingKey[]).map((k) => `${k.slice(0, 3)}${b[k]}`).join(' '),
        idle: Math.round(wasted),
      });
    }
  }
  return out;
}
