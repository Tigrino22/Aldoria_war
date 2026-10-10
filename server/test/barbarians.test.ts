import { describe, expect, it } from 'vitest';
import { STARTING_BUILDINGS, emptyUnits } from '@aldoria/shared';
import { barbarianCap, barbarianTier, barbarianTroopTarget, growBarbarian } from '../src/game/barbarians';

const seeded = () => {
  let s = 12345;
  return () => ((s = (s * 1664525 + 1013904223) % 4294967296) / 4294967296);
};

describe('barbares', () => {
  it('les villages lointains sont plus forts et le plafond monte avec l’âge du monde', () => {
    expect(barbarianTier(50, 50, 100)).toBe(2);
    expect(barbarianTier(0, 0, 100)).toBeGreaterThan(barbarianTier(50, 50, 100));
    expect(barbarianCap(3, 0)).toBe(3);
    expect(barbarianCap(3, 25)).toBe(5);
    expect(barbarianCap(19, 100)).toBe(20);
  });

  it('une garnison pillée revient vers sa cible sans la dépasser', () => {
    const cap = 4;
    const target = barbarianTroopTarget(cap);
    const rng = seeded();
    const partial = growBarbarian({ buildings: { ...STARTING_BUILDINGS }, troops: emptyUnits() }, 5, cap, rng);
    expect(partial.troops.spearman).toBeGreaterThan(0);
    expect(partial.troops.spearman).toBeLessThan(target.spearman);
    const full = growBarbarian({ buildings: { ...STARTING_BUILDINGS }, troops: emptyUnits() }, 1000, cap, rng);
    expect(full.troops.spearman).toBe(target.spearman);
    expect(full.troops.swordsman).toBe(target.swordsman);
  });

  it('les bâtiments montent, sans dépasser le plafond et sans créer de marché', () => {
    const grown = growBarbarian({ buildings: { ...STARTING_BUILDINGS }, troops: emptyUnits() }, 100_000, 5, seeded());
    for (const [key, level] of Object.entries(grown.buildings)) {
      expect(level).toBeLessThanOrEqual(5);
      if (key === 'market') expect(level).toBe(0);
    }
    expect(grown.buildings.barracks).toBe(5);
  });

  it('ne change rien quand il ne s’est écoulé aucun temps', () => {
    const r = growBarbarian({ buildings: { ...STARTING_BUILDINGS }, troops: emptyUnits() }, 0, 5, seeded());
    expect(r.changed).toBe(false);
  });
});
