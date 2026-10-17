import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { STARTING_BUILDINGS, emptyUnits, type UnitCounts } from '@aldoria/shared';
import { pool, tx } from '../src/db';
import { env } from '../src/env';
import { migrate } from '../src/migrate';
import { Outbox } from '../src/notify';
import { processDueEvents } from '../src/game/commands';
import { createNpc, npcThink, setNpcRandom } from '../src/game/npc';
import { createVillage, getTroops, setTroops } from '../src/game/village';

const HOUR = 3_600_000;
const NOON = new Date('2030-01-15T12:00:00Z');
const troops = (u: Partial<UnitCounts>): UnitCounts => ({ ...emptyUnits(), ...u });

async function homeOf(npc: number) {
  return (await pool.query('SELECT id, x, y FROM villages WHERE owner_id = $1 ORDER BY id', [npc])).rows[0] as { id: number; x: number; y: number };
}

async function barbarian(x: number, y: number, resources = 100): Promise<number> {
  return tx((c) =>
    createVillage(c, { ownerId: null, name: `Barbare ${x}|${y}`, x, y, buildings: { ...STARTING_BUILDINGS }, resources: { wood: resources, clay: resources, iron: resources, wheat: resources }, at: NOON }),
  );
}

/** Le PNJ a vu ce village vide (et ses ressources) juste avant `at`. */
async function scouted(npc: number, target: number, at: Date) {
  await pool.query(`INSERT INTO reports (player_id, type, title, data, created_at) VALUES ($1, 'scout', 'Espionnage', $2::jsonb, $3)`, [
    npc,
    JSON.stringify({ attacker: {}, defender: { village: { id: target } }, intel: { resources: { wood: 5000, clay: 5000, iron: 5000, wheat: 5000 }, buildings: { wall: 0 }, troops: emptyUnits() } }),
    at,
  ]);
}

const sentFrom = async (villageId: number) =>
  (await pool.query("SELECT units, target_village_id FROM commands WHERE home_village_id = $1 AND type = 'attack' ORDER BY id", [villageId])).rows as {
    units: Record<string, number>;
    target_village_id: number;
  }[];

describe('PNJ : nobles, conquêtes et pillage', () => {
  beforeAll(async () => {
    await migrate(true);
    env.npcIntercept = 0;
    let seed = 7;
    setNpcRandom(() => ((seed = (seed * 1664525 + 1013904223) % 4294967296) / 4294967296));
  });
  afterAll(async () => {
    await pool.end();
  });

  beforeEach(async () => {
    await pool.query('DELETE FROM villages WHERE owner_id IS NULL');
    await pool.query("UPDATE villages SET x = x + 200 WHERE owner_id IN (SELECT id FROM players WHERE is_npc)");
  });

  it('dès que ses bâtiments le permettent, un PNJ frappe sa lettre de noblesse et recrute un noble', async () => {
    const npc = await tx((c) => createNpc(c, NOON, 'defense'));
    const home = await homeOf(npc);
    await pool.query(
      `UPDATE villages SET buildings = buildings || '{"townhall": 10, "barracks": 10, "warehouse": 14, "farm": 10}'::jsonb,
       wood = 14000, clay = 14000, iron = 14000, wheat = 14000 WHERE id = $1`,
      [home.id],
    );
    await tx((c) => npcThink(c, new Outbox(), npc, NOON));
    // La lettre est frappée ; le noble attend ses ressources et rien d'autre ne les entame.
    expect((await pool.query('SELECT letters_minted FROM players WHERE id = $1', [npc])).rows[0].letters_minted).toBe(1);
    expect((await pool.query('SELECT count(*)::int AS n FROM build_queue WHERE village_id = $1', [home.id])).rows[0].n).toBe(0);
    await pool.query('UPDATE villages SET wood = 14000, clay = 14000, iron = 14000, wheat = 14000 WHERE id = $1', [home.id]);
    await tx((c) => npcThink(c, new Outbox(), npc, new Date(NOON.getTime() + 60_000)));
    const queue = (await pool.query('SELECT unit, count FROM recruit_queue WHERE village_id = $1', [home.id])).rows;
    expect(queue).toContainEqual({ unit: 'noble', count: 1 });
  });

  it('un PNJ défensif pille avec 50 lanciers, un PNJ offensif avec 50 épéistes, autant de fois que ses troupes le permettent', async () => {
    for (const [type, unit, o] of [['defense', 'spearman', 500], ['offense', 'swordsman', 600]] as const) {
      await pool.query('DELETE FROM villages WHERE owner_id IS NULL');
      const npc = await tx((c) => createNpc(c, NOON, type));
      const home = await homeOf(npc);
      await pool.query('UPDATE villages SET x = $2, y = $3 WHERE id = $1', [home.id, o, o]);
      await tx((c) => setTroops(c, home.id, home.id, troops({ [unit]: 175, scout: 2 })));
      const targets = [await barbarian(o + 3, o, 3000), await barbarian(o, o + 4, 3000), await barbarian(o - 4, o, 3000), await barbarian(o, o - 5, 3000)];
      for (const t of targets) await scouted(npc, t, new Date(NOON.getTime() - 60_000));
      await tx((c) => npcThink(c, new Outbox(), npc, NOON));
      const raids = (await sentFrom(home.id)).filter((r) => targets.includes(r.target_village_id) && !r.units.scout);
      expect(raids).toHaveLength(3);
      for (const r of raids) expect(r.units).toEqual(expect.objectContaining({ [unit]: 50 }));
      for (const r of raids) expect(Object.entries(r.units).filter(([k, n]) => k !== unit && n > 0)).toEqual([]);
    }
  });

  it('un PNJ qui a un noble part conquérir un village barbare voisin, et finit par le prendre', async () => {
    const npc = await tx((c) => createNpc(c, NOON, 'offense'));
    const home = await homeOf(npc);
    await pool.query('UPDATE villages SET x = $2, y = $3 WHERE id = $1', [home.id, 700, 700]);
    const army = troops({ swordsman: 300, scout: 20, noble: 2 });
    await tx((c) => setTroops(c, home.id, home.id, army));
    const target = await barbarian(703, 700);
    let t = NOON;
    let nobleAttacks = 0;
    for (let i = 0; i < 100; i++) {
      await tx((c) => npcThink(c, new Outbox(), npc, t));
      t = new Date(t.getTime() + HOUR / 2);
      await processDueEvents(t);
      nobleAttacks = (await sentFrom(home.id)).filter((r) => r.target_village_id === target && r.units.noble > 0).length;
      if ((await pool.query('SELECT owner_id FROM villages WHERE id = $1', [target])).rows[0].owner_id === npc) break;
      // L'armée garde ses effectifs d'une vague à l'autre (les pertes ne sont pas l'objet du test).
      const back = await tx((c) => getTroops(c, home.id, home.id));
      if (back.noble === 0 && nobleAttacks === 0) await tx((c) => setTroops(c, home.id, home.id, army));
    }
    expect(nobleAttacks).toBeGreaterThan(0);
    expect((await pool.query('SELECT owner_id FROM villages WHERE id = $1', [target])).rows[0].owner_id).toBe(npc);
    // Deux villages : la gestion devient mixte, le second village suit le modèle défensif.
    const villages = (await pool.query('SELECT id FROM villages WHERE owner_id = $1 ORDER BY id', [npc])).rows;
    expect(villages).toHaveLength(2);
  });
});
