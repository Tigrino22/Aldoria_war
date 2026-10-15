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
const meOf = async (t: string) => (await app.inject({ method: 'GET', url: '/api/me', headers: auth(t) })).json();
const send = (from: string, to: string, subject: string) =>
  app.inject({ method: 'POST', url: '/api/messages', headers: auth(from), payload: { to, subject, body: 'Bonjour' } });
const seen = (t: string, page: string) => app.inject({ method: 'POST', url: '/api/me/seen', headers: auth(t), payload: { page } });

describe('pastilles du menu', () => {
  beforeAll(async () => {
    await migrate(true);
    app = await buildApp();
  });
  afterAll(async () => {
    await app.close();
    await pool.end();
  });

  it("disparaissent à l'ouverture de la page, sans marquer les messages comme lus", async () => {
    const a = await register('Gauvain');
    const b = await register('Yvain');
    await send(a, 'Yvain', 'Premier');
    await send(a, 'Yvain', 'Second');
    expect((await meOf(b)).unreadMessages).toBe(2);

    expect((await seen(b, 'messages')).statusCode).toBe(200);
    expect((await meOf(b)).unreadMessages).toBe(0);
    // Les messages restent non lus dans la boîte de réception.
    const inbox = (await app.inject({ method: 'GET', url: '/api/messages', headers: auth(b) })).json();
    expect(inbox.filter((m: { read: boolean }) => !m.read)).toHaveLength(2);

    // Un nouveau message rallume la pastille, pour lui seul.
    await send(a, 'Yvain', 'Troisième');
    expect((await meOf(b)).unreadMessages).toBe(1);
  });

  it("l'invitation de tribu reste acceptable une fois la pastille effacée", async () => {
    const chef = await register('Bohort');
    const invite = await register('Galaad');
    await app.inject({ method: 'POST', url: '/api/tribes', headers: auth(chef), payload: { name: 'Graal', tag: 'GR' } });
    await app.inject({ method: 'POST', url: '/api/tribes/invite', headers: auth(chef), payload: { username: 'Galaad' } });
    expect((await meOf(invite)).newInvites).toBe(1);
    await seen(invite, 'tribu');
    const me = await meOf(invite);
    expect(me.newInvites).toBe(0);
    expect(me.invites).toHaveLength(1);
  });

  it('refuse une page inconnue', async () => {
    const t = await register('Tristan');
    expect((await seen(t, 'carte')).statusCode).toBe(400);
  });
});
