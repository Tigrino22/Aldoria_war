import { randomBytes, scrypt, timingSafeEqual } from 'node:crypto';
import { promisify } from 'node:util';
import type { FastifyRequest } from 'fastify';
import { pool, type Db } from './db';
import { GameError } from './errors';

const scryptAsync = promisify(scrypt) as (pw: string, salt: Buffer, len: number) => Promise<Buffer>;
const SESSION_DAYS = 30;

export async function hashPassword(password: string): Promise<string> {
  const salt = randomBytes(16);
  const hash = await scryptAsync(password, salt, 64);
  return `${salt.toString('hex')}:${hash.toString('hex')}`;
}

export async function verifyPassword(password: string, stored: string): Promise<boolean> {
  const [saltHex, hashHex] = stored.split(':');
  if (!saltHex || !hashHex) return false;
  const hash = await scryptAsync(password, Buffer.from(saltHex, 'hex'), 64);
  const expected = Buffer.from(hashHex, 'hex');
  return expected.length === hash.length && timingSafeEqual(expected, hash);
}

export async function createSession(c: Db, playerId: number): Promise<string> {
  const token = randomBytes(32).toString('hex');
  await c.query('INSERT INTO sessions (token, player_id) VALUES ($1, $2)', [token, playerId]);
  return token;
}

export async function playerFromToken(token: string | undefined | null): Promise<number | null> {
  if (!token || !/^[a-f0-9]{64}$/.test(token)) return null;
  const { rows } = await pool.query(
    `SELECT player_id FROM sessions WHERE token = $1 AND created_at > now() - make_interval(days => $2)`,
    [token, SESSION_DAYS],
  );
  const id: number | null = rows[0]?.player_id ?? null;
  // Dernière activité, utile à l'administration : au plus une écriture par minute et par joueur.
  if (id) {
    pool
      .query("UPDATE players SET last_seen_at = now() WHERE id = $1 AND (last_seen_at IS NULL OR last_seen_at < now() - interval '1 minute')", [id])
      .catch(() => {});
  }
  return id;
}

export function bearer(req: FastifyRequest): string | undefined {
  const h = req.headers.authorization;
  return h?.startsWith('Bearer ') ? h.slice(7) : undefined;
}

export async function requirePlayer(req: FastifyRequest): Promise<number> {
  const id = await playerFromToken(bearer(req));
  if (!id) throw new GameError('Connexion requise', 401);
  return id;
}
