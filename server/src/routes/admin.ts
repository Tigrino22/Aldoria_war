import type { FastifyInstance, FastifyRequest } from 'fastify';
import { z } from 'zod';
import { BUILDING_KEYS, productionRates, RESOURCES, UNIT_KEYS, type Buildings } from '@aldoria/shared';
import { requirePlayer } from '../auth';
import { pool } from '../db';
import { env } from '../env';
import { forbidden } from '../errors';
import { isQuiet } from '../game/npc-rules';

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

  /** Marché : offres ouvertes et échanges récents. */
  app.get('/api/admin/market', async (req) => {
    await requireAdmin(req);
    const { hours } = hoursQuery.parse(req.query);
    const { rows } = await pool.query(
      `SELECT o.id, o.created_at, o.expires_at, o.status, o.give_resource, o.give_amount, o.want_resource, o.want_amount, p.username, p.is_npc
       FROM market_offers o JOIN players p ON p.id = o.player_id
       WHERE o.status = 'open' OR o.created_at >= $1 ORDER BY o.created_at DESC LIMIT 200`,
      [sinceOf(hours)],
    );
    return rows.map((o) => ({
      id: o.id,
      owner: o.username,
      isNpc: o.is_npc,
      status: o.status,
      give: { resource: o.give_resource, amount: o.give_amount },
      want: { resource: o.want_resource, amount: o.want_amount },
      createdAt: o.created_at,
      expiresAt: o.expires_at,
    }));
  });

  /** Statistiques anonymes : troupes, ressources, bâtiments et activité, sans aucun nom de joueur. */
  app.get('/api/admin/stats', async (req) => {
    await requireAdmin(req);
    const villages = (await pool.query('SELECT buildings, wood, clay, iron, wheat FROM villages WHERE owner_id IS NOT NULL')).rows;
    const n = villages.length;

    // Toutes les troupes du monde : au village, en route (attaques, renforts, retours) et recrutées mais pas encore livrées
    // (la file de recrutement d'un village n'est livrée qu'à sa prochaine synchronisation).
    const tally = Object.fromEntries(UNIT_KEYS.map((u) => [u, { players: 0, npc: 0 }])) as Record<(typeof UNIT_KEYS)[number], { players: number; npc: number }>;
    const add = (unit: string, count: number, isNpc: boolean) => {
      if (!(unit in tally) || !(count > 0)) return;
      tally[unit as keyof typeof tally][isNpc ? 'npc' : 'players'] += count;
    };
    const stationed = await pool.query(
      `SELECT t.units, p.is_npc FROM troops t JOIN villages hv ON hv.id = t.home_village_id JOIN players p ON p.id = hv.owner_id
       UNION ALL
       SELECT cm.units, p.is_npc FROM commands cm JOIN villages hv ON hv.id = cm.home_village_id JOIN players p ON p.id = hv.owner_id
       WHERE NOT cm.processed AND cm.type IN ('attack', 'support', 'return')`,
    );
    for (const row of stationed.rows) for (const [unit, count] of Object.entries(row.units as Record<string, number>)) add(unit, Number(count), row.is_npc);
    const queued = await pool.query(
      `SELECT q.unit, greatest(0, least(q.count, floor(extract(epoch FROM now() - q.start_at) / q.unit_seconds + 1e-9))) - q.delivered AS fresh, p.is_npc
       FROM recruit_queue q JOIN villages v ON v.id = q.village_id JOIN players p ON p.id = v.owner_id`,
    );
    for (const row of queued.rows) add(row.unit, Number(row.fresh), row.is_npc);
    const troops = UNIT_KEYS.map((unit) => {
      const { players, npc } = tally[unit];
      const total = players + npc;
      return { unit, total, players, npc, perVillage: n ? total / n : 0 };
    });

    const stock = Object.fromEntries(RESOURCES.map((r) => [r, villages.reduce((sum, v) => sum + Number(v[r]), 0)]));
    const production = Object.fromEntries(RESOURCES.map((r) => [r, 0])) as Record<(typeof RESOURCES)[number], number>;
    for (const v of villages) {
      const rates = productionRates(v.buildings as Buildings, 0, env.worldSpeed);
      for (const r of RESOURCES) production[r] += rates[r];
    }
    const resources = RESOURCES.map((resource) => ({ resource, total: stock[resource], perVillage: n ? stock[resource] / n : 0, perHour: production[resource] }));

    const buildings = BUILDING_KEYS.map((building) => ({
      building,
      average: n ? villages.reduce((sum, v) => sum + Number(v.buildings[building] ?? 0), 0) / n : 0,
    }));

    const a = (
      await pool.query(
        `SELECT count(*) FILTER (WHERE last_seen_at > now() - interval '1 hour')::int AS hour,
                count(*) FILTER (WHERE last_seen_at > now() - interval '24 hours')::int AS day,
                count(*) FILTER (WHERE last_seen_at > now() - interval '7 days')::int AS week,
                count(*) FILTER (WHERE created_at > now() - interval '7 days')::int AS signups
         FROM players WHERE NOT is_npc`,
      )
    ).rows[0];

    return { villages: n, troops, resources, buildings, activity: { hour: a.hour, day: a.day, week: a.week, signups: a.signups } };
  });

  /** Totaux du monde et paramètres actifs. */
  app.get('/api/admin/world', async (req) => {
    await requireAdmin(req);
    const c = (
      await pool.query(
        `SELECT (SELECT count(*)::int FROM players WHERE NOT is_npc) AS humans,
                (SELECT count(*)::int FROM players WHERE is_npc) AS npcs,
                (SELECT count(*)::int FROM villages WHERE owner_id IS NULL) AS barbarians,
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
        npcDifficulty: env.npcDifficulty,
        npcTimezone: env.npcTimezone,
        quietHours: `${env.npcQuietStart} h → ${env.npcQuietEnd} h`,
      },
    };
  });
}
