import { type UnitCounts, UNIT_KEYS, emptyUnits, resolveCombat, wallDuringCombat } from '@aldoria/shared';
import type { Db } from '../db';
import { env } from '../env';
import { ATTACK_MARGIN } from './npc-rules';

/**
 * Offensives occasionnelles des PNJ : de temps en temps, un village offensif envoie une vraie attaque
 * (une part de son armée, 50 % par défaut) au lieu de se contenter d'éclaireurs ou de petits pillages.
 * Réglages à chaud : `npcOffensive` (interrupteur), `npcOffensiveShare` (part de l'armée), `npcOffensiveHours` (rythme).
 */

const HOUR_MS = 3_600_000;
/** Après une offensive annulée (armée trop faible), le PNJ réessaie au bout d'un quart du rythme normal. */
const RETRY_DIVISOR = 4;

/** Délai (en ms réelles) entre deux offensives d'un PNJ, en heures de jeu ramenées à la vitesse du monde. */
export const offensiveIntervalMs = () => (env.npcOffensiveHours * HOUR_MS) / env.worldSpeed;

/** Prochaine offensive, à 50 %–150 % du rythme pour que les PNJ ne frappent pas tous ensemble. */
export const nextOffensiveAt = (now: Date, rand: number, factor = 1) => new Date(now.getTime() + (offensiveIntervalMs() / factor) * (0.5 + rand));

/** Date de la prochaine offensive mémorisée par le PNJ, ou null s'il n'en a pas encore programmé. */
export const parseNextOffensive = (state: { offensive?: { nextAt?: string } } | null | undefined) => {
  const at = state?.offensive?.nextAt ? Date.parse(state.offensive.nextAt) : NaN;
  return Number.isNaN(at) ? null : at;
};

/** Une offensive est due quand l'interrupteur est actif et que la date programmée est passée. */
export const offensiveDue = (nextAt: number | null, now: Date) => !!env.npcOffensive && nextAt !== null && nextAt <= now.getTime();

/**
 * La part voulue de l'armée offensive, si elle bat la défense estimée avec la marge habituelle ; sinon null (offensive annulée :
 * pas d'attaque suicide). Les béliers partent avec le reste de l'armée.
 */
export function pickOffensiveUnits(available: UnitCounts, defenders: UnitCounts, wall: number, shareOverride?: number): UnitCounts | null {
  const share = (shareOverride ?? env.npcOffensiveShare) / 100;
  const units = emptyUnits();
  for (const k of UNIT_KEYS) units[k] = k === 'scout' || k === 'noble' ? 0 : Math.floor(available[k] * share);
  if (units.swordsman + units.cavalry < 1) return null;
  const r = resolveCombat({ attackers: units, defenders: [defenders], wallLevel: wallDuringCombat(wall, units.ram) });
  return r.attackPower >= ATTACK_MARGIN * r.defensePower ? units : null;
}

/** Vrai si un PNJ a déjà frappé ce joueur (hors espionnage) pendant le dernier rythme d'offensive : au plus une offensive reçue par période. */
export async function recentlyHit(c: Db, ownerId: number, now: Date): Promise<boolean> {
  const since = new Date(now.getTime() - offensiveIntervalMs());
  const { rows } = await c.query(
    `SELECT 1 FROM commands cm JOIN players a ON a.id = cm.player_id JOIN villages v ON v.id = cm.target_village_id
     WHERE a.is_npc AND v.owner_id = $1 AND cm.type = 'attack' AND cm.sent_at >= $2
       AND coalesce((cm.units->>'swordsman')::int, 0) + coalesce((cm.units->>'cavalry')::int, 0) > 0 LIMIT 1`,
    [ownerId, since],
  );
  return rows.length > 0;
}
