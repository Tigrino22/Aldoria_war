import { describe, expect, it } from 'vitest';
import { STARTING_BUILDINGS, emptyResources, emptyUnits } from '@aldoria/shared';
import { pickIntel } from '../src/game/intel';

const side = (units: ReturnType<typeof emptyUnits> | null, losses: ReturnType<typeof emptyUnits> | null) => ({
  playerName: 'X',
  village: { id: 7, name: 'Cible', x: 1, y: 1 },
  units,
  losses,
});

describe('renseignement sur une cible', () => {
  it('prend l’espionnage réussi le plus récent', () => {
    const troops = { ...emptyUnits(), spearman: 12 };
    const intel = pickIntel([
      { type: 'scout', created_at: '2030-01-02T00:00:00Z', data: { attacker: side(null, null), defender: side(null, null), intel: { resources: emptyResources(), buildings: { ...STARTING_BUILDINGS, wall: 4 }, troops } } },
      { type: 'scout', created_at: '2030-01-01T00:00:00Z', data: { attacker: side(null, null), defender: side(null, null), intel: null } },
    ]);
    expect(intel).toMatchObject({ source: 'scout', wall: 4, troops: { spearman: 12 } });
  });

  it('ignore un espionnage raté et se rabat sur une attaque dont l’armée est revenue', () => {
    const before = { ...emptyUnits(), spearman: 30 };
    const losses = { ...emptyUnits(), spearman: 20 };
    const intel = pickIntel([
      { type: 'scout', created_at: '2030-01-03T00:00:00Z', data: { attacker: side(null, null), defender: side(null, null), intel: null } },
      {
        type: 'attack',
        created_at: '2030-01-02T00:00:00Z',
        data: { attackerWins: false, attacker: side(before, losses), defender: side(before, losses), wall: 5, wallDamage: { before: 5, after: 3 }, loot: null, loyalty: null, conquered: false },
      },
    ]);
    expect(intel).toMatchObject({ source: 'attack', wall: 3, troops: { spearman: 10 } });
  });

  it('ne sait rien quand l’attaquant n’a rien vu', () => {
    const intel = pickIntel([
      { type: 'attack', created_at: '2030-01-02T00:00:00Z', data: { attackerWins: false, attacker: side(emptyUnits(), emptyUnits()), defender: side(null, null), wall: null, loot: null, loyalty: null, conquered: false } },
    ]);
    expect(intel).toBeNull();
  });
});
