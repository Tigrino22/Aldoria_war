import {
  BUILDINGS,
  RESOURCES,
  RESOURCE_NAMES,
  UNITS,
  UNIT_KEYS,
  BUILD_QUEUE_LIMIT,
  emptyResources,
  merchantCount,
  populationCapacity,
  productionRates,
  warehouseCapacity,
  type BuildingKey,
  type Buildings,
  type UnitCounts,
} from '@aldoria/shared';
import { tx, pool, type Db } from '../db';
import { env } from '../env';
import { GameError } from '../errors';
import { unlocked, type Locker } from '../lock';
import { sendTrade } from '../game/commands';
import { busyMerchants, computePopulation, enqueueBuild, enqueueRecruit, ownedUnits, resourcesOf, syncVillage } from '../game/village';
import { Outbox } from '../notify';
import { describeCargo, planBalance, type BalanceVillage } from './balance';
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

/** Niveaux d'un village une fois sa file de construction terminée, et nombre de chantiers en file. */
async function queuedLevels(c: Db, villageId: number, buildings: Buildings) {
  const queue = (await c.query('SELECT building, level FROM build_queue WHERE village_id = $1', [villageId])).rows;
  const levels: Buildings = { ...buildings };
  for (const q of queue) levels[q.building as BuildingKey] = Math.max(levels[q.building as BuildingKey], q.level);
  return { levels, queued: queue.length };
}

/** Une passe sur un village. Renvoie les actions effectuées (pour les tests) et met à jour le message de blocage. */
export async function runVillage(c: Db, villageId: number, plan: Plan, now: Date): Promise<string[]> {
  const done: string[] = [];
  let blocked: string | null = null;
  let v = await syncVillage(c, villageId, now);

  const levelsWithQueue = () => queuedLevels(c, villageId, v.buildings);

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
    // Comptées où qu'elles soient : au village (dont celles réservées par un ordre planifié), en renfort ailleurs (dont l'escorte d'un noble) ou en route.
    const owned: UnitCounts = await ownedUnits(c, villageId);
    const cap = warehouseCapacity(v.buildings.warehouse);
    const stock = resourcesOf(v);
    // Les troupes ont tout ce qui dépasse le coût du prochain bâtiment, plus `troopsShare` % de la production prise sur sa réserve.
    const budget = troopBudget(stock, reserveFor(costOf(next), 0, cap));
    const until = (await c.query('SELECT troops_until FROM manager_villages WHERE village_id = $1', [villageId])).rows[0]?.troops_until ?? null;
    const dip = !until || new Date(until) <= now ? { stock, rates: productionRates(v.buildings, env.worldSpeed), share: plan.troopsShare } : undefined;
    const free = populationCapacity(v.buildings.farm) - (await computePopulation(c, villageId));
    const lot = nextTroopLot(plan.troops, owned, v.buildings, budget, free, env.worldSpeed, dip);
    if (lot) {
      try {
        await enqueueRecruit(c, villageId, lot.unit, lot.count, now);
        if (lot.dipSeconds > 0) {
          await c.query('UPDATE manager_villages SET troops_until = $2 WHERE village_id = $1', [villageId, new Date(now.getTime() + lot.dipSeconds * 1000)]);
        }
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

/**
 * Passe de tout le monde, village par village sous `lock` (le verrou du jeu en production, pour laisser passer les joueurs
 * entre deux villages, `clock` donnant alors l'heure réelle de chaque village). Ne fait rien si l'administrateur a coupé le gestionnaire.
 */
export async function processManager(now: Date, opts: { lock?: Locker; clock?: () => Date } = {}): Promise<number> {
  const lock = opts.lock ?? unlocked;
  if (!env.accountManager) return 0;
  const { rows } = await pool.query(
    `SELECT mv.village_id, mv.owner_id, mv.custom,
            t.buildings AS t_buildings, t.troops AS t_troops, t.troops_share AS t_share
     FROM manager_villages mv
     LEFT JOIN manager_templates t ON t.id = mv.template_id
     WHERE mv.enabled ORDER BY mv.village_id`,
  );
  let runs = 0;
  for (const row of rows) {
    try {
      await lock(() => tx(async (c) => {
        // Village conquis par un autre joueur (relu sous le verrou, il a pu tomber depuis la liste) : ses réglages disparaissent.
        const owner = (await c.query('SELECT owner_id FROM villages WHERE id = $1', [row.village_id])).rows[0]?.owner_id ?? null;
        if (owner !== row.owner_id) {
          await c.query('DELETE FROM manager_villages WHERE village_id = $1', [row.village_id]);
          return;
        }
        const plan = planOf(row);
        if (!plan) return;
        await runVillage(c, row.village_id, plan, opts.clock?.() ?? now);
        runs++;
      }));
    } catch (err) {
      console.error(`Gestionnaire : village ${row.village_id} en échec`, err);
    }
  }
  // Après les constructions de la minute : chaque village réclame ce qui manque à son prochain bâtiment.
  const players = (await pool.query('SELECT owner_id, low, high FROM manager_balance WHERE enabled ORDER BY owner_id')).rows;
  for (const p of players) {
    try {
      await lock(async () => {
        const outbox = new Outbox();
        await tx((c) => runBalance(c, outbox, p.owner_id, { low: p.low, high: p.high }, opts.clock?.() ?? now));
        outbox.flush();
      });
    } catch (err) {
      console.error(`Gestionnaire : équilibrage du joueur ${p.owner_id} en échec`, err);
    }
  }
  return runs;
}

/**
 * Équilibrage d'un joueur : état de ses villages qui participent, convois planifiés par `planBalance`, puis envoyés par
 * `sendTrade` comme un envoi du joueur (mêmes marchands, même trajet), mais sans rapport de livraison.
 */
export async function runBalance(c: Db, outbox: Outbox, playerId: number, thresholds: { low: number; high: number }, now: Date): Promise<number> {
  const rows = (
    await c.query(
      `SELECT v.id, coalesce(mv.balance, true) AS balance, mv.enabled, mv.custom,
              t.buildings AS t_buildings, t.troops AS t_troops, t.troops_share AS t_share
       FROM villages v
       LEFT JOIN manager_villages mv ON mv.village_id = v.id
       LEFT JOIN manager_templates t ON t.id = mv.template_id
       WHERE v.owner_id = $1 ORDER BY v.id`,
      [playerId],
    )
  ).rows.filter((r) => r.balance);
  if (rows.length < 2) return 0;

  const villages: BalanceVillage[] = [];
  const names = new Map<number, string>();
  for (const row of rows) {
    const v = await syncVillage(c, row.id, now);
    names.set(v.id, `${v.name} (${v.x}|${v.y})`);
    const incoming = emptyResources();
    const inbound = await c.query("SELECT loot FROM commands WHERE target_village_id = $1 AND type = 'trade' AND NOT processed", [v.id]);
    for (const cmd of inbound.rows) for (const r of RESOURCES) incoming[r] += Number(cmd.loot?.[r] ?? 0);
    const plan = row.enabled ? planOf(row) : null;
    const reserve = plan ? costOf(nextBuilding(plan.buildings, (await queuedLevels(c, v.id, v.buildings)).levels)) : null;
    villages.push({
      id: v.id,
      x: v.x,
      y: v.y,
      stock: resourcesOf(v),
      capacity: warehouseCapacity(v.buildings.warehouse),
      incoming,
      freeMerchants: Math.max(0, merchantCount(v.buildings.market) - (await busyMerchants(c, v.id))),
      reserve,
    });
  }

  let sent = 0;
  for (const s of planBalance(villages, thresholds)) {
    try {
      await sendTrade(c, outbox, playerId, s.from, { targetId: s.to, resources: s.resources }, now, { automatic: true });
    } catch (err) {
      if (!(err instanceof GameError)) throw err;
      continue;
    }
    const cargo = describeCargo(s.resources, RESOURCE_NAMES);
    await logLine(c, s.from, `Équilibrage : ${cargo} envoyés vers ${names.get(s.to)}`);
    await logLine(c, s.to, `Équilibrage : ${cargo} en route depuis ${names.get(s.from)}`);
    sent++;
  }
  return sent;
}
