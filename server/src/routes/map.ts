import type { FastifyInstance } from 'fastify';
import { z } from 'zod';
import { RESOURCES, UNIT_KEYS, type MapVillage, type RaidStatus, type RaidTarget } from '@aldoria/shared';
import { requirePlayer } from '../auth';
import { pool } from '../db';
import { forbidden } from '../errors';

export default async function mapRoutes(app: FastifyInstance) {
  app.get('/api/map', async (req) => {
    await requirePlayer(req);
    const q = z
      .object({
        x0: z.coerce.number().int().default(0),
        y0: z.coerce.number().int().default(0),
        x1: z.coerce.number().int().default(1000),
        y1: z.coerce.number().int().default(1000),
      })
      .parse(req.query);
    const { rows } = await pool.query(
      `SELECT v.id, v.name, v.x, v.y, v.points, v.owner_id, p.username, t.id AS tribe_id, t.tag
       FROM villages v LEFT JOIN players p ON p.id = v.owner_id LEFT JOIN tribes t ON t.id = p.tribe_id
       WHERE v.x BETWEEN $1 AND $3 AND v.y BETWEEN $2 AND $4`,
      [q.x0, q.y0, q.x1, q.y1],
    );
    return rows.map(
      (r): MapVillage => ({
        id: r.id,
        name: r.name,
        x: r.x,
        y: r.y,
        points: r.points,
        ownerId: r.owner_id,
        ownerName: r.username,
        tribeId: r.tribe_id,
        tribeTag: r.tag,
      }),
    );
  });

  /** Villages barbares autour d'un village du joueur, avec le résultat de sa dernière attaque ou de son dernier espionnage. */
  app.get('/api/villages/:id/raid-targets', async (req) => {
    const playerId = await requirePlayer(req);
    const { id } = z.object({ id: z.coerce.number().int().positive() }).parse(req.params);
    const { radius } = z.object({ radius: z.coerce.number().int().min(1).max(60).default(15) }).parse(req.query);
    const home = (await pool.query('SELECT x, y FROM villages WHERE id = $1 AND owner_id = $2', [id, playerId])).rows[0];
    if (!home) throw forbidden("Ce village n'est pas à vous");
    const { rows } = await pool.query(
      `SELECT id, name, x, y, points, sqrt((x - $1)^2 + (y - $2)^2) AS dist FROM villages
       WHERE owner_id IS NULL AND (x - $1)^2 + (y - $2)^2 <= $3 ORDER BY dist, id LIMIT 200`,
      [home.x, home.y, radius * radius],
    );
    const ids = rows.map((r) => r.id as number);
    const last = new Map<number, { type: string; data: any; at: Date }>();
    const moving = new Set<number>();
    if (ids.length) {
      const reports = await pool.query(
        `SELECT DISTINCT ON ((data->'defender'->'village'->>'id')::int) (data->'defender'->'village'->>'id')::int AS target, type, data, created_at
         FROM reports WHERE player_id = $1 AND type IN ('scout', 'attack') AND (data->'defender'->'village'->>'id')::int = ANY($2::int[])
         ORDER BY (data->'defender'->'village'->>'id')::int, created_at DESC, id DESC`,
        [playerId, ids],
      );
      for (const r of reports.rows) last.set(r.target, { type: r.type, data: r.data, at: r.created_at });
      const cmds = await pool.query("SELECT DISTINCT target_village_id FROM commands WHERE player_id = $1 AND NOT processed AND type = 'attack' AND target_village_id = ANY($2::int[])", [playerId, ids]);
      for (const r of cmds.rows) moving.add(r.target_village_id);
    }
    return rows.map((r): RaidTarget => {
      const l = last.get(r.id);
      let status: RaidStatus = 'never';
      let loot = 0;
      if (l?.type === 'scout') status = 'scouted';
      else if (l) {
        const d = l.data;
        const lost = UNIT_KEYS.reduce((n, k) => n + (d.attacker?.losses?.[k] ?? 0), 0);
        status = !d.attackerWins ? 'lost' : lost > 0 ? 'losses' : 'clean';
        if (d.attackerWins && d.loot) loot = RESOURCES.reduce((n, k) => n + (d.loot[k] ?? 0), 0);
      }
      return { id: r.id, name: r.name, x: r.x, y: r.y, points: r.points, distance: Math.round(r.dist * 10) / 10, status, lastAt: l ? new Date(l.at).toISOString() : null, lastLoot: loot, underAttack: moving.has(r.id) };
    });
  });
}
