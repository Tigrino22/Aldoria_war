import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { buildApp } from '../src/app';
import { corePool, pool } from '../src/db';
import { env } from '../src/env';
import { migrate } from '../src/migrate';
import { defaultWorld, inWorld, type WorldCtx } from '../src/world-store';
import { createWorld, loadWorlds, updateWorld } from '../src/worlds';

let app: Awaited<ReturnType<typeof buildApp>>;
let elnor: WorldCtx;

const auth = (token: string) => ({ authorization: `Bearer ${token}` });
async function post(url: string, payload: object, headers: Record<string, string> = {}) {
  return app.inject({ method: 'POST', url, payload, headers });
}
const get = (url: string, headers: Record<string, string>) => app.inject({ method: 'GET', url, headers });

describe('plusieurs mondes', () => {
  beforeAll(async () => {
    await migrate(true);
    await loadWorlds();
    app = await buildApp();
    elnor = await createWorld({ name: 'Elnor', config: { mapSize: 40, barbarianVillages: 3, npcCount: 2, npcTribes: 0, worldSpeed: 4 } });
  });
  afterAll(async () => {
    env.adminUsernames.length = 0;
    await app.close();
    await pool.end();
  });

  it('un nouveau monde a ses propres tables, sa carte et ses réglages', async () => {
    expect(elnor.schema).toBe(`monde_${elnor.id}`);
    const counts = async (w: WorldCtx) =>
      inWorld(w, async () => (await pool.query("SELECT count(*) FILTER (WHERE owner_id IS NULL AND kind = 'village')::int AS barbares, (SELECT count(*)::int FROM players WHERE is_npc) AS pnj FROM villages")).rows[0]);
    expect(await counts(elnor)).toEqual({ barbares: 3, pnj: 2 });
    // Le monde par défaut n'a pas été peuplé par la création d'Elnor.
    expect((await counts(defaultWorld())).pnj).toBe(0);
    expect(inWorld(elnor, () => [env.mapSize, env.worldSpeed])).toEqual([40, 4]);
    expect([env.mapSize, env.worldSpeed]).toEqual([50, 1]);
    const maxX = await inWorld(elnor, async () => (await pool.query('SELECT max(x)::int AS m FROM villages')).rows[0].m);
    expect(maxX).toBeLessThan(40);
  });

  it('les anciennes versions de l’application s’inscrivent et se connectent dans le monde par défaut', async () => {
    const res = await post('/api/auth/register', { username: 'Ancien', password: 'secret123' });
    expect(res.statusCode).toBe(200);
    const me = await get('/api/me', auth(res.json().token));
    expect(me.statusCode).toBe(200);
    expect((await get('/api/world', auth(res.json().token))).json().name).toBe('Aldoria');
    const login = await post('/api/auth/login', { username: 'ancien', password: 'secret123' });
    expect((await get('/api/me', auth(login.json().token))).statusCode).toBe(200);
  });

  it('le joueur choisit son monde, ceux où il est inscrit en premier', async () => {
    const res = await post('/api/auth/register', { username: 'Voyageur', password: 'secret123', world: null });
    expect(res.statusCode).toBe(200);
    const h = auth(res.json().token);
    expect((await get('/api/me', h)).statusCode).toBe(428);
    expect((await get('/api/session', h)).json()).toMatchObject({ account: { username: 'Voyageur', isAdmin: false }, world: null });

    let worlds = (await get('/api/worlds', h)).json();
    expect(worlds.map((w: { name: string }) => w.name).sort()).toEqual(['Aldoria', 'Elnor']);
    expect(worlds.every((w: { member: unknown }) => w.member === null)).toBe(true);

    const enter = await post(`/api/worlds/${elnor.id}/enter`, {}, h);
    expect(enter.statusCode).toBe(200);
    expect(enter.json().joined).toBe(true);
    const me = (await get('/api/me', h)).json();
    expect(me.villages).toHaveLength(1);
    expect((await get('/api/world', h)).json()).toMatchObject({ id: elnor.id, name: 'Elnor', speed: 4, mapSize: 40 });
    // Son village est dans Elnor, pas dans le monde par défaut.
    expect((await pool.query("SELECT 1 FROM players WHERE username = 'Voyageur'")).rowCount).toBe(0);

    worlds = (await get('/api/worlds', h)).json();
    expect(worlds[0]).toMatchObject({ name: 'Elnor', member: { villages: 1 } });
    expect(worlds[1]).toMatchObject({ name: 'Aldoria', member: null });

    // Nouvelle connexion : rien n'est choisi d'office, il retrouve Elnor en tête de liste.
    const login = await post('/api/auth/login', { username: 'Voyageur', password: 'secret123', world: null });
    const h2 = auth(login.json().token);
    expect((await get('/api/me', h2)).statusCode).toBe(428);
    expect((await get('/api/worlds', h2)).json()[0].name).toBe('Elnor');
    expect((await post(`/api/worlds/${elnor.id}/enter`, {}, h2)).json().joined).toBe(false);
    expect((await get('/api/me', h2)).json().player.id).toBe(me.player.id);

    // Puis il rejoint aussi Aldoria avec le même compte.
    expect((await post(`/api/worlds/${defaultWorld().id}/enter`, {}, h2)).json().joined).toBe(true);
    expect((await get('/api/me', h2)).json().player.username).toBe('Voyageur');
  });

  it('un monde fermé n’accepte plus de nouveaux joueurs mais garde les siens', async () => {
    const res = await post('/api/auth/register', { username: 'Retardataire', password: 'secret123', world: null });
    const h = auth(res.json().token);
    await updateWorld(elnor.id, { open: false });
    expect((await get('/api/worlds', h)).json().map((w: { name: string }) => w.name)).toEqual(['Aldoria']);
    expect((await post(`/api/worlds/${elnor.id}/enter`, {}, h)).statusCode).toBe(400);
    const voyageur = auth((await post('/api/auth/login', { username: 'Voyageur', password: 'secret123', world: null })).json().token);
    expect((await post(`/api/worlds/${elnor.id}/enter`, {}, voyageur)).statusCode).toBe(200);
    await updateWorld(elnor.id, { open: true });
  });

  it('l’administrateur règle chaque monde séparément', async () => {
    env.adminUsernames.push('chef');
    const h = auth((await post('/api/auth/register', { username: 'Chef', password: 'secret123', world: null })).json().token);
    const put = (world: number, payload: object) => app.inject({ method: 'PUT', url: '/api/admin/settings', headers: { ...h, 'x-world': String(world) }, payload });
    expect((await put(elnor.id, { npcOffensiveShare: 75 })).statusCode).toBe(200);
    expect(inWorld(elnor, () => env.npcOffensiveShare)).toBe(75);
    expect(env.npcOffensiveShare).toBe(50);
    expect(await inWorld(elnor, async () => (await pool.query('SELECT value FROM world_settings')).rows)).toEqual([{ value: '75' }]);
    expect((await pool.query('SELECT count(*)::int AS n FROM world_settings')).rows[0].n).toBe(0);
    // Un joueur ordinaire ne choisit pas son monde par l'en-tête.
    const other = auth((await post('/api/auth/register', { username: 'Curieux', password: 'secret123' })).json().token);
    expect((await app.inject({ method: 'GET', url: '/api/world', headers: { ...other, 'x-world': String(elnor.id) } })).json().id).toBe(1);
    expect((await put(999, { npcOffensiveShare: 50 })).statusCode).toBe(404);
  });

  it('supprimer son compte le retire de tous ses mondes', async () => {
    const h = auth((await post('/api/auth/login', { username: 'Voyageur', password: 'secret123' })).json().token);
    expect((await app.inject({ method: 'DELETE', url: '/api/me', headers: h, payload: { password: 'secret123' } })).statusCode).toBe(200);
    expect((await pool.query("SELECT 1 FROM players WHERE username = 'Voyageur'")).rowCount).toBe(0);
    expect(await inWorld(elnor, async () => (await pool.query("SELECT 1 FROM players WHERE username = 'Voyageur'")).rowCount)).toBe(0);
    expect((await corePool.query("SELECT 1 FROM core.accounts WHERE username = 'Voyageur'")).rowCount).toBe(0);
  });

  it('la migration reprend les joueurs et les sessions du monde existant', async () => {
    // Base d'avant les mondes : seulement le schéma public, avec un joueur, un PNJ et une session.
    await corePool.query(`DROP SCHEMA core CASCADE; DROP SCHEMA ${elnor.schema} CASCADE`);
    const id = (await pool.query("INSERT INTO players (username, password_hash) VALUES ('Pionnier', 'sel:hash') RETURNING id")).rows[0].id;
    await pool.query("INSERT INTO players (username, password_hash, is_npc) VALUES ('Brigand', '!', true)");
    const token = 'ab'.repeat(32);
    await pool.query('INSERT INTO sessions (token, player_id) VALUES ($1, $2)', [token, id]);
    await migrate();
    const account = (await corePool.query("SELECT * FROM core.accounts WHERE username = 'Pionnier'")).rows[0];
    expect(account).toMatchObject({ id, password_hash: 'sel:hash' });
    expect((await corePool.query("SELECT 1 FROM core.accounts WHERE username = 'Brigand'")).rowCount).toBe(0);
    expect((await corePool.query('SELECT name, schema_name FROM core.worlds')).rows).toEqual([{ name: 'Aldoria', schema_name: 'public' }]);
    // Le joueur reste connecté dans son monde, et les nouveaux comptes ne reprennent pas un numéro existant.
    expect((await get('/api/me', auth(token))).json().player.username).toBe('Pionnier');
    const next = await post('/api/auth/register', { username: 'Suivant', password: 'secret123', world: null });
    expect(next.statusCode).toBe(200);
  });
});
