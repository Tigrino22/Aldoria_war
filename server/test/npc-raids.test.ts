import { describe, expect, it } from 'vitest';
import { emptyUnits } from '@aldoria/shared';
import { farmPlan, raidGroup } from '../src/game/npc-raids';

const NOW = new Date('2030-01-15T12:00:00Z');
const full = { wood: 500, clay: 500, iron: 500, wheat: 500 };
const buildings = { townhall: 1, woodcutter: 1, claypit: 1, ironmine: 1, farm: 1, warehouse: 1, market: 0, barracks: 0, wall: 0 };
const scoutRow = (minutesAgo: number, troops = emptyUnits()) => ({
  type: 'scout',
  created_at: new Date(NOW.getTime() - minutesAgo * 60_000),
  data: { intel: { resources: full, buildings, troops } },
});

describe('pillage intensif des PNJ', () => {
  it('un pillage compte 50 épéistes depuis un village offensif, 50 lanciers depuis un village défensif', () => {
    const home = { ...emptyUnits(), spearman: 120, halberdier: 50, swordsman: 80, cavalry: 10, scout: 5 };
    expect(raidGroup(home, 'offense', 0)).toEqual({ ...emptyUnits(), swordsman: 50 });
    expect(raidGroup(home, 'defense', 0)).toEqual({ ...emptyUnits(), spearman: 50 });
    // Moins de 50 de l'unité du rôle : pas de pillage, même avec d'autres troupes au village.
    expect(raidGroup({ ...home, swordsman: 49 }, 'offense', 0)).toBeNull();
  });

  it('espionne un barbare inconnu, pille un barbare vu vide, laisse un village défendu', () => {
    expect(farmPlan({ barbarian: true }, [], NOW, 1)).toEqual({ action: 'scout' });
    expect(farmPlan({ barbarian: true }, [scoutRow(5)], NOW, 1).action).toBe('raid');
    expect(farmPlan({ barbarian: true }, [scoutRow(5, { ...emptyUnits(), spearman: 10 })], NOW, 1)).toEqual({ action: 'skip' });
    expect(farmPlan({ barbarian: false }, [], NOW, 1)).toEqual({ action: 'skip' });
  });

  it('retourne espionner un barbare dont le rapport est trop ancien', () => {
    expect(farmPlan({ barbarian: true }, [scoutRow(60 * 60)], NOW, 1)).toEqual({ action: 'scout' });
  });
});
