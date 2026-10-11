import { describe, expect, it } from 'vitest';
import { STARTING_BUILDINGS, emptyResources, emptyUnits, hiddenResources, resourceProduction, warehouseCapacity } from '@aldoria/shared';
import { estimateLoot, pickIntel } from '../src/game/intel';

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

describe('butin estimé pour l’assistant de pillage', () => {
  const buildings = { ...STARTING_BUILDINGS, woodcutter: 1, claypit: 1, ironmine: 1, farm: 1, warehouse: 1 };
  const seen = { resources: { wood: 300, clay: 200, iron: 100, wheat: 200 }, buildings };
  const scout = (at: string, intel: unknown) => ({ type: 'scout', created_at: at, data: { attacker: side(null, null), defender: side(null, null), intel } });
  const hidden = hiddenResources(1);
  const prod = resourceProduction(1);

  it('ajoute la production depuis l’espionnage et retire la cachette', () => {
    const est = estimateLoot([scout('2030-01-01T00:00:00Z', { ...seen, troops: emptyUnits() })], new Date('2030-01-01T02:00:00Z'), 1, emptyUnits());
    expect(est?.resources.wood).toBe(300 + 2 * prod - hidden);
    expect(est?.resources.wheat).toBe(200 + 2 * prod - hidden);
    expect(est?.total).toBe(800 + 8 * prod - 4 * hidden);
    expect(est?.seenAt).toBe('2030-01-01T00:00:00.000Z');
  });

  it('plafonne à l’entrepôt et déduit les pillages arrivés depuis', () => {
    const cap = warehouseCapacity(1);
    const later = { type: 'attack', created_at: '2030-02-01T00:00:00Z', data: { attackerWins: true, loot: { wood: 400, clay: 0, iron: 0, wheat: 0 }, intel: null } };
    const est = estimateLoot([later, scout('2030-01-01T00:00:00Z', { ...seen, troops: emptyUnits() })], new Date('2030-03-01T00:00:00Z'), 1, null);
    expect(est?.resources.wood).toBe(cap - 400 - hidden);
    expect(est?.resources.clay).toBe(cap - hidden);
  });

  it('se sert des éclaireurs survivants d’une attaque et renvoie null sans aucun éclaireur', () => {
    const attack = { type: 'attack', created_at: '2030-01-01T00:00:00Z', data: { attackerWins: true, loot: { wood: 50, clay: 0, iron: 0, wheat: 0 }, intel: seen } };
    expect(estimateLoot([attack], new Date('2030-01-01T00:00:00Z'), 1, null)?.resources.wood).toBe(300 - hidden);
    expect(estimateLoot([scout('2030-01-01T00:00:00Z', null)], new Date(), 1, null)).toBeNull();
    expect(estimateLoot([], new Date(), 1, null)).toBeNull();
  });
});
