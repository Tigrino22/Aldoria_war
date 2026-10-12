import type { Db } from '../db';
import { GameError, forbidden } from '../errors';
import type { Outbox } from '../notify';

/**
 * Alliances entre tribus de joueurs (tables `tribe_alliances` et `tribe_alliance_invites`) :
 * - le chef d'une tribu propose une alliance à une autre tribu de joueurs ;
 * - le chef de la tribu invitée l'accepte ou la refuse ; le chef qui l'a envoyée peut la retirer ;
 * - l'alliance est symétrique et l'un ou l'autre chef peut la rompre à tout moment.
 * Une seule proposition en attente par paire de tribus, pas d'alliance avec une tribu en guerre ni avec une tribu de PNJ.
 * Les alliés apparaissent en bleu ciel sur la carte (`allyTribeIdsOf`).
 */

/** Alliances qu'une tribu peut avoir en même temps. */
export const MAX_ALLIES = 5;

type Q = Pick<Db, 'query'>;

export interface AllianceTribe {
  id: number;
  tag: string;
  name: string;
  members: number;
  villages: number;
  points: number;
}

export interface AllianceLine {
  id: number;
  tribe: AllianceTribe;
  /** Joueur qui a envoyé la proposition (ou conclu l'alliance). */
  by: string | null;
  at: string;
}

export interface TribeAlliancesView {
  isLeader: boolean;
  allies: AllianceLine[];
  /** Propositions reçues, à accepter ou refuser par le chef. */
  received: AllianceLine[];
  /** Propositions envoyées, en attente de réponse. */
  sent: AllianceLine[];
  /** Tribus de joueurs à qui l'on peut proposer une alliance. */
  candidates: AllianceTribe[];
  maxAllies: number;
}

const tribeLabel = (t: { tag: string; name: string }) => `[${t.tag}] ${t.name}`;
const pair = (a: number, b: number) => (a < b ? [a, b] : [b, a]);

const TRIBE_STATS = `
  (SELECT count(*)::int FROM players p WHERE p.tribe_id = t.id) AS members,
  (SELECT count(*)::int FROM villages v JOIN players p ON p.id = v.owner_id WHERE p.tribe_id = t.id) AS villages,
  (SELECT coalesce(sum(v.points), 0)::int FROM villages v JOIN players p ON p.id = v.owner_id WHERE p.tribe_id = t.id) AS points`;

const tribeOf = (r: any): AllianceTribe => ({ id: r.tid, tag: r.tag, name: r.name, members: r.members, villages: r.villages, points: r.points });

async function leaderOf(c: Q, playerId: number) {
  const { rows } = await c.query('SELECT p.tribe_id, t.leader_id FROM players p LEFT JOIN tribes t ON t.id = p.tribe_id WHERE p.id = $1', [playerId]);
  return { tribeId: (rows[0]?.tribe_id ?? null) as number | null, isLeader: rows[0]?.leader_id === playerId };
}

async function requireLeader(c: Q, playerId: number) {
  const { tribeId, isLeader } = await leaderOf(c, playerId);
  if (!tribeId) throw new GameError("Vous n'avez pas de tribu");
  if (!isLeader) throw forbidden('Seul le chef de tribu peut gérer les alliances');
  return tribeId;
}

/** Message à tous les membres joueurs d'une tribu. */
async function notifyMembers(c: Q, outbox: Outbox, tribeId: number, fromId: number | null, subject: string, body: string) {
  const members = (await c.query('SELECT id FROM players WHERE tribe_id = $1 AND NOT is_npc', [tribeId])).rows;
  const from = fromId ? ((await c.query('SELECT username FROM players WHERE id = $1', [fromId])).rows[0]?.username as string | undefined) : undefined;
  for (const m of members) {
    await c.query('INSERT INTO messages (from_id, to_id, subject, body) VALUES ($1, $2, $3, $4)', [fromId, m.id, subject, body]);
    outbox.push(m.id, { type: 'message', from: from ?? 'Alliance' });
  }
}

/** Message au seul chef d'une tribu. */
async function notifyLeader(c: Q, outbox: Outbox, tribeId: number, fromId: number, subject: string, body: string) {
  const t = (await c.query('SELECT leader_id FROM tribes WHERE id = $1', [tribeId])).rows[0];
  if (!t?.leader_id) return;
  const from = (await c.query('SELECT username FROM players WHERE id = $1', [fromId])).rows[0]?.username as string;
  await c.query('INSERT INTO messages (from_id, to_id, subject, body) VALUES ($1, $2, $3, $4)', [fromId, t.leader_id, subject, body]);
  outbox.push(t.leader_id, { type: 'message', from });
}

/** Identifiants des tribus alliées à une tribu. */
export async function allyTribeIdsOf(c: Q, tribeId: number | null): Promise<number[]> {
  if (!tribeId) return [];
  const { rows } = await c.query('SELECT CASE WHEN tribe_a = $1 THEN tribe_b ELSE tribe_a END AS id FROM tribe_alliances WHERE $1 IN (tribe_a, tribe_b) ORDER BY id', [tribeId]);
  return rows.map((r) => r.id as number);
}

/** Les deux tribus sont-elles alliées ? */
export async function areAllied(c: Q, a: number, b: number): Promise<boolean> {
  const [x, y] = pair(a, b);
  return (await c.query('SELECT 1 FROM tribe_alliances WHERE tribe_a = $1 AND tribe_b = $2', [x, y])).rows.length > 0;
}

async function atWar(c: Q, a: number, b: number, now: Date) {
  const { rows } = await c.query(
    `SELECT 1 FROM tribe_wars WHERE ended_at IS NULL AND until > $3 AND ((declarer_id = $1 AND target_id = $2) OR (declarer_id = $2 AND target_id = $1))`,
    [a, b, now],
  );
  return rows.length > 0;
}

/** Vue de l'onglet « Alliances » : alliés, propositions reçues et envoyées, tribus à qui proposer une alliance. */
export async function tribeAlliancesView(c: Q, playerId: number, now: Date): Promise<TribeAlliancesView> {
  const { tribeId, isLeader } = await leaderOf(c, playerId);
  if (!tribeId) throw new GameError("Vous n'avez pas de tribu");
  const allies = (
    await c.query(
      `SELECT a.id, a.created_at AS at, p.username AS by, t.id AS tid, t.tag, t.name, ${TRIBE_STATS}
       FROM tribe_alliances a JOIN tribes t ON t.id = CASE WHEN a.tribe_a = $1 THEN a.tribe_b ELSE a.tribe_a END
       LEFT JOIN players p ON p.id = a.created_by
       WHERE $1 IN (a.tribe_a, a.tribe_b) ORDER BY a.created_at, a.id`,
      [tribeId],
    )
  ).rows;
  const invites = (
    await c.query(
      `SELECT i.id, i.created_at AS at, i.from_tribe, p.username AS by, t.id AS tid, t.tag, t.name, ${TRIBE_STATS}
       FROM tribe_alliance_invites i JOIN tribes t ON t.id = CASE WHEN i.from_tribe = $1 THEN i.to_tribe ELSE i.from_tribe END
       LEFT JOIN players p ON p.id = i.invited_by
       WHERE $1 IN (i.from_tribe, i.to_tribe) ORDER BY i.created_at DESC, i.id DESC`,
      [tribeId],
    )
  ).rows;
  const line = (r: any): AllianceLine => ({ id: r.id, tribe: tribeOf(r), by: r.by ?? null, at: new Date(r.at).toISOString() });
  const taken = new Set([tribeId, ...allies.map((r) => r.tid as number), ...invites.map((r) => r.tid as number)]);
  const enemies = new Set(
    (
      await c.query(
        `SELECT CASE WHEN declarer_id = $1 THEN target_id ELSE declarer_id END AS id FROM tribe_wars
         WHERE $1 IN (declarer_id, target_id) AND ended_at IS NULL AND until > $2`,
        [tribeId, now],
      )
    ).rows.map((r) => r.id as number),
  );
  const candidates = (
    await c.query(
      `SELECT t.id AS tid, t.tag, t.name, ${TRIBE_STATS} FROM tribes t
       WHERE NOT t.is_npc AND t.id <> $1 ORDER BY points DESC, t.id LIMIT 200`,
      [tribeId],
    )
  ).rows
    .filter((r) => !taken.has(r.tid) && !enemies.has(r.tid))
    .map(tribeOf);
  return {
    isLeader,
    allies: allies.map(line),
    received: invites.filter((r) => r.from_tribe !== tribeId).map(line),
    sent: invites.filter((r) => r.from_tribe === tribeId).map(line),
    candidates,
    maxAllies: MAX_ALLIES,
  };
}

/** Le chef de tribu propose une alliance à une autre tribu de joueurs. Renvoie l'identifiant de la proposition. */
export async function proposeAlliance(c: Db, outbox: Outbox, playerId: number, targetId: number, now: Date): Promise<number> {
  const tribeId = await requireLeader(c, playerId);
  if (targetId === tribeId) throw new GameError('Votre tribu ne peut pas s’allier avec elle-même');
  const target = (await c.query('SELECT id, tag, name, is_npc FROM tribes WHERE id = $1', [targetId])).rows[0];
  if (!target) throw new GameError('Tribu introuvable');
  if (target.is_npc) throw new GameError('Les tribus de PNJ ne concluent pas d’alliance avec les joueurs');
  const mine = (await c.query('SELECT id, tag, name FROM tribes WHERE id = $1 FOR UPDATE', [tribeId])).rows[0];
  if (await areAllied(c, tribeId, targetId)) throw new GameError('Vos tribus sont déjà alliées');
  if (await atWar(c, tribeId, targetId, now)) throw new GameError('Vos tribus sont en guerre : mettez d’abord fin à la guerre');
  const pending = (
    await c.query('SELECT from_tribe FROM tribe_alliance_invites WHERE (from_tribe = $1 AND to_tribe = $2) OR (from_tribe = $2 AND to_tribe = $1)', [tribeId, targetId])
  ).rows[0];
  if (pending) {
    throw new GameError(pending.from_tribe === tribeId ? 'Une proposition est déjà en attente auprès de cette tribu' : 'Cette tribu vous a déjà proposé une alliance : acceptez-la');
  }
  if ((await allyTribeIdsOf(c, tribeId)).length >= MAX_ALLIES) throw new GameError(`Votre tribu ne peut pas avoir plus de ${MAX_ALLIES} alliées`);
  const id = (await c.query('INSERT INTO tribe_alliance_invites (from_tribe, to_tribe, invited_by, created_at) VALUES ($1, $2, $3, $4) RETURNING id', [tribeId, targetId, playerId, now]))
    .rows[0].id as number;
  await notifyLeader(
    c,
    outbox,
    targetId,
    playerId,
    `[Alliance] ${tribeLabel(mine)} vous propose une alliance`,
    `La tribu ${tribeLabel(mine)} propose une alliance à ${tribeLabel(target)}. Acceptez ou refusez-la dans l'onglet « Alliances » de la page Tribu. Une fois alliées, vos deux tribus apparaissent en bleu ciel sur la carte de leurs membres.`,
  );
  return id;
}

/** Le chef de la tribu invitée accepte ou refuse une proposition d'alliance. */
export async function answerAlliance(c: Db, outbox: Outbox, playerId: number, inviteId: number, accept: boolean, now: Date) {
  const tribeId = await requireLeader(c, playerId);
  const invite = (await c.query('SELECT * FROM tribe_alliance_invites WHERE id = $1 FOR UPDATE', [inviteId])).rows[0];
  if (!invite || invite.to_tribe !== tribeId) throw new GameError('Proposition d’alliance introuvable');
  await c.query('DELETE FROM tribe_alliance_invites WHERE id = $1', [inviteId]);
  const [mine, other] = await Promise.all([tribeId, invite.from_tribe].map(async (id) => (await c.query('SELECT id, tag, name FROM tribes WHERE id = $1', [id])).rows[0]));
  if (!accept) {
    await notifyLeader(c, outbox, other.id, playerId, `[Alliance] ${tribeLabel(mine)} refuse votre alliance`, `La tribu ${tribeLabel(mine)} a refusé l'alliance que vous lui proposiez.`);
    return;
  }
  if (await atWar(c, tribeId, other.id, now)) throw new GameError('Vos tribus sont en guerre : mettez d’abord fin à la guerre');
  if ((await allyTribeIdsOf(c, tribeId)).length >= MAX_ALLIES) throw new GameError(`Votre tribu ne peut pas avoir plus de ${MAX_ALLIES} alliées`);
  if ((await allyTribeIdsOf(c, other.id)).length >= MAX_ALLIES) throw new GameError(`${tribeLabel(other)} a déjà ${MAX_ALLIES} alliées`);
  const [a, b] = pair(tribeId, other.id);
  await c.query('INSERT INTO tribe_alliances (tribe_a, tribe_b, created_by, created_at) VALUES ($1, $2, $3, $4) ON CONFLICT DO NOTHING', [a, b, invite.invited_by, now]);
  const body = `Les tribus ${tribeLabel(other)} et ${tribeLabel(mine)} sont désormais alliées. Les villages de vos alliés apparaissent en bleu ciel sur la carte.`;
  for (const t of [mine, other]) await notifyMembers(c, outbox, t.id, playerId, `[Alliance] Alliance conclue avec ${tribeLabel(t === mine ? other : mine)}`, body);
}

/** Le chef qui a envoyé une proposition la retire. */
export async function cancelAllianceInvite(c: Db, playerId: number, inviteId: number) {
  const tribeId = await requireLeader(c, playerId);
  const { rowCount } = await c.query('DELETE FROM tribe_alliance_invites WHERE id = $1 AND from_tribe = $2', [inviteId, tribeId]);
  if (!rowCount) throw new GameError('Proposition d’alliance introuvable');
}

/** L'un ou l'autre chef rompt une alliance ; les membres des deux tribus sont prévenus. */
export async function breakAlliance(c: Db, outbox: Outbox, playerId: number, otherTribeId: number) {
  const tribeId = await requireLeader(c, playerId);
  const [a, b] = pair(tribeId, otherTribeId);
  const { rowCount } = await c.query('DELETE FROM tribe_alliances WHERE tribe_a = $1 AND tribe_b = $2', [a, b]);
  if (!rowCount) throw new GameError('Vos tribus ne sont pas alliées');
  const [mine, other] = await Promise.all([tribeId, otherTribeId].map(async (id) => (await c.query('SELECT id, tag, name FROM tribes WHERE id = $1', [id])).rows[0]));
  const body = `La tribu ${tribeLabel(mine)} a rompu son alliance avec ${tribeLabel(other)}.`;
  for (const t of [mine, other]) await notifyMembers(c, outbox, t.id, playerId, `[Alliance] Fin de l'alliance avec ${tribeLabel(t === mine ? other : mine)}`, body);
}

/** Relation de la tribu du joueur avec une autre tribu, pour la page publique d'une tribu. */
export async function allianceRelation(c: Q, playerId: number, otherTribeId: number, now: Date) {
  const { tribeId, isLeader } = await leaderOf(c, playerId);
  if (!tribeId || tribeId === otherTribeId) return { relation: tribeId ? ('self' as const) : null, canPropose: false };
  if (await areAllied(c, tribeId, otherTribeId)) return { relation: 'ally' as const, canPropose: false };
  if (await atWar(c, tribeId, otherTribeId, now)) return { relation: 'war' as const, canPropose: false };
  const pending = (
    await c.query('SELECT id, from_tribe FROM tribe_alliance_invites WHERE (from_tribe = $1 AND to_tribe = $2) OR (from_tribe = $2 AND to_tribe = $1)', [tribeId, otherTribeId])
  ).rows[0];
  if (pending) {
    const received = pending.from_tribe !== tribeId;
    return { relation: received ? ('received' as const) : ('sent' as const), inviteId: pending.id as number, canPropose: false, canAnswer: received && isLeader };
  }
  const other = (await c.query('SELECT is_npc FROM tribes WHERE id = $1', [otherTribeId])).rows[0];
  return { relation: null, canPropose: isLeader && !!other && !other.is_npc };
}
