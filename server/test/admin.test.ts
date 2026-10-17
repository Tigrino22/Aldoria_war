import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { buildApp } from '../src/app';
import { pool, tx } from '../src/db';
import { env } from '../src/env';
import { migrate } from '../src/migrate';
import { warehouseCapacity } from '@aldoria/shared';
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

    expect((await put(autre, { npcOffensiveShare: 80 })).statusCode).toBe(403);
    const before = env.npcOffensiveShare;
    const ok = await put(chef, { npcOffensiveShare: '75', npcQuietStart: 23 });
    expect(ok.statusCode).toBe(200);
    expect(env.npcOffensiveShare).toBe(75);
    expect(env.npcQuietStart).toBe(23);
    expect((await pool.query('SELECT value FROM world_settings WHERE key = $1', ['npcOffensiveShare'])).rows[0].value).toBe('75');

    const off = await put(chef, { npcRevenge: false });
    expect(off.statusCode).toBe(200);
    expect(env.npcRevenge).toBe(0);
    expect(off.json().find((s: { key: string }) => s.key === 'npcRevenge').value).toBe(0);
    expect((await put(chef, { npcRevenge: 'oui' })).statusCode).toBe(200);
    expect(env.npcRevenge).toBe(1);

    for (const bad of [{ npcOffensiveShare: 500 }, { npcQuietStart: 1.5 }, { npcTimezone: 'Mars/Olympus' }, { vitesse: 5 }]) {
      expect((await put(chef, bad)).statusCode, JSON.stringify(bad)).toBe(400);
    }
    expect(env.npcOffensiveShare).toBe(75);

    const reset = await put(chef, { npcOffensiveShare: null, npcQuietStart: null, npcRevenge: null });
    expect(reset.statusCode).toBe(200);
    expect(env.npcOffensiveShare).toBe(before);
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

    await tx((c) => createNpc(c, new Date(), 'offense'));
    for (const url of ['/api/admin/npc?hours=24', '/api/admin/players', '/api/admin/stats', '/api/admin/world']) {
      const res = await app.inject({ method: 'GET', url, headers: boss });
      expect(res.statusCode, url).toBe(200);
    }
    const players = (await app.inject({ method: 'GET', url: '/api/admin/players', headers: boss })).json();
    expect(players.some((p: { isNpc: boolean }) => p.isNpc)).toBe(true);
    expect((await app.inject({ method: 'GET', url: '/api/admin/npc', headers: boss })).json().stats.npcCount).toBeGreaterThan(0);

    const stats = (await app.inject({ method: 'GET', url: '/api/admin/stats', headers: boss })).json();
    expect(stats.villages).toBeGreaterThan(0);
    expect(stats.troops).toHaveLength(7);
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

    // Fiche d'un joueur : villages, troupes (au village, dehors, en recrutement) et rang, réservée à l'administrateur.
    const bossId = (await pool.query("SELECT id FROM players WHERE username = 'Patron'")).rows[0].id as number;
    expect((await app.inject({ method: 'GET', url: `/api/admin/players/${bossId}`, headers: other })).statusCode).toBe(403);
    expect((await app.inject({ method: 'GET', url: '/api/admin/players/999999', headers: boss })).statusCode).toBe(404);
    const detail = (await app.inject({ method: 'GET', url: `/api/admin/players/${bossId}`, headers: boss })).json();
    expect(detail.username).toBe('Patron');
    expect(detail.villages).toHaveLength(1);
    expect(detail.troops.home.spearman).toBe(30);
    expect(detail.troops.away.spearman).toBe(5);
    expect(detail.troops.queued.swordsman).toBe(10);
    expect(detail.rank.all).toBeGreaterThan(0);
    // Le contenu des messages privés n'est pas accessible depuis l'administration : seulement leur nombre.
    expect(detail.messages).toEqual({ sent7: 0, received7: 0 });
    expect((await app.inject({ method: 'GET', url: `/api/admin/players/${bossId}/messages`, headers: boss })).statusCode).toBe(404);
  });

  it('remplit les entrepôts des PNJ jusqu’à un pourcentage, sans jamais réduire', async () => {
    env.adminUsernames.push('patron2');
    const boss = await register('Patron2');
    const other = await register('Curieux2');
    const npcId = await tx((c) => createNpc(c, new Date(), 'offense'));
    const post = (headers: Record<string, string>, payload: object) => app.inject({ method: 'POST', url: '/api/admin/npc/fill', headers, payload });
    expect((await post(other, { percent: 50 })).statusCode).toBe(403);
    expect((await post(boss, { percent: 150 })).statusCode).toBe(400);

    await pool.query('UPDATE villages SET wood = 0, clay = 10, iron = 0, wheat = 0 WHERE owner_id = $1', [npcId]);
    const res = await post(boss, { percent: 50 });
    expect(res.statusCode).toBe(200);
    expect(res.json().changed).toBeGreaterThan(0);
    const v = (await pool.query('SELECT v.wood, v.clay, v.buildings FROM villages v WHERE v.owner_id = $1', [npcId])).rows[0];
    const cap = warehouseCapacity(v.buildings.warehouse);
    expect(v.wood).toBeGreaterThanOrEqual(Math.floor(cap / 2));
    expect(v.clay).toBeGreaterThanOrEqual(Math.floor(cap / 2));

    // Un pourcentage plus bas ne vide rien.
    await post(boss, { percent: 10 });
    const after = (await pool.query('SELECT wood FROM villages WHERE owner_id = $1', [npcId])).rows[0];
    expect(after.wood).toBeGreaterThanOrEqual(v.wood);
    env.adminUsernames.length = 0;
  });
});
