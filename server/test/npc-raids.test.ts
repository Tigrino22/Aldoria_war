import { describe, expect, it } from 'vitest';
import { emptyUnits } from '@aldoria/shared';
import { farmPlan, farmPool, pickFarmUnits } from '../src/game/npc-raids';
import { carryOf } from '../src/game/npc-rules';

const NOW = new Date('2030-01-15T12:00:00Z');
const full = { wood: 500, clay: 500, iron: 500, wheat: 500 };
const buildings = { townhall: 1, woodcutter: 1, claypit: 1, ironmine: 1, farm: 1, warehouse: 1, market: 0, barracks: 0, wall: 0 };
const scoutRow = (minutesAgo: number, troops = emptyUnits()) => ({
  type: 'scout',
  created_at: new Date(NOW.getTime() - minutesAgo * 60_000),
  data: { intel: { resources: full, buildings, troops } },
});

describe('pillage intensif des PNJ', () => {
  it('tous les porteurs peuvent piller, hallebardiers compris', () => {
    const home = { ...emptyUnits(), spearman: 100, halberdier: 50, swordsman: 20, cavalry: 10, scout: 5, ram: 3 };
    expect(farmPool(home)).toEqual({ ...emptyUnits(), spearman: 100, halberdier: 50, swordsman: 20, cavalry: 10 });
  });

  it('complète avec les hallebardiers quand il n’y a rien d’autre', () => {
    const units = pickFarmUnits({ ...emptyUnits(), halberdier: 100 }, 300, 0)!;
    expect(units.halberdier).toBeGreaterThanOrEqual(30);
  });

  it('envoie juste de quoi porter le butin', () => {
    const units = pickFarmUnits({ ...emptyUnits(), cavalry: 50 }, 800, 0)!;
    expect(units.cavalry).toBe(10);
    expect(carryOf(units)).toBeGreaterThanOrEqual(800);
  });

  it('n’envoie rien si le groupe ne passe pas la muraille', () => {
    expect(pickFarmUnits({ ...emptyUnits(), spearman: 2 }, 50, 20)).toBeNull();
  });

  it('espionne un barbare inconnu, pille un barbare vu vide, laisse un village défendu', () => {
    expect(farmPlan({ barbarian: true }, [], NOW, 1)).toEqual({ action: 'scout' });
    expect(farmPlan({ barbarian: true }, [scoutRow(5)], NOW, 1).action).toBe('raid');
    expect(farmPlan({ barbarian: true }, [scoutRow(5, { ...emptyUnits(), spearman: 10 })], NOW, 1)).toEqual({ action: 'skip' });
    expect(farmPlan({ barbarian: false }, [], NOW, 1)).toEqual({ action: 'skip' });
  });

  it('retourne espionner un barbare dont le rapport est trop ancien', () => {
    expect(farmPlan({ barbarian: true }, [scoutRow(60 * 30)], NOW, 1)).toEqual({ action: 'scout' });
  });
});
