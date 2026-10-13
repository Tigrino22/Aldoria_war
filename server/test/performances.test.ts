import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { STARTING_BUILDINGS, emptyUnits } from '@aldoria/shared';
import { buildApp } from '../src/app';
import { pool, tx } from '../src/db';
import { migrate } from '../src/migrate';
import { Outbox, register } from '../src/notify';
import { createVillage, setTroops } from '../src/game/village';

let app: Awaited<ReturnType<typeof buildApp>>;
const T0 = new Date('2030-01-15T12:00:00Z');

describe('performances : envois groupés et notifications', () => {
  beforeAll(async () => {
    await migrate(true);
    app = await buildApp();
  });
  afterAll(async () => {
    await app.close();
    await pool.end();
  });

  it('l’assistant de pillage envoie plusieurs attaques en une requête et s’arrête quand les troupes manquent', async () => {
    const reg = await app.inject({ method: 'POST', url: '/api/auth/register', payload: { username: 'Groupe', password: 'secret123' } });
    const headers = { authorization: `Bearer ${reg.json().token}` };
    const home = (await app.inject({ method: 'GET', url: '/api/me', headers })).json().villages[0];
    const barb = (dx: number) =>
      tx((c) => createVillage(c, { ownerId: null, name: `Barbare ${dx}`, x: home.x + dx, y: home.y + 1, buildings: STARTING_BUILDINGS, resources: { wood: 0, clay: 0, iron: 0, wheat: 0 }, at: T0, troops: emptyUnits() }));
    const targets = [await barb(1), await barb(2), await barb(3), await barb(4)];
    const url = `/api/villages/${home.id}/commands/batch`;

    // Sans troupes, rien ne part et l'erreur est celle d'un envoi simple.
    const none = await app.inject({ method: 'POST', url, headers, payload: { targetIds: targets, units: { spearman: 10 } } });
    expect(none.statusCode).toBe(400);
    expect(none.json().error).toMatch(/assez de troupes/);

    await tx((c) => setTroops(c, home.id, home.id, { ...emptyUnits(), spearman: 30 }));
    const res = await app.inject({ method: 'POST', url, headers, payload: { targetIds: targets, units: { spearman: 10 } } });
    expect(res.statusCode).toBe(200);
    const body = res.json();
    expect(body.sent).toBe(3);
    expect(body.error).toMatch(/assez de troupes/);
    expect(body.village.troopsHome.spearman).toBe(0);
    expect(body.village.outgoing.map((o: any) => o.target.id).sort()).toEqual(targets.slice(0, 3).sort());
  });

  it('une même notification n’est envoyée qu’une fois par passage', () => {
    const sent: string[] = [];
    register(424242, { readyState: 1, send: (m: string) => sent.push(m), on: () => undefined } as any);
    const outbox = new Outbox();
    outbox.push(424242, { type: 'village', villageId: 1 });
    outbox.push(424242, { type: 'village', villageId: 1 });
    outbox.push(424242, { type: 'village', villageId: 2 });
    outbox.flush();
    expect(sent).toEqual([JSON.stringify({ type: 'village', villageId: 1 }), JSON.stringify({ type: 'village', villageId: 2 })]);
  });
});
