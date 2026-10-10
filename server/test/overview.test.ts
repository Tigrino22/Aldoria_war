import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { buildApp } from '../src/app';
import { pool } from '../src/db';
import { migrate } from '../src/migrate';

let app: Awaited<ReturnType<typeof buildApp>>;

describe("vue d'ensemble", () => {
  beforeAll(async () => {
    await migrate(true);
    app = await buildApp();
  });
  afterAll(async () => {
    await app.close();
    await pool.end();
  });

  it('liste tous les villages du joueur avec leurs files', async () => {
    const reg = await app.inject({ method: 'POST', url: '/api/auth/register', payload: { username: 'Voyageur', password: 'secret123' } });
    const token = reg.json().token as string;
    const headers = { authorization: `Bearer ${token}` };
    const me = (await app.inject({ method: 'GET', url: '/api/me', headers })).json();
    await app.inject({ method: 'POST', url: `/api/villages/${me.villages[0].id}/build`, headers, payload: { building: 'woodcutter' } });

    const res = await app.inject({ method: 'GET', url: '/api/overview', headers });
    expect(res.statusCode).toBe(200);
    const list = res.json();
    expect(list).toHaveLength(1);
    expect(list[0].id).toBe(me.villages[0].id);
    expect(list[0].buildQueue).toHaveLength(1);

    const anonymous = await app.inject({ method: 'GET', url: '/api/overview' });
    expect(anonymous.statusCode).toBe(401);
  });
});
