import { type UnitCounts, emptyUnits, travelTime } from '@aldoria/shared';
import { pool, type Db } from '../db';
import { env } from '../env';
import { GameError } from '../errors';
import type { Outbox } from '../notify';
import { sendCommand } from './commands';
import { getTroops, loadVillage } from './village';

/** Opération coordonnée : tous les membres frappent la même cible dans une fenêtre d'arrivée. */
export interface TribeOp {
  targetId: number;
  /** Arrivée du premier assaut (celui du chef). */
  landAt: string;
  /** Les autres doivent arriver avant cette heure. */
  landBy: string;
  /** Renseignement du chef sur la cible, partagé avec les autres membres. */
  troops: UnitCounts;
  wall: number;
  joined: number[];
}

export interface TribeState {
  allies?: number[];
  rivals?: number[];
  op?: TribeOp | null;
  /** Début de la dernière opération, pour espacer les opérations. */
  lastOpAt?: string;
  /** Attaques déjà signalées aux membres (pour ne pas les réveiller en boucle). */
  alerted?: number[];
}

export interface TribeInfo {
  id: number;
  leaderId: number | null;
  state: TribeState;
}

export async function npcTribeOf(c: Db, npcId: number): Promise<TribeInfo | null> {
  const { rows } = await c.query(
    'SELECT t.id, t.leader_id, t.npc_state FROM players p JOIN tribes t ON t.id = p.tribe_id WHERE p.id = $1 AND t.is_npc',
    [npcId],
  );
  return rows[0] ? { id: rows[0].id, leaderId: rows[0].leader_id, state: rows[0].npc_state ?? {} } : null;
}

export async function saveTribeState(c: Db, tribe: TribeInfo) {
  await c.query('UPDATE tribes SET npc_state = $2::jsonb WHERE id = $1', [tribe.id, JSON.stringify(tribe.state)]);
}

/** Largeur de la fenêtre d'arrivée d'une opération : un quart d'heure, moins quand le monde va vite. */
export const opWindowMs = () => Math.max(60_000, (15 * 60_000) / Math.sqrt(env.worldSpeed));

/** Une attaque qui n'est pas un simple espionnage. */
const REAL_ATTACK = `(coalesce((cm.units->>'spearman')::int, 0) + coalesce((cm.units->>'swordsman')::int, 0) + coalesce((cm.units->>'cavalry')::int, 0)
  + coalesce((cm.units->>'ram')::int, 0) + coalesce((cm.units->>'noble')::int, 0)) > 0`;

/** Rayon (en cases) dans lequel un PNJ envoie du renfort à une tribu amie. */
const DEFENCE_RADIUS = 30;

/** Un PNJ envoie des renforts aux villages de sa tribu (ou d'une tribu alliée) menacés par une attaque qu'ils peuvent encore devancer. */
export async function defendStep(c: Db, outbox: Outbox, npcId: number, villageId: number, tribe: TribeInfo, now: Date) {
  const friends = [tribe.id, ...(tribe.state.allies ?? [])];
  const { rows } = await c.query(
    `SELECT cm.id, cm.arrive_at, v.id AS vid FROM commands cm
     JOIN villages v ON v.id = cm.target_village_id
     JOIN players o ON o.id = v.owner_id
     JOIN players a ON a.id = cm.player_id
     WHERE cm.type = 'attack' AND NOT cm.processed AND cm.arrive_at > $1 AND ${REAL_ATTACK}
       AND o.tribe_id = ANY($2::int[]) AND o.id <> $3
       AND (a.tribe_id IS NULL OR NOT (a.tribe_id = ANY($2::int[])))
       AND (v.x - (SELECT x FROM villages WHERE id = $4))^2 + (v.y - (SELECT y FROM villages WHERE id = $4))^2 <= $5
     ORDER BY cm.arrive_at LIMIT 3`,
    [now, friends, npcId, villageId, DEFENCE_RADIUS * DEFENCE_RADIUS],
  );
  if (!rows.length) return;
  const home = await loadVillage(c, villageId);
  for (const threat of rows) {
    const already = await c.query(
      "SELECT 1 FROM commands WHERE player_id = $1 AND type = 'support' AND target_village_id = $2 AND NOT processed LIMIT 1",
      [npcId, threat.vid],
    );
    if (already.rows.length) continue;
    const troops = await getTroops(c, villageId, villageId);
    // Les défenseurs partent, mais le village garde de quoi tenir : 60 % des lanciers, 30 % des épéistes.
    const units: UnitCounts = { ...emptyUnits(), spearman: Math.floor(troops.spearman * 0.6), swordsman: Math.floor(troops.swordsman * 0.3) };
    if (units.spearman + units.swordsman < 5) continue;
    const target = await loadVillage(c, threat.vid);
    const arrival = now.getTime() + travelTime(units, home, target, env.worldSpeed) * 1000;
    if (arrival >= new Date(threat.arrive_at).getTime() - 2_000) continue;
    try {
      await sendCommand(c, outbox, npcId, villageId, { type: 'support', targetId: threat.vid, units }, now);
    } catch (err) {
      if (!(err instanceof GameError)) throw err;
    }
  }
}

/**
 * Prévient les tribus de PNJ qu'on attaque l'un des leurs : leurs membres (et ceux des tribus alliées) se réveillent aussitôt,
 * au lieu d'attendre leur prochaine réflexion, pour avoir une chance d'envoyer du renfort à temps.
 */
export async function alertTribes(now: Date) {
  const tribes = (await pool.query('SELECT id, leader_id, npc_state FROM tribes WHERE is_npc')).rows;
  if (!tribes.length) return;
  const threats = (
    await pool.query(
      `SELECT cm.id, o.tribe_id FROM commands cm
       JOIN villages v ON v.id = cm.target_village_id JOIN players o ON o.id = v.owner_id JOIN players a ON a.id = cm.player_id
       WHERE cm.type = 'attack' AND NOT cm.processed AND cm.arrive_at > $1 AND ${REAL_ATTACK}
         AND o.tribe_id = ANY($2::int[]) AND (a.tribe_id IS NULL OR a.tribe_id <> o.tribe_id)`,
      [now, tribes.map((t) => t.id)],
    )
  ).rows;
  for (const t of tribes) {
    const state: TribeState = t.npc_state ?? {};
    const mine = threats.filter((r) => r.tribe_id === t.id).map((r) => r.id as number);
    const alerted = state.alerted ?? [];
    const fresh = mine.filter((id) => !alerted.includes(id));
    if (fresh.length === 0 && mine.length === alerted.length) continue;
    if (fresh.length) {
      await pool.query('UPDATE players SET npc_next_action_at = LEAST(npc_next_action_at, $2) WHERE is_npc AND tribe_id = ANY($1::int[])', [
        [t.id, ...(state.allies ?? [])],
        now,
      ]);
    }
    await pool.query('UPDATE tribes SET npc_state = $2::jsonb WHERE id = $1', [t.id, JSON.stringify({ ...state, alerted: mine })]);
  }
}
