import { randomBytes, scrypt, timingSafeEqual } from 'node:crypto';
import { promisify } from 'node:util';
import type { FastifyRequest } from 'fastify';
import { corePool } from './db';
import { env } from './env';
import { GameError } from './errors';
import { currentWorld, worldById } from './world-store';

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

/**
 * Une session appartient à un compte (commun à tous les mondes) ; `worldId` est le monde choisi à la connexion
 * et `playerId` le joueur du compte dans ce monde.
 */
export interface Session {
  token: string;
  accountId: number;
  username: string;
  worldId: number | null;
  playerId: number | null;
  isAdmin: boolean;
}

export const isAdminName = (username: string) => env.adminUsernames.includes(username.toLowerCase());

export async function createSession(accountId: number, worldId: number | null): Promise<string> {
  const token = randomBytes(32).toString('hex');
  await corePool.query('INSERT INTO core.sessions (token, account_id, world_id) VALUES ($1, $2, $3)', [token, accountId, worldId]);
  return token;
}

export async function sessionFromToken(token: string | undefined | null): Promise<Session | null> {
  if (!token || !/^[a-f0-9]{64}$/.test(token)) return null;
  const { rows } = await corePool.query(
    `SELECT s.account_id, s.world_id, a.username, m.player_id
     FROM core.sessions s JOIN core.accounts a ON a.id = s.account_id
     LEFT JOIN core.memberships m ON m.account_id = s.account_id AND m.world_id = s.world_id
     WHERE s.token = $1 AND s.created_at > now() - make_interval(days => $2)`,
    [token, SESSION_DAYS],
  );
  const r = rows[0];
  if (!r) return null;
  const session: Session = {
    token,
    accountId: r.account_id,
    username: r.username,
    worldId: r.world_id,
    playerId: r.player_id ?? null,
    isAdmin: isAdminName(r.username),
  };
  touch(session);
  return session;
}

/** Dernière activité, utile à l'administration : au plus une écriture par minute et par compte. */
function touch(s: Session) {
  const recent = "(last_seen_at IS NULL OR last_seen_at < now() - interval '1 minute')";
  corePool.query(`UPDATE core.accounts SET last_seen_at = now() WHERE id = $1 AND ${recent}`, [s.accountId]).catch(() => {});
  const w = s.worldId === null ? null : worldById(s.worldId);
  if (!w || !s.playerId) return;
  w.pool.query(`UPDATE players SET last_seen_at = now() WHERE id = $1 AND ${recent}`, [s.playerId]).catch(() => {});
  corePool
    .query("UPDATE core.memberships SET last_played_at = now() WHERE account_id = $1 AND world_id = $2 AND last_played_at < now() - interval '1 minute'", [
      s.accountId,
      s.worldId,
    ])
    .catch(() => {});
}

/** Joueur du compte dans le monde courant, si le jeton y donne accès. */
export async function playerFromToken(token: string | undefined | null): Promise<number | null> {
  const s = await sessionFromToken(token);
  return s && s.worldId === currentWorld().id ? s.playerId : null;
}

export function bearer(req: FastifyRequest): string | undefined {
  const h = req.headers.authorization;
  return h?.startsWith('Bearer ') ? h.slice(7) : undefined;
}

/** Session de la requête, lue une seule fois même si plusieurs étapes la demandent. */
const sessions = new WeakMap<FastifyRequest, Promise<Session | null>>();
export function requestSession(req: FastifyRequest): Promise<Session | null> {
  let s = sessions.get(req);
  if (!s) sessions.set(req, (s = sessionFromToken(bearer(req))));
  return s;
}

export async function requireAccount(req: FastifyRequest): Promise<Session> {
  const s = await requestSession(req);
  if (!s) throw new GameError('Connexion requise', 401);
  return s;
}

/** Statut renvoyé quand le compte est connecté mais n'a pas encore choisi de monde : le client affiche la liste des mondes. */
export const CHOOSE_WORLD = 428;

/** Joueur du compte dans le monde de la requête. */
export async function requirePlayer(req: FastifyRequest): Promise<number> {
  const s = await requireAccount(req);
  const w = currentWorld();
  if (s.worldId === w.id && s.playerId) return s.playerId;
  // L'administrateur consulte un autre monde que le sien depuis le tableau de bord.
  if (s.worldId !== w.id && s.isAdmin) {
    const { rows } = await corePool.query('SELECT player_id FROM core.memberships WHERE account_id = $1 AND world_id = $2', [s.accountId, w.id]);
    if (rows[0]) return rows[0].player_id;
  }
  throw new GameError('Choisissez un monde', CHOOSE_WORLD);
}
