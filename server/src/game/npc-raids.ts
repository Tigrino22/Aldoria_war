import { type UnitCounts, emptyUnits, resolveCombat, wallDuringCombat, type TargetIntel } from '@aldoria/shared';
import type { Db } from '../db';
import { env } from '../env';
import { GameError } from '../errors';
import type { Outbox } from '../notify';
import { sendCommand } from './commands';
import { estimateLoot, pickIntel } from './intel';
import { attackBeats } from './npc-rules';
import { RAID_SIZE, RAID_UNIT, type VillageRole } from './npc-roles';
import { getTroops, loadVillage } from './village';

/**
 * Pillage intensif des PNJ : à chaque réflexion, chaque village envoie autant de pillages qu'il le peut vers les villages sans défense
 * qu'il connaît (barbares, et villages vides des PNJ hostiles), comme un joueur avec l'assistant de pillage. Chaque pillage compte
 * 50 épéistes depuis un village offensif, 50 lanciers depuis un village défensif. Le PNJ ne triche pas :
 * il se fie à ses propres rapports (dernier espionnage ou dernière attaque) et estime le butin comme l'assistant des joueurs
 * (`estimateLoot`). Un barbare jamais vu reçoit d'abord un éclaireur. Les joueurs n'en font jamais partie : ils restent visés
 * par les attaques habituelles (`attackStep`), avec leurs heures calmes et leur protection.
 * Réglages à chaud : `npcRaids` (interrupteur), `npcRaidsPerThink` (pillages par village et par réflexion), `npcRaidRadius` (rayon).
 */

/** Butin estimé en dessous duquel un pillage ne vaut pas le déplacement. */
export const FARM_MIN_LOOT = 100;
/** Éclaireurs envoyés au plus par village et par réflexion vers des barbares inconnus (ou à revoir). */
const SCOUTS_PER_THINK = 4;
/** Au-delà de cet âge (heures de jeu), le dernier renseignement sur un barbare est trop vieux pour estimer son butin : on y retourne (un pillage récent compte aussi). */
const RESCOUT_GAME_HOURS = 48;
/** Un village de PNJ hostile n'est pillé sans espionnage récent que si on l'a vu vide il y a moins de 6 heures de jeu. */
const HOSTILE_INTEL_GAME_HOURS = 6;
const noTroops = (u: UnitCounts) => Object.values(u).every((n) => n === 0);

/** Un pillage de PNJ : exactement `RAID_SIZE` unités de l'unité de son rôle, si elles battent un village vide à muraille `wall`. Null sinon. */
export function raidGroup(home: UnitCounts, role: VillageRole, wall: number): UnitCounts | null {
  const unit = RAID_UNIT[role];
  if (home[unit] < RAID_SIZE) return null;
  const units = { ...emptyUnits(), [unit]: RAID_SIZE };
  return attackBeats(resolveCombat({ attackers: units, defenders: [emptyUnits()], wallLevel: wallDuringCombat(wall, 0) })) ? units : null;
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
export async function raidStep(c: Db, outbox: Outbox, npcId: number, villageId: number, role: VillageRole, hostiles: FarmHostiles, now: Date): Promise<number> {
  if (!env.npcRaids) return 0;
  const village = await loadVillage(c, villageId);
  const home = await getTroops(c, villageId, villageId);
  const pool = { ...emptyUnits(), [RAID_UNIT[role]]: home[RAID_UNIT[role]] };
  // La moitié des éclaireurs reste au village pour les vrais espionnages (joueurs et PNJ) : le pillage ne prend que le reste.
  let scouts = Math.min(Math.floor(home.scout / 2), SCOUTS_PER_THINK);
  if (noTroops(pool) && scouts === 0) return 0;

  // Barbares et villages des PNJ hostiles dans le rayon, sauf ceux qu'une attaque (la nôtre ou celle d'un autre) vise déjà.
  const { rows } = await c.query(
    `SELECT v.id, (v.owner_id IS NULL) AS barbarian, sqrt((v.x - $2)^2 + (v.y - $3)^2) AS dist
     FROM villages v LEFT JOIN players p ON p.id = v.owner_id
     WHERE v.id <> $1 AND v.kind = 'village' AND (v.x - $2)^2 + (v.y - $3)^2 <= $4
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
    else if (plan.action === 'raid') units = raidGroup(pool, role, plan.wall);
    if (!units) continue;
    try {
      await sendCommand(c, outbox, npcId, villageId, { type: 'attack', targetId: t.id, units }, now);
    } catch (err) {
      if (!(err instanceof GameError)) throw err;
      continue;
    }
    if (units.scout) scouts--;
    else {
      pool[RAID_UNIT[role]] -= units[RAID_UNIT[role]];
      sent++;
    }
  }
  return sent;
}
