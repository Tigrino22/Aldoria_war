import { RESOURCES, UNITS, UNIT_KEYS, emptyUnits, resolveCombat, travelTime, wallDuringCombat, type UnitCounts } from '@aldoria/shared';
import type { Db } from '../db';
import { env } from '../env';
import { GameError } from '../errors';
import type { Outbox } from '../notify';
import { sendCommand } from './commands';
import { attackBeats, ramsFor } from './npc-rules';
import { freeTroops } from './village';

/**
 * Assaut groupé des PNJ : quand l'armée d'un seul village ne suffit pas contre un village bien défendu, le PNJ fait donner tous ses villages
 * et ceux de sa tribu à portée. Les vagues arrivent l'une derrière l'autre, à une seconde d'écart, de la plus faible à la plus forte :
 * chaque vague perdue tue une part des défenseurs ((attaque / défense)^1,5), la suivante trouve donc une défense entamée, et la dernière nettoie.
 * Si même toutes ensemble elles ne nettoient pas, le PNJ frappe quand même pour user la défense, pourvu qu'elle perde plus qu'il ne perd.
 */

/** Distance maximale (en cases) d'un village qui se joint à un assaut groupé. */
export const SIEGE_RADIUS = 25;
/** Part minimale de la défense (en ressources) qu'un assaut d'usure doit tuer pour partir. */
export const ATTRITION_MIN_KILL = 0.3;

export interface Wave {
  playerId: number;
  villageId: number;
  x: number;
  y: number;
  units: UnitCounts;
}

const valueOf = (units: UnitCounts) => UNIT_KEYS.reduce((sum, k) => sum + units[k] * RESOURCES.reduce((t, r) => t + UNITS[k].cost[r], 0), 0);
const powerOf = (u: UnitCounts) => UNIT_KEYS.reduce((sum, k) => sum + u[k] * UNITS[k].attack, 0);

export interface SiegePlan {
  /** Indices des vagues retenues, dans leur ordre d'arrivée. */
  order: number[];
  /** Vrai si la dernière vague gagne (avec la marge voulue) : la défense est nettoyée, les nobles peuvent suivre. */
  cleared: boolean;
  /** Valeur en ressources des défenseurs tués, et des pertes des vagues. */
  killed: number;
  lost: number;
  defenseValue: number;
}

/** Simule les vagues (règles pures, sans base de données) : de la plus faible à la plus forte, jusqu'à la première qui gagne. */
export function planSiege(waves: UnitCounts[], defenders: UnitCounts, wall: number, marginPct = 0): SiegePlan {
  const order = waves.map((_, i) => i).sort((a, b) => powerOf(waves[a]) - powerOf(waves[b]));
  let left = { ...defenders };
  const defenseValue = valueOf(defenders);
  let lost = 0;
  const kept: number[] = [];
  for (const i of order) {
    const units = waves[i];
    kept.push(i);
    const r = resolveCombat({ attackers: units, defenders: [left], wallLevel: wallDuringCombat(wall, units.ram) });
    if (r.attackerWins) {
      lost += valueOf(r.attackerLosses);
      // Une vague qui gagne tue tout, mais il faut sa marge pour compter sur elle (la défense espionnée a pu grossir).
      return { order: kept, cleared: attackBeats(r, marginPct), killed: defenseValue, lost, defenseValue };
    }
    lost += valueOf(units);
    const after = { ...left };
    for (const k of UNIT_KEYS) after[k] = left[k] - r.defenderLosses[0][k];
    left = after;
  }
  return { order: kept, cleared: false, killed: defenseValue - valueOf(left), lost, defenseValue };
}

/** Vague que peut fournir un village : ses épéistes, cavaliers et béliers au plus juste pour la muraille. */
export function waveOf(home: UnitCounts, wall: number): UnitCounts {
  return { ...emptyUnits(), swordsman: home.swordsman, cavalry: home.cavalry, ram: ramsFor(home.ram, wall) };
}

/**
 * Villages qui peuvent se joindre à un assaut : les autres villages du PNJ et ceux des PNJ de sa tribu, à `SIEGE_RADIUS` cases au plus de la cible,
 * avec une armée offensive d'au moins « Taille minimale d'une attaque » au village.
 */
export async function siegeHelpers(c: Db, npcId: number, tribeId: number | null, exceptVillageId: number, target: { id: number; x: number; y: number; wall: number }): Promise<Wave[]> {
  const { rows } = await c.query(
    `SELECT v.id, v.x, v.y, v.owner_id FROM villages v JOIN players p ON p.id = v.owner_id
     WHERE p.is_npc AND (p.id = $1 OR ($2::int IS NOT NULL AND p.tribe_id = $2)) AND v.id <> $3 AND v.id <> $4
       AND (v.x - $5)^2 + (v.y - $6)^2 <= $7 ORDER BY v.id`,
    [npcId, tribeId, exceptVillageId, target.id, target.x, target.y, SIEGE_RADIUS * SIEGE_RADIUS],
  );
  const waves: Wave[] = [];
  for (const r of rows) {
    const units = waveOf(await freeTroops(c, r.id), target.wall);
    // Vraie attaque ou rien : une vague plus faible que le minimum réglé ne pèse rien et remplit les rapports.
    if (powerOf(units) > 0 && powerOf(units) >= env.npcMinAttack * UNITS.swordsman.attack) waves.push({ playerId: r.owner_id, villageId: r.id, x: r.x, y: r.y, units });
  }
  return waves;
}

/**
 * Envoie les vagues retenues pour qu'elles arrivent l'une derrière l'autre à partir de `landTime` (au plus tôt l'arrivée naturelle de la plus lente),
 * une seconde d'écart. Renvoie l'heure d'arrivée de la dernière vague envoyée, ou null si aucune n'a pu partir.
 */
export async function sendWaves(c: Db, outbox: Outbox, waves: Wave[], target: { id: number; x: number; y: number }, landTime: number, now: Date): Promise<number | null> {
  let at = landTime;
  let last: number | null = null;
  for (const w of waves) {
    try {
      const cmd = await sendCommand(c, outbox, w.playerId, w.villageId, { type: 'attack', targetId: target.id, units: w.units }, now);
      await c.query('UPDATE commands SET arrive_at = $2 WHERE id = $1', [cmd.id, new Date(at)]);
      last = at;
      at += 1000;
    } catch (err) {
      if (!(err instanceof GameError)) throw err;
    }
  }
  return last;
}

/** Heure d'arrivée naturelle la plus tardive de ces vagues vers la cible. */
export function latestArrival(waves: Wave[], target: { x: number; y: number }, now: Date): number {
  return Math.max(...waves.map((w) => now.getTime() + travelTime(w.units, w, target, env.worldSpeed) * 1000));
}
