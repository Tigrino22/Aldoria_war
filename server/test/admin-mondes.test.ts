import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { buildApp } from '../src/app';
import { pool } from '../src/db';
import { env } from '../src/env';
import { migrate } from '../src/migrate';
import { inWorld, worldById } from '../src/world-store';
import { loadWorlds } from '../src/worlds';

let app: Awaited<ReturnType<typeof buildApp>>;
let chef: Record<string, string>;
let joueur: Record<string, string>;

const call = (method: 'GET' | 'POST' | 'PATCH' | 'PUT', url: string, headers: Record<string, string>, payload?: object) =>
  app.inject({ method, url, headers, payload });

describe('tableau de bord des mondes', () => {
  beforeAll(async () => {
    await migrate(true);
    await loadWorlds();
    app = await buildApp();
    env.adminUsernames.push('chef');
    const reg = async (username: string) =>
      ({ authorization: `Bearer ${(await call('POST', '/api/auth/register', {}, { username, password: 'secret123' })).json().token}` });
    chef = await reg('Chef');
    joueur = await reg('Paysan');
  });
  afterAll(async () => {
    env.adminUsernames.length = 0;
    await app.close();
    await pool.end();
  });

  it('seul un administrateur voit et crée des mondes', async () => {
    expect((await call('GET', '/api/admin/worlds', joueur)).statusCode).toBe(403);
    expect((await call('POST', '/api/admin/worlds', joueur, { name: 'Pirate' })).statusCode).toBe(403);
    const list = (await call('GET', '/api/admin/worlds', chef)).json();
    expect(list).toHaveLength(1);
    expect(list[0]).toMatchObject({ id: 1, name: 'Aldoria', open: true, config: { worldSpeed: 1, mapSize: 50 }, totals: { players: 2 } });
  });

  it('un nouveau monde reçoit son nom, ses réglages de création et ses réglages du jeu', async () => {
    const template = (await call('GET', '/api/admin/worlds/template', chef)).json();
    expect(template.config.find((c: { key: string }) => c.key === 'mapSize').default).toBe(50);
    expect(template.settings.find((c: { key: string }) => c.key === 'npcRevenge').default).toBe(1);

    for (const bad of [
      { name: 'x' },
      { name: 'Aldoria' },
      { name: 'Bon', config: { mapSize: 5 } },
      { name: 'Bon', settings: { npcRevenge: 'peut-être' } },
      { name: 'Bon', settings: { inconnu: 1 } },
    ]) {
      expect((await call('POST', '/api/admin/worlds', chef, bad)).statusCode, JSON.stringify(bad)).toBe(400);
    }
    expect((await call('GET', '/api/admin/worlds', chef)).json()).toHaveLength(1);

    const res = await call('POST', '/api/admin/worlds', chef, {
      name: 'Terres du Nord',
      open: false,
      config: { worldSpeed: 3, mapSize: 40, barbarianVillages: 4, npcCount: 1, npcTribes: 0 },
      settings: { npcRevenge: false, crusades: 0 },
    });
    expect(res.statusCode).toBe(200);
    const w = res.json();
    expect(w).toMatchObject({ name: 'Terres du Nord', open: false, config: { worldSpeed: 3, mapSize: 40 }, totals: { players: 0, npcs: 1, barbarians: 4 } });
    const ctx = worldById(w.id)!;
    expect(inWorld(ctx, () => [env.npcRevenge, env.crusades, env.worldSpeed])).toEqual([0, 0, 3]);
    expect([env.npcRevenge, env.crusades, env.worldSpeed]).toEqual([1, 1, 1]);

    // Ses réglages se lisent et se changent depuis le tableau de bord, monde par monde.
    const settings = (await call('GET', '/api/admin/settings', { ...chef, 'x-world': String(w.id) })).json();
    expect(settings.find((s: { key: string }) => s.key === 'npcRevenge').value).toBe(0);

    // Fermé aux inscriptions, puis ouvert et renommé.
    expect((await call('POST', `/api/worlds/${w.id}/enter`, joueur, {})).statusCode).toBe(400);
    const patched = await call('PATCH', `/api/admin/worlds/${w.id}`, chef, { name: 'Nordmark', open: true });
    expect(patched.json()).toMatchObject({ name: 'Nordmark', open: true });
    expect((await call('POST', `/api/worlds/${w.id}/enter`, joueur, {})).statusCode).toBe(200);
    expect((await call('PATCH', `/api/admin/worlds/${w.id}`, chef, { name: 'aldoria' })).statusCode).toBe(400);
  });

  it('la liste des comptes montre chaque joueur dans tous ses mondes', async () => {
    const accounts = (await call('GET', '/api/admin/accounts', chef)).json();
    const paysan = accounts.find((a: { username: string }) => a.username === 'Paysan');
    expect(paysan.worlds.map((w: { worldName: string }) => w.worldName).sort()).toEqual(['Aldoria', 'Nordmark']);
    expect(paysan.worlds.every((w: { villages: number; points: number }) => w.villages === 1 && w.points > 0)).toBe(true);
    expect(accounts.find((a: { username: string }) => a.username === 'Chef').admin).toBe(true);
    expect((await call('GET', '/api/admin/accounts', joueur)).statusCode).toBe(403);
  });
});
