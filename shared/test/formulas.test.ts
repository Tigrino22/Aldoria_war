import { describe, expect, it } from 'vitest';
import {
  buildingCost,
  buildingTime,
  carryCapacity,
  emptyUnits,
  plunder,
  populationCapacity,
  productionRates,
  resolveCombat,
  STARTING_BUILDINGS,
  UNITS,
  wallAfterRams,
  ramsToBreakWall,
  travelTime,
} from '../src';

describe('formules', () => {
  it('le coût augmente avec le niveau', () => {
    expect(buildingCost('farm', 1)).toEqual({ wood: 45, clay: 40, iron: 30, wheat: 0 });
    expect(buildingCost('farm', 2).wood).toBeGreaterThan(45);
  });

  it("l'hôtel de ville accélère la construction et la vitesse du monde divise les durées", () => {
    expect(buildingTime('farm', 1, 1, 1)).toBe(300);
    expect(buildingTime('farm', 1, 10, 1)).toBeLessThan(300);
    expect(buildingTime('farm', 1, 1, 10)).toBe(30);
  });

  it("la troupe n'entame pas la production de blé : la ferme limite la population", () => {
    expect(productionRates(STARTING_BUILDINGS, 1).wheat).toBe(30);
    expect(populationCapacity(1)).toBe(240);
    expect(populationCapacity(20)).toBeGreaterThan(4500);
    expect(populationCapacity(0)).toBe(0);
  });

  it('les béliers abaissent la muraille de façon progressive : le niveau N coûte N béliers', () => {
    expect(wallAfterRams(3, 0)).toBe(3);
    expect(wallAfterRams(3, 2)).toBe(3);
    expect(wallAfterRams(3, 3)).toBe(2);
    expect(wallAfterRams(3, 5)).toBe(1);
    expect(wallAfterRams(3, 6)).toBe(0);
    expect(wallAfterRams(20, 209)).toBe(1);
    expect(wallAfterRams(20, 210)).toBe(0);
    expect(ramsToBreakWall(20)).toBe(210);
    expect(wallAfterRams(0, 50)).toBe(0);
  });

  it('le hallebardier défend mieux contre l’infanterie que le lancier', () => {
    expect(UNITS.halberdier.defenseInfantry).toBeGreaterThan(UNITS.spearman.defenseInfantry);
  });

  it('le trajet dépend de la distance et de l’unité la plus lente', () => {
    const units = { ...emptyUnits(), spearman: 1, cavalry: 1 };
    expect(travelTime(units, { x: 0, y: 0 }, { x: 3, y: 4 }, 1)).toBe(5 * 18 * 60);
  });

  it('le pillage répartit le butin équitablement', () => {
    const loot = plunder({ wood: 1000, clay: 10, iron: 1000, wheat: 0 }, 300);
    expect(loot.clay).toBe(10);
    expect(loot.wood + loot.clay + loot.iron + loot.wheat).toBe(300);
    expect(Math.abs(loot.wood - loot.iron)).toBeLessThanOrEqual(1);
    expect(carryCapacity({ ...emptyUnits(), cavalry: 2 })).toBe(160);
  });
});

describe('combat', () => {
  it("une grosse attaque bat un village vide et perd peu", () => {
    const r = resolveCombat({ attackers: { ...emptyUnits(), swordsman: 100 }, defenders: [], wallLevel: 0 });
    expect(r.attackerWins).toBe(true);
    expect(r.attackerLosses.swordsman).toBeLessThan(5);
  });

  it('les lanciers arrêtent la cavalerie', () => {
    const r = resolveCombat({
      attackers: { ...emptyUnits(), cavalry: 10 },
      defenders: [{ ...emptyUnits(), spearman: 30 }],
      wallLevel: 0,
    });
    expect(r.attackerWins).toBe(false);
    expect(r.attackerLosses.cavalry).toBe(10);
    expect(r.defenderLosses[0].spearman).toBeLessThan(30);
  });

  it('la muraille renverse un combat serré', () => {
    const base = { attackers: { ...emptyUnits(), swordsman: 50 }, defenders: [{ ...emptyUnits(), spearman: 120 }] };
    expect(resolveCombat({ ...base, wallLevel: 0 }).attackerWins).toBe(true);
    expect(resolveCombat({ ...base, wallLevel: 10 }).attackerWins).toBe(false);
  });
});
