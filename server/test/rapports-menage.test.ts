import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { buildApp } from '../src/app';
import { pool } from '../src/db';
import { migrate } from '../src/migrate';

let app: Awaited<ReturnType<typeof buildApp>>;
const auth = async (username: string) => {
  const res = await app.inject({ method: 'POST', url: '/api/auth/register', payload: { username, password: 'secret123' } });
  return { authorization: `Bearer ${res.json().token as string}` };
};
const playerId = async (name: string) => (await pool.query('SELECT id FROM players WHERE username = $1', [name])).rows[0].id as number;
const add = async (p: number, type: string, data: object = {}) =>
  (await pool.query("INSERT INTO reports (player_id, type, title, data, created_at) VALUES ($1, $2, 'T', $3, now()) RETURNING id", [p, type, JSON.stringify(data)])).rows[0].id as number;

describe('ménage des rapports', () => {
  beforeAll(async () => {
    await migrate(true);
    app = await buildApp();
  });
  afterAll(async () => {
    await app.close();
    await pool.end();
  });

  it('archive, désarchive et supprime en lot, sans toucher aux rapports des autres', async () => {
    const h = await auth('Menagere');
    const other = await auth('Voisin');
    const me = await playerId('Menagere');
    const [a, b, c] = [await add(me, 'scout'), await add(me, 'trade'), await add(me, 'trade')];
    const foreign = await add(await playerId('Voisin'), 'trade');
    const list = async (archived: number) => (await app.inject({ method: 'GET', url: `/api/reports?archived=${archived}`, headers: h })).json();

    expect((await list(0)).find((r: any) => r.id === a).tone).toBe('scout');
    await app.inject({ method: 'POST', url: '/api/reports/bulk', headers: h, payload: { ids: [a, b, foreign], action: 'archive' } });
    expect((await list(1)).map((r: any) => r.id).sort()).toEqual([a, b].sort());
    expect((await list(0)).map((r: any) => r.id)).toEqual([c]);
    await app.inject({ method: 'POST', url: '/api/reports/bulk', headers: h, payload: { ids: [a], action: 'unarchive' } });
    expect((await list(1)).map((r: any) => r.id)).toEqual([b]);
    await app.inject({ method: 'POST', url: '/api/reports/bulk', headers: h, payload: { ids: [b, c, foreign], action: 'delete' } });
    expect((await list(1))).toEqual([]);
    expect((await pool.query('SELECT 1 FROM reports WHERE id = $1', [foreign])).rowCount).toBe(1);
    expect((await app.inject({ method: 'GET', url: '/api/reports', headers: other })).json()).toHaveLength(1);
  });

  it("les mouvements entrants indiquent la tribu de l'expéditeur", async () => {
    const { tx } = await import('../src/db');
    const { createVillage, villageState } = await import('../src/game/village');
    const { STARTING_BUILDINGS, emptyUnits } = await import('@aldoria/shared');
    const mkp = async (n: string) => (await pool.query("INSERT INTO players (username, password_hash) VALUES ($1, 'x') RETURNING id", [n])).rows[0].id as number;
    const att = await mkp('Assaillant');
    const def = await mkp('Cible');
    const tribe = (await pool.query("INSERT INTO tribes (name, tag, leader_id) VALUES ('Les Loups', 'LOUP', $1) RETURNING id", [att])).rows[0].id;
    await pool.query('UPDATE players SET tribe_id = $1 WHERE id = $2', [tribe, att]);
    const now = new Date();
    const mk = (owner: number, x: number, y: number) =>
      tx((c) => createVillage(c, { ownerId: owner, name: 'V', x, y, buildings: { ...STARTING_BUILDINGS }, resources: { wood: 0, clay: 0, iron: 0, wheat: 0 }, at: now, troops: { ...emptyUnits(), swordsman: 5 } }));
    const from = await mk(att, 300, 300);
    const to = await mk(def, 302, 300);
    await pool.query(
      "INSERT INTO commands (type, player_id, origin_village_id, home_village_id, target_village_id, units, sent_at, arrive_at) VALUES ('attack', $1, $2, $2, $3, $4, now(), now() + interval '1 hour')",
      [att, from, to, JSON.stringify({ ...emptyUnits(), swordsman: 5 })],
    );
    const state = await tx(async (c) => villageState(c, (await c.query('SELECT * FROM villages WHERE id = $1', [to])).rows[0], def));
    expect(state.incoming[0].origin.ownerTag).toBe('LOUP');
  });
});
