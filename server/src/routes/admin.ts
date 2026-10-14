import type { FastifyInstance, FastifyRequest } from 'fastify';
import { z } from 'zod';
import { requirePlayer } from '../auth';
import { pool } from '../db';
import { env } from '../env';
import { forbidden } from '../errors';
import { fillNpcWarehouses } from '../game/npc-fill';
import { worldStats } from '../game/world-stats';
import { isQuiet } from '../game/npc-rules';
import { warOverview } from '../game/npc-war-report';
import { GameError } from '../errors';
import { act } from '../act';
import { announceCrusade, endCrusade } from '../game/crusades';
import { saveSettings, SETTINGS, settingDefault, settingValue, type SettingDef } from '../settings';

/** Réservé aux pseudos listés dans ADMIN_USERNAMES : vérifié à chaque requête, côté serveur. */
async function requireAdmin(req: FastifyRequest) {
  const id = await requirePlayer(req);
  const name = (await pool.query('SELECT username FROM players WHERE id = $1', [id])).rows[0]?.username as string | undefined;
  if (!name || !env.adminUsernames.includes(name.toLowerCase())) throw forbidden('Réservé à l’administrateur');
  return id;
}

const hoursQuery = z.object({ hours: z.coerce.number().int().min(1).max(168).default(24) });
const sinceOf = (hours: number) => new Date(Date.now() - hours * 3_600_000);

export default async function adminRoutes(app: FastifyInstance) {
  /** Journal des PNJ : attaques, espionnages, offres et échanges du marché. */
  app.get('/api/admin/npc', async (req) => {
    await requireAdmin(req);
    const { hours } = hoursQuery.parse(req.query);
    const since = sinceOf(hours);
    const quiet = (d: Date) => isQuiet(d, env.npcTimezone, env.npcQuietStart, env.npcQuietEnd);

    const attacks = (
      await pool.query(
        `SELECT cm.id, cm.sent_at, cm.arrive_at, cm.processed, cm.units, p.username AS npc,
                tv.name AS target_name, tv.x, tv.y, tp.username AS target_owner, coalesce(tp.is_npc, false) AS target_npc,
                (SELECT r.title FROM reports r WHERE r.player_id = cm.player_id AND r.created_at = cm.arrive_at AND r.type IN ('attack', 'scout') ORDER BY r.id LIMIT 1) AS result
         FROM commands cm JOIN players p ON p.id = cm.player_id AND p.is_npc
         JOIN villages tv ON tv.id = cm.target_village_id LEFT JOIN players tp ON tp.id = tv.owner_id
         WHERE cm.type = 'attack' AND cm.sent_at >= $1 ORDER BY cm.sent_at DESC LIMIT 300`,
        [since],
      )
    ).rows;
    const offers = (
      await pool.query(
        `SELECT o.id, o.created_at, o.status, o.give_resource, o.give_amount, o.want_resource, o.want_amount, p.username AS npc
         FROM market_offers o JOIN players p ON p.id = o.player_id AND p.is_npc WHERE o.created_at >= $1 ORDER BY o.created_at DESC LIMIT 100`,
        [since],
      )
    ).rows;

    const events = [
      ...attacks.map((a) => {
        const scout = (a.units.scout ?? 0) > 0 && Object.entries(a.units).every(([k, n]) => k === 'scout' || !n);
        const target = a.target_owner ? `${a.target_owner} · ${a.target_name}` : `Camp barbare · ${a.target_name}`;
        return {
          at: a.sent_at as Date,
          npc: a.npc as string,
          kind: scout ? 'scout' : 'attack',
          target: `${target} (${a.x}|${a.y})`,
          onBarbarian: !a.target_owner,
          onPlayer: !!a.target_owner && !a.target_npc,
          result: (a.result as string | null) ?? (a.processed ? 'Terminé' : 'En route'),
          quiet: quiet(a.sent_at),
        };
      }),
      ...offers.map((o) => ({
        at: o.created_at as Date,
        npc: o.npc as string,
        kind: 'market',
        target: `${o.give_amount} ${o.give_resource} ⇄ ${o.want_amount} ${o.want_resource}`,
        onBarbarian: false,
        onPlayer: false,
        result: { open: 'Publiée', accepted: 'Acceptée', cancelled: 'Annulée', expired: 'Expirée' }[o.status as string] ?? o.status,
        quiet: quiet(o.created_at),
      })),
    ].sort((a, b) => b.at.getTime() - a.at.getTime());

    const npcCount = (await pool.query('SELECT count(*)::int AS n FROM players WHERE is_npc')).rows[0].n as number;
    return {
      hours,
      stats: {
        npcCount,
        attacks: events.filter((e) => e.kind === 'attack').length,
        onBarbarians: events.filter((e) => e.kind === 'attack' && e.onBarbarian).length,
        onPlayers: events.filter((e) => e.kind === 'attack' && e.onPlayer).length,
        scouts: events.filter((e) => e.kind === 'scout').length,
        offers: events.filter((e) => e.kind === 'market').length,
        quietAttacks: events.filter((e) => e.kind === 'attack' && e.quiet).length,
      },
      events: events.slice(0, 300).map((e) => ({ ...e, at: e.at.toISOString() })),
    };
  });

  /** Guerres entre tribus de PNJ : état en direct et historique des dernières heures. */
  app.get('/api/admin/wars', async (req) => {
    await requireAdmin(req);
    const { hours } = hoursQuery.parse(req.query);
    return warOverview(hours);
  });

  /** Joueurs et PNJ : points, villages, dernière connexion. */
  app.get('/api/admin/players', async (req) => {
    await requireAdmin(req);
    const { rows } = await pool.query(
      `SELECT p.id, p.username, p.is_npc, p.npc_profile, p.created_at, t.tag AS tribe_tag,
              count(v.id)::int AS villages, coalesce(sum(v.points), 0)::int AS points,
              p.last_seen_at AS last_seen
       FROM players p LEFT JOIN villages v ON v.owner_id = p.id LEFT JOIN tribes t ON t.id = p.tribe_id
       GROUP BY p.id, t.tag ORDER BY points DESC, p.id LIMIT 300`,
    );
    return rows.map((r) => ({
      id: r.id,
      username: r.username,
      isNpc: r.is_npc,
      profile: r.npc_profile,
      tribe: r.tribe_tag,
      villages: r.villages,
      points: r.points,
      createdAt: r.created_at,
      lastSeen: r.last_seen,
    }));
  });

  /** Statistiques anonymes : troupes, ressources, bâtiments et activité, sans aucun nom de joueur. */
  app.get('/api/admin/stats', async (req) => {
    await requireAdmin(req);
    return worldStats();
  });

  /** Réglages du monde modifiables, avec leur valeur actuelle et leur valeur d'origine. */
  const settingsView = () =>
    SETTINGS.map((def) => ({ key: def.key, label: def.label, help: def.help, type: def.type, min: def.min ?? null, max: def.max ?? null, value: settingValue(def.key), default: settingDefault(def.key) }));

  app.get('/api/admin/settings', async (req) => {
    await requireAdmin(req);
    return settingsView();
  });

  /** Enregistre un ou plusieurs réglages ; une valeur `null` rétablit la valeur d'origine. */
  app.put('/api/admin/settings', async (req) => {
    await requireAdmin(req);
    const values = z.record(z.string(), z.union([z.string(), z.number(), z.boolean(), z.null()])).parse(req.body);
    const unknown = Object.keys(values).find((k) => !SETTINGS.some((s) => s.key === k));
    if (unknown) throw new GameError(`Réglage inconnu : ${unknown}`);
    const error = await saveSettings(values as Partial<Record<SettingDef['key'], unknown>>);
    if (error) throw new GameError(error);
    return settingsView();
  });

  /** Remplit les entrepôts de tous les PNJ jusqu'à un pourcentage de leur capacité (jamais en dessous de ce qu'ils ont). */
  app.post('/api/admin/npc/fill', async (req) => {
    await requireAdmin(req);
    const { percent } = z.object({ percent: z.number().min(0).max(100) }).parse(req.body);
    return fillNpcWarehouses(percent, new Date());
  });

  /**
   * Croisade d'essai : annonce tout de suite une Citadelle dont les portes s'ouvrent dans `inMinutes` minutes
   * (pour tester sans attendre le jour prévu), ou ferme celle en cours.
   */
  app.post('/api/admin/crusade/start', async (req) => {
    await requireAdmin(req);
    const { inMinutes } = z.object({ inMinutes: z.number().int().min(1).max(7 * 24 * 60) }).parse(req.body);
    return act(async (c, _o, now) => {
      const busy = (await c.query("SELECT 1 FROM crusades WHERE status <> 'ended'")).rowCount;
      if (busy) throw new GameError('Une croisade est déjà annoncée ou en cours');
      const opens = new Date(now.getTime() + inMinutes * 60_000);
      return { id: await announceCrusade(c, now, opens, new Date(opens.getTime() + env.crusadeMinutes * 60_000)) };
    });
  });
  app.post('/api/admin/crusade/end', async (req) => {
    await requireAdmin(req);
    return act(async (c, outbox, now) => {
      const cr = (await c.query("SELECT * FROM crusades WHERE status <> 'ended' ORDER BY id LIMIT 1 FOR UPDATE")).rows[0];
      if (!cr) throw new GameError('Aucune croisade en cours');
      await endCrusade(c, outbox, cr, now);
      return { id: cr.id };
    });
  });

  /** Totaux du monde et paramètres actifs. */
  app.get('/api/admin/world', async (req) => {
    await requireAdmin(req);
    const c = (
      await pool.query(
        `SELECT (SELECT count(*)::int FROM players WHERE NOT is_npc) AS humans,
                (SELECT count(*)::int FROM players WHERE is_npc) AS npcs,
                (SELECT count(*)::int FROM villages WHERE owner_id IS NULL AND kind = 'village') AS barbarians,
                (SELECT count(*)::int FROM villages WHERE owner_id IS NOT NULL) AS owned,
                (SELECT count(*)::int FROM tribes) AS tribes,
                (SELECT count(*)::int FROM commands WHERE NOT processed AND type = 'attack') AS attacksInFlight`,
      )
    ).rows[0];
    return {
      totals: c,
      settings: {
        worldSpeed: env.worldSpeed,
        mapSize: env.mapSize,
        npcCount: env.npcCount,
        accountManager: env.accountManager ? 'activé' : 'désactivé',
        npcRevenge: env.npcRevenge ? 'activée' : 'désactivée',
        npcPlayerWars: env.npcPlayerWars ? 'activées' : 'désactivées',
        npcOffensive: env.npcOffensive ? 'activées' : 'désactivées',
        npcOffensiveShare: `${env.npcOffensiveShare} %`,
        npcOffensiveHours: `${env.npcOffensiveHours} h`,
        npcRaids: env.npcRaids ? `activé (${env.npcRaidsPerThink} par réflexion, ${env.npcRaidRadius} cases)` : 'désactivé',
        npcAttackMargin: `${env.npcAttackMargin} %`,
        npcThinkMinutes: `${env.npcThinkMinutes} min`,
        npcRecruitBatch: `${env.npcRecruitBatch} unités, ${env.npcRecruitBatches} lots par réflexion`,
        npcArmyFirst: env.npcArmyFirst ? 'recrutement avant construction' : 'construction avant recrutement',
        npcWars: env.npcWars ? 'activées' : 'désactivées',
        npcDifficulty: env.npcDifficulty,
        npcTimezone: env.npcTimezone,
        quietHours: `${env.npcQuietStart} h → ${env.npcQuietEnd} h`,
        crusades: env.crusades ? `activées (jours ${env.crusadeDays}, ${env.crusadeTime}, ${env.crusadeMinutes} min)` : 'désactivées',
      },
    };
  });
}
