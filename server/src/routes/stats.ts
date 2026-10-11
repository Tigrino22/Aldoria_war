import type { FastifyInstance } from 'fastify';
import { requirePlayer } from '../auth';
import { pool } from '../db';
import { env } from '../env';
import { warScore, WAR_POINTS, WAR_SCORE_SQL } from '../game/war-stats';
import { worldStats } from '../game/world-stats';

const toStats = (r: any) => ({
  conquests: r.conquests as number,
  villagesLost: r.villagesLost as number,
  attackWins: r.attackWins as number,
  defenseWins: r.defenseWins as number,
  killsAttack: r.killsAttack as number,
  killsDefense: r.killsDefense as number,
});

/** Classement de guerre et statistiques du monde : consultables par tous les joueurs, sans donnée individuelle sensible. */
export default async function statsRoutes(app: FastifyInstance) {
  const withScore = (rows: any[], rankFrom = 1) => rows.map((r, i) => ({ rank: rankFrom + i, ...r, score: warScore(toStats(r)) }));

  /** Joueurs classés par points de guerre (conquêtes, victoires, adversaires battus). Seuls ceux qui ont déjà combattu figurent au tableau. */
  app.get('/api/ranking/war/players', async (req) => {
    const playerId = await requirePlayer(req);
    const cols = `p.id, p.username, p.is_npc AS "isNpc", t.tag, p.conquests, p.villages_lost AS "villagesLost", p.attack_wins AS "attackWins",
                  p.defense_wins AS "defenseWins", p.kills_attack::float8 AS "killsAttack", p.kills_defense::float8 AS "killsDefense"`;
    const from = 'FROM players p LEFT JOIN tribes t ON t.id = p.tribe_id';
    const rows = (await pool.query(`SELECT ${cols}, ${WAR_SCORE_SQL}::float8 AS score ${from} WHERE ${WAR_SCORE_SQL} > 0 ORDER BY score DESC, p.id LIMIT 100`)).rows;
    const mine = (await pool.query(`SELECT ${cols}, ${WAR_SCORE_SQL}::float8 AS score, (SELECT count(*)::int + 1 FROM players p2 WHERE (p2.conquests * ${WAR_POINTS.conquest} + (p2.attack_wins + p2.defense_wins) * ${WAR_POINTS.win} + floor((p2.kills_attack + p2.kills_defense) / ${WAR_POINTS.killsDivisor})) > ${WAR_SCORE_SQL}) AS rank ${from} WHERE p.id = $1`, [playerId])).rows[0];
    return { rows: withScore(rows), me: mine && Number(mine.score) > 0 ? { ...mine, score: Number(mine.score) } : null, points: WAR_POINTS };
  });

  /** Tribus classées par points de guerre : la somme de ceux de leurs membres actuels. */
  app.get('/api/ranking/war/tribes', async (req) => {
    await requirePlayer(req);
    const { rows } = await pool.query(
      `SELECT t.id, t.name, t.tag, count(p.id)::int AS members,
              coalesce(sum(p.conquests), 0)::int AS conquests, coalesce(sum(p.villages_lost), 0)::int AS "villagesLost",
              coalesce(sum(p.attack_wins), 0)::int AS "attackWins", coalesce(sum(p.defense_wins), 0)::int AS "defenseWins",
              coalesce(sum(p.kills_attack), 0)::float8 AS "killsAttack", coalesce(sum(p.kills_defense), 0)::float8 AS "killsDefense"
       FROM tribes t JOIN players p ON p.tribe_id = t.id GROUP BY t.id`,
    );
    const ranked = withScore(rows)
      .filter((r) => r.score > 0)
      .sort((a, b) => b.score - a.score || a.id - b.id)
      .slice(0, 100)
      .map((r, i) => ({ ...r, rank: i + 1 }));
    return { rows: ranked, points: WAR_POINTS };
  });

  /** Dernières conquêtes et guerres de tribu en cours. */
  app.get('/api/ranking/war/feed', async (req) => {
    await requirePlayer(req);
    const conquests = (
      await pool.query('SELECT at, conqueror_name AS "conqueror", loser_name AS "loser", village_name AS "village", x, y FROM conquest_log ORDER BY at DESC, id DESC LIMIT 15')
    ).rows;
    const wars = (
      await pool.query(
        `SELECT w.started_at AS "startedAt", w.until, a.id AS "aId", a.tag AS "aTag", a.name AS "aName", a.is_npc AS "aNpc",
                b.id AS "bId", b.tag AS "bTag", b.name AS "bName", b.is_npc AS "bNpc"
         FROM tribe_wars w JOIN tribes a ON a.id = w.declarer_id JOIN tribes b ON b.id = w.target_id
         WHERE w.ended_at IS NULL AND w.until > now() ORDER BY w.started_at DESC LIMIT 20`,
      )
    ).rows;
    return { conquests, wars };
  });

  /** Statistiques publiques du monde : uniquement des totaux et des moyennes, jamais de joueur ni de village précis. */
  app.get('/api/world/stats', async (req) => {
    await requirePlayer(req);
    const [stats, totals, sizes] = await Promise.all([
      worldStats(),
      pool.query(
        `SELECT (SELECT count(*)::int FROM players WHERE NOT is_npc) AS players,
                (SELECT count(*)::int FROM players WHERE is_npc) AS npcs,
                (SELECT count(*)::int FROM tribes) AS tribes,
                (SELECT count(*)::int FROM villages WHERE owner_id IS NOT NULL) AS villages,
                (SELECT count(*)::int FROM villages WHERE owner_id IS NULL) AS barbarians,
                (SELECT coalesce(sum(points), 0)::int FROM villages WHERE owner_id IS NOT NULL) AS points,
                (SELECT count(*)::int FROM commands WHERE type = 'attack' AND NOT processed) AS "attacksInFlight",
                (SELECT count(*)::int FROM commands WHERE type = 'attack' AND processed AND arrive_at > now() - interval '24 hours') AS "attacks24h",
                (SELECT count(*)::int FROM conquest_log WHERE at > now() - interval '24 hours') AS "conquests24h",
                (SELECT count(*)::int FROM conquest_log WHERE at > now() - interval '7 days') AS "conquests7d",
                (SELECT count(*)::int FROM tribe_wars WHERE ended_at IS NULL AND until > now()) AS "tribeWars"`,
      ),
      pool.query(
        `SELECT width_bucket(points, ARRAY[100, 250, 500, 1000, 2000]) AS bucket, count(*)::int AS n
         FROM villages WHERE owner_id IS NOT NULL GROUP BY bucket ORDER BY bucket`,
      ),
    ]);
    const t = totals.rows[0];
    const owners = t.players + t.npcs;
    const bounds = ['moins de 100', '100 à 249', '250 à 499', '500 à 999', '1 000 à 1 999', '2 000 et plus'];
    const distribution = bounds.map((label, i) => ({ label, villages: sizes.rows.find((r) => r.bucket === i)?.n ?? 0 }));
    return {
      world: { speed: env.worldSpeed, mapSize: env.mapSize },
      totals: { ...t, villagesPerOwner: owners ? t.villages / owners : 0, pointsPerVillage: t.villages ? t.points / t.villages : 0 },
      distribution,
      troops: stats.troops,
      resources: stats.resources,
      buildings: stats.buildings,
      activity: { day: stats.activity.day, week: stats.activity.week },
    };
  });
}
