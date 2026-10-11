import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { buildApp } from '../src/app';
import { pool } from '../src/db';
import { migrate } from '../src/migrate';
import { tx } from '../src/db';
import { recordBattle, warScore, WAR_POINTS } from '../src/game/war-stats';
import { tribeWarsView } from '../src/game/tribe-wars';

let app: Awaited<ReturnType<typeof buildApp>>;

async function register(username: string) {
  const res = await app.inject({ method: 'POST', url: '/api/auth/register', payload: { username, password: 'secret123' } });
  expect(res.statusCode).toBe(200);
  return { authorization: `Bearer ${res.json().token as string}` };
}

describe('classement de guerre et statistiques du monde', () => {
  beforeAll(async () => {
    await migrate(true);
    app = await buildApp();
  });
  afterAll(async () => {
    await app.close();
    await pool.end();
  });

  it('le score de guerre pèse les conquêtes, les victoires et les adversaires battus', () => {
    expect(warScore({ conquests: 2, attackWins: 3, defenseWins: 1, killsAttack: 400, killsDefense: 100 })).toBe(2 * WAR_POINTS.conquest + 4 * WAR_POINTS.win + 10);
  });

  it('classe joueurs et tribus, journalise les conquêtes et ignore les villages barbares', async () => {
    const guest = await register('Spectateur');
    const a = (await register('Conquerant'), (await pool.query("SELECT id FROM players WHERE username = 'Conquerant'")).rows[0].id as number);
    const d = (await register('Perdant'), (await pool.query("SELECT id FROM players WHERE username = 'Perdant'")).rows[0].id as number);
    const tribe = (await pool.query("INSERT INTO tribes (name, tag, leader_id) VALUES ('Les Lames', 'LAM', $1) RETURNING id", [a])).rows[0].id as number;
    await pool.query('UPDATE players SET tribe_id = $2 WHERE id = $1', [a, tribe]);

    const at = new Date();
    const village = { name: 'Ancien fief', x: 3, y: 4 };
    await tx(async (c) => {
      await recordBattle(c, { attackerId: a, defenderId: d, attackerWins: true, conquered: true, village, at });
      await recordBattle(c, { attackerId: a, defenderId: d, attackerWins: false, conquered: false, village, at });
      // Contre un village barbare ou contre soi-même : rien n'est compté.
      await recordBattle(c, { attackerId: a, defenderId: null, attackerWins: true, conquered: true, village, at });
      await recordBattle(c, { attackerId: a, defenderId: a, attackerWins: true, conquered: true, village, at });
    });

    const players = (await app.inject({ method: 'GET', url: '/api/ranking/war/players', headers: guest })).json();
    expect(players.rows[0]).toMatchObject({ rank: 1, username: 'Conquerant', tag: 'LAM', conquests: 1, attackWins: 1, defenseWins: 0, score: WAR_POINTS.conquest + WAR_POINTS.win });
    expect(players.rows[1]).toMatchObject({ username: 'Perdant', villagesLost: 1, defenseWins: 1 });
    expect(players.me).toBeNull();
    expect(players.rows.every((r: { score: number }) => r.score > 0)).toBe(true);

    const tribes = (await app.inject({ method: 'GET', url: '/api/ranking/war/tribes', headers: guest })).json();
    expect(tribes.rows).toHaveLength(1);
    expect(tribes.rows[0]).toMatchObject({ rank: 1, tag: 'LAM', members: 1, conquests: 1 });

    const feed = (await app.inject({ method: 'GET', url: '/api/ranking/war/feed', headers: guest })).json();
    expect(feed.conquests).toHaveLength(1);
    expect(feed.conquests[0]).toMatchObject({ conqueror: 'Conquerant', loser: 'Perdant', village: 'Ancien fief', x: 3, y: 4 });

    expect((await app.inject({ method: 'GET', url: '/api/ranking/war/players' })).statusCode).toBe(401);
  });

  it('les statistiques du monde sont publiques pour les joueurs et ne contiennent aucune donnée individuelle', async () => {
    const guest = await register('Curieux');
    const res = await app.inject({ method: 'GET', url: '/api/world/stats', headers: guest });
    expect(res.statusCode).toBe(200);
    const stats = res.json();
    expect(stats.totals.players).toBeGreaterThanOrEqual(3);
    expect(stats.troops.length).toBeGreaterThan(0);
    expect(stats.distribution).toHaveLength(6);
    expect(stats.activity).toEqual({ day: expect.any(Number), week: expect.any(Number) });
    // Aucun pseudo ni identifiant dans la réponse.
    const text = JSON.stringify(stats);
    for (const name of ['Conquerant', 'Perdant', 'Curieux', 'Spectateur']) expect(text).not.toContain(name);
    expect((await app.inject({ method: 'GET', url: '/api/world/stats' })).statusCode).toBe(401);
  });

  it('compte les batailles dans la guerre de tribu en cours, pour chaque camp', async () => {
    await register('Vert1');
    await register('Rouge1');
    await register('Neutre1');
    const id = async (n: string) => (await pool.query('SELECT id FROM players WHERE username = $1', [n])).rows[0].id as number;
    const [v, r, n] = [await id('Vert1'), await id('Rouge1'), await id('Neutre1')];
    const tv = (await pool.query("INSERT INTO tribes (name, tag, leader_id) VALUES ('Verts', 'VER', $1) RETURNING id", [v])).rows[0].id as number;
    const tr = (await pool.query("INSERT INTO tribes (name, tag, leader_id) VALUES ('Rouges', 'ROU', $1) RETURNING id", [r])).rows[0].id as number;
    await pool.query('UPDATE players SET tribe_id = $2 WHERE id = $1', [v, tv]);
    await pool.query('UPDATE players SET tribe_id = $2 WHERE id = $1', [r, tr]);
    const at = new Date();
    const village = { name: 'Fief', x: 9, y: 9 };
    // Les Verts déclarent la guerre aux Rouges.
    await pool.query("INSERT INTO tribe_wars (declarer_id, target_id, started_at, until) VALUES ($1, $2, $3, $4)", [tv, tr, new Date(at.getTime() - 1000), new Date(at.getTime() + 86_400_000)]);
    await tx(async (c) => {
      await recordBattle(c, { attackerId: v, defenderId: r, attackerWins: true, conquered: true, village, at, attackerKills: 100, defenderKills: 30 });
      await recordBattle(c, { attackerId: r, defenderId: v, attackerWins: false, conquered: false, village, at, attackerKills: 10, defenderKills: 50 });
      await recordBattle(c, { attackerId: r, defenderId: v, attackerWins: true, conquered: false, village, at, attackerKills: 70, defenderKills: 5 });
      // Hors guerre : un tiers sans tribu ne compte pas.
      await recordBattle(c, { attackerId: n, defenderId: v, attackerWins: true, conquered: true, village, at, attackerKills: 999, defenderKills: 0 });
    });
    const mine = (await tribeWarsView(pool, v, at)).active[0].stats;
    expect(mine.mine).toEqual({ attackWins: 1, defenseWins: 1, conquests: 1, kills: 100 + 50 + 5 });
    expect(mine.theirs).toEqual({ attackWins: 1, defenseWins: 0, conquests: 0, kills: 30 + 10 + 70 });
    const theirs = (await tribeWarsView(pool, r, at)).active[0].stats;
    expect(theirs.mine).toEqual(mine.theirs);
    expect((await tribeWarsView(pool, v, at)).warriors.map((w) => w.username)).toEqual(['Vert1']);
  });

  it('les guerres du monde sont visibles de tous les joueurs, sans le détail des attaques en route', async () => {
    expect((await app.inject({ method: 'GET', url: '/api/world/wars' })).statusCode).toBe(401);
    const joueur = await register('Passant77');
    const res = await app.inject({ method: 'GET', url: '/api/world/wars?hours=72', headers: joueur });
    expect(res.statusCode).toBe(200);
    const body = res.json();
    expect(body.inFlight).toEqual([]);
    expect(Array.isArray(body.fronts)).toBe(true);
    expect(body.hours).toBe(72);
    // Un joueur ordinaire n'a toujours pas accès à la vue d'administration.
    expect((await app.inject({ method: 'GET', url: '/api/admin/wars', headers: joueur })).statusCode).toBe(403);
    expect((await app.inject({ method: 'GET', url: '/api/world/wars?hours=500', headers: joueur })).statusCode).toBe(400);
  });
});
