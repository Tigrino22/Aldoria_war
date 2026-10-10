import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { buildApp } from '../src/app';
import { pool } from '../src/db';
import { migrate } from '../src/migrate';

let app: Awaited<ReturnType<typeof buildApp>>;

describe('quêtes de départ', () => {
  beforeAll(async () => {
    await migrate(true);
    app = await buildApp();
  });
  afterAll(async () => {
    await app.close();
    await pool.end();
  });

  it('une quête accomplie se récupère une seule fois et donne ses ressources', async () => {
    const reg = await app.inject({ method: 'POST', url: '/api/auth/register', payload: { username: 'Novice', password: 'secret123' } });
    const headers = { authorization: `Bearer ${reg.json().token}` };
    const me = (await app.inject({ method: 'GET', url: '/api/me', headers })).json();
    const villageId = me.villages[0].id as number;

    const list = (await app.inject({ method: 'GET', url: '/api/quests', headers })).json();
    expect(list.length).toBeGreaterThan(5);
    expect(list.every((q: any) => !q.done && !q.claimed)).toBe(true);

    const tooEarly = await app.inject({ method: 'POST', url: '/api/quests/woodcutter3/claim', headers, payload: { villageId } });
    expect(tooEarly.statusCode).toBe(400);

    // Le village de départ a déjà un hôtel de ville niveau 1 : on triche en base pour monter le bûcheron.
    await pool.query("UPDATE villages SET buildings = buildings || '{\"woodcutter\": 3}'::jsonb, wood = 0 WHERE id = $1", [villageId]);
    const after = (await app.inject({ method: 'GET', url: '/api/quests', headers })).json();
    expect(after.find((q: any) => q.key === 'woodcutter3').done).toBe(true);

    const ok = await app.inject({ method: 'POST', url: '/api/quests/woodcutter3/claim', headers, payload: { villageId } });
    expect(ok.statusCode).toBe(200);
    expect(ok.json().resources.wood).toBeGreaterThanOrEqual(100);

    const again = await app.inject({ method: 'POST', url: '/api/quests/woodcutter3/claim', headers, payload: { villageId } });
    expect(again.statusCode).toBe(400);
    expect((await app.inject({ method: 'GET', url: '/api/quests', headers })).json().find((q: any) => q.key === 'woodcutter3').claimed).toBe(true);
  });
});
