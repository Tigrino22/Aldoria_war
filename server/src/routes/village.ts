import type { FastifyInstance } from 'fastify';
import { z } from 'zod';
import { BUILDING_KEYS, RESOURCES, UNIT_KEYS } from '@aldoria/shared';
import { act } from '../act';
import { requirePlayer } from '../auth';
import { pool, type Db } from '../db';
import { GameError, forbidden } from '../errors';
import { pickIntel } from '../game/intel';
import { recallTroops, sendCommand, sendTrade } from '../game/commands';
import { enqueueBuild, enqueueRecruit, loadVillage, syncVillage, villageState } from '../game/village';

const idParam = z.object({ id: z.coerce.number().int().positive() });
const unitsSchema = z.object(Object.fromEntries(UNIT_KEYS.map((k) => [k, z.number().int().min(0).max(1_000_000).optional()])));

async function ownVillage(c: Db, villageId: number, playerId: number) {
  const v = await loadVillage(c, villageId);
  if (v.owner_id !== playerId) throw forbidden("Ce village n'est pas à vous");
  return v;
}

export default async function villageRoutes(app: FastifyInstance) {
  app.get('/api/villages/:id', async (req) => {
    const playerId = await requirePlayer(req);
    const { id } = idParam.parse(req.params);
    return act(async (c, _o, now) => {
      await ownVillage(c, id, playerId);
      return villageState(c, await syncVillage(c, id, now), playerId);
    });
  });

  app.get('/api/villages/:id/public', async (req) => {
    await requirePlayer(req);
    const { id } = idParam.parse(req.params);
    return act(async (c) => {
      const { rows } = await c.query(
        `SELECT v.id, v.name, v.x, v.y, v.points, v.owner_id, p.username, p.protection_until, t.id AS tribe_id, t.tag
         FROM villages v LEFT JOIN players p ON p.id = v.owner_id LEFT JOIN tribes t ON t.id = p.tribe_id WHERE v.id = $1`,
        [id],
      );
      const v = rows[0];
      if (!v) throw new GameError('Village introuvable', 404);
      return {
        id: v.id,
        name: v.name,
        x: v.x,
        y: v.y,
        points: v.points,
        ownerId: v.owner_id,
        ownerName: v.username,
        tribeId: v.tribe_id,
        tribeTag: v.tag,
        protected: v.protection_until ? new Date(v.protection_until) > new Date() : false,
      };
    });
  });

  /** Le dernier renseignement du joueur sur un village cible, pour simuler une attaque. */
  app.get('/api/villages/:id/intel', async (req) => {
    const playerId = await requirePlayer(req);
    const { id } = idParam.parse(req.params);
    const { rows } = await pool.query(
      `SELECT type, data, created_at FROM reports
       WHERE player_id = $1 AND type IN ('scout', 'attack') AND (data->'defender'->'village'->>'id')::int = $2
       ORDER BY created_at DESC, id DESC LIMIT 10`,
      [playerId, id],
    );
    return pickIntel(rows) ?? { none: true };
  });

  app.post('/api/villages/:id/build', async (req) => {
    const playerId = await requirePlayer(req);
    const { id } = idParam.parse(req.params);
    const { building } = z.object({ building: z.enum(BUILDING_KEYS) }).parse(req.body);
    return act(async (c, _o, now) => {
      await ownVillage(c, id, playerId);
      await enqueueBuild(c, id, building, now);
      return villageState(c, await syncVillage(c, id, now), playerId);
    });
  });

  app.post('/api/villages/:id/recruit', async (req) => {
    const playerId = await requirePlayer(req);
    const { id } = idParam.parse(req.params);
    const { unit, count } = z.object({ unit: z.enum(UNIT_KEYS), count: z.number().int().min(1).max(10000) }).parse(req.body);
    return act(async (c, _o, now) => {
      await ownVillage(c, id, playerId);
      await enqueueRecruit(c, id, unit, count, now);
      return villageState(c, await syncVillage(c, id, now), playerId);
    });
  });

  app.post('/api/villages/:id/rename', async (req) => {
    const playerId = await requirePlayer(req);
    const { id } = idParam.parse(req.params);
    const { name } = z.object({ name: z.string().trim().min(2).max(32) }).parse(req.body);
    return act(async (c, outbox) => {
      await ownVillage(c, id, playerId);
      await c.query('UPDATE villages SET name = $2 WHERE id = $1', [id, name]);
      outbox.push(playerId, { type: 'me' });
      return { ok: true };
    });
  });

  app.post('/api/villages/:id/commands', async (req) => {
    const playerId = await requirePlayer(req);
    const { id } = idParam.parse(req.params);
    const body = z
      .object({ type: z.enum(['attack', 'support']), targetId: z.number().int().positive(), units: unitsSchema })
      .parse(req.body);
    return act(async (c, outbox, now) => {
      await sendCommand(c, outbox, playerId, id, body, now);
      return villageState(c, await syncVillage(c, id, now), playerId);
    });
  });

  app.post('/api/villages/:id/trade', async (req) => {
    const playerId = await requirePlayer(req);
    const { id } = idParam.parse(req.params);
    const body = z
      .object({
        targetId: z.number().int().positive(),
        resources: z.object(Object.fromEntries(RESOURCES.map((r) => [r, z.number().int().min(0).max(10_000_000)])) as Record<(typeof RESOURCES)[number], z.ZodNumber>),
      })
      .parse(req.body);
    return act(async (c, outbox, now) => {
      await sendTrade(c, outbox, playerId, id, body, now);
      return villageState(c, await syncVillage(c, id, now), playerId);
    });
  });

  app.post('/api/troops/recall', async (req) => {
    const playerId = await requirePlayer(req);
    const { stationedId, homeId } = z
      .object({ stationedId: z.number().int().positive(), homeId: z.number().int().positive() })
      .parse(req.body);
    return act(async (c, outbox, now) => {
      await recallTroops(c, outbox, playerId, stationedId, homeId, now);
      return { ok: true };
    });
  });
}
