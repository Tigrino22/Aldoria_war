import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { STARTING_BUILDINGS, emptyUnits, type UnitCounts } from '@aldoria/shared';
import { buildApp } from '../src/app';
import { pool, tx } from '../src/db';
import { migrate } from '../src/migrate';
import { createSession } from '../src/auth';
import { processDueEvents } from '../src/game/commands';
import { createVillage } from '../src/game/village';

let app: Awaited<ReturnType<typeof buildApp>>;
const units = (u: Partial<UnitCounts>): UnitCounts => ({ ...emptyUnits(), ...u });
let n = 0;

const player = async (name: string) =>
  (await pool.query("INSERT INTO players (username, password_hash) VALUES ($1, 'x') RETURNING id", [name])).rows[0].id as number;
const village = (owner: number | null, x: number, y: number, troops: Partial<UnitCounts> = {}) =>
  tx((c) =>
    createVillage(c, {
      ownerId: owner,
      name: `V${x}-${y}`,
      x,
      y,
      buildings: STARTING_BUILDINGS,
      resources: { wood: 100, clay: 100, iron: 100, wheat: 5000 },
      at: new Date(),
      troops: units(troops),
    }),
  );
/** Une armée étrangère qui passe à 2 cases au-dessus de (x, y), de 20 cases à gauche à 20 cases à droite, en 10 heures. */
async function passing(owner: number, x: number, y: number, type: string, u: Partial<UnitCounts>, loot: unknown = null) {
  const left = await village(owner, x - 20, y - 2);
  const right = await village(null, x + 20, y - 2);
  return (
    await pool.query(
      `INSERT INTO commands (type, origin_village_id, target_village_id, home_village_id, player_id, units, loot, sent_at, arrive_at)
       VALUES ($1, $2, $3, $2, $4, $5, $6, now() - interval '10 minutes', now() + interval '600 minutes') RETURNING id`,
      [type, left, right, owner, JSON.stringify(units(u)), loot ? JSON.stringify(loot) : null],
    )
  ).rows[0].id as number;
}
async function setup(troops: Partial<UnitCounts>) {
  n++;
  const meId = await player(`Guetteur${n}`);
  const x = 100 + n * 60;
  const homeId = await village(meId, x, 100, troops);
  const headers = { authorization: `Bearer ${await tx((c) => createSession(c, meId))}` };
  const enemy = await player(`Maraudeur${n}`);
  return { meId, homeId, x, headers, enemy };
}
const intercept = (s: { homeId: number; headers: Record<string, string> }, commandId: number, u: Partial<UnitCounts>) =>
  app.inject({ method: 'POST', url: `/api/villages/${s.homeId}/intercept`, headers: s.headers, payload: { commandId, units: u } });
const reportsOf = async (playerId: number) => (await pool.query('SELECT type, title, data FROM reports WHERE player_id = $1 ORDER BY id', [playerId])).rows;

describe('interception des armées en marche', () => {
  beforeAll(async () => {
    await migrate(true);
    app = await buildApp();
  });
  afterAll(async () => {
    await app.close();
    await pool.end();
  });

  it('livre bataille en rase campagne : les survivants adverses poursuivent leur route', async () => {
    const s = await setup({ swordsman: 300 });
    const target = await passing(s.enemy, s.x, 100, 'attack', { spearman: 2000 });
    const res = await intercept(s, target, { swordsman: 300 });
    expect(res.statusCode).toBe(200);
    const { id, arriveAt, meet } = res.json();
    expect(Math.abs(meet.y - 98)).toBeLessThan(0.01);
    expect(Date.parse(arriveAt)).toBeLessThan(Date.now() + 600 * 60_000);
    // Partie, l'interception n'apparaît pas dans les attaques entrantes du village visé.
    expect((await pool.query("SELECT type, target_command_id FROM commands WHERE id = $1", [id])).rows[0]).toEqual({ type: 'intercept', target_command_id: target });

    await processDueEvents(new Date(Date.parse(arriveAt) + 1000));
    const enemyCmd = (await pool.query('SELECT processed, units FROM commands WHERE id = $1', [target])).rows[0];
    expect(enemyCmd.processed).toBe(false);
    expect(enemyCmd.units.spearman).toBeLessThan(2000);
    expect(enemyCmd.units.spearman).toBeGreaterThan(0);
    const mine = await reportsOf(s.meId);
    expect(mine.at(-1)).toMatchObject({ type: 'attack' });
    expect(mine.at(-1).data.field).toEqual({ x: expect.any(Number), y: 98 });
    expect(mine.at(-1).data.wall).toBeNull();
    expect((await reportsOf(s.enemy)).at(-1)).toMatchObject({ type: 'defense' });
  });

  it("détruit une petite armée et ramasse son butin, puis rentre au village", async () => {
    const s = await setup({ swordsman: 500 });
    const target = await passing(s.enemy, s.x, 100, 'return', { spearman: 20 }, { wood: 300, clay: 200, iron: 100, wheat: 0 });
    const res = await intercept(s, target, { swordsman: 500 });
    expect(res.statusCode).toBe(200);
    const { arriveAt, meet } = res.json();
    await processDueEvents(new Date(Date.parse(arriveAt) + 1000));
    expect((await pool.query('SELECT processed FROM commands WHERE id = $1', [target])).rows[0].processed).toBe(true);
    const back = (await pool.query("SELECT * FROM commands WHERE player_id = $1 AND type = 'return' AND NOT processed", [s.meId])).rows[0];
    expect(back.loot).toEqual({ wood: 300, clay: 200, iron: 100, wheat: 0 });
    expect(back.meet_x).toBeCloseTo(meet.x, 3);
    const report = (await reportsOf(s.meId)).at(-1);
    expect(report.data.attackerWins).toBe(true);
    expect(report.title).toContain('armée détruite');

    const wood = (await pool.query('SELECT wood FROM villages WHERE id = $1', [s.homeId])).rows[0].wood;
    await processDueEvents(new Date(new Date(back.arrive_at).getTime() + 1000));
    const after = (await pool.query("SELECT wood FROM villages WHERE id = $1", [s.homeId])).rows[0].wood;
    expect(after).toBeGreaterThan(wood);
    const troops = (await pool.query('SELECT units FROM troops WHERE village_id = $1 AND home_village_id = $1', [s.homeId])).rows[0].units;
    expect(troops.swordsman).toBeGreaterThan(450);
  });

  it("rentre bredouille si l'armée a déjà disparu", async () => {
    const s = await setup({ swordsman: 100 });
    const target = await passing(s.enemy, s.x, 100, 'attack', { spearman: 50 });
    const { arriveAt } = (await intercept(s, target, { swordsman: 100 })).json();
    await pool.query('UPDATE commands SET processed = true WHERE id = $1', [target]);
    await processDueEvents(new Date(Date.parse(arriveAt) + 1000));
    expect((await reportsOf(s.meId)).at(-1).title).toContain('échappé');
    expect((await pool.query("SELECT count(*)::int AS n FROM commands WHERE player_id = $1 AND type = 'return' AND NOT processed", [s.meId])).rows[0].n).toBe(1);
  });

  it("refuse une armée trop loin, une armée amie et des éclaireurs seuls", async () => {
    const s = await setup({ swordsman: 100, scout: 10 });
    const far = await passing(s.enemy, s.x, 90, 'attack', { spearman: 50 });
    expect((await intercept(s, far, { swordsman: 10 })).json().error).toMatch(/pas repérée/);
    const near = await passing(s.enemy, s.x, 100, 'attack', { spearman: 50 });
    expect((await intercept(s, near, { scout: 10 })).json().error).toMatch(/éclaireurs/);
    expect((await intercept(s, near, { swordsman: 1000 })).json().error).toMatch(/assez de troupes/);
    const ownMove = await passing(s.meId, s.x, 101, 'attack', { spearman: 1 });
    expect((await intercept(s, ownMove, { swordsman: 10 })).json().error).toMatch(/propre armée/);
  });
});
