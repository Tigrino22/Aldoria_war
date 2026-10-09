import type { FastifyInstance } from 'fastify';
import { z } from 'zod';
import type { MapVillage } from '@fiefs/shared';
import { requirePlayer } from '../auth';
import { pool } from '../db';

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
}
