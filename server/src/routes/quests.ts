import type { FastifyInstance } from 'fastify';
import { z } from 'zod';
import { act } from '../act';
import { requirePlayer } from '../auth';
import { claimQuest, listQuests } from '../game/quests';
import { syncVillage, villageState } from '../game/village';

export default async function questRoutes(app: FastifyInstance) {
  app.get('/api/quests', async (req) => {
    const playerId = await requirePlayer(req);
    return act((c) => listQuests(c, playerId));
  });

  app.post('/api/quests/:key/claim', async (req) => {
    const playerId = await requirePlayer(req);
    const { key } = z.object({ key: z.string().min(1).max(40) }).parse(req.params);
    const { villageId } = z.object({ villageId: z.number().int().positive() }).parse(req.body);
    return act(async (c, _o, now) => {
      await claimQuest(c, playerId, key, villageId, now);
      return villageState(c, await syncVillage(c, villageId, now), playerId);
    });
  });
}
