import type { FastifyInstance } from 'fastify';
import { z } from 'zod';
import { RESOURCES } from '@aldoria/shared';
import { act } from '../act';
import { requirePlayer } from '../auth';
import { acceptOffer, cancelOffer, createOffer, expireOffers, listOffers, myOffers } from '../game/market';
import { syncVillage, villageState } from '../game/village';

const idParam = z.object({ id: z.coerce.number().int().positive() });
const resource = z.enum(RESOURCES);

export default async function marketRoutes(app: FastifyInstance) {
  /** Offres des autres joueurs et PNJ, et les miennes. */
  app.get('/api/villages/:id/market/offers', async (req) => {
    const playerId = await requirePlayer(req);
    const { id } = idParam.parse(req.params);
    return act(async (c, outbox, now) => {
      await expireOffers(c, outbox, now);
      return { offers: await listOffers(c, playerId, id, now), mine: await myOffers(c, playerId, id, now) };
    });
  });

  app.post('/api/villages/:id/market/offers', async (req) => {
    const playerId = await requirePlayer(req);
    const { id } = idParam.parse(req.params);
    const body = z
      .object({ give: resource, giveAmount: z.number().int().positive().max(1_000_000), want: resource, wantAmount: z.number().int().positive().max(1_000_000) })
      .parse(req.body);
    return act(async (c, outbox, now) => {
      await createOffer(c, outbox, playerId, id, body, now);
      return villageState(c, await syncVillage(c, id, now), playerId);
    });
  });

  app.delete('/api/market/offers/:id', async (req) => {
    const playerId = await requirePlayer(req);
    const { id } = idParam.parse(req.params);
    return act(async (c, outbox, now) => {
      await cancelOffer(c, outbox, playerId, id, now);
      return { ok: true };
    });
  });

  app.post('/api/market/offers/:id/accept', async (req) => {
    const playerId = await requirePlayer(req);
    const { id } = idParam.parse(req.params);
    const { villageId } = z.object({ villageId: z.number().int().positive() }).parse(req.body);
    return act(async (c, outbox, now) => {
      await acceptOffer(c, outbox, playerId, villageId, id, now);
      return villageState(c, await syncVillage(c, villageId, now), playerId);
    });
  });
}
