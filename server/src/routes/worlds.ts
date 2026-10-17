import type { FastifyInstance } from 'fastify';
import { z } from 'zod';
import type { WorldChoice } from '@aldoria/shared';
import { requireAccount } from '../auth';
import { corePool } from '../db';
import { GameError } from '../errors';
import { allWorlds, worldById } from '../world-store';
import { configValue, worldMeta } from '../worlds';
import { joinWorld } from './auth';

export default async function worldRoutes(app: FastifyInstance) {
  /** Le compte connecté et le monde choisi (null tant qu'il n'en a pas choisi). */
  app.get('/api/session', async (req) => {
    const s = await requireAccount(req);
    const w = s.worldId && s.playerId ? worldById(s.worldId) : null;
    return { account: { id: s.accountId, username: s.username, isAdmin: s.isAdmin }, world: w ? { id: w.id, name: w.name } : null };
  });

  /** Mondes où entrer : d'abord ceux où le compte est inscrit (le dernier joué en tête), puis les autres. */
  app.get('/api/worlds', async (req): Promise<WorldChoice[]> => {
    const s = await requireAccount(req);
    const mine = new Map(
      (await corePool.query('SELECT world_id, player_id, last_played_at FROM core.memberships WHERE account_id = $1', [s.accountId])).rows.map((r) => [
        r.world_id as number,
        { playerId: r.player_id as number, lastPlayed: r.last_played_at as Date },
      ]),
    );
    const list: (WorldChoice & { sort: number })[] = [];
    for (const w of allWorlds()) {
      const m = mine.get(w.id);
      const meta = worldMeta(w.id);
      if (!m && !meta.open) continue;
      const stats = (
        await w.pool.query(
          `SELECT (SELECT count(*)::int FROM players WHERE NOT is_npc) AS players,
                  (SELECT count(*)::int FROM villages WHERE owner_id = $1) AS villages,
                  (SELECT coalesce(sum(points), 0)::int FROM villages WHERE owner_id = $1) AS points`,
          [m?.playerId ?? 0],
        )
      ).rows[0];
      list.push({
        id: w.id,
        name: w.name,
        speed: configValue(w, 'worldSpeed'),
        mapSize: configValue(w, 'mapSize'),
        players: stats.players,
        open: meta.open,
        createdAt: meta.createdAt.toISOString(),
        member: m ? { villages: stats.villages, points: stats.points, lastPlayed: m.lastPlayed.toISOString() } : null,
        sort: m ? m.lastPlayed.getTime() : -meta.createdAt.getTime(),
      });
    }
    // Inscrit d'abord (le plus récemment joué en tête), puis les autres mondes, du plus récent au plus ancien.
    list.sort((a, b) => Number(!!b.member) - Number(!!a.member) || (a.member ? b.sort - a.sort : a.sort - b.sort));
    return list.map(({ sort: _sort, ...w }) => w);
  });

  /** Entre dans un monde : inscrit le compte s'il n'y joue pas encore, puis la session y reste jusqu'au prochain choix. */
  app.post('/api/worlds/:id/enter', async (req) => {
    const s = await requireAccount(req);
    const { id } = z.object({ id: z.coerce.number().int().positive() }).parse(req.params);
    const w = worldById(id);
    if (!w) throw new GameError('Monde introuvable', 404);
    const member = (await corePool.query('SELECT 1 FROM core.memberships WHERE account_id = $1 AND world_id = $2', [s.accountId, id])).rowCount;
    if (!member) {
      if (!worldMeta(id).open) throw new GameError('Les inscriptions sont fermées dans ce monde');
      await joinWorld(w, { id: s.accountId, username: s.username });
    }
    await corePool.query('UPDATE core.sessions SET world_id = $2 WHERE token = $1', [s.token, id]);
    await corePool.query('UPDATE core.memberships SET last_played_at = now() WHERE account_id = $1 AND world_id = $2', [s.accountId, id]);
    return { ok: true, joined: !member, world: { id: w.id, name: w.name } };
  });
}
