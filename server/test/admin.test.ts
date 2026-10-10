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

    // La dernière activité des joueurs est enregistrée.
    await new Promise((r) => setTimeout(r, 100));
    const seen = (await app.inject({ method: 'GET', url: '/api/admin/players', headers: boss })).json().find((p: { username: string }) => p.username === 'Curieux');
    expect(seen.lastSeen).not.toBeNull();
  });
});
