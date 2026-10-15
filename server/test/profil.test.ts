import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { PROFILE_BIO_MAX, cleanBio } from '@aldoria/shared';
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

beforeAll(async () => {
  await migrate(true);
  app = await buildApp();
});
afterAll(async () => {
  await app.close();
  await pool.end();
});

describe('présentation', () => {
  it('nettoie les espaces et les lignes vides, refuse trop long', () => {
    expect(cleanBio('  Bonjour   à tous \n\n\n\nJe   cherche une tribu.  \n\n')).toEqual({ bio: 'Bonjour à tous\n\nJe cherche une tribu.' });
    expect('error' in cleanBio('x'.repeat(PROFILE_BIO_MAX + 1))).toBe(true);
    expect('error' in cleanBio(Array.from({ length: 9 }, (_, i) => `ligne ${i}`).join('\n'))).toBe(true);
    expect(cleanBio('   ')).toEqual({ bio: '' });
  });
});

describe('profil joueur', () => {
  it('montre la présentation, les faits d’armes et les conquêtes ; la modération peut effacer la présentation', async () => {
    env.adminUsernames.push('gardien');
    const gardien = await register('Gardien');
    const aldric = await register('Aldric');
    const brune = await register('Brune');
    const profile = async (name: string, headers = brune) => (await app.inject({ method: 'GET', url: `/api/players/${name}`, headers })).json();

    const empty = await profile('Aldric');
    expect(empty.bio).toBe('');
    expect(empty.war).toEqual({ conquests: 0, villagesLost: 0, attackWins: 0, defenseWins: 0 });
    expect(empty.conquests).toEqual([]);

    const put = (bio: string) => app.inject({ method: 'PUT', url: '/api/me/bio', headers: aldric, payload: { bio } });
    expect((await put('x'.repeat(PROFILE_BIO_MAX + 1))).statusCode).toBe(400);
    const saved = await put('  Seigneur du Nord.  \n\n\nPas de quartier. ');
    expect(saved.statusCode).toBe(200);
    expect(saved.json().bio).toBe('Seigneur du Nord.\n\nPas de quartier.');
    expect((await profile('aldric')).bio).toBe('Seigneur du Nord.\n\nPas de quartier.');

    // Faits d'armes : compteurs du moteur de combat et journal des conquêtes.
    const ids = (await pool.query("SELECT id, username FROM players WHERE username IN ('Aldric', 'Brune')")).rows;
    const id = (n: string) => ids.find((r) => r.username === n).id as number;
    await pool.query('UPDATE players SET conquests = 1, attack_wins = 4 WHERE id = $1', [id('Aldric')]);
    await pool.query('UPDATE players SET villages_lost = 1, defense_wins = 2 WHERE id = $1', [id('Brune')]);
    await pool.query(
      `INSERT INTO conquest_log (at, conqueror_id, conqueror_name, loser_id, loser_name, village_name, x, y)
       VALUES (now(), $1, 'Aldric', $2, 'Brune', 'Fort-Brune', 12, 34)`,
      [id('Aldric'), id('Brune')],
    );
    const a = await profile('Aldric');
    expect(a.war).toEqual({ conquests: 1, villagesLost: 0, attackWins: 4, defenseWins: 0 });
    expect(a.conquests).toMatchObject([{ won: true, other: 'Brune', village: { name: 'Fort-Brune', x: 12, y: 34 } }]);
    const b = await profile('Brune', aldric);
    expect(b.war).toEqual({ conquests: 0, villagesLost: 1, attackWins: 0, defenseWins: 2 });
    expect(b.conquests).toMatchObject([{ won: false, other: 'Aldric' }]);

    // Un signalement recopie la présentation ; l'administration peut l'effacer du profil.
    expect((await app.inject({ method: 'POST', url: '/api/moderation/reports', headers: brune, payload: { kind: 'player', target: 'Aldric', reason: 'name' } })).statusCode).toBe(200);
    const reports = (await app.inject({ method: 'GET', url: '/api/admin/moderation', headers: gardien })).json();
    expect(reports[0].bio).toBe('Seigneur du Nord.\n\nPas de quartier.');
    expect((await app.inject({ method: 'DELETE', url: `/api/admin/players/${id('Aldric')}/bio`, headers: brune })).statusCode).toBe(403);
    expect((await app.inject({ method: 'DELETE', url: `/api/admin/players/${id('Aldric')}/bio`, headers: gardien })).statusCode).toBe(200);
    expect((await profile('Aldric')).bio).toBe('');
    // La copie reste dans le signalement.
    expect((await app.inject({ method: 'GET', url: '/api/admin/moderation', headers: gardien })).json()[0].bio).toBe('Seigneur du Nord.\n\nPas de quartier.');
  });
});
