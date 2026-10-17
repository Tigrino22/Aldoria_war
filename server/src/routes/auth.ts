import type { FastifyInstance } from 'fastify';
import { z } from 'zod';
import { BEGINNER_PROTECTION_HOURS, MeResponse, STARTING_BUILDINGS, STARTING_RESOURCES } from '@aldoria/shared';
import { act } from '../act';
import { createSession, hashPassword, requireAccount, requirePlayer, verifyPassword, bearer } from '../auth';
import { corePool, type Db } from '../db';
import { env } from '../env';
import { GameError } from '../errors';
import { createVillage } from '../game/village';
import { ensureWorld, spawnLocation } from '../game/world';
import { leaveTribe } from './social';
import { currentWorld, defaultWorld, inWorld, worldById, type WorldCtx } from '../world-store';
import { worldMeta } from '../worlds';

const credentials = z.object({
  username: z
    .string()
    .trim()
    .min(3, 'Le pseudo doit faire au moins 3 caractères')
    .max(20, 'Le pseudo doit faire au plus 20 caractères')
    .regex(/^[\p{L}0-9_-]+$/u, 'Le pseudo ne peut contenir que des lettres, chiffres, _ et -'),
  password: z.string().min(6, 'Le mot de passe doit faire au moins 6 caractères').max(200),
  /**
   * Monde où entrer : un numéro, ou null pour choisir ensuite dans la liste des mondes. Absent (anciennes versions de
   * l'application) : le monde par défaut.
   */
  world: z.number().int().positive().nullable().optional(),
});

/** Inscrit un compte dans un monde : son joueur, son premier village et son inscription. Renvoie le numéro du joueur. */
export function joinWorld(w: WorldCtx, account: { id: number; username: string }): Promise<number> {
  return inWorld(w, () =>
    act(async (c, _outbox, now) => {
      const exists = await c.query('SELECT 1 FROM players WHERE lower(username) = lower($1)', [account.username]);
      if (exists.rows.length) throw new GameError('Ce pseudo est déjà pris dans ce monde');
      const protectionUntil = new Date(now.getTime() + (BEGINNER_PROTECTION_HOURS / env.worldSpeed) * 3_600_000);
      // Le mot de passe est celui du compte (schéma core) : le joueur du monde n'en a pas.
      const { rows } = await c.query("INSERT INTO players (username, password_hash, protection_until) VALUES ($1, '!', $2) RETURNING id", [
        account.username,
        protectionUntil,
      ]);
      const playerId = rows[0].id as number;
      await spawnVillage(c, playerId, account.username, now);
      await corePool.query('INSERT INTO core.memberships (account_id, world_id, player_id) VALUES ($1, $2, $3)', [account.id, w.id, playerId]);
      return playerId;
    }),
  );
}

/** Le monde demandé à l'inscription ou à la connexion (voir `credentials.world`). */
function askedWorld(world: number | null | undefined): WorldCtx | null {
  if (world === null) return null;
  if (world === undefined) return defaultWorld();
  const w = worldById(world);
  if (!w) throw new GameError('Monde introuvable', 404);
  return w;
}

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
  // Les pastilles ne comptent que ce qui est arrivé depuis la dernière visite de la page (table player_seen).
  const counts = (
    await c.query(
      `WITH seen AS (SELECT kind, last_id FROM player_seen WHERE player_id = $1)
       SELECT (SELECT count(*)::int FROM reports WHERE player_id = $1 AND NOT read AND NOT archived
                 AND id > COALESCE((SELECT last_id FROM seen WHERE kind = 'reports'), 0)) AS reports,
              (SELECT count(*)::int FROM messages WHERE to_id = $1 AND NOT read
                 AND id > COALESCE((SELECT last_id FROM seen WHERE kind = 'messages'), 0)) AS messages,
              (SELECT count(*)::int FROM player_items WHERE player_id = $1 AND used_at IS NULL
                 AND id > COALESCE((SELECT last_id FROM seen WHERE kind = 'items'), 0)) AS items,
              (SELECT count(*)::int FROM tribe_invites WHERE player_id = $1
                 AND id > COALESCE((SELECT last_id FROM seen WHERE kind = 'invites'), 0)) AS invites,
              (SELECT count(*)::int FROM moderation_reports WHERE status = 'open'
                 AND id > COALESCE((SELECT last_id FROM seen WHERE kind = 'moderation'), 0)) AS moderation,
              (SELECT count(*)::int FROM bug_reports WHERE status = 'open'
                 AND id > COALESCE((SELECT last_id FROM seen WHERE kind = 'bugs'), 0)) AS bugs`,
      [playerId],
    )
  ).rows[0];
  const invites = (
    await c.query(
      `SELECT i.id, t.id AS tribe_id, t.name, t.tag FROM tribe_invites i JOIN tribes t ON t.id = i.tribe_id WHERE i.player_id = $1`,
      [playerId],
    )
  ).rows;
  const isAdmin = env.adminUsernames.includes(String(p.username).toLowerCase());
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
    items: counts.items,
    isAdmin,
    ...(isAdmin ? { openModerationReports: counts.moderation, openBugReports: counts.bugs } : {}),
    newInvites: counts.invites,
    invites: invites.map((i) => ({ id: i.id, tribeId: i.tribe_id, tribeName: i.name, tribeTag: i.tag })),
  };
}

export default async function authRoutes(app: FastifyInstance) {
  app.get('/api/world', async () => {
    const w = currentWorld();
    return { id: w.id, name: w.name, speed: env.worldSpeed, mapSize: env.mapSize, serverTime: new Date().toISOString() };
  });

  /** Crée un compte, commun à tous les mondes, et l'inscrit dans le monde demandé. */
  app.post('/api/auth/register', { config: { rateLimit: { max: 10, timeWindow: '1 minute' } } }, async (req) => {
    const { username, password, world } = credentials.parse(req.body);
    const target = askedWorld(world);
    if (target && !worldMeta(target.id).open) throw new GameError('Les inscriptions sont fermées dans ce monde');
    // Un PNJ du monde peut porter ce nom : le vérifier avant de créer le compte.
    if (target && (await target.pool.query('SELECT 1 FROM players WHERE lower(username) = lower($1)', [username])).rowCount) {
      throw new GameError('Ce pseudo est déjà pris');
    }
    const hash = await hashPassword(password);
    const exists = await corePool.query('SELECT 1 FROM core.accounts WHERE lower(username) = lower($1)', [username]);
    if (exists.rows.length) throw new GameError('Ce pseudo est déjà pris');
    let accountId: number;
    try {
      accountId = (await corePool.query('INSERT INTO core.accounts (username, password_hash) VALUES ($1, $2) RETURNING id', [username, hash])).rows[0].id;
    } catch {
      throw new GameError('Ce pseudo est déjà pris');
    }
    if (target) {
      try {
        await joinWorld(target, { id: accountId, username });
      } catch (err) {
        await corePool.query('DELETE FROM core.accounts WHERE id = $1', [accountId]);
        throw err;
      }
    }
    return { token: await createSession(accountId, target?.id ?? null) };
  });

  app.post('/api/auth/login', { config: { rateLimit: { max: 20, timeWindow: '1 minute' } } }, async (req) => {
    const { username, password, world } = credentials.parse(req.body);
    const { rows } = await corePool.query('SELECT id, password_hash FROM core.accounts WHERE lower(username) = lower($1)', [username]);
    if (!rows[0] || !(await verifyPassword(password, rows[0].password_hash))) throw new GameError('Pseudo ou mot de passe incorrect', 401);
    // Le monde demandé n'est retenu que si le compte y est inscrit ; sinon le joueur choisira dans la liste.
    const target = askedWorld(world);
    const member = target
      ? (await corePool.query('SELECT 1 FROM core.memberships WHERE account_id = $1 AND world_id = $2', [rows[0].id, target.id])).rowCount
      : 0;
    return { token: await createSession(rows[0].id, member ? target!.id : null) };
  });

  app.post('/api/auth/logout', async (req) => {
    await corePool.query('DELETE FROM core.sessions WHERE token = $1', [bearer(req) ?? '']);
    return { ok: true };
  });

  app.get('/api/me', async (req) => {
    const playerId = await requirePlayer(req);
    return act((c) => loadMe(c, playerId));
  });

  /**
   * Le joueur vient d'ouvrir une page du menu : ses notifications sont vues, la pastille disparaît.
   * Les rapports et messages restent « non lus » dans leur liste tant qu'ils ne sont pas ouverts.
   */
  app.post('/api/me/seen', async (req) => {
    const playerId = await requirePlayer(req);
    const { page } = z.object({ page: z.enum(['rapports', 'messages', 'tribu', 'inventaire', 'admin']) }).parse(req.body);
    const kinds: Record<typeof page, [string, string][]> = {
      rapports: [['reports', 'SELECT max(id) AS m FROM reports WHERE player_id = $1']],
      messages: [['messages', 'SELECT max(id) AS m FROM messages WHERE to_id = $1']],
      tribu: [['invites', 'SELECT max(id) AS m FROM tribe_invites WHERE player_id = $1']],
      inventaire: [['items', 'SELECT max(id) AS m FROM player_items WHERE player_id = $1']],
      admin: [
        ['moderation', 'SELECT max(id) AS m FROM moderation_reports WHERE $1::int IS NOT NULL'],
        ['bugs', 'SELECT max(id) AS m FROM bug_reports WHERE $1::int IS NOT NULL'],
      ],
    };
    return act(async (c) => {
      for (const [kind, sql] of kinds[page]) {
        const last = (await c.query(sql, [playerId])).rows[0].m ?? 0;
        await c.query(
          `INSERT INTO player_seen (player_id, kind, last_id) VALUES ($1, $2, $3)
           ON CONFLICT (player_id, kind) DO UPDATE SET last_id = GREATEST(player_seen.last_id, EXCLUDED.last_id)`,
          [playerId, kind, last],
        );
      }
      return { ok: true };
    });
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

  /**
   * Suppression définitive du compte (exigée par l'App Store pour toute app qui permet de s'inscrire), dans tous les mondes.
   * Les villages deviennent barbares, les troupes en route sont perdues, rapports et messages reçus sont effacés.
   */
  app.delete('/api/me', async (req) => {
    const session = await requireAccount(req);
    const { password } = z.object({ password: z.string().min(1, 'Mot de passe requis') }).parse(req.body);
    const { rows } = await corePool.query('SELECT password_hash FROM core.accounts WHERE id = $1', [session.accountId]);
    if (!rows[0] || !(await verifyPassword(password, rows[0].password_hash))) throw new GameError('Mot de passe incorrect', 403);
    const memberships = (await corePool.query('SELECT world_id, player_id FROM core.memberships WHERE account_id = $1', [session.accountId])).rows;
    for (const m of memberships) {
      const w = worldById(m.world_id);
      if (w) await inWorld(w, () => act((c) => deletePlayer(c, m.player_id)));
    }
    await corePool.query('DELETE FROM core.accounts WHERE id = $1', [session.accountId]);
    return { ok: true };
  });
}

/** Retire un joueur d'un monde : ses villages deviennent abandonnés. */
export async function deletePlayer(c: Db, playerId: number) {
  await leaveTribe(c, playerId);
  const villages = (await c.query('SELECT id FROM villages WHERE owner_id = $1', [playerId])).rows.map((r) => r.id as number);
  await c.query("UPDATE villages SET owner_id = NULL, name = 'Village abandonné' WHERE owner_id = $1", [playerId]);
  await c.query('DELETE FROM build_queue WHERE village_id = ANY($1)', [villages]);
  await c.query('DELETE FROM recruit_queue WHERE village_id = ANY($1)', [villages]);
  await c.query('DELETE FROM commands WHERE player_id = $1', [playerId]);
  await c.query('DELETE FROM players WHERE id = $1', [playerId]);
}
