import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import {
  BASTION_GARRISON,
  STARTING_BUILDINGS,
  emptyUnits,
  generateSeeds,
  populationOf,
  provinceCount,
  provinceGrid,
  provinceNeighbours,
  recruitTime,
  type UnitCounts,
} from '@aldoria/shared';
import { pool, tx } from '../src/db';
import { env } from '../src/env';
import { migrate } from '../src/migrate';
import { Outbox } from '../src/notify';
import { processDueEvents, sendCommand } from '../src/game/commands';
import { bastionName, ensureProvinces, processProvinces, provinceBonuses, provincesState } from '../src/game/provinces';
import { createVillage, enqueueRecruit, getTroops, loadVillage } from '../src/game/village';

const MIN = 60_000;
const HOUR = 60 * MIN;
const T0 = new Date('2030-06-01T10:00:00Z');
const units = (u: Partial<UnitCounts>): UnitCounts => ({ ...emptyUnits(), ...u });
const at = (ms: number) => new Date(T0.getTime() + ms);

/** Générateur pseudo-aléatoire reproductible. */
function seeded(seed: number) {
  let s = seed;
  return () => {
    s = (s * 1664525 + 1013904223) % 4294967296;
    return s / 4294967296;
  };
}
async function player(name: string, tribeId: number | null = null) {
  return (await pool.query("INSERT INTO players (username, password_hash, tribe_id) VALUES ($1, 'x', $2) RETURNING id", [name, tribeId])).rows[0].id as number;
}
async function tribe(name: string, tag: string) {
  return (await pool.query('INSERT INTO tribes (name, tag) VALUES ($1, $2) RETURNING id', [name, tag])).rows[0].id as number;
}
/** Un village près d'un point, sur une case libre. */
async function villageNear(owner: number, x: number, y: number, troops: Partial<UnitCounts> = {}) {
  for (let r = 1; r < 10; r++)
    for (const [dx, dy] of [[r, 0], [0, r], [-r, 0], [0, -r], [r, r], [-r, -r]]) {
      const free = (await pool.query('SELECT 1 FROM villages WHERE x = $1 AND y = $2', [x + dx, y + dy])).rows.length === 0;
      if (!free || x + dx < 0 || y + dy < 0 || x + dx >= env.mapSize || y + dy >= env.mapSize) continue;
      return tx((c) =>
        createVillage(c, {
          ownerId: owner,
          name: `V${x + dx}-${y + dy}`,
          x: x + dx,
          y: y + dy,
          buildings: { ...STARTING_BUILDINGS, warehouse: 10, barracks: 5 },
          resources: { wood: 50_000, clay: 50_000, iron: 50_000, wheat: 50_000 },
          at: T0,
          troops: units(troops),
        }),
      );
    }
  throw new Error('pas de place');
}
const send = (playerId: number, from: number, to: number, type: 'attack' | 'support', u: Partial<UnitCounts>, now: Date) =>
  tx((c) => sendCommand(c, new Outbox(), playerId, from, { type, targetId: to, units: u }, now));
const arrival = async (id: number) => new Date((await pool.query('SELECT arrive_at FROM commands WHERE id = $1', [id])).rows[0].arrive_at);
const province = async (id: number) => (await pool.query('SELECT * FROM provinces WHERE id = $1', [id])).rows[0];
const reportsOf = async (playerId: number) => (await pool.query('SELECT type, title FROM reports WHERE player_id = $1 ORDER BY id', [playerId])).rows;
const ARMY = { cavalry: 3000, swordsman: 2000, ram: 60, noble: 1 };

describe('provinces : découpage de la carte', () => {
  it('tire la Terre sainte au centre et des provinces voisines qui couvrent toute la carte', () => {
    const size = 100;
    const raw = generateSeeds(size, seeded(7));
    expect(raw).toHaveLength(provinceCount(size) + 1);
    expect(raw[0]).toMatchObject({ kind: 'holy', x: 50, y: 50 });
    const seeds = raw.map((s, i) => ({ ...s, id: i + 1 }));
    const grid = provinceGrid(size, seeds);
    expect(grid.every((g) => g >= 0)).toBe(true);
    const sizes = seeds.map((_, i) => grid.filter((g) => g === i).length);
    // Chaque province a des cases, de tailles variées ; la Terre sainte est plus petite que la moyenne.
    expect(Math.min(...sizes)).toBeGreaterThan(20);
    expect(Math.max(...sizes)).toBeGreaterThan(Math.min(...sizes) * 1.5);
    expect(sizes[0]).toBeLessThan((size * size) / seeds.length);
    const around = provinceNeighbours(grid, size, seeds.length);
    expect(around[0].size).toBeGreaterThanOrEqual(3);
    for (const [i, set] of around.entries()) for (const j of set) expect(around[j].has(i)).toBe(true);
  });

  it('nomme les bastions d’après leur province', () => {
    expect(bastionName('Marche de Valbrune')).toBe('Bastion de Valbrune');
    expect(bastionName('Comté d’Aubefer')).toBe('Bastion d’Aubefer');
    expect(bastionName('Val des Saules')).toBe('Bastion des Saules');
  });
});

describe('provinces : bastions, bannière et Terre sainte', () => {
  let ids: number[] = [];
  let holy: any;
  let first: any;

  beforeAll(async () => {
    await migrate(true);
    (env as any).provinces = 1;
    (env as any).provinceHoldHours = 12;
    (env as any).holyAccess = 2;
    (env as any).holyHoldDays = 3;
    (env as any).provinceBonus = 10;
    await tx((c) => ensureProvinces(c, T0, seeded(3)));
    await tx((c) => ensureProvinces(c, T0, seeded(4)));
    ids = (await pool.query('SELECT id FROM provinces ORDER BY id')).rows.map((r) => r.id);
    holy = (await pool.query("SELECT * FROM provinces WHERE kind = 'holy'")).rows[0];
    first = (await pool.query("SELECT * FROM provinces WHERE kind = 'province' ORDER BY id LIMIT 1")).rows[0];
  });
  afterAll(async () => {
    await pool.end();
  });

  it('dresse un bastion gardé dans chaque province, une seule fois', async () => {
    expect(ids).toHaveLength(provinceCount(env.mapSize) + 1);
    const b = await tx((c) => loadVillage(c, first.bastion_village_id));
    expect(b).toMatchObject({ kind: 'bastion', owner_id: null });
    expect(b.buildings.wall).toBe(10);
    expect(populationOf(await tx((c) => getTroops(c, b.id, b.id)))).toBeGreaterThan(BASTION_GARRISON - 10);
    expect(first.bonus).not.toBeNull();
    expect(holy.bonus).toBeNull();
    const map = await tx((c) => provincesState(c, 0, T0));
    expect(map.provinces.find((p) => p.kind === 'holy')!.neighbours.length).toBeGreaterThanOrEqual(2);
  });

  it('plante la bannière avec un noble, contrôle la province après la tenue et donne son bonus', async () => {
    const t = await tribe('Les Loups', 'LOUP');
    const p = await player('Aymeric', t);
    const mate = await player('Bertrade', t);
    const v = await villageNear(p, first.x, first.y, ARMY);
    const mateV = await villageNear(mate, first.x, first.y, { spearman: 100 });
    const { id } = await send(p, v, first.bastion_village_id, 'attack', ARMY, T0);
    const t1 = await arrival(id);
    await processDueEvents(t1);
    const pr = await province(first.id);
    expect(pr.holder_tribe_id).toBe(t);
    expect((await reportsOf(p)).at(-1).title).toContain('bannière plantée');
    // Les survivants gardent le bastion.
    expect(totalOf(await tx((c) => getTroops(c, first.bastion_village_id, v)))).toBeGreaterThan(0);

    // Pas encore de bonus avant la fin de la tenue.
    expect((await tx((c) => provinceBonuses(c, mate, at(HOUR + 1))))[first.bonus as 'wood']).toBe(0);
    const done = new Date(t1.getTime() + 12 * HOUR + 1000);
    await tx((c) => processProvinces(c, new Outbox(), done));
    expect((await reportsOf(mate)).at(-1).title).toContain(`contrôle ${first.name}`);
    const bonus = await tx((c) => provinceBonuses(c, mate, done));
    expect(bonus[first.bonus as 'wood']).toBeCloseTo(0.1);

    // Le bonus de recrutement accélère la file (vérifié sur une province de recrutement, s'il y en a une).
    const recruit = (await pool.query("SELECT id FROM provinces WHERE bonus = 'recruit' LIMIT 1")).rows[0];
    if (recruit) {
      await pool.query('UPDATE provinces SET holder_tribe_id = $2, holder_since = $3 WHERE id = $1', [recruit.id, t, T0]);
      await tx((c) => enqueueRecruit(c, mateV, 'spearman', 1, done));
      const q = (await pool.query('SELECT unit_seconds FROM recruit_queue WHERE village_id = $1', [mateV])).rows[0];
      expect(q.unit_seconds).toBeCloseTo(recruitTime('spearman', 5, env.worldSpeed) / 1.1, 3);
      await pool.query('UPDATE provinces SET holder_tribe_id = NULL, holder_since = NULL WHERE id = $1', [recruit.id]);
    }

    // Un renfort d'une autre tribu est refusé, celui d'un membre accepté.
    const other = await player('Odon', await tribe('Les Ours', 'OURS'));
    const otherV = await villageNear(other, first.x, first.y, { spearman: 50 });
    await expect(send(other, otherV, first.bastion_village_id, 'support', { spearman: 10 }, done)).rejects.toThrow(/tient la bannière/);
    await send(mate, mateV, first.bastion_village_id, 'support', { spearman: 10 }, done);
  });

  it('une attaque victorieuse sans noble abat la bannière et retire le bonus', async () => {
    const t = await tribe('Les Aigles', 'AIGL');
    const p = await player('Clothaire', t);
    const before = await province(first.id);
    const v = await villageNear(p, first.x, first.y, { cavalry: 6000, ram: 60 });
    const now = new Date(before.holder_since.getTime() + 13 * HOUR);
    const { id } = await send(p, v, first.bastion_village_id, 'attack', { cavalry: 6000, ram: 60 }, now);
    await processDueEvents(await arrival(id));
    const pr = await province(first.id);
    expect(pr.holder_tribe_id).toBeNull();
    const formerMember = (await pool.query("SELECT id FROM players WHERE username = 'Bertrade'")).rows[0].id;
    expect((await reportsOf(formerMember)).some((r) => r.title.includes('votre bannière est tombée'))).toBe(true);
    expect((await tx((c) => provinceBonuses(c, formerMember, now)))[first.bonus as 'wood']).toBe(0);
  });

  it('le Sanctuaire n’est ouvert qu’aux tribus qui contrôlent assez de provinces voisines, et sa tenue gagne le monde', async () => {
    const t = await tribe('Les Templiers', 'TEMP');
    const p = await player('Hugues', t);
    const big = { cavalry: 9000, swordsman: 6000, ram: 210, noble: 1 };
    const v = await villageNear(p, holy.x, holy.y, big);
    await expect(send(p, v, holy.bastion_village_id, 'attack', big, T0)).rejects.toThrow(/Sanctuaire/);
    // Les éclaireurs y vont librement.
    const state = await tx((c) => provincesState(c, p, T0));
    const around = state.provinces.find((x) => x.kind === 'holy')!.neighbours;
    await pool.query('UPDATE provinces SET holder_tribe_id = $2, holder_since = $3 WHERE id = ANY($1::int[])', [around.slice(0, 2), t, at(-13 * HOUR)]);
    expect((await tx((c) => provincesState(c, p, T0))).mine).toMatchObject({ holyNeighbours: 2, canAttackHoly: true });
    const { id } = await send(p, v, holy.bastion_village_id, 'attack', big, T0);
    const t1 = await arrival(id);
    await processDueEvents(t1);
    expect((await province(holy.id)).holder_tribe_id).toBe(t);

    await tx((c) => processProvinces(c, new Outbox(), new Date(t1.getTime() + 2 * 24 * HOUR)));
    expect((await pool.query('SELECT count(*)::int AS n FROM world_victories')).rows[0].n).toBe(0);
    await tx((c) => processProvinces(c, new Outbox(), new Date(t1.getTime() + 3 * 24 * HOUR + 1000)));
    const win = await tx((c) => provincesState(c, p, new Date(t1.getTime() + 3 * 24 * HOUR + 1000)));
    expect(win.victory).toMatchObject({ tribeTag: 'TEMP', tribeName: 'Les Templiers' });
    expect((await pool.query("SELECT 1 FROM player_titles WHERE player_id = $1 AND title = 'master'", [p])).rows).toHaveLength(1);
  });
});

function totalOf(u: UnitCounts) {
  return Object.values(u).reduce((a, b) => a + b, 0);
}
