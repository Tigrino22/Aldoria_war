import { BUILDING_KEYS, productionRates, RESOURCES, UNIT_KEYS, type Buildings } from '@aldoria/shared';
import { pool } from '../db';
import { env } from '../env';

/**
 * Statistiques agrégées du monde : troupes, ressources, bâtiments et activité, sans aucun nom de joueur ni donnée individuelle.
 * Partagées par l'administration et par la page publique « Monde ».
 */
export async function worldStats() {
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
    const rates = productionRates(v.buildings as Buildings, env.worldSpeed);
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
}
