import type { FastifyInstance } from 'fastify';
import { z } from 'zod';
import { act } from '../act';
import { requirePlayer } from '../auth';
import { env } from '../env';
import { GameError, forbidden, notFound } from '../errors';
import { PRESETS, parsePlan } from '../manager/rules';

const MAX_TEMPLATES = 10;
const idParam = z.object({ id: z.coerce.number().int().positive() });
const templateBody = z.object({ name: z.string().trim().min(1, 'Nom requis').max(40, 'Nom trop long (40 caractères)'), plan: z.any() });
const villageBody = z.object({
  enabled: z.boolean().optional(),
  templateId: z.number().int().positive().nullable().optional(),
  custom: z.any().optional(),
});

export default async function managerRoutes(app: FastifyInstance) {
  /** Modèles et réglages de tous les villages du joueur. Les deux modèles de départ sont créés à la première visite. */
  app.get('/api/manager', async (req) => {
    const playerId = await requirePlayer(req);
    return act(async (c) => {
      const count = (await c.query('SELECT count(*)::int AS n FROM manager_templates WHERE owner_id = $1', [playerId])).rows[0].n;
      if (count === 0) {
        for (const p of PRESETS) {
          await c.query('INSERT INTO manager_templates (owner_id, name, buildings, troops, troops_share) VALUES ($1, $2, $3, $4, $5)', [
            playerId, p.name, JSON.stringify(p.plan.buildings), JSON.stringify(p.plan.troops), p.plan.troopsShare,
          ]);
        }
      }
      const templates = (await c.query('SELECT id, name, buildings, troops, troops_share FROM manager_templates WHERE owner_id = $1 ORDER BY id', [playerId])).rows.map((t) => ({
        id: t.id, name: t.name, buildings: t.buildings, troops: t.troops, troopsShare: t.troops_share,
      }));
      const villages = (
        await c.query(
          `SELECT v.id, v.name, v.x, v.y, mv.enabled, mv.template_id, mv.custom, mv.last_blocked,
                  COALESCE((SELECT json_agg(json_build_object('at', l.at, 'text', l.text) ORDER BY l.id DESC)
                            FROM (SELECT * FROM manager_log WHERE village_id = v.id ORDER BY id DESC LIMIT 8) l), '[]') AS log
           FROM villages v LEFT JOIN manager_villages mv ON mv.village_id = v.id
           WHERE v.owner_id = $1 ORDER BY v.id`,
          [playerId],
        )
      ).rows.map((r) => ({
        id: r.id, name: r.name, x: r.x, y: r.y, enabled: !!r.enabled, templateId: r.template_id ?? null,
        custom: r.custom ?? null, blocked: r.last_blocked ?? null, log: r.log,
      }));
      return { available: !!env.accountManager, maxTemplates: MAX_TEMPLATES, templates, villages };
    });
  });

  app.post('/api/manager/templates', async (req) => {
    const playerId = await requirePlayer(req);
    const body = templateBody.parse(req.body);
    const parsed = parsePlan(body.plan);
    if ('error' in parsed) throw new GameError(parsed.error);
    return act(async (c) => {
      const n = (await c.query('SELECT count(*)::int AS n FROM manager_templates WHERE owner_id = $1', [playerId])).rows[0].n;
      if (n >= MAX_TEMPLATES) throw new GameError(`${MAX_TEMPLATES} modèles au maximum`);
      const { plan } = parsed;
      const id = (
        await c.query('INSERT INTO manager_templates (owner_id, name, buildings, troops, troops_share) VALUES ($1, $2, $3, $4, $5) RETURNING id', [
          playerId, body.name, JSON.stringify(plan.buildings), JSON.stringify(plan.troops), plan.troopsShare,
        ])
      ).rows[0].id;
      return { id };
    });
  });

  app.put('/api/manager/templates/:id', async (req) => {
    const playerId = await requirePlayer(req);
    const { id } = idParam.parse(req.params);
    const body = templateBody.parse(req.body);
    const parsed = parsePlan(body.plan);
    if ('error' in parsed) throw new GameError(parsed.error);
    return act(async (c) => {
      const { plan } = parsed;
      const res = await c.query(
        'UPDATE manager_templates SET name = $3, buildings = $4, troops = $5, troops_share = $6 WHERE id = $1 AND owner_id = $2',
        [id, playerId, body.name, JSON.stringify(plan.buildings), JSON.stringify(plan.troops), plan.troopsShare],
      );
      if (!res.rowCount) throw notFound('Modèle introuvable');
      return { ok: true };
    });
  });

  app.delete('/api/manager/templates/:id', async (req) => {
    const playerId = await requirePlayer(req);
    const { id } = idParam.parse(req.params);
    return act(async (c) => {
      const res = await c.query('DELETE FROM manager_templates WHERE id = $1 AND owner_id = $2', [id, playerId]);
      if (!res.rowCount) throw notFound('Modèle introuvable');
      // Les villages qui le suivaient restent sans modèle : le gestionnaire les laisse tranquilles.
      return { ok: true };
    });
  });

  /** Réglage d'un village : interrupteur, modèle suivi, ou réglage propre (custom: null revient au modèle). */
  app.put('/api/manager/villages/:id', async (req) => {
    const playerId = await requirePlayer(req);
    const { id } = idParam.parse(req.params);
    const body = villageBody.parse(req.body);
    let custom: string | null | undefined;
    if (body.custom === null) custom = null;
    else if (body.custom !== undefined) {
      const parsed = parsePlan(body.custom);
      if ('error' in parsed) throw new GameError(parsed.error);
      custom = JSON.stringify(parsed.plan);
    }
    return act(async (c) => {
      const owner = (await c.query('SELECT owner_id FROM villages WHERE id = $1', [id])).rows[0];
      if (!owner) throw notFound('Village introuvable');
      if (owner.owner_id !== playerId) throw forbidden("Ce village n'est pas à vous");
      if (body.templateId) {
        const t = await c.query('SELECT 1 FROM manager_templates WHERE id = $1 AND owner_id = $2', [body.templateId, playerId]);
        if (!t.rowCount) throw notFound('Modèle introuvable');
      }
      await c.query('INSERT INTO manager_villages (village_id, owner_id) VALUES ($1, $2) ON CONFLICT (village_id) DO NOTHING', [id, playerId]);
      if (body.enabled !== undefined) await c.query('UPDATE manager_villages SET enabled = $2 WHERE village_id = $1', [id, body.enabled]);
      if (body.templateId !== undefined) await c.query('UPDATE manager_villages SET template_id = $2 WHERE village_id = $1', [id, body.templateId]);
      if (custom !== undefined) await c.query('UPDATE manager_villages SET custom = $2 WHERE village_id = $1', [id, custom]);
      await c.query('UPDATE manager_villages SET last_blocked = NULL, updated_at = now() WHERE village_id = $1', [id]);
      return { ok: true };
    });
  });
}
