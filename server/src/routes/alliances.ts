import type { FastifyInstance } from 'fastify';
import { z } from 'zod';
import { act } from '../act';
import { requirePlayer } from '../auth';
import { pool } from '../db';
import { answerAlliance, breakAlliance, cancelAllianceInvite, proposeAlliance, tribeAlliancesView } from '../game/tribe-alliances';

const idParam = z.object({ id: z.coerce.number().int().positive() });

/** Alliances entre tribus : onglet « Alliances » de la page Tribu. Seul le chef propose, répond, retire ou rompt. */
export default async function allianceRoutes(app: FastifyInstance) {
  app.get('/api/tribes/mine/alliances', async (req) => {
    const playerId = await requirePlayer(req);
    return tribeAlliancesView(pool, playerId, new Date());
  });

  /** Propose une alliance à une autre tribu de joueurs. */
  app.post('/api/tribes/mine/alliances', { config: { rateLimit: { max: 10, timeWindow: '1 minute' } } }, async (req) => {
    const playerId = await requirePlayer(req);
    const { targetId } = z.object({ targetId: z.number().int().positive() }).parse(req.body);
    return act(async (c, outbox, now) => {
      await proposeAlliance(c, outbox, playerId, targetId, now);
      return tribeAlliancesView(c, playerId, now);
    });
  });

  /** Accepte ou refuse une proposition reçue. */
  app.post('/api/tribes/mine/alliances/invites/:id/:action', async (req) => {
    const playerId = await requirePlayer(req);
    const { id, action } = idParam.extend({ action: z.enum(['accept', 'decline']) }).parse(req.params);
    return act(async (c, outbox, now) => {
      await answerAlliance(c, outbox, playerId, id, action === 'accept', now);
      return tribeAlliancesView(c, playerId, now);
    });
  });

  /** Retire une proposition envoyée. */
  app.delete('/api/tribes/mine/alliances/invites/:id', async (req) => {
    const playerId = await requirePlayer(req);
    const { id } = idParam.parse(req.params);
    return act(async (c, _outbox, now) => {
      await cancelAllianceInvite(c, playerId, id);
      return tribeAlliancesView(c, playerId, now);
    });
  });

  /** Rompt l'alliance avec une tribu (identifiant de la tribu alliée). */
  app.delete('/api/tribes/mine/alliances/:id', async (req) => {
    const playerId = await requirePlayer(req);
    const { id } = idParam.parse(req.params);
    return act(async (c, outbox, now) => {
      await breakAlliance(c, outbox, playerId, id);
      return tribeAlliancesView(c, playerId, now);
    });
  });
}
