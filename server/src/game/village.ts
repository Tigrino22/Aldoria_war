import {
  BUILDINGS,
  BUILDING_KEYS,
  BUILD_QUEUE_LIMIT,
  BuildingKey,
  Buildings,
  CommandView,
  LOYALTY_REGEN_PER_HOUR,
  RESOURCES,
  Resources,
  TroopGroup,
  UNITS,
  UnitCounts,
  UnitKey,
  VillageState,
  addUnits,
  buildingCost,
  buildingTime,
  canAfford,
  refundShare,
  emptyUnits,
  meetsRequirements,
  merchantCount,
  normalizeUnits,
  productionRates,
  recruitTime,
  resourceProduction,
  scaleResources,
  totalUnits,
  upkeepOf,
  villagePoints,
  warehouseCapacity,
} from '@aldoria/shared';
import type { Db } from '../db';
import { env } from '../env';
import { barbarianCap, barbarianTier, growBarbarian } from './barbarians';
import { GameError, notFound } from '../errors';

export interface VillageRow {
  id: number;
  owner_id: number | null;
  name: string;
  x: number;
  y: number;
  buildings: Buildings;
  wood: number;
  clay: number;
  iron: number;
  wheat: number;
  resources_at: Date;
  loyalty: number;
  points: number;
}

const STARTING_ZERO = Object.fromEntries(BUILDING_KEYS.map((k) => [k, 0])) as Buildings;

export const resourcesOf = (v: VillageRow): Resources => ({ wood: v.wood, clay: v.clay, iron: v.iron, wheat: v.wheat });

export async function loadVillage(c: Db, id: number, forUpdate = false): Promise<VillageRow> {
  const { rows } = await c.query(`SELECT * FROM villages WHERE id = $1 ${forUpdate ? 'FOR UPDATE' : ''}`, [id]);
  if (!rows[0]) throw notFound('Village introuvable');
  // Un bâtiment ajouté après la création du village démarre au niveau 0.
  rows[0].buildings = { ...STARTING_ZERO, ...rows[0].buildings };
  return rows[0];
}

export async function saveVillage(c: Db, v: VillageRow) {
  await c.query(
    `UPDATE villages SET owner_id = $2, name = $3, buildings = $4, wood = $5, clay = $6, iron = $7, wheat = $8,
       resources_at = $9, loyalty = $10, points = $11 WHERE id = $1`,
    [v.id, v.owner_id, v.name, JSON.stringify(v.buildings), v.wood, v.clay, v.iron, v.wheat, v.resources_at, v.loyalty, v.points],
  );
}

// ---------- Troupes ----------

export async function getTroops(c: Db, villageId: number, homeId: number): Promise<UnitCounts> {
  const { rows } = await c.query('SELECT units FROM troops WHERE village_id = $1 AND home_village_id = $2 FOR UPDATE', [
    villageId,
    homeId,
  ]);
  return normalizeUnits(rows[0]?.units);
}

export async function setTroops(c: Db, villageId: number, homeId: number, units: UnitCounts) {
  if (totalUnits(units) <= 0) {
    await c.query('DELETE FROM troops WHERE village_id = $1 AND home_village_id = $2', [villageId, homeId]);
    return;
  }
  await c.query(
    `INSERT INTO troops (village_id, home_village_id, units) VALUES ($1, $2, $3)
     ON CONFLICT (village_id, home_village_id) DO UPDATE SET units = EXCLUDED.units`,
    [villageId, homeId, JSON.stringify(units)],
  );
}

export async function addTroops(c: Db, villageId: number, homeId: number, units: UnitCounts) {
  const current = await getTroops(c, villageId, homeId);
  await setTroops(c, villageId, homeId, addUnits(current, units));
}

/** Entretien (blé par heure) de toutes les troupes appartenant au village, où qu'elles soient, y compris en recrutement. */
export async function computeUpkeep(c: Db, villageId: number): Promise<number> {
  const { rows } = await c.query(
    `SELECT units FROM troops WHERE home_village_id = $1
     UNION ALL SELECT units FROM commands WHERE home_village_id = $1 AND NOT processed`,
    [villageId],
  );
  let upkeep = rows.reduce((sum, r) => sum + upkeepOf(normalizeUnits(r.units)), 0);
  const queue = await c.query('SELECT unit, count - delivered AS remaining FROM recruit_queue WHERE village_id = $1', [villageId]);
  for (const r of queue.rows) upkeep += UNITS[r.unit as UnitKey].upkeep * Number(r.remaining);
  return upkeep;
}

// ---------- Synchronisation dans le temps ----------

function produce(v: VillageRow, from: Date, to: Date, upkeep: number) {
  const hours = (to.getTime() - from.getTime()) / 3_600_000;
  if (hours <= 0) return;
  const rates = productionRates(v.buildings, upkeep, env.worldSpeed);
  const cap = warehouseCapacity(v.buildings.warehouse);
  for (const r of RESOURCES) {
    const next = v[r] + rates[r] * hours;
    if (rates[r] >= 0) v[r] = v[r] >= cap ? v[r] : Math.min(cap, next);
    else v[r] = Math.max(0, next);
  }
}

/**
 * Amène un village à l'instant `at` : production de ressources, constructions terminées,
 * unités recrutées et regain de loyauté. Rien n'est recalculé tant que personne ne regarde le village.
 */
export async function syncVillage(c: Db, id: number, at: Date): Promise<VillageRow> {
  const v = await loadVillage(c, id, true);
  if (at.getTime() <= new Date(v.resources_at).getTime()) return v;
  const start = new Date(v.resources_at);
  const upkeep = await computeUpkeep(c, id);

  const builds = await c.query(
    'SELECT id, building, level, finish_at FROM build_queue WHERE village_id = $1 AND finish_at <= $2 ORDER BY finish_at, id',
    [id, at],
  );
  let t = start;
  for (const b of builds.rows) {
    produce(v, t, b.finish_at, upkeep);
    const key = b.building as BuildingKey;
    v.buildings[key] = Math.max(v.buildings[key], b.level);
    t = b.finish_at;
  }
  if (builds.rows.length) await c.query('DELETE FROM build_queue WHERE id = ANY($1)', [builds.rows.map((b) => b.id)]);
  produce(v, t, at, upkeep);

  const hours = (at.getTime() - start.getTime()) / 3_600_000;
  v.loyalty = Math.min(100, v.loyalty + hours * LOYALTY_REGEN_PER_HOUR * env.worldSpeed);

  const recruits = await c.query('SELECT * FROM recruit_queue WHERE village_id = $1 ORDER BY start_at, id', [id]);
  for (const r of recruits.rows) {
    const elapsed = (at.getTime() - new Date(r.start_at).getTime()) / 1000;
    const done = Math.min(r.count, Math.max(0, Math.floor(elapsed / r.unit_seconds + 1e-9)));
    const fresh = done - r.delivered;
    if (fresh > 0) await addTroops(c, id, id, { ...emptyUnits(), [r.unit]: fresh });
    if (done >= r.count) await c.query('DELETE FROM recruit_queue WHERE id = $1', [r.id]);
    else if (fresh > 0) await c.query('UPDATE recruit_queue SET delivered = $2 WHERE id = $1', [r.id, done]);
  }

  if (v.owner_id === null) await regrowBarbarian(c, v, hours);

  v.resources_at = at;
  v.points = villagePoints(v.buildings);
  await saveVillage(c, v);
  return v;
}

let growthRandom: () => number = Math.random;
/** Permet aux tests de rendre la croissance des barbares déterministe. */
export const setGrowthRandom = (fn: () => number) => (growthRandom = fn);

/** Un village barbare pillé ou détruit se reconstruit avec le temps, dans la limite de son plafond. */
async function regrowBarbarian(c: Db, v: VillageRow, realHours: number) {
  const gameHours = realHours * env.worldSpeed;
  if (gameHours <= 0) return;
  const started = (await c.query("SELECT value FROM world_meta WHERE key = 'started_at'")).rows[0]?.value;
  const worldDays = started ? ((Date.now() - Date.parse(started)) / 86_400_000) * env.worldSpeed : 0;
  const cap = barbarianCap(barbarianTier(v.x, v.y, env.mapSize), worldDays);
  const troops = await getTroops(c, v.id, v.id);
  const grown = growBarbarian({ buildings: v.buildings, troops }, gameHours, cap, growthRandom);
  if (!grown.changed) return;
  v.buildings = grown.buildings;
  await setTroops(c, v.id, v.id, grown.troops);
}

// ---------- Création ----------

export async function createVillage(
  c: Db,
  opts: {
    ownerId: number | null;
    name: string;
    x: number;
    y: number;
    buildings: Buildings;
    resources: Resources;
    at: Date;
    troops?: UnitCounts;
  },
): Promise<number> {
  const { rows } = await c.query(
    `INSERT INTO villages (owner_id, name, x, y, buildings, wood, clay, iron, wheat, resources_at, points)
     VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11) RETURNING id`,
    [
      opts.ownerId,
      opts.name,
      opts.x,
      opts.y,
      JSON.stringify(opts.buildings),
      opts.resources.wood,
      opts.resources.clay,
      opts.resources.iron,
      opts.resources.wheat,
      opts.at,
      villagePoints(opts.buildings),
    ],
  );
  const id = rows[0].id as number;
  if (opts.troops) await setTroops(c, id, id, opts.troops);
  return id;
}

function pay(v: VillageRow, cost: Resources) {
  if (!canAfford(resourcesOf(v), cost)) throw new GameError('Pas assez de ressources');
  for (const r of RESOURCES) v[r] -= cost[r];
}

// ---------- Construction ----------

export async function enqueueBuild(c: Db, villageId: number, key: BuildingKey, now: Date) {
  if (!BUILDINGS[key]) throw new GameError('Bâtiment inconnu');
  const v = await syncVillage(c, villageId, now);
  const queue = (await c.query('SELECT building, level, finish_at FROM build_queue WHERE village_id = $1 ORDER BY finish_at', [villageId]))
    .rows;
  if (queue.length >= BUILD_QUEUE_LIMIT) throw new GameError(`La file de construction est pleine (${BUILD_QUEUE_LIMIT} maximum)`);

  const effective: Buildings = { ...v.buildings };
  for (const q of queue) effective[q.building as BuildingKey] = Math.max(effective[q.building as BuildingKey], q.level);
  const level = effective[key] + 1;
  if (level > BUILDINGS[key].maxLevel) throw new GameError('Niveau maximum atteint');
  if (!meetsRequirements(effective, BUILDINGS[key].requires)) throw new GameError('Conditions non remplies');

  pay(v, buildingCost(key, level));
  const startAt = queue.length ? new Date(queue[queue.length - 1].finish_at) : now;
  const finishAt = new Date(startAt.getTime() + buildingTime(key, level, effective.townhall, env.worldSpeed) * 1000);
  await c.query('INSERT INTO build_queue (village_id, building, level, finish_at, queued_at) VALUES ($1, $2, $3, $4, $5)', [
    villageId,
    key,
    level,
    finishAt,
    now,
  ]);
  await saveVillage(c, v);
}

/** Rend une partie du coût, sans dépasser la capacité de l'entrepôt. */
function refund(v: VillageRow, cost: Resources, share: number) {
  const cap = warehouseCapacity(v.buildings.warehouse);
  for (const r of RESOURCES) v[r] = Math.max(v[r], Math.min(cap, v[r] + Math.floor(cost[r] * share)));
}

/** Annule la dernière construction de la file (les précédentes ne sont pas affectées) et rembourse. */
export async function cancelBuild(c: Db, villageId: number, queueId: number, now: Date) {
  const v = await syncVillage(c, villageId, now);
  const queue = (await c.query('SELECT * FROM build_queue WHERE village_id = $1 ORDER BY finish_at, id', [villageId])).rows;
  const item = queue.find((q) => q.id === queueId);
  if (!item) throw new GameError('Cette construction est déjà terminée ou annulée');
  if (queue[queue.length - 1].id !== queueId) throw new GameError('Annulez d\'abord la construction suivante dans la file');
  const share = refundShare((now.getTime() - new Date(item.queued_at).getTime()) / 1000);
  refund(v, buildingCost(item.building as BuildingKey, item.level), share);
  await c.query('DELETE FROM build_queue WHERE id = $1', [queueId]);
  await saveVillage(c, v);
}

/** Annule la dernière commande de recrutement : les soldats déjà prêts restent, le reste est remboursé. */
export async function cancelRecruit(c: Db, villageId: number, queueId: number, now: Date) {
  const v = await syncVillage(c, villageId, now);
  const queue = (await c.query('SELECT * FROM recruit_queue WHERE village_id = $1 ORDER BY start_at, id', [villageId])).rows;
  const item = queue.find((q) => q.id === queueId);
  if (!item) throw new GameError('Ce recrutement est déjà terminé ou annulé');
  if (queue[queue.length - 1].id !== queueId) throw new GameError("Annulez d'abord le recrutement suivant dans la file");
  const remaining = item.count - item.delivered;
  const share = refundShare((now.getTime() - new Date(item.queued_at).getTime()) / 1000);
  refund(v, scaleResources(UNITS[item.unit as UnitKey].cost, remaining), share);
  if (item.delivered > 0) await c.query('UPDATE recruit_queue SET count = delivered WHERE id = $1', [queueId]);
  else await c.query('DELETE FROM recruit_queue WHERE id = $1', [queueId]);
  await saveVillage(c, v);
}

// ---------- Recrutement ----------

export async function enqueueRecruit(c: Db, villageId: number, unit: UnitKey, count: number, now: Date) {
  const def = UNITS[unit];
  if (!def) throw new GameError('Unité inconnue');
  if (!Number.isInteger(count) || count < 1 || count > 10000) throw new GameError('Nombre de soldats invalide');
  const v = await syncVillage(c, villageId, now);
  if (!meetsRequirements(v.buildings, def.requires)) throw new GameError('Conditions non remplies pour cette unité');

  const upkeep = await computeUpkeep(c, villageId);
  if (resourceProduction(v.buildings.farm) - upkeep - def.upkeep * count < 0) {
    throw new GameError('Votre ferme ne produit pas assez de blé pour nourrir ces troupes');
  }
  pay(v, scaleResources(def.cost, count));

  const unitSeconds = recruitTime(unit, v.buildings.barracks, env.worldSpeed);
  const last = await c.query(
    `SELECT max(start_at + make_interval(secs => count * unit_seconds)) AS end_at FROM recruit_queue WHERE village_id = $1`,
    [villageId],
  );
  const lastEnd = last.rows[0]?.end_at ? new Date(last.rows[0].end_at) : now;
  const startAt = lastEnd > now ? lastEnd : now;
  await c.query('INSERT INTO recruit_queue (village_id, unit, count, start_at, unit_seconds, queued_at) VALUES ($1, $2, $3, $4, $5, $6)', [
    villageId,
    unit,
    count,
    startAt,
    unitSeconds,
    now,
  ]);
  await saveVillage(c, v);
}

// ---------- Vue complète pour le propriétaire ----------

async function troopGroups(c: Db, where: 'here' | 'away', villageId: number): Promise<TroopGroup[]> {
  const joinCol = where === 'here' ? 't.home_village_id' : 't.village_id';
  const filter = where === 'here' ? 't.village_id = $1 AND t.home_village_id <> $1' : 't.home_village_id = $1 AND t.village_id <> $1';
  const { rows } = await c.query(
    `SELECT v.id, v.name, v.x, v.y, p.username, t.units FROM troops t
     JOIN villages v ON v.id = ${joinCol} LEFT JOIN players p ON p.id = v.owner_id
     WHERE ${filter} ORDER BY v.id`,
    [villageId],
  );
  return rows.map((r) => ({ villageId: r.id, villageName: r.name, x: r.x, y: r.y, ownerName: r.username, units: normalizeUnits(r.units) }));
}

const COMMAND_SELECT = `
  SELECT c.*, o.name AS o_name, o.x AS o_x, o.y AS o_y, po.username AS o_owner,
         t.name AS t_name, t.x AS t_x, t.y AS t_y, pt.username AS t_owner
  FROM commands c
  JOIN villages o ON o.id = c.origin_village_id LEFT JOIN players po ON po.id = o.owner_id
  JOIN villages t ON t.id = c.target_village_id LEFT JOIN players pt ON pt.id = t.owner_id`;

export function toCommandView(r: any, showUnits: boolean): CommandView {
  return {
    id: r.id,
    type: r.type,
    origin: { id: r.origin_village_id, name: r.o_name, x: r.o_x, y: r.o_y, ownerName: r.o_owner },
    target: { id: r.target_village_id, name: r.t_name, x: r.t_x, y: r.t_y, ownerName: r.t_owner },
    units: showUnits ? normalizeUnits(r.units) : null,
    loot: showUnits ? r.loot : null,
    merchants: r.merchants ?? 0,
    sentAt: new Date(r.sent_at).toISOString(),
    arriveAt: new Date(r.arrive_at).toISOString(),
  };
}

export async function villageState(c: Db, v: VillageRow, viewerId: number): Promise<VillageState> {
  const upkeep = await computeUpkeep(c, v.id);
  const buildQueue = (await c.query('SELECT * FROM build_queue WHERE village_id = $1 ORDER BY finish_at, id', [v.id])).rows;
  const recruitQueue = (await c.query('SELECT * FROM recruit_queue WHERE village_id = $1 ORDER BY start_at, id', [v.id])).rows;
  const incoming = (await c.query(`${COMMAND_SELECT} WHERE c.target_village_id = $1 AND NOT c.processed ORDER BY c.arrive_at`, [v.id]))
    .rows;
  const outgoing = (
    await c.query(`${COMMAND_SELECT} WHERE c.origin_village_id = $1 AND c.type NOT IN ('return', 'trade_return') AND NOT c.processed ORDER BY c.arrive_at`, [
      v.id,
    ])
  ).rows;

  return {
    id: v.id,
    name: v.name,
    x: v.x,
    y: v.y,
    points: v.points,
    loyalty: Math.floor(v.loyalty),
    resources: resourcesOf(v),
    rates: productionRates(v.buildings, upkeep, env.worldSpeed),
    capacity: warehouseCapacity(v.buildings.warehouse),
    syncedAt: new Date(v.resources_at).toISOString(),
    buildings: v.buildings,
    buildQueue: buildQueue.map((q) => ({ id: q.id, building: q.building, level: q.level, finishAt: new Date(q.finish_at).toISOString(), queuedAt: new Date(q.queued_at).toISOString() })),
    recruitQueue: recruitQueue.map((q) => ({
      id: q.id,
      unit: q.unit,
      count: q.count,
      delivered: q.delivered,
      startAt: new Date(q.start_at).toISOString(),
      unitSeconds: q.unit_seconds,
      queuedAt: new Date(q.queued_at).toISOString(),
    })),
    upkeep,
    troopsHome: await getTroops(c, v.id, v.id),
    supportHere: await troopGroups(c, 'here', v.id),
    supportAway: await troopGroups(c, 'away', v.id),
    // On voit ce qui arrive chez soi, sauf la composition des attaques ennemies.
    incoming: incoming.map((r) => toCommandView(r, r.type !== 'attack' || r.player_id === viewerId)),
    outgoing: outgoing.map((r) => toCommandView(r, true)),
    market: { merchants: merchantCount(v.buildings.market), available: merchantCount(v.buildings.market) - (await busyMerchants(c, v.id)) },
  };
}


/** Marchands partis en convoi ou sur le chemin du retour. */
export async function busyMerchants(c: Db, villageId: number): Promise<number> {
  const { rows } = await c.query(
    "SELECT COALESCE(SUM(merchants), 0)::int AS n FROM commands WHERE home_village_id = $1 AND type IN ('trade', 'trade_return') AND NOT processed",
    [villageId],
  );
  return rows[0].n;
}
