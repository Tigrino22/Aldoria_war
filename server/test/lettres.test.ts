import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { lettersForNext, lettersForNobles, noblesAffordable } from '@aldoria/shared';
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

describe('règle des lettres', () => {
  it('une lettre de plus par village et par noble au-delà du premier', () => {
    expect(lettersForNext(1, 0, 1)).toBe(1);
    expect(lettersForNext(6, 0, 1)).toBe(6);
    expect(lettersForNext(2, 3, 1)).toBe(5);
    expect(lettersForNext(3, 0, 2)).toBe(5);
    expect(lettersForNext(9, 9, 0)).toBe(1);
    expect(lettersForNobles(1, 0, 4, 1)).toBe(1 + 2 + 3 + 4);
    expect(noblesAffordable(1, 0, 6, 1)).toBe(3);
    expect(noblesAffordable(1, 0, 5, 1)).toBe(2);
  });
});

describe('lettres de noblesse', () => {
  it('se frappent à l’hôtel de ville, paient les nobles et reviennent à l’annulation', async () => {
    const h = await register('Baronne');
    const me = (await app.inject({ method: 'GET', url: '/api/me', headers: h })).json();
    const vid = me.villages[0].id as number;
    const pid = me.player.id as number;
    const post = (url: string, body: object) => app.inject({ method: 'POST', url: `/api/villages/${vid}${url}`, headers: h, payload: body });
    const stock = async () => (await pool.query('SELECT noble_letters FROM players WHERE id = $1', [pid])).rows[0].noble_letters as number;

    await pool.query(
      `UPDATE villages SET buildings = buildings || '{"townhall": 9, "barracks": 10, "farm": 30, "warehouse": 30}'::jsonb,
         wood = 400000, clay = 400000, iron = 400000, wheat = 400000, resources_at = now() WHERE id = $1`,
      [vid],
    );
    // Hôtel de ville 9 : pas encore de lettres.
    expect((await post('/letters', { count: 1 })).statusCode).toBe(400);
    await pool.query(`UPDATE villages SET buildings = buildings || '{"townhall": 10}'::jsonb WHERE id = $1`, [vid]);

    const minted = await post('/letters', { count: 3 });
    expect(minted.statusCode).toBe(200);
    expect(minted.json().nobility).toMatchObject({ enabled: true, letters: 3, next: 1, villages: 1, nobles: 0 });
    expect(Math.floor(minted.json().resources.wood)).toBeLessThanOrEqual(400000 - 3 * env.letterWood + 5);
    expect(await stock()).toBe(3);

    // Un noble : 1 lettre. Les deux suivants : 2 + 3 = 5 lettres, il n'en reste que 2.
    expect((await post('/recruit', { unit: 'noble', count: 1 })).statusCode).toBe(200);
    expect(await stock()).toBe(2);
    const refused = await post('/recruit', { unit: 'noble', count: 2 });
    expect(refused.statusCode).toBe(400);
    expect(refused.json().error).toMatch(/5 lettres de noblesse/);

    await post('/letters', { count: 3 });
    const two = await post('/recruit', { unit: 'noble', count: 2 });
    expect(two.statusCode).toBe(200);
    expect(two.json().nobility).toMatchObject({ letters: 0, next: 4, nobles: 3 });

    // Annuler la dernière commande rend ses lettres.
    const lastQueue = two.json().recruitQueue.at(-1);
    expect((await app.inject({ method: 'DELETE', url: `/api/villages/${vid}/recruit/${lastQueue.id}`, headers: h })).statusCode).toBe(200);
    expect(await stock()).toBe(5);

    // Système coupé : le noble ne coûte que ses ressources.
    env.nobleLetters = 0;
    expect((await post('/recruit', { unit: 'noble', count: 1 })).statusCode).toBe(200);
    expect(await stock()).toBe(5);
    expect((await post('/letters', { count: 1 })).statusCode).toBe(400);
    env.nobleLetters = 1;

    // Les PNJ frappent eux-mêmes ce qui manque, s'ils peuvent le payer.
    await pool.query('UPDATE players SET noble_letters = 0 WHERE id = $1', [pid]);
    expect(await tx((c) => ensureLetters(c, pid, vid, 1, new Date()))).toBe(true);
    // 1 village + 2 nobles déjà là : le prochain demande 3 lettres.
    expect(await stock()).toBe(3);
    await pool.query('UPDATE villages SET wood = 0, resources_at = now() WHERE id = $1', [vid]);
    expect(await tx((c) => ensureLetters(c, pid, vid, 2, new Date()))).toBe(false);
  });
});
