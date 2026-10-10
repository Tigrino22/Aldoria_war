import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { STARTING_BUILDINGS, emptyUnits } from '@aldoria/shared';
import { buildApp } from '../src/app';
import { pool, tx } from '../src/db';
import { migrate } from '../src/migrate';
import { createVillage } from '../src/game/village';

let app: Awaited<ReturnType<typeof buildApp>>;
const T0 = new Date('2030-01-15T12:00:00Z');
const losses = (n: number) => ({ ...emptyUnits(), spearman: n });

describe('assistant de pillage : villages barbares et pastilles', () => {
  beforeAll(async () => {
    await migrate(true);
    app = await buildApp();
  });
  afterAll(async () => {
    await app.close();
    await pool.end();
  });

  it('classe chaque barbare d’après le dernier rapport du joueur', async () => {
    const reg = await app.inject({ method: 'POST', url: '/api/auth/register', payload: { username: 'Pilleur', password: 'secret123' } });
    const token = reg.json().token as string;
    const headers = { authorization: `Bearer ${token}` };
    const me = (await app.inject({ method: 'GET', url: '/api/me', headers })).json();
    const home = me.villages[0];
    const playerId = me.player.id as number;

    const barb = (name: string, dx: number) =>
      tx((c) => createVillage(c, { ownerId: null, name, x: home.x + dx, y: home.y, buildings: STARTING_BUILDINGS, resources: { wood: 0, clay: 0, iron: 0, wheat: 0 }, at: T0, troops: emptyUnits() }));
    const ids = { never: await barb('Jamais', 1), scouted: await barb('Espion', 2), lost: await barb('Perdu', 3), losses: await barb('Pertes', 4), clean: await barb('Propre', 5), far: await barb('Loin', 40) };

    const report = (type: string, target: number, wins: boolean, lost: number) =>
      pool.query('INSERT INTO reports (player_id, type, title, data, created_at) VALUES ($1, $2, $3, $4, now())', [
        playerId, type, 'x', JSON.stringify({ attackerWins: wins, attacker: { losses: losses(lost) }, defender: { village: { id: target } }, loot: wins ? { wood: 100, clay: 50, iron: 0, wheat: 0 } : null }),
      ]);
    await report('scout', ids.scouted, true, 0);
    await report('attack', ids.lost, false, 30);
    await report('attack', ids.losses, true, 5);
    await report('attack', ids.clean, true, 0);

    const res = await app.inject({ method: 'GET', url: `/api/villages/${home.id}/raid-targets?radius=10`, headers });
    expect(res.statusCode).toBe(200);
    const byName = Object.fromEntries(res.json().map((t: any) => [t.name, t]));
    expect(byName.Jamais.status).toBe('never');
    expect(byName.Espion.status).toBe('scouted');
    expect(byName.Perdu.status).toBe('lost');
    expect(byName.Pertes.status).toBe('losses');
    expect(byName.Propre.status).toBe('clean');
    expect(byName.Propre.lastLoot).toBe(150);
    expect(byName.Loin).toBeUndefined();
    expect(res.json()[0].name).toBe('Jamais');

    // Seul le propriétaire du village de départ peut interroger.
    const other = await app.inject({ method: 'POST', url: '/api/auth/register', payload: { username: 'Curieux', password: 'secret123' } });
    const denied = await app.inject({ method: 'GET', url: `/api/villages/${home.id}/raid-targets`, headers: { authorization: `Bearer ${other.json().token}` } });
    expect(denied.statusCode).toBe(403);
  });
});
