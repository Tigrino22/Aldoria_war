import { describe, expect, it } from 'vitest';
import { armySize, sightWindow } from '../src/armies';

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
});
