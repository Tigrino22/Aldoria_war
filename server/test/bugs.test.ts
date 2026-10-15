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

describe('bugs remontés par les joueurs', () => {
  it('un joueur signale un bug, l’administration le traite et le joueur voit la réponse', async () => {
    env.adminUsernames.push('dev');
    const dev = await register('Dev');
    const joueur = await register('Testeuse');
    const send = (payload: object) => app.inject({ method: 'POST', url: '/api/bugs', headers: joueur, payload });

    expect((await send({ description: 'court' })).statusCode).toBe(400);
    const ok = await send({ description: 'La carte reste noire sur iPhone après un zoom.', page: 'carte/12,40', device: 'Safari iOS 19', screen: '390x844' });
    expect(ok.statusCode).toBe(200);

    expect((await app.inject({ method: 'GET', url: '/api/admin/bugs', headers: joueur })).statusCode).toBe(403);
    expect((await app.inject({ method: 'GET', url: '/api/me', headers: dev })).json().openBugReports).toBe(1);
    const open = (await app.inject({ method: 'GET', url: '/api/admin/bugs', headers: dev })).json();
    expect(open[0]).toMatchObject({ reporter: 'Testeuse', page: 'carte/12,40', device: 'Safari iOS 19', screen: '390x844', status: 'open' });

    const put = (payload: object) => app.inject({ method: 'PUT', url: `/api/admin/bugs/${open[0].id}`, headers: dev, payload });
    expect((await put({ status: 'fixed', note: 'Corrigé, merci !' })).statusCode).toBe(200);
    expect((await app.inject({ method: 'GET', url: '/api/me', headers: dev })).json().openBugReports).toBe(0);

    // Le joueur voit ses bugs et la réponse, sans le nom de l'administrateur.
    const mine = (await app.inject({ method: 'GET', url: '/api/bugs/mine', headers: joueur })).json();
    expect(mine[0]).toMatchObject({ status: 'fixed', adminNote: 'Corrigé, merci !' });
    expect(mine[0].handledBy).toBeUndefined();
    expect((await app.inject({ method: 'GET', url: '/api/bugs/mine', headers: dev })).json()).toEqual([]);

    const closed = (await app.inject({ method: 'GET', url: '/api/admin/bugs?status=closed', headers: dev })).json();
    expect(closed[0]).toMatchObject({ status: 'fixed', handledBy: 'Dev' });
    expect((await put({ status: 'open' })).statusCode).toBe(200);
    expect((await app.inject({ method: 'GET', url: '/api/bugs/mine', headers: joueur })).json()[0]).toMatchObject({ status: 'open', adminNote: null });
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
});
