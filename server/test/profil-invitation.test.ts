import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { buildApp } from '../src/app';
import { pool } from '../src/db';
import { migrate } from '../src/migrate';

let app: Awaited<ReturnType<typeof buildApp>>;
const auth = (t: string) => ({ authorization: `Bearer ${t}` });

async function register(username: string) {
  const res = await app.inject({ method: 'POST', url: '/api/auth/register', payload: { username, password: 'secret123' } });
  expect(res.statusCode).toBe(200);
  return res.json().token as string;
}
const profileOf = async (viewer: string, name: string) => (await app.inject({ method: 'GET', url: `/api/players/${name}`, headers: auth(viewer) })).json();

describe('invitation depuis le profil', () => {
  beforeAll(async () => {
    await migrate(true);
    app = await buildApp();
  });
  afterAll(async () => {
    await app.close();
    await pool.end();
  });

  it("seul le chef de tribu voit « inviter » sur le profil d'un joueur sans tribu", async () => {
    const chef = await register('Arthur');
    const membre = await register('Perceval');
    const libre = await register('Lancelot');
    await app.inject({ method: 'POST', url: '/api/tribes', headers: auth(chef), payload: { name: 'Table Ronde', tag: 'TR' } });

    // Sans tribu, personne ne peut inviter.
    expect((await profileOf(libre, 'Perceval')).invite).toBe('none');
    // Le chef voit le bouton, puis l'état « envoyée ».
    expect((await profileOf(chef, 'Lancelot')).invite).toBe('can');
    expect((await profileOf(chef, 'Arthur')).invite).toBe('none');
    await app.inject({ method: 'POST', url: '/api/tribes/invite', headers: auth(chef), payload: { username: 'Lancelot' } });
    expect((await profileOf(chef, 'Lancelot')).invite).toBe('pending');

    // Un simple membre n'a pas ce pouvoir (côté profil comme côté serveur).
    const invite = (await app.inject({ method: 'GET', url: '/api/me', headers: auth(membre) })).json().invites;
    expect(invite).toHaveLength(0);
    await app.inject({ method: 'POST', url: '/api/tribes/invite', headers: auth(chef), payload: { username: 'Perceval' } });
    const inv = (await app.inject({ method: 'GET', url: '/api/me', headers: auth(membre) })).json().invites[0];
    await app.inject({ method: 'POST', url: `/api/invites/${inv.id}/accept`, headers: auth(membre) });
    expect((await profileOf(membre, 'Lancelot')).invite).toBe('none');
    const refused = await app.inject({ method: 'POST', url: '/api/tribes/invite', headers: auth(membre), payload: { username: 'Lancelot' } });
    expect(refused.statusCode).toBe(403);
    // Un joueur déjà dans une tribu ne se voit plus proposer d'invitation.
    expect((await profileOf(chef, 'Perceval')).invite).toBe('none');
  });
});
