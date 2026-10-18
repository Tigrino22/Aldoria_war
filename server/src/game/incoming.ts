import { armyKinds, armySize, distance, normalizeUnits, populationOf, sightWindow, totalUnits, type IncomingAttack } from '@aldoria/shared';
import type { Db } from '../db';
import { pathOf } from './intercept';

/**
 * Toutes les attaques en route vers les villages du joueur, PNJ compris, de la plus proche à la plus lointaine.
 * La composition suit la règle de la carte : cachée tant que l'armée n'est pas à portée de vue de l'un de ses villages.
 */
export async function incomingAttacks(c: Pick<Db, 'query'>, playerId: number, now: Date): Promise<IncomingAttack[]> {
  const mine = (await c.query('SELECT x, y FROM villages WHERE owner_id = $1', [playerId])).rows as { x: number; y: number }[];
  const { rows } = await c.query(
    `SELECT c.id, c.type, c.units, c.sent_at, c.arrive_at, c.meet_x, c.meet_y,
            o.id AS o_id, o.name AS o_name, o.x AS ox, o.y AS oy, po.username AS o_owner, po.is_npc AS o_npc, tro.tag AS o_tag,
            t.id AS t_id, t.name AS t_name, t.x AS tx, t.y AS ty
     FROM commands c
     JOIN villages o ON o.id = c.origin_village_id LEFT JOIN players po ON po.id = o.owner_id LEFT JOIN tribes tro ON tro.id = po.tribe_id
     JOIN villages t ON t.id = c.target_village_id
     WHERE t.owner_id = $1 AND c.type = 'attack' AND NOT c.processed AND c.player_id IS DISTINCT FROM $1
     ORDER BY c.arrive_at, c.id LIMIT 1000`,
    [playerId],
  );
  const t = now.getTime();
  return rows.map((r) => {
    const path = pathOf(r);
    const w = sightWindow(path.from, path.to, mine);
    const spotAt = w ? path.t0 + (path.t1 - path.t0) * w[0] : null;
    const spotted = spotAt !== null && spotAt <= t;
    const units = normalizeUnits(r.units);
    return {
      id: r.id,
      sentAt: new Date(r.sent_at).toISOString(),
      arriveAt: new Date(r.arrive_at).toISOString(),
      distance: Math.round(distance({ x: r.ox, y: r.oy }, { x: r.tx, y: r.ty }) * 10) / 10,
      origin: { id: r.o_id, name: r.o_name, x: r.ox, y: r.oy, ownerName: r.o_owner ?? null, ownerTag: r.o_tag ?? null, npc: !!r.o_npc },
      target: { id: r.t_id, name: r.t_name, x: r.tx, y: r.ty },
      spotFrom: spotAt !== null && !spotted ? new Date(spotAt).toISOString() : null,
      spotted,
      size: spotted ? armySize(populationOf(units)) : null,
      kinds: spotted ? armyKinds(units) : null,
      scouts: spotted && units.scout > 0 && units.scout === totalUnits(units),
    };
  });
}
