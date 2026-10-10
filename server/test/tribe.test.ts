import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { buildApp } from '../src/app';
import { pool, tx } from '../src/db';
import { migrate } from '../src/migrate';
import { Outbox } from '../src/notify';
import { sendCommand } from '../src/game/commands';

let app: Awaited<ReturnType<typeof buildApp>>;
const auth = (t: string) => ({ authorization: `Bearer ${t}` });

async function register(username: string) {
  const res = await app.inject({ method: 'POST', url: '/api/auth/register', payload: { username, password: 'secret123' } });
  expect(res.statusCode).toBe(200);
  const token = res.json().token as string;
  const me = (await app.inject({ method: 'GET', url: '/api/me', headers: auth(token) })).json();
  return { token, id: me.player.id as number, village: me.villages[0].id as number };
}

describe('outils de tribu', () => {
  beforeAll(async () => {
    await migrate(true);
    app = await buildApp();
  });
  afterAll(async () => {
    await app.close();
    await pool.end();
  });

  it('message de tribu, villages des membres et menaces extérieures', async () => {
    const chef = await register('Chef');
    const membre = await register('Membre');
    const tribe = (await app.inject({ method: 'POST', url: '/api/tribes', headers: auth(chef.token), payload: { name: 'Les Loups', tag: 'LOUP' } })).json();
    await pool.query('UPDATE players SET tribe_id = $1 WHERE id = $2', [tribe.id, membre.id]);

    const villages = (await app.inject({ method: 'GET', url: '/api/tribes/mine/villages', headers: auth(membre.token) })).json();
    expect(villages.map((v: any) => v.ownerName).sort()).toEqual(['Chef', 'Membre']);

    const sent = await app.inject({ method: 'POST', url: '/api/tribes/mine/broadcast', headers: auth(chef.token), payload: { subject: 'Rendez-vous', body: 'Ce soir 21h' } });
    expect(sent.json().sent).toBe(1);
    const inbox = (await app.inject({ method: 'GET', url: '/api/messages', headers: auth(membre.token) })).json();
    expect(inbox[0].subject).toBe('[Tribu] Rendez-vous');

    // Un joueur extérieur lance une attaque sur le membre ; une attaque entre alliés n'est pas une menace.
    const ennemi = await register('Ennemi');
    await pool.query('UPDATE players SET protection_until = NULL');
    await tx((c) => c.query("INSERT INTO troops (village_id, home_village_id, units) VALUES ($1, $1, '{\"swordsman\": 10}') ON CONFLICT (village_id, home_village_id) DO UPDATE SET units = EXCLUDED.units", [ennemi.village]));
    await tx((c) => sendCommand(c, new Outbox(), ennemi.id, ennemi.village, { type: 'attack', targetId: membre.village, units: { swordsman: 5 } }, new Date()));
    const threats = (await app.inject({ method: 'GET', url: '/api/tribes/mine/threats', headers: auth(chef.token) })).json();
    expect(threats).toHaveLength(1);
    expect(threats[0].origin.ownerName).toBe('Ennemi');
    expect(threats[0].target.ownerName).toBe('Membre');

    const outsider = await app.inject({ method: 'GET', url: '/api/tribes/mine/threats', headers: auth(ennemi.token) });
    expect(outsider.statusCode).toBe(400);
  });
});
