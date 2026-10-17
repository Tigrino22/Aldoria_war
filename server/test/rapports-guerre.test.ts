import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { buildApp } from '../src/app';
import { pool } from '../src/db';
import { env } from '../src/env';
import { migrate } from '../src/migrate';

let app: Awaited<ReturnType<typeof buildApp>>;

async function register(username: string) {
  const res = await app.inject({ method: 'POST', url: '/api/auth/register', payload: { username, password: 'secret123' } });
  expect(res.statusCode).toBe(200);
  return { authorization: `Bearer ${res.json().token as string}` };
}

/** Un PNJ dans sa propre tribu de PNJ, avec un village. */
async function npc(username: string, tag: string, x: number) {
  const tribe = (await pool.query("INSERT INTO tribes (name, tag, is_npc) VALUES ($1, $2, true) RETURNING id", [`Tribu ${tag}`, tag])).rows[0].id as number;
  const id = (await pool.query("INSERT INTO players (username, password_hash, is_npc, tribe_id) VALUES ($1, '-', true, $2) RETURNING id", [username, tribe])).rows[0].id as number;
  const village = (
    await pool.query(
      `INSERT INTO villages (name, x, y, owner_id, buildings, wood, clay, iron, wheat, resources_at) VALUES ($1, $2, 50, $3, '{}', 0, 0, 0, 0, now()) RETURNING id`,
      [`Domaine de ${username}`, x, id],
    )
  ).rows[0].id as number;
  return { id, village: { id: village, name: `Domaine de ${username}`, x, y: 50 } };
}

describe('rapports des batailles du journal des guerres', () => {
  beforeAll(async () => {
    await migrate(true);
    app = await buildApp();
  });
  afterAll(async () => {
    env.adminUsernames.length = 0;
    await app.close();
    await pool.end();
  });

  it("l'administration ouvre le rapport d'une bataille du journal, les joueurs ne voient que la ligne", async () => {
    env.adminUsernames.push('arbitre');
    const admin = await register('Arbitre');
    const joueur = await register('Curieux');
    const a = await npc('Telchar', 'LGR', 10);
    const d = await npc('Seaine', 'VFE', 20);
    const units = { spearman: 10, halberdier: 0, swordsman: 0, scout: 0, cavalry: 5, ram: 0, noble: 0 };
    const data = {
      attackerWins: true,
      conquered: false,
      wall: 2,
      loot: null,
      loyalty: null,
      attacker: { playerName: 'Telchar', village: a.village, units, losses: { ...units, spearman: 3, cavalry: 0 } },
      defender: { playerName: 'Seaine', village: d.village, units, losses: units },
    };
    const reportId = (
      await pool.query("INSERT INTO reports (player_id, type, title, data, created_at) VALUES ($1, 'defense', 'Telchar attaque Domaine de Seaine', $2, now()) RETURNING id", [d.id, data])
    ).rows[0].id as number;

    const wars = (await app.inject({ method: 'GET', url: '/api/admin/wars', headers: admin })).json();
    expect(wars.battles).toHaveLength(1);
    expect(wars.battles[0]).toMatchObject({ reportId, attackerLosses: 3, defenderLosses: 15 });

    const report = await app.inject({ method: 'GET', url: `/api/admin/reports/${reportId}`, headers: admin });
    expect(report.statusCode).toBe(200);
    expect(report.json()).toMatchObject({ id: reportId, type: 'defense', title: 'Telchar attaque Domaine de Seaine', player: 'Seaine', data: { attackerWins: true } });
    // Lecture seule : le rapport reste non lu pour son joueur.
    expect((await pool.query('SELECT read FROM reports WHERE id = $1', [reportId])).rows[0].read).toBe(false);

    expect((await app.inject({ method: 'GET', url: `/api/admin/reports/${reportId}`, headers: joueur })).statusCode).toBe(403);
    expect((await app.inject({ method: 'GET', url: '/api/admin/reports/999999', headers: admin })).statusCode).toBe(404);
    // Hors des batailles (échanges, succès…), rien à ouvrir depuis ici.
    const trade = (await pool.query("INSERT INTO reports (player_id, type, title, data, created_at) VALUES ($1, 'trade', 'Échange', '{}', now()) RETURNING id", [d.id])).rows[0].id;
    expect((await app.inject({ method: 'GET', url: `/api/admin/reports/${trade}`, headers: admin })).statusCode).toBe(404);

    const world = (await app.inject({ method: 'GET', url: '/api/world/wars', headers: joueur })).json();
    expect(world.battles).toHaveLength(1);
    expect(world.battles[0].reportId).toBeUndefined();
  });
});
