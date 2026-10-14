import type { FastifyInstance } from 'fastify';
import { z } from 'zod';
import { BUILDING_KEYS, RESOURCES, UNIT_KEYS } from '@aldoria/shared';
import { act } from '../act';
import { requirePlayer } from '../auth';
import { pool, type Db } from '../db';
import { GameError, forbidden } from '../errors';
import { pickIntel } from '../game/intel';
import { cancelOrder, placeOrder, plannedOrders } from '../game/orders';
import { cancelCommand, disbandTroops, recallTroops, sendCommand, sendTrade } from '../game/commands';
import { planInterception, sendInterception } from '../game/intercept';
import { cancelBuild, cancelRecruit, enqueueBuild, enqueueRecruit, loadVillage, syncVillage, villageState } from '../game/village';

const idParam = z.object({ id: z.coerce.number().int().positive() });
const unitsSchema = z.object(Object.fromEntries(UNIT_KEYS.map((k) => [k, z.number().int().min(0).max(1_000_000).optional()])));

async function ownVillage(c: Db, villageId: number, playerId: number) {
  const v = await loadVillage(c, villageId);
  if (v.owner_id !== playerId) throw forbidden("Ce village n'est pas à vous");
  return v;
}

const ownVillageRow = async (id: number, playerId: number) => {
  const v = (await pool.query('SELECT id, x, y, owner_id FROM villages WHERE id = $1', [id])).rows[0];
  if (!v || v.owner_id !== playerId) throw forbidden("Ce village n'est pas à vous");
  return v as { id: number; x: number; y: number; owner_id: number };
};

export default async function villageRoutes(app: FastifyInstance) {
  app.get('/api/villages/:id', async (req) => {
    const playerId = await requirePlayer(req);
    const { id } = idParam.parse(req.params);
    return act(async (c, _o, now) => {
      await ownVillage(c, id, playerId);
      return villageState(c, await syncVillage(c, id, now), playerId);
    });
  });

  /** Tous les villages du joueur d'un coup, pour la vue d'ensemble. */
  app.get('/api/overview', async (req) => {
    const playerId = await requirePlayer(req);
    return act(async (c, _o, now) => {
      const { rows } = await c.query('SELECT id FROM villages WHERE owner_id = $1 ORDER BY id', [playerId]);
      const out = [];
      for (const r of rows) out.push(await villageState(c, await syncVillage(c, r.id, now), playerId));
      return out;
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

  const queueParams = z.object({ id: z.coerce.number().int().positive(), queueId: z.coerce.number().int().positive() });

  app.delete('/api/villages/:id/build/:queueId', async (req) => {
    const playerId = await requirePlayer(req);
    const { id, queueId } = queueParams.parse(req.params);
    return act(async (c, _o, now) => {
      await ownVillage(c, id, playerId);
      await cancelBuild(c, id, queueId, now);
      return villageState(c, await syncVillage(c, id, now), playerId);
    });
  });

  app.delete('/api/villages/:id/recruit/:queueId', async (req) => {
    const playerId = await requirePlayer(req);
    const { id, queueId } = queueParams.parse(req.params);
    return act(async (c, _o, now) => {
      await ownVillage(c, id, playerId);
      await cancelRecruit(c, id, queueId, now);
      return villageState(c, await syncVillage(c, id, now), playerId);
    });
  });

  app.delete('/api/commands/:id', async (req) => {
    const playerId = await requirePlayer(req);
    const { id } = idParam.parse(req.params);
    return act(async (c, outbox, now) => {
      await cancelCommand(c, outbox, playerId, id, now);
      return { ok: true };
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

  // Interception d'une armée repérée en chemin (bataille en rase campagne).
  app.post('/api/villages/:id/intercept', async (req) => {
    const playerId = await requirePlayer(req);
    const { id } = idParam.parse(req.params);
    const body = z.object({ commandId: z.number().int().positive(), units: unitsSchema }).parse(req.body);
    return act(async (c, outbox, now) => {
      const sent = await sendInterception(c, outbox, playerId, id, body, now);
      return { ...sent, village: await villageState(c, await syncVillage(c, id, now), playerId) };
    });
  });

  /** Point et heure de rencontre d'une interception, sans rien envoyer : la fiche de l'armée sur la carte l'affiche. */
  app.post('/api/villages/:id/intercept/preview', async (req) => {
    const playerId = await requirePlayer(req);
    const { id } = idParam.parse(req.params);
    const body = z.object({ commandId: z.number().int().positive(), units: unitsSchema }).parse(req.body);
    // Lecture seule, hors du verrou du jeu : la fiche la redemande à chaque changement de troupes.
    try {
      const { meet, chase } = await planInterception(pool, playerId, await ownVillageRow(id, playerId), body, new Date(), false);
      return { ok: true, meet: { x: meet.x, y: meet.y }, arriveAt: new Date(meet.at), chase };
    } catch (err) {
      if (!(err instanceof GameError) || err.status !== 400) throw err;
      return { ok: false, error: err.message };
    }
  });

  /**
   * Assistant de pillage : la même troupe vers plusieurs villages en une seule requête. Les envois s'enchaînent dans l'ordre
   * et s'arrêtent à la première erreur (troupes épuisées…) ; ceux déjà partis restent partis.
   */
  app.post('/api/villages/:id/commands/batch', async (req) => {
    const playerId = await requirePlayer(req);
    const { id } = idParam.parse(req.params);
    const body = z.object({ targetIds: z.array(z.number().int().positive()).min(1).max(100), units: unitsSchema }).parse(req.body);
    return act(async (c, outbox, now) => {
      let sent = 0;
      let error: string | null = null;
      for (const targetId of body.targetIds) {
        await c.query('SAVEPOINT envoi');
        try {
          await sendCommand(c, outbox, playerId, id, { type: 'attack', targetId, units: body.units }, now);
          await c.query('RELEASE SAVEPOINT envoi');
          sent++;
        } catch (err) {
          await c.query('ROLLBACK TO SAVEPOINT envoi');
          // Rien n'est parti : l'erreur est renvoyée telle quelle, comme pour un envoi simple.
          if (sent === 0) throw err;
          error = err instanceof Error ? err.message : 'Erreur inconnue';
          break;
        }
      }
      return { sent, error, village: await villageState(c, await syncVillage(c, id, now), playerId) };
    });
  });

  // Point de ralliement : ordre à heure d'arrivée précise et/ou train de nobles.
  app.post('/api/villages/:id/orders', async (req) => {
    const playerId = await requirePlayer(req);
    const { id } = idParam.parse(req.params);
    const body = z
      .object({
        type: z.enum(['attack', 'support']),
        targetId: z.number().int().positive(),
        units: unitsSchema,
        arriveAt: z.string().datetime().nullish(),
        train: z.object({ nobles: z.number().int().min(1).max(200), escort: unitsSchema.optional(), gapSeconds: z.number().int().min(1).max(10).optional() }).nullish(),
      })
      .parse(req.body);
    return act(async (c, outbox, now) => {
      await placeOrder(c, outbox, playerId, id, { ...body, arriveAt: body.arriveAt ? new Date(body.arriveAt) : null }, now);
      return villageState(c, await syncVillage(c, id, now), playerId);
    });
  });

  app.get('/api/orders', async (req) => {
    const playerId = await requirePlayer(req);
    return act((c) => plannedOrders(c, playerId));
  });

  app.delete('/api/orders/:groupId', async (req) => {
    const playerId = await requirePlayer(req);
    const { groupId } = z.object({ groupId: z.string().uuid() }).parse(req.params);
    return act(async (c, outbox) => {
      await cancelOrder(c, outbox, playerId, groupId);
      return { ok: true };
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

  app.post('/api/villages/:id/disband', async (req) => {
    const playerId = await requirePlayer(req);
    const { id } = idParam.parse(req.params);
    const { unit, count } = z.object({ unit: z.enum(UNIT_KEYS), count: z.number().int().positive() }).parse(req.body);
    return act(async (c, outbox, now) => {
      await disbandTroops(c, outbox, playerId, id, unit, count, now);
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
