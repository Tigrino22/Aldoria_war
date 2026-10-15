import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { letterPriceFor, lettersAffordable } from '@aldoria/shared';
import { buildApp } from '../src/app';
import { pool, tx } from '../src/db';
import { env } from '../src/env';
import { migrate } from '../src/migrate';
import { ensureLetters } from '../src/game/nobility';

let app: Awaited<ReturnType<typeof buildApp>>;

async function register(username: string) {
  const res = await app.inject({ method: 'POST', url: '/api/auth/register', payload: { username, password: 'secret123' } });
  expect(res.statusCode).toBe(200);
  return { authorization: `Bearer ${res.json().token as string}` };
}

beforeAll(async () => {
  await migrate(true);
  app = await buildApp();
});
afterAll(async () => {
  await app.close();
  await pool.end();
});

describe('prix des lettres', () => {
  const base = { wood: 15000, clay: 18000, iron: 15000, wheat: 0 };
  it('monte de growth % par village au-delà du premier', () => {
    expect(letterPriceFor(base, 25, 1)).toEqual(base);
    expect(letterPriceFor(base, 25, 2)).toEqual({ wood: 18750, clay: 22500, iron: 18750, wheat: 0 });
    expect(letterPriceFor(base, 25, 3).clay).toBe(28125);
    expect(letterPriceFor(base, 0, 10)).toEqual(base);
  });
  it('compte les lettres que paie la cagnotte', () => {
    expect(lettersAffordable({ wood: 45000, clay: 54000, iron: 30000, wheat: 0 }, base)).toBe(2);
    expect(lettersAffordable({ wood: 0, clay: 54000, iron: 30000, wheat: 0 }, base)).toBe(0);
  });
});

describe('cagnotte et lettres de noblesse', () => {
  it('la cagnotte reçoit les villages, paie les lettres, et chaque noble prend une lettre', async () => {
    const h = await register('Baronne');
    const me = (await app.inject({ method: 'GET', url: '/api/me', headers: h })).json();
    const vid = me.villages[0].id as number;
    const pid = me.player.id as number;
    const post = (url: string, body: object) => app.inject({ method: 'POST', url: `/api/villages/${vid}${url}`, headers: h, payload: body });
    const player = async () => (await pool.query('SELECT noble_letters, treasury_wood, treasury_clay, treasury_iron FROM players WHERE id = $1', [pid])).rows[0];

    await pool.query(
      `UPDATE villages SET buildings = buildings || '{"townhall": 9, "barracks": 10, "farm": 30, "warehouse": 30}'::jsonb,
         wood = 400000, clay = 400000, iron = 400000, wheat = 400000, resources_at = now() WHERE id = $1`,
      [vid],
    );

    // Versement : plafonné au stock du village, sans plafond côté cagnotte.
    const dep = await post('/treasury', { wood: 100000, clay: 900000, iron: 60000 });
    expect(dep.statusCode).toBe(200);
    const t = dep.json().nobility.treasury;
    expect(t.wood).toBe(100000);
    expect(t.clay).toBeGreaterThanOrEqual(400000);
    expect(t.iron).toBe(60000);
    expect(Math.floor(dep.json().resources.clay)).toBeLessThan(10);
    expect((await post('/treasury', { wood: 0, clay: 0, iron: 0 })).statusCode).toBe(400);

    // Hôtel de ville 9 : pas encore de lettres.
    expect((await post('/letters', { count: 1 })).statusCode).toBe(400);
    await pool.query(`UPDATE villages SET buildings = buildings || '{"townhall": 10}'::jsonb WHERE id = $1`, [vid]);

    // 60 000 de fer : 4 lettres à 15 000.
    expect((await post('/letters', { count: 5 })).statusCode).toBe(400);
    const minted = await post('/letters', { count: 4 });
    expect(minted.statusCode).toBe(200);
    expect(minted.json().nobility).toMatchObject({ enabled: true, letters: 4, villages: 1, growth: 25 });
    expect(minted.json().nobility.price.wood).toBe(env.letterWood);
    expect(minted.json().nobility.nextPrice.wood).toBe(Math.round(env.letterWood * 1.25));
    expect(Number((await player()).treasury_iron)).toBe(0);

    // Une lettre par noble.
    await pool.query('UPDATE villages SET wood = 400000, clay = 400000, iron = 400000, resources_at = now() WHERE id = $1', [vid]);
    expect((await post('/recruit', { unit: 'noble', count: 3 })).statusCode).toBe(200);
    expect((await player()).noble_letters).toBe(1);
    const refused = await post('/recruit', { unit: 'noble', count: 2 });
    expect(refused.statusCode).toBe(400);
    expect(refused.json().error).toMatch(/2 lettres de noblesse/);

    // Annuler la dernière commande rend ses lettres.
    const q = (await post('/recruit', { unit: 'noble', count: 1 })).json().recruitQueue.at(-1);
    expect((await player()).noble_letters).toBe(0);
    expect((await app.inject({ method: 'DELETE', url: `/api/villages/${vid}/recruit/${q.id}`, headers: h })).statusCode).toBe(200);
    expect((await player()).noble_letters).toBe(1);

    // Un 2e village rend la lettre 25 % plus chère.
    await pool.query(`UPDATE villages SET owner_id = $1 WHERE id = (SELECT id FROM villages WHERE owner_id IS NULL AND kind = 'village' LIMIT 1)`, [pid]);
    const view = (await app.inject({ method: 'GET', url: `/api/villages/${vid}`, headers: h })).json().nobility;
    expect(view).toMatchObject({ villages: 2, price: { wood: Math.round(env.letterWood * 1.25) } });

    // Système coupé : le noble ne coûte que ses ressources.
    env.nobleLetters = 0;
    expect((await post('/recruit', { unit: 'noble', count: 1 })).statusCode).toBe(200);
    expect((await player()).noble_letters).toBe(1);
    expect((await post('/letters', { count: 1 })).statusCode).toBe(400);
    expect((await post('/treasury', { wood: 1, clay: 1, iron: 1 })).statusCode).toBe(400);
    env.nobleLetters = 1;

    // Les PNJ versent ce qui manque puis frappent.
    await pool.query('UPDATE players SET noble_letters = 0, treasury_wood = 0, treasury_clay = 0, treasury_iron = 0 WHERE id = $1', [pid]);
    await pool.query('UPDATE villages SET wood = 400000, clay = 400000, iron = 400000, resources_at = now() WHERE id = $1', [vid]);
    expect(await tx((c) => ensureLetters(c, pid, vid, 2, new Date()))).toBe(true);
    expect((await player()).noble_letters).toBe(2);
    expect(Number((await player()).treasury_wood)).toBe(0);
    // Trop cher d'un coup : il verse la moitié de son stock et réessaiera.
    await pool.query('UPDATE villages SET wood = 10000, resources_at = now() WHERE id = $1', [vid]);
    expect(await tx((c) => ensureLetters(c, pid, vid, 4, new Date()))).toBe(false);
    expect(Number((await player()).treasury_wood)).toBeGreaterThanOrEqual(5000);
  });
});
