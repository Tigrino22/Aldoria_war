import { type UnitCounts, UNITS, emptyUnits, resolveCombat, wallDuringCombat, type TargetIntel } from '@aldoria/shared';
import type { Db } from '../db';
import { env } from '../env';
import { GameError } from '../errors';
import type { Outbox } from '../notify';
import { sendCommand } from './commands';
import { estimateLoot, pickIntel } from './intel';
import { attackBeats, carryOf } from './npc-rules';
import { getTroops, loadVillage } from './village';

/**
 * Pillage intensif des PNJ : à chaque réflexion, chaque village envoie plusieurs petits pillages vers les villages sans défense
 * qu'il connaît (barbares, et villages vides des PNJ hostiles), comme un joueur avec l'assistant de pillage. Le PNJ ne triche pas :
 * il se fie à ses propres rapports (dernier espionnage ou dernière attaque) et estime le butin comme l'assistant des joueurs
 * (`estimateLoot`). Un barbare jamais vu reçoit d'abord un éclaireur. Les joueurs n'en font jamais partie : ils restent visés
 * par les attaques habituelles (`attackStep`), avec leurs heures calmes et leur protection.
 * Réglages à chaud : `npcRaids` (interrupteur), `npcRaidsPerThink` (pillages par village et par réflexion), `npcRaidRadius` (rayon).
 */

/** Butin estimé en dessous duquel un pillage ne vaut pas le déplacement. */
export const FARM_MIN_LOOT = 100;
/** Éclaireurs envoyés au plus par village et par réflexion vers des barbares inconnus (ou à revoir). */
const SCOUTS_PER_THINK = 2;
/** Au-delà de cet âge (heures de jeu), le dernier espionnage d'un barbare est trop vieux pour estimer son butin : on y retourne. */
const RESCOUT_GAME_HOURS = 24;
/** Un village de PNJ hostile n'est pillé sans espionnage récent que si on l'a vu vide il y a moins de 6 heures de jeu. */
const HOSTILE_INTEL_GAME_HOURS = 6;
/** Ordre de remplissage d'un pillage : les cavaliers (rapides, gros sacs), puis lanciers, épéistes et hallebardiers. */
const FARM_ORDER = ['cavalry', 'spearman', 'swordsman', 'halberdier'] as const;

const noTroops = (u: UnitCounts) => Object.values(u).every((n) => n === 0);

/** Troupes qu'un village peut envoyer piller : tous ses porteurs, offensifs ou défensifs (ni éclaireurs, ni béliers, ni nobles). */
export function farmPool(home: UnitCounts): UnitCounts {
  const pool = emptyUnits();
  for (const k of FARM_ORDER) pool[k] = home[k];
  return pool;
}

/**
 * Le plus petit groupe qui emporte `goal` ressources et bat la défense d'un village vide à muraille `wall`.
 * S'il n'y a pas de quoi tout porter, part ce qui suffit à gagner (tout le butin possible). Null si le groupe ne gagne pas.
 */
export function pickFarmUnits(pool: UnitCounts, goal: number, wall: number): UnitCounts | null {
  const units = emptyUnits();
  for (const k of FARM_ORDER) {
    const missing = goal - carryOf(units);
    if (missing <= 0) break;
    units[k] = Math.min(pool[k], Math.ceil(missing / UNITS[k].carry));
  }
  const wins = () => {
    if (noTroops(units)) return false;
    const r = resolveCombat({ attackers: units, defenders: [emptyUnits()], wallLevel: wallDuringCombat(wall, 0) });
    return attackBeats(r);
  };
  // Pas assez fort pour passer sans pertes : on ajoute un à un les attaquants les plus solides.
  while (!wins()) {
    const k = (['cavalry', 'swordsman', 'spearman', 'halberdier'] as const).find((u) => units[u] < pool[u]);
    if (!k) return null;
    units[k]++;
  }
  return units;
}

interface FarmTarget {
  id: number;
  barbarian: boolean;
  dist: number;
}

/** Ce qu'il faut faire d'une cible d'après les rapports du PNJ (du plus récent au plus ancien) : l'espionner, la piller (avec le butin visé), ou la laisser. */
export function farmPlan(
  target: { barbarian: boolean },
  rows: { type: string; data: unknown; created_at: Date | string }[],
  now: Date,
  worldSpeed: number,
): { action: 'scout' } | { action: 'raid'; goal: number; wall: number } | { action: 'skip' } {
  const intel: TargetIntel | null = pickIntel(rows);
  if (!intel) return target.barbarian ? { action: 'scout' } : { action: 'skip' };
  // Des défenseurs : ce n'est plus du pillage, l'attaque habituelle s'en charge avec toute l'armée.
  if (!noTroops(intel.troops)) return { action: 'skip' };
  const ageHours = ((now.getTime() - Date.parse(intel.at)) / 3_600_000) * worldSpeed;
  if (!target.barbarian && ageHours > HOSTILE_INTEL_GAME_HOURS) return { action: 'skip' };
  const loot = estimateLoot(rows, now, worldSpeed, intel.troops);
  const seenHours = loot ? ((now.getTime() - Date.parse(loot.seenAt)) / 3_600_000) * worldSpeed : Infinity;
  if (!loot || seenHours > RESCOUT_GAME_HOURS) return target.barbarian ? { action: 'scout' } : { action: 'skip' };
  if (loot.total < FARM_MIN_LOOT) return { action: 'skip' };
  return { action: 'raid', goal: loot.total, wall: intel.wall };
}

/** PNJ qu'un PNJ peut piller en plus des barbares : tribus rivales, tribus en guerre, PNJ qui l'ont attaqué. */
export interface FarmHostiles {
  tribes: number[];
  npcs: number[];
}

/** Envoie les pillages d'un village. Renvoie le nombre de pillages partis. */
export async function raidStep(c: Db, outbox: Outbox, npcId: number, villageId: number, hostiles: FarmHostiles, now: Date): Promise<number> {
  if (!env.npcRaids) return 0;
  const village = await loadVillage(c, villageId);
  const home = await getTroops(c, villageId, villageId);
  const pool = farmPool(home);
  // La moitié des éclaireurs reste au village pour les vrais espionnages (joueurs et PNJ) : le pillage ne prend que le reste.
  let scouts = Math.min(Math.floor(home.scout / 2), SCOUTS_PER_THINK);
  if (noTroops(pool) && scouts === 0) return 0;

  // Barbares et villages des PNJ hostiles dans le rayon, sauf ceux qu'une attaque (la nôtre ou celle d'un autre) vise déjà.
  const { rows } = await c.query(
    `SELECT v.id, (v.owner_id IS NULL) AS barbarian, sqrt((v.x - $2)^2 + (v.y - $3)^2) AS dist
     FROM villages v LEFT JOIN players p ON p.id = v.owner_id
     WHERE v.id <> $1 AND (v.x - $2)^2 + (v.y - $3)^2 <= $4
       AND (v.owner_id IS NULL OR (p.is_npc AND v.owner_id <> $5 AND (p.tribe_id = ANY($6::int[]) OR p.id = ANY($7::int[]))))
       AND NOT EXISTS (SELECT 1 FROM commands cm WHERE cm.target_village_id = v.id AND NOT cm.processed AND cm.type = 'attack')
     ORDER BY dist, v.id LIMIT 60`,
    [villageId, village.x, village.y, env.npcRaidRadius * env.npcRaidRadius, npcId, hostiles.tribes, hostiles.npcs],
  );
  const targets: FarmTarget[] = rows.map((r) => ({ id: r.id, barbarian: r.barbarian, dist: Number(r.dist) }));
  if (!targets.length) return 0;
  const history = new Map<number, { type: string; data: unknown; created_at: Date }[]>();
  const reports = await c.query(
    `SELECT (data->'defender'->'village'->>'id')::int AS target, type, data, created_at FROM reports
     WHERE player_id = $1 AND type IN ('scout', 'attack') AND (data->'defender'->'village'->>'id')::int = ANY($2::int[])
     ORDER BY created_at DESC, id DESC LIMIT 2000`,
    [npcId, targets.map((t) => t.id)],
  );
  for (const r of reports.rows) {
    const h = history.get(r.target) ?? [];
    if (h.length < 20) h.push(r);
    history.set(r.target, h);
  }

  let sent = 0;
  for (const t of targets) {
    if (sent >= env.npcRaidsPerThink) break;
    const plan = farmPlan(t, history.get(t.id) ?? [], now, env.worldSpeed);
    let units: UnitCounts | null = null;
    if (plan.action === 'scout' && scouts > 0) units = { ...emptyUnits(), scout: 1 };
    else if (plan.action === 'raid') units = pickFarmUnits(pool, plan.goal, plan.wall);
    if (!units) continue;
    try {
      await sendCommand(c, outbox, npcId, villageId, { type: 'attack', targetId: t.id, units }, now);
    } catch (err) {
      if (!(err instanceof GameError)) throw err;
      continue;
    }
    if (units.scout) scouts--;
    else {
      for (const k of FARM_ORDER) pool[k] -= units[k];
      sent++;
    }
  }
  return sent;
}
