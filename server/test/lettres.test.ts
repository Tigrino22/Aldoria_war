import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { freeLetters, letterPriceAt, lettersAffordable, lettersCost, lettersRequired } from '@aldoria/shared';
import { buildApp } from '../src/app';
import { pool, tx } from '../src/db';
import { env } from '../src/env';
import { readFileSync } from 'node:fs';
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
  const base = { wood: 5000, clay: 6000, iron: 5000, wheat: 0 };
  it('chaque lettre ajoute increase % du prix de base', () => {
    expect(letterPriceAt(base, 100, 1)).toEqual(base);
    expect(letterPriceAt(base, 100, 2)).toEqual({ wood: 10000, clay: 12000, iron: 10000, wheat: 0 });
    expect(letterPriceAt(base, 100, 4).clay).toBe(24000);
    expect(letterPriceAt(base, 50, 3).wood).toBe(10000);
    expect(letterPriceAt(base, 0, 10)).toEqual(base);
    // 4 lettres d'un coup après 2 déjà frappées : 3 + 4 + 5 + 6 fois le prix de base.
    expect(lettersCost(base, 100, 2, 4).wood).toBe(18 * 5000);
  });
  it('demande autant de lettres frappées que de villages et de nobles', () => {
    expect(lettersRequired(1, 0)).toBe(1);
    expect(lettersRequired(1, 1)).toBe(2);
    expect(lettersRequired(3, 2, 2)).toBe(6);
    expect(freeLetters(0, 1, 0)).toBe(0);
    expect(freeLetters(3, 1, 0)).toBe(3);
    expect(freeLetters(3, 2, 1)).toBe(1);
    expect(freeLetters(1, 3, 2)).toBe(0);
  });
  it('compte les lettres que paie la cagnotte, hausse comprise', () => {
    // 1 + 2 + 3 = 6 fois le prix de base tient dans 30 000 de bois, pas 1 + 2 + 3 + 4 = 10 fois.
    expect(lettersAffordable({ wood: 30000, clay: 36000, iron: 30000, wheat: 0 }, base, 100, 0)).toBe(3);
    expect(lettersAffordable({ wood: 30000, clay: 36000, iron: 30000, wheat: 0 }, base, 100, 5)).toBe(1);
    expect(lettersAffordable({ wood: 30000, clay: 36000, iron: 30000, wheat: 0 }, base, 100, 6)).toBe(0);
    expect(lettersAffordable({ wood: 0, clay: 54000, iron: 30000, wheat: 0 }, base, 100, 0)).toBe(0);
  });
});

describe('cagnotte et lettres de noblesse', () => {
  it('la cagnotte paie les lettres, qui doivent couvrir villages + nobles', async () => {
    const h = await register('Baronne');
    const me = (await app.inject({ method: 'GET', url: '/api/me', headers: h })).json();
    const vid = me.villages[0].id as number;
    const pid = me.player.id as number;
    const post = (url: string, body: object) => app.inject({ method: 'POST', url: `/api/villages/${vid}${url}`, headers: h, payload: body });
    const player = async () => (await pool.query('SELECT letters_minted, treasury_wood, treasury_clay, treasury_iron FROM players WHERE id = $1', [pid])).rows[0];
    const view = async () => (await app.inject({ method: 'GET', url: `/api/villages/${vid}`, headers: h })).json().nobility;

    await pool.query(
      `UPDATE villages SET buildings = buildings || '{"townhall": 9, "barracks": 10, "farm": 30, "warehouse": 30}'::jsonb,
         wood = 400000, clay = 400000, iron = 400000, wheat = 400000, resources_at = now() WHERE id = $1`,
      [vid],
    );

    // Versement : plafonné au stock du village, sans plafond côté cagnotte.
    const dep = await post('/treasury', { wood: 100000, clay: 900000, iron: 40000 });
    expect(dep.statusCode).toBe(200);
    const t = dep.json().nobility.treasury;
    expect(t.wood).toBe(100000);
    expect(t.clay).toBeGreaterThanOrEqual(400000);
    expect(t.iron).toBe(40000);
    expect(Math.floor(dep.json().resources.clay)).toBeLessThan(10);
    expect((await post('/treasury', { wood: 0, clay: 0, iron: 0 })).statusCode).toBe(400);

    // Hôtel de ville 9 : pas encore de lettres.
    expect((await post('/letters', { count: 1 })).statusCode).toBe(400);
    await pool.query(`UPDATE villages SET buildings = buildings || '{"townhall": 10}'::jsonb WHERE id = $1`, [vid]);

    // Sans lettre, pas de noble.
    const none = await post('/recruit', { unit: 'noble', count: 1 });
    expect(none.statusCode).toBe(400);
    expect(none.json().error).toMatch(/1 lettre de noblesse/);

    // 40 000 de fer : 1 + 2 + 3 = 6 fois 5 000 tiennent, pas 10 fois avec une 4e lettre.
    expect((await post('/letters', { count: 4 })).statusCode).toBe(400);
    const minted = await post('/letters', { count: 3 });
    expect(minted.statusCode).toBe(200);
    expect(minted.json().nobility).toMatchObject({ enabled: true, minted: 3, villages: 1, nobles: 0, free: 3, increase: 100 });
    expect(minted.json().nobility.price.wood).toBe(4 * env.letterWood);
    expect(Number((await player()).treasury_iron)).toBe(40000 - 6 * env.letterIron);

    // 1 village + 2 nobles = 3 lettres : un 3e noble en demanderait 4.
    await pool.query('UPDATE villages SET wood = 400000, clay = 400000, iron = 400000, resources_at = now() WHERE id = $1', [vid]);
    expect((await post('/recruit', { unit: 'noble', count: 2 })).statusCode).toBe(200);
    expect(await view()).toMatchObject({ nobles: 2, free: 1 });
    const refused = await post('/recruit', { unit: 'noble', count: 2 });
    expect(refused.statusCode).toBe(400);
    expect(refused.json().error).toMatch(/1 lettre de noblesse/);

    // Annuler un recrutement libère la lettre ; les lettres frappées ne diminuent pas.
    const q = (await post('/recruit', { unit: 'noble', count: 1 })).json().recruitQueue.at(-1);
    expect(await view()).toMatchObject({ nobles: 3, free: 0 });
    expect((await app.inject({ method: 'DELETE', url: `/api/villages/${vid}/recruit/${q.id}`, headers: h })).statusCode).toBe(200);
    expect(await view()).toMatchObject({ minted: 3, nobles: 2, free: 1 });

    // Un noble mort (retiré de l'armée) libère sa lettre ; une conquête (noble installé, village en plus) ne change rien.
    await pool.query('DELETE FROM recruit_queue WHERE village_id = $1', [vid]);
    await pool.query(`UPDATE villages SET owner_id = $1 WHERE id = (SELECT id FROM villages WHERE owner_id IS NULL AND kind = 'village' LIMIT 1)`, [pid]);
    expect(await view()).toMatchObject({ villages: 2, nobles: 0, free: 2 });

    // Système coupé : le noble ne demande pas de lettre.
    env.nobleLetters = 0;
    expect((await post('/recruit', { unit: 'noble', count: 3 })).statusCode).toBe(200);
    expect((await post('/letters', { count: 1 })).statusCode).toBe(400);
    expect((await post('/treasury', { wood: 1, clay: 1, iron: 1 })).statusCode).toBe(400);
    env.nobleLetters = 1;
    await pool.query('DELETE FROM recruit_queue WHERE village_id = $1', [vid]);

    // Les PNJ versent ce qui manque puis frappent : 3 nobles avec 2 villages demandent 4 lettres, il en manque 1.
    await pool.query('UPDATE players SET treasury_wood = 0, treasury_clay = 0, treasury_iron = 0 WHERE id = $1', [pid]);
    await pool.query('UPDATE villages SET wood = 400000, clay = 400000, iron = 400000, resources_at = now() WHERE id = $1', [vid]);
    expect(await tx((c) => ensureLetters(c, pid, vid, 3, new Date()))).toBe(true);
    expect((await player()).letters_minted).toBe(4);
    expect(Number((await player()).treasury_wood)).toBe(0);
    // Trop cher d'un coup : il verse la moitié de son stock et réessaiera.
    await pool.query('UPDATE villages SET wood = 10000, resources_at = now() WHERE id = $1', [vid]);
    expect(await tx((c) => ensureLetters(c, pid, vid, 6, new Date()))).toBe(false);
    expect(Number((await player()).treasury_wood)).toBeGreaterThanOrEqual(5000);
  });

  it('compte les nobles déjà recrutés comme des lettres frappées (migration 037)', async () => {
    const h = await register('Comtesse');
    const me = (await app.inject({ method: 'GET', url: '/api/me', headers: h })).json();
    const vid = me.villages[0].id as number;
    const pid = me.player.id as number;
    await pool.query(
      `INSERT INTO troops (village_id, home_village_id, units) VALUES ($1, $1, '{"noble": 2}')
       ON CONFLICT (village_id, home_village_id) DO UPDATE SET units = troops.units || '{"noble": 2}'::jsonb`,
      [vid],
    );
    await pool.query('UPDATE players SET letters_minted = 0 WHERE id = $1', [pid]);
    await pool.query(readFileSync(new URL('../migrations/037_lettres_nobles_existants.sql', import.meta.url), 'utf8'));
    expect((await pool.query('SELECT letters_minted FROM players WHERE id = $1', [pid])).rows[0].letters_minted).toBe(2);
    // Le 3e noble demande seulement la lettre n° 3.
    const view = (await app.inject({ method: 'GET', url: `/api/villages/${vid}`, headers: h })).json().nobility;
    expect(view).toMatchObject({ minted: 2, nobles: 2, free: 0, price: { wood: 3 * env.letterWood } });
  });
});
