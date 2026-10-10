import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { buildApp } from '../src/app';
import { pool, tx } from '../src/db';
import { env } from '../src/env';
import { migrate } from '../src/migrate';
import { createNpc } from '../src/game/npc';

let app: Awaited<ReturnType<typeof buildApp>>;

async function register(username: string) {
  const res = await app.inject({ method: 'POST', url: '/api/auth/register', payload: { username, password: 'secret123' } });
  expect(res.statusCode).toBe(200);
  return { authorization: `Bearer ${res.json().token as string}` };
}

describe('administration', () => {
  it('les réglages du monde se modifient à chaud, se contrôlent et se rétablissent', async () => {
    env.adminUsernames.push('chef');
    const chef = await register('Chef');
    const autre = await register('Badaud');
    const put = (headers: Record<string, string>, payload: object) => app.inject({ method: 'PUT', url: '/api/admin/settings', headers, payload });

    expect((await put(autre, { npcDifficulty: 2 })).statusCode).toBe(403);
    const before = env.npcDifficulty;
    const ok = await put(chef, { npcDifficulty: '1,5', npcQuietStart: 23 });
    expect(ok.statusCode).toBe(200);
    expect(env.npcDifficulty).toBe(1.5);
    expect(env.npcQuietStart).toBe(23);
    expect((await pool.query('SELECT value FROM world_settings WHERE key = $1', ['npcDifficulty'])).rows[0].value).toBe('1.5');

    for (const bad of [{ npcDifficulty: 10 }, { npcQuietStart: 1.5 }, { npcTimezone: 'Mars/Olympus' }, { vitesse: 5 }]) {
      expect((await put(chef, bad)).statusCode, JSON.stringify(bad)).toBe(400);
    }
    expect(env.npcDifficulty).toBe(1.5);

    const reset = await put(chef, { npcDifficulty: null, npcQuietStart: null });
    expect(reset.statusCode).toBe(200);
    expect(env.npcDifficulty).toBe(before);
    expect((await pool.query('SELECT count(*)::int AS n FROM world_settings')).rows[0].n).toBe(0);
    env.adminUsernames.length = 0;
  });

  beforeAll(async () => {
    await migrate(true);
    app = await buildApp();
  });
  afterAll(async () => {
    env.adminUsernames.length = 0;
    await app.close();
    await pool.end();
  });

  it('seuls les pseudos listés dans ADMIN_USERNAMES accèdent aux routes admin', async () => {
    env.adminUsernames.push('patron');
    const boss = await register('Patron');
    const other = await register('Curieux');
    expect((await app.inject({ method: 'GET', url: '/api/admin/npc' })).statusCode).toBe(401);
    expect((await app.inject({ method: 'GET', url: '/api/admin/npc', headers: other })).statusCode).toBe(403);
    expect((await app.inject({ method: 'GET', url: '/api/me', headers: other })).json().isAdmin).toBe(false);
    expect((await app.inject({ method: 'GET', url: '/api/me', headers: boss })).json().isAdmin).toBe(true);

    await tx((c) => createNpc(c, new Date(), 'raider'));
    for (const url of ['/api/admin/npc?hours=24', '/api/admin/players', '/api/admin/market', '/api/admin/stats', '/api/admin/world']) {
      const res = await app.inject({ method: 'GET', url, headers: boss });
      expect(res.statusCode, url).toBe(200);
    }
    const players = (await app.inject({ method: 'GET', url: '/api/admin/players', headers: boss })).json();
    expect(players.some((p: { isNpc: boolean }) => p.isNpc)).toBe(true);
    expect((await app.inject({ method: 'GET', url: '/api/admin/npc', headers: boss })).json().stats.npcCount).toBeGreaterThan(0);

    const stats = (await app.inject({ method: 'GET', url: '/api/admin/stats', headers: boss })).json();
    expect(stats.villages).toBeGreaterThan(0);
    expect(stats.troops).toHaveLength(6);
    expect(stats.resources).toHaveLength(4);
    expect(JSON.stringify(stats)).not.toContain('Patron');

    // Les troupes des joueurs comptent : au village, en route et recrutées mais pas encore livrées.
    const bossVillage = (await pool.query("SELECT v.id FROM villages v JOIN players p ON p.id = v.owner_id WHERE p.username = 'Patron'")).rows[0].id as number;
    await pool.query("INSERT INTO troops (village_id, home_village_id, units) VALUES ($1, $1, '{\"spearman\": 30}')", [bossVillage]);
    await pool.query(
      `INSERT INTO commands (type, origin_village_id, target_village_id, home_village_id, player_id, units, sent_at, arrive_at)
       VALUES ('attack', $1, $1, $1, NULL, '{"spearman": 5}', now(), now() + interval '1 hour')`,
      [bossVillage],
    );
    await pool.query("INSERT INTO recruit_queue (village_id, unit, count, delivered, start_at, unit_seconds) VALUES ($1, 'swordsman', 10, 0, now() - interval '1 hour', 60)", [bossVillage]);
    const again = (await app.inject({ method: 'GET', url: '/api/admin/stats', headers: boss })).json();
    const row = (u: string) => again.troops.find((t: { unit: string }) => t.unit === u);
    expect(row('spearman').players).toBe(35);
    expect(row('swordsman').players).toBe(10);

    // La dernière activité des joueurs est enregistrée.
    await new Promise((r) => setTimeout(r, 100));
    const seen = (await app.inject({ method: 'GET', url: '/api/admin/players', headers: boss })).json().find((p: { username: string }) => p.username === 'Curieux');
    expect(seen.lastSeen).not.toBeNull();
  });
});
