import { pool, type Db } from '../db';
import { env } from '../env';
import { GRUDGE_DAYS, REAL_ATTACK, type TribeInfo } from './npc-tribes';

/**
 * Guerres entre tribus de PNJ. Une tribu déclare la guerre à une autre (la rivale en priorité) pour quelques jours réels : ses
 * membres frappent alors les villages ennemis, jusqu'à la conquête, puis une trêve s'installe avant la guerre suivante.
 * Les règles de choix sont pures (`planWars`) ; `refreshWars` ne fait que les lire et les écrire en base.
 * Le réglage `npcWars` de l'administration les coupe à chaud : sans guerre déclarée, les PNJ se comportent comme avant.
 */

/** Durée d'une guerre, en jours réels. */
export const WAR_DAYS = 4;
/** Trêve minimale entre deux guerres d'une même tribu, en jours réels. */
export const TRUCE_DAYS = 2;
/** Portée (en cases) dans laquelle un PNJ cherche des villages d'une tribu ennemie : plus large que celle d'un pillage. */
export const WAR_RADIUS = 40;

const DAY_MS = 86_400_000;
const HOUR_MS = 3_600_000;

export interface TribeWar {
  enemyId: number;
  /** Fin de la guerre (ISO). */
  until: string;
}

/** Ce que les règles ont besoin de savoir d'une tribu de PNJ. */
export interface WarTribe {
  id: number;
  allies: number[];
  rivals: number[];
  war: TribeWar | null;
  /** Date (ISO) à partir de laquelle la tribu peut déclarer une nouvelle guerre. */
  nextWarAt: string | null;
  /** Nombre de villages que possèdent ses membres. */
  villages: number;
}

export interface WarUpdate {
  id: number;
  war: TribeWar | null;
  nextWarAt: string | null;
}

/**
 * Décide des guerres à terminer et à déclarer. Une guerre est toujours réciproque. Une tribu sans village n'est ni belligérante ni
 * cible. Renvoie uniquement les tribus dont l'état change.
 */
export function planWars(tribes: WarTribe[], now: Date, rnd: () => number): WarUpdate[] {
  const state = new Map(tribes.map((t) => [t.id, { ...t }]));
  const changed = new Set<number>();
  const at = (ms: number) => new Date(now.getTime() + ms).toISOString();
  const peace = (t: WarTribe) => {
    t.war = null;
    t.nextWarAt = at((TRUCE_DAYS + rnd()) * DAY_MS);
    changed.add(t.id);
  };

  // 1. Fin des guerres échues, ou dont l'ennemi a disparu ou ne répond plus.
  for (const t of state.values()) {
    if (!t.war) continue;
    const enemy = state.get(t.war.enemyId);
    if (Date.parse(t.war.until) <= now.getTime() || !enemy || enemy.villages === 0 || enemy.war?.enemyId !== t.id) peace(t);
  }
  // 2. Une tribu qui n'a encore jamais reçu de date attend un peu avant sa première guerre.
  for (const t of state.values()) {
    if (!t.war && !t.nextWarAt) {
      t.nextWarAt = at(rnd() * DAY_MS);
      changed.add(t.id);
    }
  }
  // 3. Déclarations : la plus pressée d'abord, contre une tribu libre qui n'est pas son alliée, une rivale de préférence.
  const ready = [...state.values()]
    .filter((t) => !t.war && t.villages > 0 && t.nextWarAt !== null && Date.parse(t.nextWarAt) <= now.getTime())
    .sort((a, b) => Date.parse(a.nextWarAt!) - Date.parse(b.nextWarAt!) || a.id - b.id);
  for (const t of ready) {
    if (t.war) continue; // déjà entrée en guerre comme cible d'une autre déclaration
    const free = [...state.values()].filter((o) => o.id !== t.id && !o.war && o.villages > 0 && !t.allies.includes(o.id) && !o.allies.includes(t.id));
    const rivals = free.filter((o) => t.rivals.includes(o.id) || o.rivals.includes(t.id));
    const pool = rivals.length ? rivals : free;
    if (pool.length === 0) {
      t.nextWarAt = at(HOUR_MS);
      changed.add(t.id);
      continue;
    }
    const enemy = pool[Math.floor(rnd() * pool.length)];
    const until = at(WAR_DAYS * DAY_MS);
    t.war = { enemyId: enemy.id, until };
    enemy.war = { enemyId: t.id, until };
    t.nextWarAt = enemy.nextWarAt = null;
    changed.add(t.id).add(enemy.id);
  }
  return [...changed].sort((a, b) => a - b).map((id) => ({ id, war: state.get(id)!.war, nextWarAt: state.get(id)!.nextWarAt }));
}

export interface WarLogEntry {
  kind: 'declared' | 'ended';
  tribeA: number;
  tribeB: number;
}

/** Déclarations et fins de guerre que provoquent les mises à jour de `planWars` (une entrée par paire de tribus). */
export function warLogEntries(before: WarTribe[], updates: WarUpdate[]): WarLogEntry[] {
  const old = new Map(before.map((t) => [t.id, t.war]));
  const entries = new Map<string, WarLogEntry>();
  for (const u of updates) {
    const was = old.get(u.id) ?? null;
    if (!!was === !!u.war) continue;
    const enemy = (u.war ?? was)!.enemyId;
    const [a, b] = u.id < enemy ? [u.id, enemy] : [enemy, u.id];
    entries.set(`${u.war ? 'declared' : 'ended'}:${a}:${b}`, { kind: u.war ? 'declared' : 'ended', tribeA: a, tribeB: b });
  }
  return [...entries.values()];
}

/** Tribus ennemies de la tribu d'un PNJ en ce moment (vide si les guerres sont désactivées ou si la guerre est finie). */
export function warEnemiesOf(tribe: TribeInfo | null, now: Date): number[] {
  const war = tribe?.state.war;
  if (!env.npcWars || !war || Date.parse(war.until) <= now.getTime()) return [];
  return [war.enemyId];
}

/**
 * PNJ d'une autre tribu qui ont attaqué ce PNJ, sa tribu ou une tribu alliée au cours des trois derniers jours : ils ripostent contre eux.
 * Toujours active : l'interrupteur « Riposte des PNJ » ne coupe que la riposte contre les joueurs (voir `grudgesOf`).
 */
export async function npcGrudgesOf(c: Db, npcId: number, tribe: TribeInfo | null, now: Date): Promise<number[]> {
  const friends = tribe ? [tribe.id, ...(tribe.state.allies ?? [])] : [];
  const { rows } = await c.query(
    `SELECT DISTINCT cm.player_id FROM commands cm
     JOIN villages t ON t.id = cm.target_village_id
     JOIN players a ON a.id = cm.player_id
     WHERE cm.type = 'attack' AND a.is_npc AND a.id <> $2 AND cm.sent_at > $1 AND ${REAL_ATTACK}
       AND (a.tribe_id IS NULL OR NOT (a.tribe_id = ANY($3::int[])))
       AND (t.owner_id = $2 OR t.owner_id IN (SELECT id FROM players WHERE tribe_id = ANY($3::int[])))`,
    [new Date(now.getTime() - GRUDGE_DAYS * DAY_MS), npcId, friends],
  );
  return rows.map((r) => r.player_id as number);
}

/** Termine et déclare les guerres entre tribus de PNJ. À appeler à chaque passage des PNJ ; sans effet quand les guerres sont désactivées. */
export async function refreshWars(now: Date, rnd: () => number = Math.random) {
  if (!env.npcWars) return;
  const { rows } = await pool.query(
    `SELECT t.id, t.npc_state, (SELECT count(*)::int FROM villages v JOIN players p ON p.id = v.owner_id WHERE p.tribe_id = t.id) AS villages
     FROM tribes t WHERE t.is_npc ORDER BY t.id`,
  );
  const tribes: WarTribe[] = rows.map((r) => ({
    id: r.id,
    allies: r.npc_state?.allies ?? [],
    rivals: r.npc_state?.rivals ?? [],
    war: r.npc_state?.war ?? null,
    nextWarAt: r.npc_state?.nextWarAt ?? null,
    villages: r.villages,
  }));
  const updates = planWars(tribes, now, rnd);
  for (const e of warLogEntries(tribes, updates)) {
    await pool.query(
      `INSERT INTO npc_war_log (at, kind, tribe_a, tribe_b, tag_a, tag_b)
       VALUES ($1, $2, $3, $4, (SELECT tag FROM tribes WHERE id = $3), (SELECT tag FROM tribes WHERE id = $4))`,
      [now, e.kind, e.tribeA, e.tribeB],
    );
  }
  for (const u of updates) {
    await pool.query("UPDATE tribes SET npc_state = npc_state || jsonb_build_object('war', $2::jsonb, 'nextWarAt', $3::jsonb) WHERE id = $1", [
      u.id,
      JSON.stringify(u.war),
      JSON.stringify(u.nextWarAt),
    ]);
  }
}
