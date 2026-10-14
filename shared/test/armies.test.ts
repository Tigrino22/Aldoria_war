import { describe, expect, it } from 'vitest';
import { armyKinds, armySize, sightWindow } from '../src/armies';

describe('armées sur la carte', () => {
  it('ne montre que la portion du trajet à portée de vue', () => {
    // Trajet horizontal de (0|0) à (20|0), village en (10|3), vue 5 : visible de x = 6 à x = 14.
    const w = sightWindow({ x: 0, y: 0 }, { x: 20, y: 0 }, [{ x: 10, y: 3 }], 5)!;
    expect(w[0]).toBeCloseTo(0.3);
    expect(w[1]).toBeCloseTo(0.7);
    // Trop loin : rien.
    expect(sightWindow({ x: 0, y: 0 }, { x: 20, y: 0 }, [{ x: 10, y: 6 }], 5)).toBeNull();
    // Départ dans la zone de vue : coupé à 0.
    expect(sightWindow({ x: 0, y: 0 }, { x: 20, y: 0 }, [{ x: 0, y: 0 }], 5)).toEqual([0, 0.25]);
    // Deux villages : l'enveloppe des deux portions.
    const two = sightWindow({ x: 0, y: 0 }, { x: 20, y: 0 }, [{ x: 0, y: 0 }, { x: 20, y: 0 }], 5)!;
    expect(two).toEqual([0, 1]);
  });

  it('classe les armées en trois tailles', () => {
    expect(armySize(10)).toBe(1);
    expect(armySize(500)).toBe(2);
    expect(armySize(5000)).toBe(3);
  });

  it('donne les genres d’unités du plus gros au plus petit', () => {
    const u = { spearman: 0, halberdier: 0, swordsman: 300, scout: 0, cavalry: 200, ram: 10, noble: 1 };
    expect(armyKinds(u)).toEqual(['horse', 'foot', 'noble']);
    expect(armyKinds({ ...u, swordsman: 0, cavalry: 0, ram: 0, noble: 0 })).toEqual(['foot']);
    expect(armyKinds({ ...u, swordsman: 3000, ram: 30 })).toEqual(['foot', 'horse', 'noble']);
  });
});
