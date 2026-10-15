import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import {
  STARTING_BUILDINGS,
  emptyUnits,
  generateSeeds,
  populationOf,
  provinceCount,
  provinceGrid,
  provinceNeighbours,
  provinceTiers,
  recruitTime,
  travelTime,
  type UnitCounts,
} from '@aldoria/shared';
import { pool, tx } from '../src/db';
import { env } from '../src/env';
import { migrate } from '../src/migrate';
import { Outbox } from '../src/notify';
import { processDueEvents, sendCommand } from '../src/game/commands';
import { bastionName, ensureProvinces, processProvinces, provinceBonuses, provincesState, refreshNeutralBastions, tierRules } from '../src/game/provinces';
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

  it('classe les provinces en trois niveaux selon leur distance à la Terre sainte', () => {
    const size = 100;
    const seeds = generateSeeds(size, seeded(7)).map((s, i) => ({ ...s, id: i + 1 }));
    const around = provinceNeighbours(provinceGrid(size, seeds), size, seeds.length);
    const tiers = provinceTiers(seeds, around, 0);
    expect(tiers[0]).toBe(0);
    for (const [i, t] of tiers.entries()) if (i > 0) expect(t === 3).toBe(around[0].has(i));
    // Les autres : la moitié la plus proche de la Terre sainte en niveau 2.
    const d = (i: number) => Math.hypot(seeds[i].x - seeds[0].x, seeds[i].y - seeds[0].y);
    const two = tiers.flatMap((t, i) => (t === 2 ? [d(i)] : []));
    const one = tiers.flatMap((t, i) => (t === 1 ? [d(i)] : []));
    expect(Math.abs(two.length - one.length)).toBeLessThanOrEqual(1);
    expect(Math.max(...two)).toBeLessThanOrEqual(Math.min(...one));
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
    Object.assign(env, { provinceGarrison1: 1500, provinceGarrison2: 3000, provinceGarrison3: 6000, provinceWall1: 5, provinceWall2: 10, provinceWall3: 15 });
    Object.assign(env, { provinceBonus1: 5, provinceBonus2: 10, provinceBonus3: 15 });
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
    expect([1, 2, 3]).toContain(first.tier);
    expect(b.buildings.wall).toBe(tierRules(first.tier).wall);
    expect(populationOf(await tx((c) => getTroops(c, b.id, b.id)))).toBeGreaterThan(tierRules(first.tier).garrison - 10);
    // Les provinces qui bordent la Terre sainte sont de niveau 3, la garde grandit avec le niveau.
    const all = (await pool.query('SELECT p.tier, p.bonus, (v.buildings->>\'wall\')::int AS wall FROM provinces p JOIN villages v ON v.id = p.bastion_village_id WHERE p.kind = \'province\'')).rows;
    // Petite carte de test : toutes les provinces bordent la Terre sainte.
    expect(all.every((r) => r.tier === 3)).toBe(true);
    for (const r of all) expect(r.wall).toBe(tierRules(r.tier).wall);
    expect(all.some((r) => r.bonus === 'speed')).toBe(true);
    expect(holy.tier).toBe(0);
    expect(first.bonus).not.toBeNull();
    expect(holy.bonus).toBeNull();
    const map = await tx((c) => provincesState(c, 0, T0));
    const holyView = map.provinces.find((p) => p.kind === 'holy')!;
    expect(holyView.neighbours.length).toBeGreaterThanOrEqual(2);
    for (const id of holyView.neighbours) expect(map.provinces.find((p) => p.id === id)).toMatchObject({ tier: 3, bonusPercent: 15 });
    expect(map.tiers.map((t) => t.bonus)).toEqual([5, 10, 15]);
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
    expect(bonus[first.bonus as 'wood']).toBeCloseTo(tierRules(first.tier).bonus / 100);

    // Le bonus de recrutement accélère la file (vérifié sur une province de recrutement, s'il y en a une).
    const recruit = (await pool.query("SELECT id, tier FROM provinces WHERE bonus = 'recruit' AND id <> $1 LIMIT 1", [first.id])).rows[0];
    if (recruit) {
      await pool.query('UPDATE provinces SET holder_tribe_id = $2, holder_since = $3 WHERE id = $1', [recruit.id, t, T0]);
      await tx((c) => enqueueRecruit(c, mateV, 'spearman', 1, done));
      const q = (await pool.query('SELECT unit_seconds FROM recruit_queue WHERE village_id = $1', [mateV])).rows[0];
      const extra = first.bonus === 'recruit' ? tierRules(first.tier).bonus : 0;
      expect(q.unit_seconds).toBeCloseTo(recruitTime('spearman', 5, env.worldSpeed) / (1 + (tierRules(recruit.tier).bonus + extra) / 100), 3);
      await pool.query('UPDATE provinces SET holder_tribe_id = NULL, holder_since = NULL WHERE id = $1', [recruit.id]);
    }

    // Une province de vitesse raccourcit les trajets des troupes de la tribu.
    const speed = (await pool.query("SELECT id, tier FROM provinces WHERE bonus = 'speed' AND id <> $1 LIMIT 1", [first.id])).rows[0];
    await pool.query('UPDATE provinces SET holder_tribe_id = $2, holder_since = $3 WHERE id = $1', [speed.id, t, T0]);
    const target = await loadVillageAt(mateV);
    const bastionV = await tx((c) => loadVillage(c, first.bastion_village_id));
    const { id: fast } = await send(mate, mateV, first.bastion_village_id, 'support', { spearman: 5 }, done);
    const extraSpeed = first.bonus === 'speed' ? tierRules(first.tier).bonus : 0;
    const expected = travelTime(units({ spearman: 5 }), target, bastionV, env.worldSpeed, (tierRules(speed.tier).bonus + extraSpeed) / 100);
    expect(((await arrival(fast)).getTime() - done.getTime()) / 1000).toBeCloseTo(expected, 0);
    expect(expected).toBeLessThan(travelTime(units({ spearman: 5 }), target, bastionV, env.worldSpeed));
    await pool.query('UPDATE provinces SET holder_tribe_id = NULL, holder_since = NULL WHERE id = $1', [speed.id]);

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

  it('l’administrateur change la garde d’un niveau : les bastions sans bannière la reçoivent', async () => {
    const free = (await pool.query("SELECT tier, bastion_village_id FROM provinces WHERE kind = 'province' AND holder_tribe_id IS NULL LIMIT 1")).rows[0];
    expect(free.tier).toBe(3);
    (env as any).provinceGarrison3 = 4000;
    (env as any).provinceWall3 = 12;
    await tx((c) => refreshNeutralBastions(c));
    const b = await tx((c) => loadVillage(c, free.bastion_village_id));
    expect(b.buildings.wall).toBe(12);
    expect(populationOf(await tx((c) => getTroops(c, b.id, b.id)))).toBeGreaterThan(3990);
    Object.assign(env, { provinceGarrison3: 6000, provinceWall3: 15 });
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

async function loadVillageAt(id: number) {
  return tx((c) => loadVillage(c, id));
}

function totalOf(u: UnitCounts) {
  return Object.values(u).reduce((a, b) => a + b, 0);
}
