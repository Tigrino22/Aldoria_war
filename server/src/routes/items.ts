import type { FastifyInstance } from 'fastify';
import { z } from 'zod';
import { act } from '../act';
import { requirePlayer } from '../auth';
import { listItems, useItem } from '../game/items';

const idParam = z.object({ id: z.coerce.number().int().positive() });

/** Inventaire : objets du joueur et leur utilisation. */
export default async function itemRoutes(app: FastifyInstance) {
  app.get('/api/items', async (req) => {
    const playerId = await requirePlayer(req);
    return act((c) => listItems(c, playerId));
  });

  app.post('/api/items/:id/use', async (req) => {
    const playerId = await requirePlayer(req);
    const { id } = idParam.parse(req.params);
    const { villageId } = z.object({ villageId: z.number().int().positive() }).parse(req.body);
    return act((c, outbox, now) => useItem(c, outbox, playerId, id, villageId, now));
  });
}
