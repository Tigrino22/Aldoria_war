import { pool, type Db } from '../db';
import { env } from '../env';
import { GameError, forbidden } from '../errors';
import { Outbox } from '../notify';
import { WAR_DAYS } from './npc-wars';

/**
 * Guerres qui concernent une tribu de joueurs (table `tribe_wars`) :
 * - un chef de tribu déclare la guerre à une autre tribu, de joueurs ou de PNJ ;
 * - une tribu de PNJ déclare la guerre à une tribu de joueurs, sans provocation (réglage `npcPlayerWars`, indépendant de la riposte).
 * Contre une tribu de PNJ, ou depuis une tribu de PNJ, les membres du camp PNJ frappent les villages ennemis (voir `warEnemiesOf`).
 * Entre deux tribus de joueurs, la guerre est un état déclaré, visible des deux camps, sans effet mécanique.
 * Les règles de choix des PNJ (`planPlayerWars`) sont pures ; le reste lit et écrit la base.
 */

/** Durée d'une guerre, en jours réels (la même que celle des guerres entre PNJ). */
export const PLAYER_WAR_DAYS = WAR_DAYS;
/** Trêve minimale d'une tribu de PNJ entre la fin d'une guerre contre des joueurs et la suivante, en jours réels. */
export const PLAYER_WAR_TRUCE_DAYS = 3;
/** Guerres qu'une tribu peut déclarer en même temps. */
export const MAX_DECLARED_WARS = 3;

const DAY_MS = 86_400_000;
const HOUR_MS = 3_600_000;

export interface PlayerWarNpc {
  id: number;
  /** Date (ISO) à partir de laquelle la tribu peut déclarer une guerre à des joueurs. */
  nextAt: string | null;
  /** Village(s) que possèdent ses membres. */
  villages: number;
  /** Elle a déjà une guerre en cours avec une tribu de joueurs. */
  busy: boolean;
}

export interface PlayerWarPlan {
  declare: { npcId: number; targetId: number }[];
  reschedule: { npcId: number; nextAt: string }[];
}

/**
 * Décide quelles tribus de PNJ déclarent la guerre à quelle tribu de joueurs. `targets` ne contient que des tribus de joueurs
 * libres (aucune guerre contre un PNJ en cours) avec au moins un village attaquable (hors protection des débutants).
 * Une tribu qui n'a pas encore de date attend jusqu'à un jour ; sans cible, elle réessaie une heure plus tard.
 */
export function planPlayerWars(npcs: PlayerWarNpc[], targets: number[], now: Date, rnd: () => number): PlayerWarPlan {
  const plan: PlayerWarPlan = { declare: [], reschedule: [] };
  const at = (ms: number) => new Date(now.getTime() + ms).toISOString();
  const free = [...targets];
  const order = [...npcs].filter((n) => !n.busy && n.villages > 0).sort((a, b) => (a.nextAt ?? '').localeCompare(b.nextAt ?? '') || a.id - b.id);
  for (const npc of order) {
    if (!npc.nextAt) {
      plan.reschedule.push({ npcId: npc.id, nextAt: at(rnd() * DAY_MS) });
    } else if (Date.parse(npc.nextAt) <= now.getTime()) {
      if (free.length === 0) {
        plan.reschedule.push({ npcId: npc.id, nextAt: at(HOUR_MS) });
        continue;
      }
      const targetId = free.splice(Math.floor(rnd() * free.length), 1)[0];
      plan.declare.push({ npcId: npc.id, targetId });
      plan.reschedule.push({ npcId: npc.id, nextAt: at((PLAYER_WAR_DAYS + PLAYER_WAR_TRUCE_DAYS + rnd()) * DAY_MS) });
    }
  }
  return plan;
}

/** Message de la tribu qui déclare (ou termine) la guerre à tous les membres joueurs d'une tribu. */
async function notifyMembers(c: Pick<Db, 'query'>, outbox: Outbox, tribeId: number, fromId: number | null, subject: string, body: string) {
  const members = (await c.query('SELECT id FROM players WHERE tribe_id = $1 AND NOT is_npc', [tribeId])).rows;
  const from = fromId ? ((await c.query('SELECT username FROM players WHERE id = $1', [fromId])).rows[0]?.username as string | undefined) : undefined;
  for (const m of members) {
    await c.query('INSERT INTO messages (from_id, to_id, subject, body) VALUES ($1, $2, $3, $4)', [fromId, m.id, subject, body]);
    outbox.push(m.id, { type: 'message', from: from ?? 'Guerre' });
  }
}

const tribeLabel = (t: { tag: string; name: string }) => `[${t.tag}] ${t.name}`;

export interface TribeWarLine {
  id: number;
  other: { id: number; tag: string; name: string; isNpc: boolean; members: number; villages: number; points: number };
  /** `declared` : déclarée par notre tribu ; `received` : déclarée contre nous. */
  direction: 'declared' | 'received';
  declaredBy: string | null;
  startedAt: string;
  until: string;
  endedAt: string | null;
}

export interface TribeWarsView {
  isLeader: boolean;
  /** Les guerres entre PNJ et joueurs sont-elles activées dans ce monde ? */
  npcWarsEnabled: boolean;
  active: TribeWarLine[];
  /** Guerres terminées depuis une semaine. */
  recent: TribeWarLine[];
  /** Tribus à qui l'on peut déclarer la guerre (aucune guerre en cours avec elles). */
  targets: { id: number; tag: string; name: string; isNpc: boolean; members: number; points: number }[];
  canDeclare: boolean;
  declaredCount: number;
  maxDeclared: number;
  durationDays: number;
}

async function leaderOf(c: Pick<Db, 'query'>, playerId: number) {
  const { rows } = await c.query('SELECT p.tribe_id, t.leader_id FROM players p LEFT JOIN tribes t ON t.id = p.tribe_id WHERE p.id = $1', [playerId]);
  return { tribeId: (rows[0]?.tribe_id ?? null) as number | null, isLeader: rows[0]?.leader_id === playerId };
}

/** Vue de l'onglet « Guerres » d'une tribu : guerres en cours (déclarées ou subies), récentes et cibles possibles. */
export async function tribeWarsView(c: Pick<Db, 'query'>, playerId: number, now: Date): Promise<TribeWarsView> {
  const { tribeId, isLeader } = await leaderOf(c, playerId);
  if (!tribeId) throw new GameError("Vous n'avez pas de tribu");
  const lines = (
    await c.query(
      `SELECT w.id, w.declarer_id, w.target_id, w.started_at, w.until, w.ended_at, dp.username AS declared_by,
              o.id AS oid, o.tag, o.name, o.is_npc,
              (SELECT count(*)::int FROM players p WHERE p.tribe_id = o.id) AS members,
              (SELECT count(*)::int FROM villages v JOIN players p ON p.id = v.owner_id WHERE p.tribe_id = o.id) AS villages,
              (SELECT coalesce(sum(v.points), 0)::int FROM villages v JOIN players p ON p.id = v.owner_id WHERE p.tribe_id = o.id) AS points
       FROM tribe_wars w
       JOIN tribes o ON o.id = CASE WHEN w.declarer_id = $1 THEN w.target_id ELSE w.declarer_id END
       LEFT JOIN players dp ON dp.id = w.declared_by
       WHERE (w.declarer_id = $1 OR w.target_id = $1) AND (w.ended_at IS NULL OR w.ended_at > $2)
       ORDER BY w.started_at DESC`,
      [tribeId, new Date(now.getTime() - 7 * DAY_MS)],
    )
  ).rows;
  const line = (r: (typeof lines)[number]): TribeWarLine => ({
    id: r.id,
    other: { id: r.oid, tag: r.tag, name: r.name, isNpc: r.is_npc, members: r.members, villages: r.villages, points: r.points },
    direction: r.declarer_id === tribeId ? 'declared' : 'received',
    declaredBy: r.declared_by,
    startedAt: new Date(r.started_at).toISOString(),
    until: new Date(r.until).toISOString(),
    endedAt: r.ended_at ? new Date(r.ended_at).toISOString() : null,
  });
  const isActive = (r: (typeof lines)[number]) => !r.ended_at && new Date(r.until).getTime() > now.getTime();
  const active = lines.filter(isActive).map(line);
  const busy = new Set(active.map((l) => l.other.id));
  const targets = (
    await c.query(
      `SELECT t.id, t.tag, t.name, t.is_npc,
              (SELECT count(*)::int FROM players p WHERE p.tribe_id = t.id) AS members,
              (SELECT coalesce(sum(v.points), 0)::int FROM villages v JOIN players p ON p.id = v.owner_id WHERE p.tribe_id = t.id) AS points
       FROM tribes t WHERE t.id <> $1 AND EXISTS (SELECT 1 FROM villages v JOIN players p ON p.id = v.owner_id WHERE p.tribe_id = t.id)
       ORDER BY points DESC, t.id LIMIT 200`,
      [tribeId],
    )
  ).rows
    .filter((t) => !busy.has(t.id))
    .map((t) => ({ id: t.id, tag: t.tag, name: t.name, isNpc: t.is_npc, members: t.members, points: t.points }));
  const declaredCount = active.filter((l) => l.direction === 'declared').length;
  return {
    isLeader,
    npcWarsEnabled: !!env.npcWars && !!env.npcPlayerWars,
    active,
    recent: lines.filter((r) => !isActive(r)).map(line),
    targets,
    canDeclare: isLeader && declaredCount < MAX_DECLARED_WARS,
    declaredCount,
    maxDeclared: MAX_DECLARED_WARS,
    durationDays: PLAYER_WAR_DAYS,
  };
}

/** Le chef de tribu déclare la guerre à une autre tribu. Renvoie l'identifiant de la guerre. */
export async function declareWar(c: Db, outbox: Outbox, playerId: number, targetId: number, now: Date): Promise<number> {
  const { tribeId, isLeader } = await leaderOf(c, playerId);
  if (!tribeId) throw new GameError("Vous n'avez pas de tribu");
  if (!isLeader) throw forbidden('Seul le chef de tribu peut déclarer la guerre');
  if (targetId === tribeId) throw new GameError('Vous ne pouvez pas déclarer la guerre à votre propre tribu');
  const target = (await c.query('SELECT id, tag, name, is_npc, leader_id FROM tribes WHERE id = $1', [targetId])).rows[0];
  if (!target) throw new GameError('Tribu introuvable');
  const villages = (await c.query('SELECT count(*)::int AS n FROM villages v JOIN players p ON p.id = v.owner_id WHERE p.tribe_id = $1', [targetId])).rows[0].n as number;
  if (villages === 0) throw new GameError("Cette tribu n'a plus de village");
  if (target.is_npc && !(env.npcWars && env.npcPlayerWars)) throw new GameError('Les guerres contre les tribus de PNJ sont désactivées dans ce monde');
  const mine = (await c.query('SELECT id, tag, name FROM tribes WHERE id = $1 FOR UPDATE', [tribeId])).rows[0];
  const existing = await c.query(
    `SELECT 1 FROM tribe_wars WHERE ended_at IS NULL AND until > $3 AND ((declarer_id = $1 AND target_id = $2) OR (declarer_id = $2 AND target_id = $1))`,
    [tribeId, targetId, now],
  );
  if (existing.rows.length) throw new GameError('Une guerre est déjà en cours avec cette tribu');
  const declared = (await c.query('SELECT count(*)::int AS n FROM tribe_wars WHERE declarer_id = $1 AND ended_at IS NULL AND until > $2', [tribeId, now])).rows[0].n as number;
  if (declared >= MAX_DECLARED_WARS) throw new GameError(`Votre tribu ne peut pas déclarer plus de ${MAX_DECLARED_WARS} guerres en même temps`);

  const until = new Date(now.getTime() + PLAYER_WAR_DAYS * DAY_MS);
  const id = (
    await c.query('INSERT INTO tribe_wars (declarer_id, target_id, declared_by, started_at, until) VALUES ($1, $2, $3, $4, $5) RETURNING id', [tribeId, targetId, playerId, now, until])
  ).rows[0].id as number;
  if (!target.is_npc) {
    await notifyMembers(
      c,
      outbox,
      targetId,
      playerId,
      `[Guerre] ${tribeLabel(mine)} vous déclare la guerre`,
      `La tribu ${tribeLabel(mine)} vient de déclarer la guerre à ${tribeLabel(target)}. La guerre dure ${PLAYER_WAR_DAYS} jours, jusqu'au ${until.toLocaleString('fr-FR', { timeZone: env.npcTimezone })}. Elle est visible dans l'onglet « Guerres » de la page Tribu.`,
    );
  }
  return id;
}

/** Le chef de la tribu qui a déclaré une guerre y met fin tout de suite. */
export async function endWar(c: Db, outbox: Outbox, playerId: number, warId: number, now: Date) {
  const { tribeId, isLeader } = await leaderOf(c, playerId);
  if (!tribeId || !isLeader) throw forbidden('Seul le chef de tribu peut mettre fin à une guerre');
  const war = (await c.query('SELECT * FROM tribe_wars WHERE id = $1 FOR UPDATE', [warId])).rows[0];
  if (!war || war.declarer_id !== tribeId) throw new GameError('Seule la tribu qui a déclaré la guerre peut y mettre fin');
  if (war.ended_at || new Date(war.until).getTime() <= now.getTime()) throw new GameError('Cette guerre est déjà terminée');
  await c.query('UPDATE tribe_wars SET ended_at = $2 WHERE id = $1', [warId, now]);
  const mine = (await c.query('SELECT tag, name FROM tribes WHERE id = $1', [tribeId])).rows[0];
  const target = (await c.query('SELECT tag, name, is_npc FROM tribes WHERE id = $1', [war.target_id])).rows[0];
  if (target && !target.is_npc) {
    await notifyMembers(c, outbox, war.target_id, playerId, `[Guerre] ${tribeLabel(mine)} met fin à la guerre`, `La tribu ${tribeLabel(mine)} a mis fin à la guerre qu'elle avait déclarée à ${tribeLabel(target)}.`);
  }
}

/**
 * Termine les guerres échues (avec un message aux tribus de joueurs concernées) et, quand les guerres contre les joueurs
 * sont activées, laisse les tribus de PNJ en déclarer de nouvelles. À appeler à chaque passage des PNJ.
 */
export async function refreshTribeWars(now: Date, rnd: () => number = Math.random) {
  const outbox = new Outbox();
  const ended = await pool.query(
    `UPDATE tribe_wars SET ended_at = until WHERE ended_at IS NULL AND until <= $1
     RETURNING declarer_id, target_id`,
    [now],
  );
  for (const w of ended.rows) {
    const [a, b] = await Promise.all(
      [w.declarer_id, w.target_id].map(async (id) => (await pool.query('SELECT id, tag, name, is_npc, leader_id FROM tribes WHERE id = $1', [id])).rows[0]),
    );
    if (!a || !b) continue;
    for (const [mine, other] of [[a, b], [b, a]] as const) {
      if (!mine.is_npc) {
        await notifyMembers(pool, outbox, mine.id, other.is_npc ? other.leader_id : null, `[Guerre] Fin de la guerre contre ${tribeLabel(other)}`, `La guerre entre ${tribeLabel(a)} et ${tribeLabel(b)} est terminée.`);
      }
    }
  }
  outbox.flush();
  if (!env.npcWars || !env.npcPlayerWars) return;

  const npcRows = (
    await pool.query(
      `SELECT t.id, t.npc_state->>'nextPlayerWarAt' AS next_at,
              (SELECT count(*)::int FROM villages v JOIN players p ON p.id = v.owner_id WHERE p.tribe_id = t.id) AS villages,
              EXISTS (SELECT 1 FROM tribe_wars w JOIN tribes o ON o.id = CASE WHEN w.declarer_id = t.id THEN w.target_id ELSE w.declarer_id END
                      WHERE (w.declarer_id = t.id OR w.target_id = t.id) AND w.ended_at IS NULL AND w.until > $1 AND NOT o.is_npc) AS busy
       FROM tribes t WHERE t.is_npc ORDER BY t.id`,
      [now],
    )
  ).rows;
  // Tribus de joueurs libres : aucune guerre en cours contre un PNJ, au moins un village hors protection des débutants.
  const targets = (
    await pool.query(
      `SELECT t.id FROM tribes t
       WHERE NOT t.is_npc
         AND EXISTS (SELECT 1 FROM villages v JOIN players p ON p.id = v.owner_id
                     WHERE p.tribe_id = t.id AND (p.protection_until IS NULL OR p.protection_until <= $1))
         AND NOT EXISTS (SELECT 1 FROM tribe_wars w JOIN tribes o ON o.id = CASE WHEN w.declarer_id = t.id THEN w.target_id ELSE w.declarer_id END
                         WHERE (w.declarer_id = t.id OR w.target_id = t.id) AND w.ended_at IS NULL AND w.until > $1 AND o.is_npc)
       ORDER BY t.id`,
      [now],
    )
  ).rows.map((r) => r.id as number);
  const plan = planPlayerWars(
    npcRows.map((r) => ({ id: r.id, nextAt: r.next_at, villages: r.villages, busy: r.busy })),
    targets,
    now,
    rnd,
  );
  for (const r of plan.reschedule) {
    await pool.query("UPDATE tribes SET npc_state = npc_state || jsonb_build_object('nextPlayerWarAt', $2::text) WHERE id = $1", [r.npcId, r.nextAt]);
  }
  for (const d of plan.declare) {
    const until = new Date(now.getTime() + PLAYER_WAR_DAYS * DAY_MS);
    await pool.query('INSERT INTO tribe_wars (declarer_id, target_id, declared_by, started_at, until) VALUES ($1, $2, NULL, $3, $4)', [d.npcId, d.targetId, now, until]);
    const [npc, target] = await Promise.all([d.npcId, d.targetId].map(async (id) => (await pool.query('SELECT tag, name, leader_id FROM tribes WHERE id = $1', [id])).rows[0]));
    const out = new Outbox();
    await notifyMembers(
      pool,
      out,
      d.targetId,
      npc.leader_id,
      `[Guerre] ${tribeLabel(npc)} vous déclare la guerre`,
      `La tribu de PNJ ${tribeLabel(npc)} déclare la guerre à ${tribeLabel(target)} pour ${PLAYER_WAR_DAYS} jours : ses membres vont frapper vos villages (jamais pendant les heures calmes). Surveillez l'onglet « Guerres » de la page Tribu.`,
    );
    out.flush();
  }
}
