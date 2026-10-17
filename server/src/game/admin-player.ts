import {
  CRUSADE_TITLES,
  RESOURCES,
  UNIT_KEYS,
  addUnits,
  emptyUnits,
  normalizeUnits,
  populationCapacity,
  warehouseCapacity,
  type CrusadeTitleKey,
  type UnitCounts,
} from '@aldoria/shared';
import { currentWorld } from '../world-store';
import { pool, type Db } from '../db';
import { notFound } from '../errors';
import { boostedRates, computePopulation, estimateResources, productionBonus, type VillageRow } from './village';
import { warScore } from './war-stats';
import { npcType, PROFILE_LABEL } from './npc-rules';

/**
 * Fiche d'un joueur pour l'administration, en lecture seule : compte, tribu, classements, villages (ressources estimées,
 * troupes, constructions), mouvements, objets et activité récente. Le contenu des messages privés n'est jamais lu.
 */
export async function adminPlayerDetail(id: number) {
  const c = await pool.connect();
  try {
    return await detail(c, id);
  } finally {
    c.release();
  }
}

async function detail(c: Db, id: number) {
  const now = new Date();
  const p = (
    await c.query(
      `SELECT p.*, t.id AS t_id, t.name AS t_name, t.tag AS t_tag, t.is_npc AS t_npc, (t.leader_id = p.id) AS is_leader,
              (SELECT count(*)::int FROM players m WHERE m.tribe_id = p.tribe_id) AS t_members,
              (SELECT count(*)::int FROM core.sessions s JOIN core.memberships m ON m.account_id = s.account_id
                WHERE m.world_id = $2 AND m.player_id = p.id) AS sessions
       FROM players p LEFT JOIN tribes t ON t.id = p.tribe_id WHERE p.id = $1`,
      [id, currentWorld().id],
    )
  ).rows[0];
  if (!p) throw notFound('Joueur introuvable');

  const ranks = (
    await c.query(
      `WITH pts AS (SELECT p.id, p.is_npc, coalesce(sum(v.points), 0) AS points FROM players p LEFT JOIN villages v ON v.owner_id = p.id GROUP BY p.id)
       SELECT (SELECT count(*)::int + 1 FROM pts o WHERE o.points > me.points) AS all_rank,
              (SELECT count(*)::int + 1 FROM pts o WHERE NOT o.is_npc AND o.points > me.points) AS human_rank,
              (SELECT count(*)::int FROM pts) AS all_count,
              (SELECT count(*)::int FROM pts WHERE NOT is_npc) AS human_count
       FROM pts me WHERE me.id = $1`,
      [id],
    )
  ).rows[0];

  const bonus = (await productionBonus(c, id, now)).total;
  const villageRows = (await c.query('SELECT * FROM villages WHERE owner_id = $1 ORDER BY points DESC, id', [id])).rows as VillageRow[];
  const ids = villageRows.map((v) => v.id);

  // Un seul client : les requêtes s'enchaînent une à une.
  // Troupes du village chez elles.
  const home = await c.query('SELECT village_id AS id, units FROM troops WHERE village_id = home_village_id AND home_village_id = ANY($1)', [ids]);
  // Renforts stationnés chez un autre village.
  const away = await c.query('SELECT home_village_id AS id, units FROM troops WHERE village_id <> home_village_id AND home_village_id = ANY($1)', [ids]);
  // Troupes en route (attaques, renforts, retours).
  const moving = await c.query('SELECT home_village_id AS id, units FROM commands WHERE NOT processed AND home_village_id = ANY($1)', [ids]);
  const queued = await c.query('SELECT village_id AS id, unit, (count - delivered)::int AS remaining FROM recruit_queue WHERE village_id = ANY($1)', [ids]);
  const builds = await c.query(
    'SELECT village_id AS id, building, level, finish_at FROM build_queue WHERE village_id = ANY($1) AND finish_at > now() ORDER BY finish_at',
    [ids],
  );
  const managed = await c.query('SELECT village_id AS id FROM manager_villages WHERE enabled AND village_id = ANY($1)', [ids]);
  const sumBy = (rows: { id: number; units: unknown }[]) => {
    const out = new Map<number, UnitCounts>();
    for (const r of rows) out.set(r.id, addUnits(out.get(r.id) ?? emptyUnits(), normalizeUnits(r.units as UnitCounts)));
    return out;
  };
  const homeBy = sumBy(home.rows);
  const awayBy = sumBy([...away.rows, ...moving.rows]);
  const queuedBy = new Map<number, UnitCounts>();
  for (const r of queued.rows) {
    const u = queuedBy.get(r.id) ?? emptyUnits();
    u[r.unit as keyof UnitCounts] += Math.max(0, r.remaining);
    queuedBy.set(r.id, u);
  }
  const managedSet = new Set(managed.rows.map((r) => r.id as number));

  const villages = [];
  for (const v of villageRows) {
    const resources = estimateResources(v, now, bonus);
    const rates = boostedRates(v.buildings, bonus);
    const build = builds.rows.filter((b) => b.id === v.id);
    villages.push({
      id: v.id,
      name: v.name,
      x: v.x,
      y: v.y,
      kind: v.kind ?? 'village',
      points: v.points,
      loyalty: Math.round(v.loyalty),
      resources: Object.fromEntries(RESOURCES.map((r) => [r, Math.floor(resources[r])])),
      rates: Object.fromEntries(RESOURCES.map((r) => [r, Math.round(rates[r])])),
      capacity: warehouseCapacity(v.buildings.warehouse),
      population: await computePopulation(c, v.id),
      populationCap: populationCapacity(v.buildings.farm),
      buildings: v.buildings,
      troopsHome: homeBy.get(v.id) ?? emptyUnits(),
      troopsAway: awayBy.get(v.id) ?? emptyUnits(),
      troopsQueued: queuedBy.get(v.id) ?? emptyUnits(),
      building: build[0]
        ? {
            building: build[0].building,
            level: build[0].level,
            finishAt: build[0].finish_at,
          }
        : null,
      buildQueue: build.length,
      manager: managedSet.has(v.id),
    });
  }
  const troops = {
    home: emptyUnits(),
    away: emptyUnits(),
    queued: emptyUnits(),
  };
  for (const v of villages) {
    troops.home = addUnits(troops.home, v.troopsHome);
    troops.away = addUnits(troops.away, v.troopsAway);
    troops.queued = addUnits(troops.queued, v.troopsQueued);
  }

  const counts = (
    await c.query(
      `SELECT (SELECT count(*)::int FROM commands WHERE NOT processed AND type = 'attack' AND player_id = $1) AS attacks_out,
              (SELECT count(*)::int FROM commands WHERE NOT processed AND type = 'support' AND player_id = $1) AS supports_out,
              (SELECT count(*)::int FROM commands cm JOIN villages tv ON tv.id = cm.target_village_id
                 WHERE NOT cm.processed AND cm.type = 'attack' AND tv.owner_id = $1) AS attacks_in,
              (SELECT count(*)::int FROM planned_commands WHERE player_id = $1) AS planned,
              (SELECT count(*)::int FROM player_items WHERE player_id = $1 AND used_at IS NULL) AS items,
              (SELECT count(*)::int FROM market_offers WHERE player_id = $1 AND status = 'open') AS offers,
              (SELECT count(*)::int FROM messages WHERE from_id = $1 AND created_at > now() - interval '7 days') AS sent7,
              (SELECT count(*)::int FROM messages WHERE to_id = $1 AND created_at > now() - interval '7 days') AS received7,
              (SELECT count(*)::int FROM reports WHERE player_id = $1 AND NOT read) AS unread_reports,
              (SELECT coalesce(sum(glory), 0)::int FROM crusade_scores WHERE player_id = $1) AS glory,
              (SELECT count(*)::int FROM crusade_scores WHERE player_id = $1) AS crusades`,
      [id],
    )
  ).rows[0];
  const titles = (await c.query('SELECT title, earned_at FROM player_titles WHERE player_id = $1 ORDER BY earned_at', [id])).rows.map((r) => ({
    title: CRUSADE_TITLES[r.title as CrusadeTitleKey] ?? r.title,
    earnedAt: r.earned_at,
  }));
  const reports = (
    await c.query('SELECT id, type, title, read, created_at FROM reports WHERE player_id = $1 ORDER BY created_at DESC, id DESC LIMIT 15', [id])
  ).rows.map((r) => ({
    id: r.id,
    type: r.type,
    title: r.title,
    read: r.read,
    at: r.created_at,
  }));

  const war = {
    conquests: p.conquests,
    villagesLost: p.villages_lost,
    attackWins: p.attack_wins,
    defenseWins: p.defense_wins,
    killsAttack: Number(p.kills_attack),
    killsDefense: Number(p.kills_defense),
  };

  return {
    id: p.id as number,
    username: p.username as string,
    isNpc: p.is_npc as boolean,
    profile: p.is_npc ? PROFILE_LABEL[npcType(p.npc_profile)] : null,
    createdAt: p.created_at,
    lastSeen: p.last_seen_at,
    protectionUntil: p.protection_until && new Date(p.protection_until) > now ? p.protection_until : null,
    relicUntil: p.relic_until && new Date(p.relic_until) > now ? p.relic_until : null,
    title: p.title ? CRUSADE_TITLES[p.title as CrusadeTitleKey] ?? p.title : null,
    sessions: p.sessions as number,
    tribe: p.t_id
      ? {
          id: p.t_id,
          name: p.t_name,
          tag: p.t_tag,
          isNpc: p.t_npc,
          leader: !!p.is_leader,
          members: p.t_members,
        }
      : null,
    rank: {
      all: ranks.all_rank,
      allCount: ranks.all_count,
      humans: p.is_npc ? null : ranks.human_rank,
      humanCount: ranks.human_count,
    },
    points: villages.reduce((s, v) => s + v.points, 0),
    war: {
      ...war,
      score: warScore({
        conquests: war.conquests,
        attackWins: war.attackWins,
        defenseWins: war.defenseWins,
        killsAttack: war.killsAttack,
        killsDefense: war.killsDefense,
      }),
    },
    glory: counts.glory as number,
    crusades: counts.crusades as number,
    titles,
    movements: {
      attacksOut: counts.attacks_out,
      supportsOut: counts.supports_out,
      attacksIn: counts.attacks_in,
      planned: counts.planned,
    },
    items: counts.items as number,
    offers: counts.offers as number,
    messages: { sent7: counts.sent7, received7: counts.received7 },
    unreadReports: counts.unread_reports as number,
    troops: {
      home: troops.home,
      away: troops.away,
      queued: troops.queued,
      total: UNIT_KEYS.reduce((s, u) => s + troops.home[u] + troops.away[u] + troops.queued[u], 0),
    },
    villages,
    reports,
  };
}
