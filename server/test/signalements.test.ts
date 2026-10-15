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

describe('signalements', () => {
  it('un joueur signale un joueur, un message reçu ou une tribu, et l’administration les traite', async () => {
    env.adminUsernames.push('modo');
    const modo = await register('Modo');
    const victime = await register('Victime');
    const fauteur = await register('Fauteur');
    const report = (headers: Record<string, string>, payload: object) => app.inject({ method: 'POST', url: '/api/moderation/reports', headers, payload });

    // Joueur
    expect((await report(victime, { kind: 'player', target: 'fauteur', reason: 'cheat', comment: 'Deux comptes' })).statusCode).toBe(200);
    expect((await report(victime, { kind: 'player', target: 'Fauteur', reason: 'cheat' })).statusCode).toBe(400); // déjà signalé
    expect((await report(victime, { kind: 'player', target: 'Victime', reason: 'cheat' })).statusCode).toBe(400); // soi-même
    expect((await report(victime, { kind: 'player', target: 'Personne', reason: 'cheat' })).statusCode).toBe(404);
    expect((await report(victime, { kind: 'player', target: 'Fauteur', reason: 'inconnu' })).statusCode).toBe(400);

    // Message : seul le destinataire peut le signaler, et il est recopié tel quel.
    await app.inject({ method: 'POST', url: '/api/messages', headers: fauteur, payload: { to: 'Victime', subject: 'Salut', body: 'Texte insultant' } });
    const msgId = (await app.inject({ method: 'GET', url: '/api/messages?box=in', headers: victime })).json()[0].id as number;
    expect((await report(fauteur, { kind: 'message', target: msgId, reason: 'insult' })).statusCode).toBe(404);
    expect((await report(modo, { kind: 'message', target: msgId, reason: 'insult' })).statusCode).toBe(404);
    expect((await report(victime, { kind: 'message', target: msgId, reason: 'insult' })).statusCode).toBe(200);

    // Tribu
    const tribe = (await app.inject({ method: 'POST', url: '/api/tribes', headers: fauteur, payload: { name: 'Les Vilains', tag: 'VIL' } })).json();
    expect((await report(victime, { kind: 'tribe', target: tribe.id, reason: 'name' })).statusCode).toBe(200);

    // Réservé à l'administration, compteur dans /api/me.
    expect((await app.inject({ method: 'GET', url: '/api/admin/moderation', headers: victime })).statusCode).toBe(403);
    expect((await app.inject({ method: 'GET', url: '/api/me', headers: modo })).json().openModerationReports).toBe(3);
    expect((await app.inject({ method: 'GET', url: '/api/me', headers: victime })).json().openModerationReports).toBeUndefined();

    const open = (await app.inject({ method: 'GET', url: '/api/admin/moderation?status=open', headers: modo })).json();
    expect(open.map((r: any) => r.kind)).toEqual(['player', 'message', 'tribe']);
    expect(open[0]).toMatchObject({ reporter: 'Victime', reason: 'cheat', comment: 'Deux comptes', targetPlayer: { name: 'Fauteur' }, sameTarget: 2 });
    expect(open[1].message).toEqual({ subject: 'Salut', body: 'Texte insultant' });
    expect(open[2].targetTribe.name).toBe('[VIL] Les Vilains');

    // Le message signalé reste lisible même si l'auteur le modifiait ou le supprimait ensuite.
    await pool.query('DELETE FROM messages WHERE id = $1', [msgId]);
    expect((await app.inject({ method: 'GET', url: '/api/admin/moderation', headers: modo })).json()[1].message.body).toBe('Texte insultant');

    const put = (id: number, payload: object) => app.inject({ method: 'PUT', url: `/api/admin/moderation/${id}`, headers: modo, payload });
    expect((await put(open[0].id, { status: 'done', note: 'Averti' })).statusCode).toBe(200);
    expect((await put(open[2].id, { status: 'rejected' })).statusCode).toBe(200);
    expect((await put(999999, { status: 'done' })).statusCode).toBe(404);

    const closed = (await app.inject({ method: 'GET', url: '/api/admin/moderation?status=closed', headers: modo })).json();
    expect(closed).toHaveLength(2);
    expect(closed.find((r: any) => r.id === open[0].id)).toMatchObject({ status: 'done', adminNote: 'Averti', handledBy: 'Modo' });
    expect((await app.inject({ method: 'GET', url: '/api/me', headers: modo })).json().openModerationReports).toBe(1);

    // Rouvrir efface la décision ; après clôture, on peut de nouveau signaler la même chose.
    expect((await put(open[2].id, { status: 'open' })).statusCode).toBe(200);
    expect((await app.inject({ method: 'GET', url: '/api/admin/moderation', headers: modo })).json()).toHaveLength(2);
    expect((await report(victime, { kind: 'player', target: 'Fauteur', reason: 'insult' })).statusCode).toBe(200);
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
