import type { FastifyInstance } from 'fastify';
import { z } from 'zod';
import type { AdminAccount, AdminWorldSummary, WorldTemplate } from '@aldoria/shared';
import { isAdminName, requireAccount } from '../auth';
import { corePool } from '../db';
import { forbidden, GameError } from '../errors';
import { parseSetting, saveSettings, SETTINGS, settingDefault, type SettingDef } from '../settings';
import { allWorlds, inWorld, worldById, type WorldCtx } from '../world-store';
import { configDefault, configValue, createWorld, parseWorldConfig, updateWorld, WORLD_CONFIG, worldMeta } from '../worlds';

async function requireAdmin(req: Parameters<typeof requireAccount>[0]) {
  const s = await requireAccount(req);
  if (!s.isAdmin) throw forbidden('Réservé à l’administrateur');
  return s;
}

async function summary(w: WorldCtx): Promise<AdminWorldSummary> {
  const c = (
    await w.pool.query(
      `SELECT (SELECT count(*)::int FROM players WHERE NOT is_npc) AS players,
              (SELECT count(*)::int FROM players WHERE is_npc) AS npcs,
              (SELECT count(*)::int FROM villages WHERE owner_id IS NOT NULL) AS villages,
              (SELECT count(*)::int FROM villages WHERE owner_id IS NULL AND kind = 'village') AS barbarians,
              (SELECT count(*)::int FROM tribes) AS tribes,
              (SELECT count(*)::int FROM players WHERE NOT is_npc AND last_seen_at > now() - interval '1 day') AS active`,
    )
  ).rows[0];
  const meta = worldMeta(w.id);
  return {
    id: w.id,
    name: w.name,
    open: meta.open,
    createdAt: meta.createdAt.toISOString(),
    config: Object.fromEntries(WORLD_CONFIG.map((d) => [d.key, configValue(w, d.key)])),
    totals: c,
  };
}

export default async function adminWorldRoutes(app: FastifyInstance) {
  /** Tous les mondes, avec leurs réglages de création et leurs chiffres clés. */
  app.get('/api/admin/worlds', async (req): Promise<AdminWorldSummary[]> => {
    await requireAdmin(req);
    return Promise.all(allWorlds().map(summary));
  });

  /** Formulaire d'un nouveau monde : réglages de création et réglages du jeu, avec leur valeur d'origine. */
  app.get('/api/admin/worlds/template', async (req): Promise<WorldTemplate> => {
    await requireAdmin(req);
    return {
      config: WORLD_CONFIG.map((d) => ({ key: d.key, label: d.label, help: d.help, min: d.min, max: d.max, integer: d.integer, default: configDefault(d.key) })),
      settings: SETTINGS.map((d) => ({ key: d.key, label: d.label, help: d.help, type: d.type, min: d.min ?? null, max: d.max ?? null, default: settingDefault(d.key) })),
    };
  });

  /** Crée un monde avec son nom, ses réglages de création et, au besoin, des réglages du jeu différents de ceux d'origine. */
  app.post('/api/admin/worlds', async (req) => {
    await requireAdmin(req);
    const body = z
      .object({
        name: z.string().max(60),
        open: z.boolean().default(true),
        config: z.record(z.string(), z.unknown()).default({}),
        settings: z.record(z.string(), z.union([z.string(), z.number(), z.boolean()])).default({}),
      })
      .parse(req.body);
    const parsed = parseWorldConfig(body.config);
    if ('error' in parsed) throw new GameError(parsed.error);
    // Les réglages sont contrôlés avant de créer quoi que ce soit.
    for (const [key, raw] of Object.entries(body.settings)) {
      const def = SETTINGS.find((s) => s.key === key);
      if (!def) throw new GameError(`Réglage inconnu : ${key}`);
      const check = parseSetting(def, raw);
      if ('error' in check) throw new GameError(check.error);
    }
    const w = await createWorld({ name: body.name, config: parsed.config, open: body.open });
    if (Object.keys(body.settings).length) {
      const error = await inWorld(w, () => saveSettings(body.settings as Partial<Record<SettingDef['key'], unknown>>));
      if (error) throw new GameError(error);
    }
    return summary(w);
  });

  /** Renomme un monde ou ouvre / ferme ses inscriptions. */
  app.patch('/api/admin/worlds/:id', async (req) => {
    await requireAdmin(req);
    const { id } = z.object({ id: z.coerce.number().int().positive() }).parse(req.params);
    const patch = z.object({ name: z.string().max(60).optional(), open: z.boolean().optional() }).parse(req.body);
    await updateWorld(id, patch);
    return summary(worldById(id)!);
  });

  /** Tous les comptes, avec les mondes où ils jouent (points et villages dans chacun). */
  app.get('/api/admin/accounts', async (req): Promise<AdminAccount[]> => {
    await requireAdmin(req);
    const accounts = (await corePool.query('SELECT id, username, created_at, last_seen_at FROM core.accounts ORDER BY lower(username)')).rows;
    const memberships = (await corePool.query('SELECT account_id, world_id, player_id, joined_at, last_played_at FROM core.memberships')).rows;
    const stats = new Map<string, { villages: number; points: number; tribe: string | null }>();
    for (const w of allWorlds()) {
      const ids = memberships.filter((m) => m.world_id === w.id).map((m) => m.player_id as number);
      if (!ids.length) continue;
      const { rows } = await w.pool.query(
        `SELECT p.id, t.tag, count(v.id)::int AS villages, coalesce(sum(v.points), 0)::int AS points
         FROM players p LEFT JOIN villages v ON v.owner_id = p.id LEFT JOIN tribes t ON t.id = p.tribe_id
         WHERE p.id = ANY($1) GROUP BY p.id, t.tag`,
        [ids],
      );
      for (const r of rows) stats.set(`${w.id}:${r.id}`, { villages: r.villages, points: r.points, tribe: r.tag });
    }
    return accounts.map((a) => ({
      id: a.id,
      username: a.username,
      createdAt: a.created_at.toISOString(),
      lastSeen: a.last_seen_at ? a.last_seen_at.toISOString() : null,
      admin: isAdminName(a.username),
      worlds: memberships
        .filter((m) => m.account_id === a.id && worldById(m.world_id))
        .map((m) => {
          const s = stats.get(`${m.world_id}:${m.player_id}`);
          return {
            worldId: m.world_id,
            worldName: worldById(m.world_id)!.name,
            playerId: m.player_id,
            villages: s?.villages ?? 0,
            points: s?.points ?? 0,
            tribe: s?.tribe ?? null,
            lastPlayed: m.last_played_at.toISOString(),
          };
        })
        .sort((x, y) => y.points - x.points),
    }));
  });
}
