import {
  BUILDINGS,
  RESOURCES,
  RESOURCE_NAMES,
  UNITS,
  UNIT_KEYS,
  BUILD_QUEUE_LIMIT,
  normalizeUnits,
  populationCapacity,
  warehouseCapacity,
  type BuildingKey,
  type Buildings,
  type UnitCounts,
} from '@aldoria/shared';
import { tx, pool, type Db } from '../db';
import { env } from '../env';
import { GameError } from '../errors';
import { computePopulation, enqueueBuild, enqueueRecruit, getTroops, resourcesOf, syncVillage } from '../game/village';
import { costOf, nextBuilding, nextTroopLot, parsePlan, reserveFor, troopBudget, type Plan } from './rules';

/**
 * Exécution du gestionnaire de compte. Il n'écrit jamais lui-même dans les tables du jeu : il appelle `enqueueBuild` et
 * `enqueueRecruit`, comme le ferait un clic du joueur, donc coûts, prérequis, file de construction et ferme restent contrôlés par le jeu.
 */
const LOG_KEEP = 30;

export async function logLine(c: Db, villageId: number, text: string) {
  await c.query('INSERT INTO manager_log (village_id, text) VALUES ($1, $2)', [villageId, text]);
  await c.query('DELETE FROM manager_log WHERE village_id = $1 AND id NOT IN (SELECT id FROM manager_log WHERE village_id = $1 ORDER BY id DESC LIMIT $2)', [
    villageId,
    LOG_KEEP,
  ]);
}

/** Plan en vigueur pour un village : son réglage propre s'il existe, sinon son modèle. */
export function planOf(row: { custom: unknown; t_buildings: unknown; t_troops: unknown; t_share: number | null }): Plan | null {
  const raw = row.custom ?? (row.t_buildings ? { buildings: row.t_buildings, troops: row.t_troops, troopsShare: row.t_share } : null);
  if (!raw) return null;
  const parsed = parsePlan(raw);
  return 'plan' in parsed ? parsed.plan : null;
}

/** Une passe sur un village. Renvoie les actions effectuées (pour les tests) et met à jour le message de blocage. */
export async function runVillage(c: Db, villageId: number, plan: Plan, now: Date): Promise<string[]> {
  const done: string[] = [];
  let blocked: string | null = null;
  let v = await syncVillage(c, villageId, now);

  const levelsWithQueue = async () => {
    const queue = (await c.query('SELECT building, level FROM build_queue WHERE village_id = $1', [villageId])).rows;
    const levels: Buildings = { ...v.buildings };
    for (const q of queue) levels[q.building as BuildingKey] = Math.max(levels[q.building as BuildingKey], q.level);
    return { levels, queued: queue.length };
  };

  // 1. Bâtiments : le premier objectif non atteint, sans jamais passer au suivant faute de ressources.
  let { levels, queued } = await levelsWithQueue();
  let next = nextBuilding(plan.buildings, levels);
  const target = next;
  if (target && queued < BUILD_QUEUE_LIMIT) {
    try {
      await enqueueBuild(c, villageId, target.building, now);
      done.push(`${BUILDINGS[target.building].name} niveau ${target.level} lancé`);
      v = await syncVillage(c, villageId, now);
      ({ levels, queued } = await levelsWithQueue());
      next = nextBuilding(plan.buildings, levels);
    } catch (err) {
      if (!(err instanceof GameError)) throw err;
      const cost = costOf(target)!;
      const lacking = RESOURCES.filter((r) => v[r] < cost[r]).map((r) => RESOURCE_NAMES[r].toLowerCase());
      blocked = lacking.length
        ? `${BUILDINGS[target.building].name} niveau ${target.level} : il manque ${lacking.join(', ')}`
        : `${BUILDINGS[target.building].name} niveau ${target.level} : ${err.message}`;
    }
  } else if (target) {
    blocked = `File de construction pleine, ${BUILDINGS[target.building].name} niveau ${target.level} attend`;
  }

  // 2. Troupes : seulement avec ce qui reste une fois mis de côté le coût du prochain bâtiment (selon la part réglée).
  const goals = UNIT_KEYS.filter((u) => (plan.troops[u] ?? 0) > 0);
  const queuedRecruits = (await c.query('SELECT unit, count - delivered AS remaining FROM recruit_queue WHERE village_id = $1', [villageId])).rows;
  if (goals.length && v.buildings.barracks >= 1 && queuedRecruits.length === 0) {
    const owned: UnitCounts = await getTroops(c, villageId, villageId);
    const away = (await c.query("SELECT units FROM commands WHERE home_village_id = $1 AND NOT processed AND type IN ('attack', 'support', 'return')", [villageId])).rows;
    for (const r of away) {
      const u = normalizeUnits(r.units);
      for (const k of UNIT_KEYS) owned[k] += u[k];
    }
    const cap = warehouseCapacity(v.buildings.warehouse);
    const budget = troopBudget(resourcesOf(v), reserveFor(costOf(next), plan.troopsShare, cap));
    const free = populationCapacity(v.buildings.farm) - (await computePopulation(c, villageId));
    const lot = nextTroopLot(plan.troops, owned, v.buildings, budget, free, env.worldSpeed);
    if (lot) {
      try {
        await enqueueRecruit(c, villageId, lot.unit, lot.count, now);
        done.push(`${lot.count} ${UNITS[lot.unit].name.toLowerCase()} en recrutement`);
      } catch (err) {
        if (!(err instanceof GameError)) throw err;
        blocked ??= `Recrutement impossible : ${err.message}`;
      }
    } else if (!blocked && UNIT_KEYS.some((u) => (plan.troops[u] ?? 0) > owned[u]) && free < 1) {
      blocked = 'Ferme pleine : améliorez-la pour loger plus de troupes';
    }
  }

  for (const line of done) await logLine(c, villageId, line);
  const prev = (await c.query('SELECT last_blocked FROM manager_villages WHERE village_id = $1', [villageId])).rows[0]?.last_blocked ?? null;
  if (blocked !== prev) await c.query('UPDATE manager_villages SET last_blocked = $2, updated_at = now() WHERE village_id = $1', [villageId, blocked]);
  return done;
}

/** Passe de tout le monde : à appeler sous le verrou du jeu. Ne fait rien si l'administrateur a coupé le gestionnaire. */
export async function processManager(now: Date): Promise<number> {
  if (!env.accountManager) return 0;
  const { rows } = await pool.query(
    `SELECT mv.village_id, mv.owner_id, mv.custom, v.owner_id AS real_owner,
            t.buildings AS t_buildings, t.troops AS t_troops, t.troops_share AS t_share
     FROM manager_villages mv
     JOIN villages v ON v.id = mv.village_id
     LEFT JOIN manager_templates t ON t.id = mv.template_id
     WHERE mv.enabled ORDER BY mv.village_id`,
  );
  let runs = 0;
  for (const row of rows) {
    try {
      await tx(async (c) => {
        // Village conquis par un autre joueur : ses réglages disparaissent.
        if (row.real_owner !== row.owner_id) {
          await c.query('DELETE FROM manager_villages WHERE village_id = $1', [row.village_id]);
          return;
        }
        const plan = planOf(row);
        if (!plan) return;
        await runVillage(c, row.village_id, plan, now);
        runs++;
      });
    } catch (err) {
      console.error(`Gestionnaire : village ${row.village_id} en échec`, err);
    }
  }
  return runs;
}
