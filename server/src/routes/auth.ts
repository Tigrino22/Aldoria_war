import type { FastifyInstance } from 'fastify';
import { z } from 'zod';
import { BEGINNER_PROTECTION_HOURS, MeResponse, STARTING_BUILDINGS, STARTING_RESOURCES } from '@fiefs/shared';
import { act } from '../act';
import { createSession, hashPassword, requirePlayer, verifyPassword, bearer } from '../auth';
import { pool, type Db } from '../db';
import { env } from '../env';
import { GameError } from '../errors';
import { createVillage } from '../game/village';
import { ensureWorld, spawnLocation } from '../game/world';

const credentials = z.object({
  username: z
    .string()
    .trim()
    .min(3, 'Le pseudo doit faire au moins 3 caractères')
    .max(20, 'Le pseudo doit faire au plus 20 caractères')
    .regex(/^[\p{L}0-9_-]+$/u, 'Le pseudo ne peut contenir que des lettres, chiffres, _ et -'),
  password: z.string().min(6, 'Le mot de passe doit faire au moins 6 caractères').max(200),
});

export async function spawnVillage(c: Db, playerId: number, username: string, now: Date) {
  await ensureWorld(c, now);
  const spot = await spawnLocation(c);
  return createVillage(c, {
    ownerId: playerId,
    name: `Village de ${username}`,
    x: spot.x,
    y: spot.y,
    buildings: { ...STARTING_BUILDINGS },
    resources: { ...STARTING_RESOURCES },
    at: now,
  });
}

export async function loadMe(c: Db, playerId: number): Promise<MeResponse> {
  const p = (
    await c.query(
      `SELECT p.id, p.username, p.protection_until, t.id AS tribe_id, t.name AS tribe_name, t.tag AS tribe_tag
       FROM players p LEFT JOIN tribes t ON t.id = p.tribe_id WHERE p.id = $1`,
      [playerId],
    )
  ).rows[0];
  if (!p) throw new GameError('Joueur introuvable', 401);
  const villages = (await c.query('SELECT id, name, x, y, points FROM villages WHERE owner_id = $1 ORDER BY id', [playerId])).rows;
  const counts = (
    await c.query(
      `SELECT (SELECT count(*)::int FROM reports WHERE player_id = $1 AND NOT read) AS reports,
              (SELECT count(*)::int FROM messages WHERE to_id = $1 AND NOT read) AS messages`,
      [playerId],
    )
  ).rows[0];
  const invites = (
    await c.query(
      `SELECT i.id, t.id AS tribe_id, t.name, t.tag FROM tribe_invites i JOIN tribes t ON t.id = i.tribe_id WHERE i.player_id = $1`,
      [playerId],
    )
  ).rows;
  return {
    player: {
      id: p.id,
      username: p.username,
      tribe: p.tribe_id ? { id: p.tribe_id, name: p.tribe_name, tag: p.tribe_tag } : null,
      protectionUntil: p.protection_until ? new Date(p.protection_until).toISOString() : null,
      points: villages.reduce((s, v) => s + v.points, 0),
    },
    villages,
    unreadReports: counts.reports,
    unreadMessages: counts.messages,
    invites: invites.map((i) => ({ id: i.id, tribeId: i.tribe_id, tribeName: i.name, tribeTag: i.tag })),
  };
}

export default async function authRoutes(app: FastifyInstance) {
  app.get('/api/world', async () => ({ speed: env.worldSpeed, mapSize: env.mapSize, serverTime: new Date().toISOString() }));

  app.post('/api/auth/register', { config: { rateLimit: { max: 10, timeWindow: '1 minute' } } }, async (req) => {
    const { username, password } = credentials.parse(req.body);
    const hash = await hashPassword(password);
    return act(async (c, _outbox, now) => {
      const exists = await c.query('SELECT 1 FROM players WHERE lower(username) = lower($1)', [username]);
      if (exists.rows.length) throw new GameError('Ce pseudo est déjà pris');
      const protectionUntil = new Date(now.getTime() + (BEGINNER_PROTECTION_HOURS / env.worldSpeed) * 3_600_000);
      const { rows } = await c.query('INSERT INTO players (username, password_hash, protection_until) VALUES ($1, $2, $3) RETURNING id', [
        username,
        hash,
        protectionUntil,
      ]);
      const playerId = rows[0].id;
      await spawnVillage(c, playerId, username, now);
      return { token: await createSession(c, playerId) };
    });
  });

  app.post('/api/auth/login', { config: { rateLimit: { max: 20, timeWindow: '1 minute' } } }, async (req) => {
    const { username, password } = credentials.parse(req.body);
    const { rows } = await pool.query('SELECT id, password_hash FROM players WHERE lower(username) = lower($1)', [username]);
    if (!rows[0] || !(await verifyPassword(password, rows[0].password_hash))) throw new GameError('Pseudo ou mot de passe incorrect', 401);
    const client = await pool.connect();
    try {
      return { token: await createSession(client, rows[0].id) };
    } finally {
      client.release();
    }
  });

  app.post('/api/auth/logout', async (req) => {
    await pool.query('DELETE FROM sessions WHERE token = $1', [bearer(req) ?? '']);
    return { ok: true };
  });

  app.get('/api/me', async (req) => {
    const playerId = await requirePlayer(req);
    return act((c) => loadMe(c, playerId));
  });

  /** Un joueur qui a perdu tous ses villages peut recommencer ailleurs sur la carte. */
  app.post('/api/me/restart', async (req) => {
    const playerId = await requirePlayer(req);
    return act(async (c, _outbox, now) => {
      const owned = await c.query('SELECT 1 FROM villages WHERE owner_id = $1 LIMIT 1', [playerId]);
      if (owned.rows.length) throw new GameError('Vous avez encore un village');
      const { rows } = await c.query('SELECT username FROM players WHERE id = $1', [playerId]);
      await spawnVillage(c, playerId, rows[0].username, now);
      return loadMe(c, playerId);
    });
  });
}
