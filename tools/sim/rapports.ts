/**
 * Simulation accélérée d'un monde (PNJ seuls) pour mesurer le volume de rapports et de mouvements.
 * Usage : DATABASE_URL=… WORLD_SPEED=10 npx tsx tools/sim/rapports.ts <heures réelles> [pas en minutes]
 */
import { pool, tx } from '../../server/src/db';
import { migrate } from '../../server/src/migrate';
import { ensureWorld } from '../../server/src/game/world';
import { assignTriblessNpcs, ensureNpcTribes, ensureNpcs, processNpcs } from '../../server/src/game/npc';
import { processDueEvents } from '../../server/src/game/commands';

const hours = Number(process.argv[2] ?? 6);
const stepMin = Number(process.argv[3] ?? 1);
const start = new Date('2030-03-01T09:00:00Z');

async function counts() {
  const r = await pool.query(`SELECT
    (SELECT count(*) FROM reports r JOIN players p ON p.id = r.player_id WHERE p.is_npc)::int AS npc_reports,
    (SELECT count(*) FROM reports r JOIN players p ON p.id = r.player_id WHERE NOT p.is_npc)::int AS player_reports,
    (SELECT count(*) FROM commands)::int AS commands,
    (SELECT pg_total_relation_size('reports'))::bigint AS reports_bytes,
    (SELECT pg_total_relation_size('commands'))::bigint AS commands_bytes`);
  return r.rows[0];
}

async function main() {
  await migrate(true);
  await tx((c) => ensureWorld(c, start));
  await tx((c) => ensureNpcs(c, start));
  await tx((c) => ensureNpcTribes(c, start));
  await tx((c) => assignTriblessNpcs(c));
  if (process.env.SIM_MATURE) {
    // Monde déjà avancé : villages des PNJ au niveau 12 avec une armée, monde vieux de 12 jours de jeu.
    await pool.query(`UPDATE world_meta SET value = to_jsonb($1::text) WHERE key = 'started_at'`, [new Date(start.getTime() - (12 * 86_400_000) / Number(process.env.WORLD_SPEED ?? 1)).toISOString()]);
    await pool.query(`UPDATE villages SET buildings = '{"farm":14,"wall":8,"market":6,"claypit":12,"barracks":12,"ironmine":12,"townhall":12,"warehouse":12,"woodcutter":12}', wood = 8000, clay = 8000, iron = 8000, wheat = 8000 WHERE owner_id IS NOT NULL`);
    await pool.query(`UPDATE troops SET units = '{"spearman":300,"halberdier":100,"swordsman":400,"scout":120,"cavalry":250,"ram":20,"noble":0}' WHERE village_id = home_village_id AND village_id IN (SELECT id FROM villages WHERE owner_id IS NOT NULL)`);
  }
  const t0 = Date.now();
  for (let m = 0; m <= hours * 60; m += stepMin) {
    const now = new Date(start.getTime() + m * 60_000);
    await processDueEvents(now);
    await processNpcs(now, 1000);
    if (m % 60 === 0) console.log(`h${m / 60}`, JSON.stringify(await counts()), `${Math.round((Date.now() - t0) / 1000)}s`);
  }
  const byType = await pool.query(`SELECT p.is_npc, r.type, count(*)::int n FROM reports r JOIN players p ON p.id = r.player_id GROUP BY 1, 2 ORDER BY 3 DESC`);
  console.table(byType.rows);
  await pool.end();
}
main().catch((e) => { console.error(e); process.exit(1); });
