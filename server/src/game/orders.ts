import { randomUUID } from 'node:crypto';
import {
  DEFAULT_NOBLE_GAP_SECONDS,
  MAX_NOBLE_GAP_SECONDS,
  UNIT_KEYS,
  type NobleTrain,
  type OrderPart,
  type PlannedOrderView,
  type UnitCounts,
  addUnits,
  emptyUnits,
  hasUnits,
  normalizeUnits,
  orderTotal,
  planOrderParts,
  subtractUnits,
  totalUnits,
  trainCapacity,
  travelTime,
} from '@aldoria/shared';
import { tx, type Db } from '../db';
import { env } from '../env';
import { GameError, forbidden } from '../errors';
import { Outbox } from '../notify';
import { assertCanAttack, chargeAttackWheat, dispatchCommand, refundAttackWheat } from './commands';
import { assertCitadelMove } from './crusades';
import { assertBastionMove, speedBonus } from './provinces';
import { freeTroops, getTroops, loadVillage, setTroops, syncVillage } from './village';

/**
 * Point de ralliement : ordres d'attaque et de soutien organisés.
 * - une heure d'arrivée précise : les troupes sont réservées mais restent au village, qu'elles défendent jusqu'à l'heure qui convient.
 *   Si une partie a péri entre-temps, l'assaut part avec ce qui reste ; un train de nobles ne part qu'avec toute son escorte ;
 * - le train de nobles : l'assaut, puis chaque noble dans une attaque séparée, une seconde après le précédent, car chaque
 *   attaque ne fait baisser la loyauté qu'une fois, quel que soit le nombre de nobles qu'elle compte. Un noble seul ne survit
 *   pas à la défense de base d'un village : chaque noble part donc avec une petite escorte.
 * La découpe d'un ordre en mouvements (`orderParts`) est pure ; le reste lit et écrit la base.
 */

/** Un mouvement dont le départ tombe dans cet intervalle part tout de suite. */
const IMMEDIATE_MS = 500;
/** Au-delà de ce retard au départ (serveur arrêté, par exemple), l'heure d'arrivée précise est abandonnée. */
const LATE_MS = 5_000;

/** Découpe d'un ordre en mouvements (voir shared/src/orders.ts), avec les erreurs du jeu. */
export function orderParts(strike: UnitCounts, train: NobleTrain | null, opts: Parameters<typeof planOrderParts>[2]): OrderPart[] {
  const plan = planOrderParts(strike, train, opts);
  if (plan.error !== undefined) throw new GameError(plan.error);
  return plan.parts;
}

export interface OrderInput {
  type: 'attack' | 'support';
  targetId: number;
  /** Troupes de l'assaut (sans les nobles du train). */
  units: Partial<UnitCounts>;
  /** Arrivée voulue de l'assaut ; absente : partir tout de suite. */
  arriveAt?: Date | null;
  /** Train de nobles : nombre de nobles, escorte de chacun et écart entre deux arrivées. */
  train?: { nobles: number; escort?: Partial<UnitCounts>; gapSeconds?: number } | null;
}

/** Prépare un ordre : envoie tout de suite ce qui part maintenant et réserve les troupes du reste, qui attendent au village. Renvoie l'identifiant du groupe. */
export async function placeOrder(c: Db, outbox: Outbox, playerId: number, originId: number, input: OrderInput, now: Date): Promise<string> {
  const origin = await syncVillage(c, originId, now);
  if (origin.owner_id !== playerId) throw forbidden("Ce village n'est pas à vous");
  const target = await loadVillage(c, input.targetId);
  if (target.id === origin.id) throw new GameError('Choisissez un autre village comme cible');
  const strike = normalizeUnits(input.units);
  let train: NobleTrain | null = null;
  if (input.train) {
    if (input.type !== 'attack') throw new GameError('Le train de nobles sert à conquérir : il suppose une attaque');
    if (strike.noble > 0) throw new GameError('Les nobles du train se règlent à part, pas dans les troupes de l’assaut');
    const escort = normalizeUnits(input.train.escort ?? {});
    if (escort.noble > 0) throw new GameError('Un noble ne peut pas en escorter un autre');
    const gapSeconds = Math.min(MAX_NOBLE_GAP_SECONDS, Math.max(1, Math.floor(input.train.gapSeconds ?? DEFAULT_NOBLE_GAP_SECONDS)));
    // Pas assez de troupes pour tous les nobles demandés : seuls ceux qui ont leur escorte partent (3 attaques au lieu de 4, par exemple).
    const home = await freeTroops(c, origin.id);
    const nobles = trainCapacity(home, strike, input.train.nobles, escort);
    if (nobles < 1) throw new GameError("Pas assez de troupes pour envoyer un seul noble avec son escorte");
    train = { nobles, escort, gapMs: gapSeconds * 1000 };
  }
  const units = orderTotal(strike, train);
  if (totalUnits(units) === 0) throw new GameError('Sélectionnez au moins une unité');
  // Les troupes déjà réservées par un autre ordre ne comptent pas.
  if (!hasUnits(await freeTroops(c, origin.id), units)) throw new GameError("Vous n'avez pas assez de troupes libres au village");
  // Un refus de principe (soi-même, joueur protégé) vaut tout de suite : la protection du joueur ne tombe qu'au départ de l'attaque.
  if (input.type === 'attack') await assertCanAttack(c, playerId, target, now, false);
  const speed = await speedBonus(c, playerId, now);
  const parts = orderParts(strike, train, {
    landAt: input.arriveAt ?? null,
    now,
    travelMs: (u) => travelTime(u, origin, target, env.worldSpeed, speed) * 1000,
  });

  // Vers la Citadelle d'une croisade, chaque mouvement de l'ordre doit arriver pendant la fenêtre d'assaut.
  for (const part of parts) {
    await assertCitadelMove(c, { type: input.type, playerId, target, units: part.units, arriveAt: part.arriveAt });
    await assertBastionMove(c, { type: input.type, playerId, target, units: part.units, arriveAt: part.arriveAt });
  }
  // Le blé de toute l'attaque est payé à la commande, comme les troupes sont réservées ; il est rendu si l'ordre est annulé.
  if (input.type === 'attack') await chargeAttackWheat(c, playerId, origin, units);
  const group = randomUUID();
  for (const part of parts) {
    if (part.departAt.getTime() - now.getTime() <= IMMEDIATE_MS) {
      if (input.type === 'attack') await assertCanAttack(c, playerId, target, now);
      await setTroops(c, origin.id, origin.id, subtractUnits(await getTroops(c, origin.id, origin.id), part.units));
      await dispatchCommand(c, outbox, { type: input.type, playerId, origin, target, units: part.units, sentAt: now, arriveAt: part.arriveAt });
    } else {
      await c.query(
        `INSERT INTO planned_commands (group_id, player_id, origin_village_id, target_village_id, type, units, depart_at, arrive_at)
         VALUES ($1, $2, $3, $4, $5, $6, $7, $8)`,
        [group, playerId, origin.id, target.id, input.type, JSON.stringify(part.units), part.departAt, part.arriveAt],
      );
    }
  }
  outbox.push(playerId, { type: 'village', villageId: origin.id });
  return group;
}

/** Annule les mouvements pas encore partis d'un ordre : leurs troupes, restées au village, redeviennent libres. */
export async function cancelOrder(c: Db, outbox: Outbox, playerId: number, groupId: string) {
  const { rows } = await c.query('SELECT * FROM planned_commands WHERE group_id = $1 AND player_id = $2 FOR UPDATE', [groupId, playerId]);
  if (rows.length === 0) throw new GameError('Cet ordre est déjà parti ou annulé');
  for (const row of rows) await refund(c, outbox, row, new Date());
  await c.query('DELETE FROM planned_commands WHERE group_id = $1 AND player_id = $2', [groupId, playerId]);
}

/** Rend le blé d'un mouvement qui ne part pas (ou des unités qui manquent au départ) ; les troupes, elles, n'ont pas quitté le village. */
async function refund(c: Db, outbox: Outbox, row: { player_id: number; origin_village_id: number; type: string; units: unknown }, now: Date) {
  const units = normalizeUnits(row.units as Partial<UnitCounts>);
  if (row.type === 'attack' && totalUnits(units) > 0) await refundAttackWheat(c, row.player_id, row.origin_village_id, units, now);
  outbox.push(row.player_id, { type: 'village', villageId: row.origin_village_id });
}

/** Ordres planifiés d'un joueur, regroupés, avec leur prochain départ en premier. */
export async function plannedOrders(c: Db, playerId: number): Promise<PlannedOrderView[]> {
  const { rows } = await c.query(
    `SELECT pc.id, pc.group_id, pc.type, pc.units, pc.depart_at, pc.arrive_at,
            o.id AS oid, o.name AS oname, o.x AS ox, o.y AS oy,
            t.id AS tid, t.name AS tname, t.x AS tx, t.y AS ty, tp.username AS towner
     FROM planned_commands pc
     JOIN villages o ON o.id = pc.origin_village_id
     JOIN villages t ON t.id = pc.target_village_id
     LEFT JOIN players tp ON tp.id = t.owner_id
     WHERE pc.player_id = $1 ORDER BY pc.depart_at, pc.id`,
    [playerId],
  );
  const groups = new Map<string, PlannedOrderView>();
  for (const r of rows) {
    let g = groups.get(r.group_id);
    if (!g) {
      g = {
        groupId: r.group_id,
        type: r.type,
        origin: { id: r.oid, name: r.oname, x: r.ox, y: r.oy },
        target: { id: r.tid, name: r.tname, x: r.tx, y: r.ty, ownerName: r.towner },
        parts: [],
      };
      groups.set(r.group_id, g);
    }
    g.parts.push({ id: r.id, units: normalizeUnits(r.units), departAt: new Date(r.depart_at).toISOString(), arriveAt: new Date(r.arrive_at).toISOString() });
  }
  return [...groups.values()];
}

/** Fait partir les mouvements planifiés dont l'heure est venue. Renvoie leur nombre. */
export async function launchDueOrders(now: Date): Promise<number> {
  let launched = 0;
  for (;;) {
    const outbox = new Outbox();
    const handled = await tx(async (c) => {
      const { rows } = await c.query('SELECT * FROM planned_commands WHERE depart_at <= $1 ORDER BY depart_at, id LIMIT 1 FOR UPDATE SKIP LOCKED', [now]);
      const row = rows[0];
      if (!row) return false;
      await c.query('DELETE FROM planned_commands WHERE id = $1', [row.id]);
      await launch(c, outbox, row, now);
      return true;
    });
    if (!handled) return launched;
    outbox.flush();
    launched++;
  }
}

type PlannedRow = {
  id: number;
  group_id: string;
  player_id: number;
  origin_village_id: number;
  target_village_id: number;
  type: 'attack' | 'support';
  units: unknown;
  depart_at: Date;
  arrive_at: Date;
};

/**
 * Fait partir un mouvement planifié (déjà retiré de la file) avec les troupes restées au village :
 * - un noble du train ne part qu'avec toute son escorte ; s'il manque des troupes pour le train restant, aucun noble ne part ;
 * - l'assaut part avec ce qui reste, en laissant au village l'escorte du train s'il peut encore partir au complet ;
 *   il est annulé s'il ne reste plus personne.
 * Le blé des unités qui ne partent pas est rendu.
 */
async function launch(c: Db, outbox: Outbox, row: PlannedRow, now: Date) {
  const origin = await loadVillage(c, row.origin_village_id);
  // Le village d'origine a été conquis entre-temps : ses troupes ont disparu avec lui.
  if (origin.owner_id !== row.player_id) return;
  const planned = normalizeUnits(row.units as Partial<UnitCounts>);
  const home = await getTroops(c, origin.id, origin.id);
  const pending = await c.query('SELECT * FROM planned_commands WHERE group_id = $1 FOR UPDATE', [row.group_id]);
  const trainRows: PlannedRow[] = pending.rows.filter((r) => normalizeUnits(r.units as Partial<UnitCounts>).noble > 0);
  const trainNeeds = trainRows.reduce((sum, r) => addUnits(sum, normalizeUnits(r.units as Partial<UnitCounts>)), emptyUnits());
  let units: UnitCounts;
  if (planned.noble > 0) {
    if (!hasUnits(home, addUnits(planned, trainNeeds))) {
      // Il manque de l'escorte (ou un noble) : le train ne part pas, ni ce noble ni les suivants.
      await refund(c, outbox, row, now);
      for (const r of trainRows) await refund(c, outbox, r, now);
      if (trainRows.length) await c.query('DELETE FROM planned_commands WHERE id = ANY($1)', [trainRows.map((r) => r.id)]);
      return;
    }
    units = planned;
  } else {
    const keep = hasUnits(home, trainNeeds) ? trainNeeds : emptyUnits();
    units = emptyUnits();
    for (const k of UNIT_KEYS) units[k] = Math.max(0, Math.min(planned[k], home[k] - keep[k]));
  }
  const missing = subtractUnits(planned, units);
  if (totalUnits(units) === 0) {
    await refund(c, outbox, row, now);
    return;
  }
  try {
    const target = await loadVillage(c, row.target_village_id);
    if (row.type === 'attack') await assertCanAttack(c, row.player_id, target, now);
    const onTime = now.getTime() - new Date(row.depart_at).getTime() <= LATE_MS;
    await dispatchCommand(c, outbox, {
      type: row.type,
      playerId: row.player_id,
      origin,
      target,
      units,
      sentAt: onTime ? new Date(row.depart_at) : now,
      arriveAt: onTime ? new Date(row.arrive_at) : undefined,
    });
    await setTroops(c, origin.id, origin.id, subtractUnits(home, units));
    await refund(c, outbox, { ...row, units: missing }, now);
  } catch (err) {
    if (!(err instanceof GameError)) throw err;
    // La cible n'est plus attaquable (protection, village devenu le nôtre) : les troupes restent au village.
    await refund(c, outbox, row, now);
  }
}
