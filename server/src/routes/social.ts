import type { FastifyInstance } from 'fastify';
import { z } from 'zod';
import { act } from '../act';
import { requirePlayer } from '../auth';
import { pool, type Db } from '../db';
import { GameError, forbidden, notFound } from '../errors';

const idParam = z.object({ id: z.coerce.number().int().positive() });

async function tribeOf(c: Db, playerId: number) {
  const { rows } = await c.query('SELECT p.tribe_id, t.leader_id FROM players p LEFT JOIN tribes t ON t.id = p.tribe_id WHERE p.id = $1', [
    playerId,
  ]);
  return { tribeId: rows[0]?.tribe_id as number | null, isLeader: rows[0]?.leader_id === playerId };
}

/** Retire le joueur de sa tribu : la direction passe au plus gros membre, la tribu vide disparaît. */
export async function leaveTribe(c: Db, playerId: number): Promise<boolean> {
  const { tribeId, isLeader } = await tribeOf(c, playerId);
  if (!tribeId) return false;
  await c.query('UPDATE players SET tribe_id = NULL WHERE id = $1', [playerId]);
  const rest = (
    await c.query(
      `SELECT p.id FROM players p LEFT JOIN villages v ON v.owner_id = p.id WHERE p.tribe_id = $1
       GROUP BY p.id ORDER BY coalesce(sum(v.points), 0) DESC LIMIT 1`,
      [tribeId],
    )
  ).rows;
  if (!rest.length) await c.query('DELETE FROM tribes WHERE id = $1', [tribeId]);
  else if (isLeader) await c.query('UPDATE tribes SET leader_id = $2 WHERE id = $1', [tribeId, rest[0].id]);
  return true;
}

export default async function socialRoutes(app: FastifyInstance) {
  // ---------- Rapports ----------
  app.get('/api/reports', async (req) => {
    const playerId = await requirePlayer(req);
    const { rows } = await pool.query(
      'SELECT id, type, title, read, created_at FROM reports WHERE player_id = $1 ORDER BY created_at DESC, id DESC LIMIT 200',
      [playerId],
    );
    return rows.map((r) => ({ id: r.id, type: r.type, title: r.title, read: r.read, createdAt: r.created_at }));
  });

  app.get('/api/reports/:id', async (req) => {
    const playerId = await requirePlayer(req);
    const { id } = idParam.parse(req.params);
    const { rows } = await pool.query('UPDATE reports SET read = true WHERE id = $1 AND player_id = $2 RETURNING *', [id, playerId]);
    if (!rows[0]) throw notFound('Rapport introuvable');
    const r = rows[0];
    return { id: r.id, type: r.type, title: r.title, data: r.data, createdAt: r.created_at, read: true };
  });

  app.delete('/api/reports/:id', async (req) => {
    const playerId = await requirePlayer(req);
    const { id } = idParam.parse(req.params);
    await pool.query('DELETE FROM reports WHERE id = $1 AND player_id = $2', [id, playerId]);
    return { ok: true };
  });

  // ---------- Messagerie ----------
  app.get('/api/messages', async (req) => {
    const playerId = await requirePlayer(req);
    const { box } = z.object({ box: z.enum(['in', 'out']).default('in') }).parse(req.query);
    const col = box === 'in' ? 'to_id' : 'from_id';
    const { rows } = await pool.query(
      `SELECT m.id, m.subject, m.read, m.created_at, pf.username AS from_name, pt.username AS to_name
       FROM messages m LEFT JOIN players pf ON pf.id = m.from_id LEFT JOIN players pt ON pt.id = m.to_id
       WHERE m.${col} = $1 ORDER BY m.created_at DESC LIMIT 200`,
      [playerId],
    );
    return rows.map((r) => ({ id: r.id, subject: r.subject, read: r.read, createdAt: r.created_at, from: r.from_name, to: r.to_name }));
  });

  app.get('/api/messages/:id', async (req) => {
    const playerId = await requirePlayer(req);
    const { id } = idParam.parse(req.params);
    const { rows } = await pool.query(
      `SELECT m.*, pf.username AS from_name, pt.username AS to_name FROM messages m
       LEFT JOIN players pf ON pf.id = m.from_id LEFT JOIN players pt ON pt.id = m.to_id
       WHERE m.id = $1 AND (m.to_id = $2 OR m.from_id = $2)`,
      [id, playerId],
    );
    const m = rows[0];
    if (!m) throw notFound('Message introuvable');
    if (m.to_id === playerId && !m.read) await pool.query('UPDATE messages SET read = true WHERE id = $1', [id]);
    return { id: m.id, subject: m.subject, body: m.body, createdAt: m.created_at, from: m.from_name, to: m.to_name };
  });

  app.post('/api/messages', { config: { rateLimit: { max: 20, timeWindow: '1 minute' } } }, async (req) => {
    const playerId = await requirePlayer(req);
    const body = z
      .object({ to: z.string().trim().min(1), subject: z.string().trim().min(1).max(120), body: z.string().trim().min(1).max(5000) })
      .parse(req.body);
    return act(async (c, outbox) => {
      const { rows } = await c.query('SELECT id FROM players WHERE lower(username) = lower($1)', [body.to]);
      if (!rows[0]) throw new GameError('Ce joueur n’existe pas');
      await c.query('INSERT INTO messages (from_id, to_id, subject, body) VALUES ($1, $2, $3, $4)', [playerId, rows[0].id, body.subject, body.body]);
      const me = await c.query('SELECT username FROM players WHERE id = $1', [playerId]);
      outbox.push(rows[0].id, { type: 'message', from: me.rows[0].username });
      return { ok: true };
    });
  });

  // ---------- Tribus ----------
  app.post('/api/tribes', async (req) => {
    const playerId = await requirePlayer(req);
    const body = z
      .object({ name: z.string().trim().min(3).max(32), tag: z.string().trim().min(2).max(6).regex(/^[\p{L}0-9]+$/u, 'Le tag ne peut contenir que des lettres et des chiffres') })
      .parse(req.body);
    return act(async (c, outbox) => {
      if ((await tribeOf(c, playerId)).tribeId) throw new GameError('Quittez d’abord votre tribu actuelle');
      const dup = await c.query('SELECT 1 FROM tribes WHERE lower(name) = lower($1) OR lower(tag) = lower($2)', [body.name, body.tag]);
      if (dup.rows.length) throw new GameError('Ce nom ou ce tag est déjà utilisé');
      const { rows } = await c.query('INSERT INTO tribes (name, tag, leader_id) VALUES ($1, $2, $3) RETURNING id', [body.name, body.tag.toUpperCase(), playerId]);
      await c.query('UPDATE players SET tribe_id = $2 WHERE id = $1', [playerId, rows[0].id]);
      await c.query('DELETE FROM tribe_invites WHERE player_id = $1', [playerId]);
      outbox.push(playerId, { type: 'me' });
      return { id: rows[0].id };
    });
  });

  app.get('/api/tribes/:id', async (req) => {
    const playerId = await requirePlayer(req);
    const { id } = idParam.parse(req.params);
    const t = (await pool.query('SELECT * FROM tribes WHERE id = $1', [id])).rows[0];
    if (!t) throw notFound('Tribu introuvable');
    const members = (
      await pool.query(
        `SELECT p.id, p.username, count(v.id)::int AS villages, coalesce(sum(v.points), 0)::int AS points
         FROM players p LEFT JOIN villages v ON v.owner_id = p.id WHERE p.tribe_id = $1 GROUP BY p.id ORDER BY points DESC`,
        [id],
      )
    ).rows;
    const isMember = members.some((m) => m.id === playerId);
    const invites = isMember
      ? (await pool.query('SELECT i.id, p.username FROM tribe_invites i JOIN players p ON p.id = i.player_id WHERE i.tribe_id = $1', [id])).rows
      : [];
    return {
      id: t.id,
      name: t.name,
      tag: t.tag,
      description: t.description,
      leaderId: t.leader_id,
      members,
      invites,
      points: members.reduce((s, m) => s + m.points, 0),
    };
  });

  app.post('/api/tribes/description', async (req) => {
    const playerId = await requirePlayer(req);
    const { description } = z.object({ description: z.string().max(2000) }).parse(req.body);
    return act(async (c) => {
      const { tribeId, isLeader } = await tribeOf(c, playerId);
      if (!tribeId || !isLeader) throw forbidden('Seul le chef de tribu peut faire cela');
      await c.query('UPDATE tribes SET description = $2 WHERE id = $1', [tribeId, description]);
      return { ok: true };
    });
  });

  app.post('/api/tribes/invite', async (req) => {
    const playerId = await requirePlayer(req);
    const { username } = z.object({ username: z.string().trim().min(1) }).parse(req.body);
    return act(async (c, outbox) => {
      const { tribeId, isLeader } = await tribeOf(c, playerId);
      if (!tribeId || !isLeader) throw forbidden('Seul le chef de tribu peut inviter');
      const { rows } = await c.query('SELECT id, tribe_id FROM players WHERE lower(username) = lower($1)', [username]);
      if (!rows[0]) throw new GameError('Ce joueur n’existe pas');
      if (rows[0].tribe_id === tribeId) throw new GameError('Ce joueur est déjà dans la tribu');
      await c.query('INSERT INTO tribe_invites (tribe_id, player_id) VALUES ($1, $2) ON CONFLICT DO NOTHING', [tribeId, rows[0].id]);
      outbox.push(rows[0].id, { type: 'me' });
      return { ok: true };
    });
  });

  app.post('/api/invites/:id/:action', async (req) => {
    const playerId = await requirePlayer(req);
    const { id, action } = z.object({ id: z.coerce.number().int().positive(), action: z.enum(['accept', 'decline']) }).parse(req.params);
    return act(async (c, outbox) => {
      const { rows } = await c.query('DELETE FROM tribe_invites WHERE id = $1 AND player_id = $2 RETURNING tribe_id', [id, playerId]);
      if (!rows[0]) throw notFound('Invitation introuvable');
      if (action === 'accept') {
        if ((await tribeOf(c, playerId)).tribeId) throw new GameError('Quittez d’abord votre tribu actuelle');
        await c.query('UPDATE players SET tribe_id = $2 WHERE id = $1', [playerId, rows[0].tribe_id]);
        await c.query('DELETE FROM tribe_invites WHERE player_id = $1', [playerId]);
      }
      outbox.push(playerId, { type: 'me' });
      return { ok: true };
    });
  });

  app.post('/api/tribes/leave', async (req) => {
    const playerId = await requirePlayer(req);
    return act(async (c, outbox) => {
      if (!(await leaveTribe(c, playerId))) throw new GameError('Vous n’êtes dans aucune tribu');
      outbox.push(playerId, { type: 'me' });
      return { ok: true };
    });
  });

  app.post('/api/tribes/kick', async (req) => {
    const playerId = await requirePlayer(req);
    const { memberId } = z.object({ memberId: z.number().int().positive() }).parse(req.body);
    return act(async (c, outbox) => {
      const { tribeId, isLeader } = await tribeOf(c, playerId);
      if (!tribeId || !isLeader) throw forbidden('Seul le chef de tribu peut exclure un membre');
      if (memberId === playerId) throw new GameError('Utilisez « Quitter la tribu »');
      await c.query('UPDATE players SET tribe_id = NULL WHERE id = $1 AND tribe_id = $2', [memberId, tribeId]);
      outbox.push(memberId, { type: 'me' });
      return { ok: true };
    });
  });

  // ---------- Profils ----------
  app.get('/api/players/:name', async (req) => {
    await requirePlayer(req);
    const { name } = z.object({ name: z.string().trim().min(1).max(60) }).parse(req.params);
    const p = (
      await pool.query(
        `SELECT p.id, p.username, p.created_at, p.protection_until, t.id AS tribe_id, t.tag, t.name AS tribe_name
         FROM players p LEFT JOIN tribes t ON t.id = p.tribe_id WHERE lower(p.username) = lower($1)`,
        [name],
      )
    ).rows[0];
    if (!p) throw notFound('Joueur introuvable');
    const villages = (
      await pool.query('SELECT id, name, x, y, points FROM villages WHERE owner_id = $1 ORDER BY points DESC, id', [p.id])
    ).rows;
    const points = villages.reduce((sum, v) => sum + v.points, 0);
    const rank = (
      await pool.query(
        `SELECT count(*)::int + 1 AS rank FROM (
           SELECT p2.id, coalesce(sum(v.points), 0) AS pts FROM players p2 LEFT JOIN villages v ON v.owner_id = p2.id GROUP BY p2.id
         ) s WHERE s.pts > $1`,
        [points],
      )
    ).rows[0].rank as number;
    return {
      id: p.id,
      username: p.username,
      createdAt: p.created_at,
      protected: !!p.protection_until && new Date(p.protection_until) > new Date(),
      points,
      rank,
      tribe: p.tribe_id ? { id: p.tribe_id, tag: p.tag, name: p.tribe_name } : null,
      villages,
    };
  });

  // ---------- Classements ----------
  app.get('/api/ranking/players', async (req) => {
    await requirePlayer(req);
    const { rows } = await pool.query(
      `SELECT p.id, p.username, t.tag, count(v.id)::int AS villages, coalesce(sum(v.points), 0)::int AS points
       FROM players p LEFT JOIN villages v ON v.owner_id = p.id LEFT JOIN tribes t ON t.id = p.tribe_id
       GROUP BY p.id, t.tag ORDER BY points DESC, p.id LIMIT 100`,
    );
    return rows.map((r, i) => ({ rank: i + 1, ...r }));
  });

  app.get('/api/ranking/tribes', async (req) => {
    await requirePlayer(req);
    const { rows } = await pool.query(
      `SELECT t.id, t.name, t.tag, count(DISTINCT p.id)::int AS members, count(v.id)::int AS villages, coalesce(sum(v.points), 0)::int AS points
       FROM tribes t JOIN players p ON p.tribe_id = t.id LEFT JOIN villages v ON v.owner_id = p.id
       GROUP BY t.id ORDER BY points DESC, t.id LIMIT 100`,
    );
    return rows.map((r, i) => ({ rank: i + 1, ...r }));
  });
}
