import { describe, expect, it } from 'vitest';
import { armyKinds, armySize, sightWindow, interceptPoint } from '../src/armies';

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

describe('interceptPoint', () => {
  // De (0, 2) à (40, 2) en 400 s : 10 s par case.
  const path = { from: { x: 0, y: 2 }, to: { x: 40, y: 2 }, t0: 0, t1: 400_000 };
  it('trouve la première rencontre possible, sur le trajet', () => {
    const m = interceptPoint({ x: 20, y: 0 }, 5, path, 0)!;
    expect(m.y).toBe(2);
    // Nos troupes (5 s par case) couvrent la distance avant que l'armée n'y passe.
    expect(Math.hypot(m.x - 20, m.y) * 5000).toBeLessThanOrEqual(m.at);
    expect(m.at).toBeLessThan(200_000);
  });
  it('respecte la fenêtre imposée et renonce si nos troupes sont trop lentes', () => {
    const m = interceptPoint({ x: 20, y: 0 }, 5, path, 0, [180_000, 220_000])!;
    expect(m.at).toBeGreaterThanOrEqual(180_000);
    expect(interceptPoint({ x: 20, y: 0 }, 500, path, 0, [180_000, 220_000])).toBeNull();
    expect(interceptPoint({ x: 20, y: 0 }, 5, path, 400_000)).toBeNull();
  });
});
