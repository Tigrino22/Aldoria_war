import type { ModerationReportInput, ModerationReportView, ModerationStatus } from '@aldoria/shared';
import type { Db } from '../db';
import { GameError, notFound } from '../errors';

/**
 * Signalements : un joueur signale un joueur, un message qu'il a reçu ou une tribu ; l'administration les traite.
 * Seul le message signalé (ou la présentation du joueur signalé) est recopié : l'administration ne lit jamais la messagerie elle-même.
 */

/** Signalements qu'un joueur peut envoyer par période glissante, pour éviter les avalanches. */
export const REPORTS_PER_DAY = 20;

interface Target {
  playerId: number | null;
  tribeId: number | null;
  name: string;
  message: { id: number; subject: string; body: string } | null;
  /** Présentation du joueur visé, recopiée telle qu'elle était au moment du signalement. */
  bio: string | null;
}

async function resolveTarget(c: Db, reporterId: number, input: ModerationReportInput): Promise<Target> {
  if (input.kind === 'player') {
    const p = (await c.query('SELECT id, username, is_npc, bio FROM players WHERE lower(username) = lower($1)', [String(input.target)])).rows[0];
    if (!p) throw notFound('Joueur introuvable');
    if (p.id === reporterId) throw new GameError('Vous ne pouvez pas vous signaler vous-même');
    return { playerId: p.id, tribeId: null, name: p.username, message: null, bio: p.bio || null };
  }
  if (input.kind === 'message') {
    // Seul le destinataire peut signaler un message : c'est lui qui choisit de le montrer à l'administration.
    const m = (
      await c.query(
        `SELECT m.id, m.subject, m.body, m.from_id, pf.username AS from_name
         FROM messages m LEFT JOIN players pf ON pf.id = m.from_id WHERE m.id = $1 AND m.to_id = $2`,
        [Number(input.target), reporterId],
      )
    ).rows[0];
    if (!m) throw notFound('Message introuvable');
    if (m.from_id === reporterId) throw new GameError('Vous ne pouvez pas signaler votre propre message');
    return { playerId: m.from_id, tribeId: null, name: m.from_name ?? 'joueur supprimé', message: { id: m.id, subject: m.subject, body: m.body }, bio: null };
  }
  const t = (await c.query('SELECT id, tag, name FROM tribes WHERE id = $1', [Number(input.target)])).rows[0];
  if (!t) throw notFound('Tribu introuvable');
  return { playerId: null, tribeId: t.id, name: `[${t.tag}] ${t.name}`, message: null, bio: null };
}

export async function createModerationReport(c: Db, reporterId: number, input: ModerationReportInput, now: Date): Promise<number> {
  const reporter = (await c.query('SELECT username FROM players WHERE id = $1', [reporterId])).rows[0];
  if (!reporter) throw notFound('Joueur introuvable');
  const recent = (
    await c.query("SELECT count(*)::int AS n FROM moderation_reports WHERE reporter_id = $1 AND created_at > $2::timestamptz - interval '1 day'", [reporterId, now])
  ).rows[0].n as number;
  if (recent >= REPORTS_PER_DAY) throw new GameError(`${REPORTS_PER_DAY} signalements par jour au plus : réessayez plus tard`);

  const target = await resolveTarget(c, reporterId, input);
  // Un même joueur ne signale pas deux fois la même chose tant que le premier signalement attend.
  const duplicate = (
    await c.query(
      `SELECT 1 FROM moderation_reports WHERE reporter_id = $1 AND status = 'open' AND kind = $2
         AND target_player_id IS NOT DISTINCT FROM $3 AND target_tribe_id IS NOT DISTINCT FROM $4 AND message_id IS NOT DISTINCT FROM $5`,
      [reporterId, input.kind, target.playerId, target.tribeId, target.message?.id ?? null],
    )
  ).rowCount;
  if (duplicate) throw new GameError('Vous avez déjà signalé cela : l’administration va s’en occuper');

  const { rows } = await c.query(
    `INSERT INTO moderation_reports (reporter_id, reporter_name, kind, target_player_id, target_tribe_id, target_name,
                                     message_id, message_subject, message_body, target_bio, reason, comment, created_at)
     VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13) RETURNING id`,
    [
      reporterId, reporter.username, input.kind, target.playerId, target.tribeId, target.name,
      target.message?.id ?? null, target.message?.subject ?? null, target.message?.body ?? null, target.bio,
      input.reason, input.comment?.trim() ?? '', now,
    ],
  );
  return rows[0].id;
}

export async function openModerationCount(c: Pick<Db, 'query'>): Promise<number> {
  return (await c.query("SELECT count(*)::int AS n FROM moderation_reports WHERE status = 'open'")).rows[0].n;
}

/** Signalements pour l'administration : en attente d'abord (les plus anciens en tête), ou déjà traités (les plus récents en tête). */
export async function listModerationReports(c: Pick<Db, 'query'>, status: 'open' | 'closed', limit = 200): Promise<ModerationReportView[]> {
  const { rows } = await c.query(
    `SELECT r.*,
            (SELECT count(*)::int FROM moderation_reports o
             WHERE (r.target_player_id IS NOT NULL AND o.target_player_id = r.target_player_id)
                OR (r.target_tribe_id IS NOT NULL AND o.target_tribe_id = r.target_tribe_id)) AS same_target
     FROM moderation_reports r
     WHERE ${status === 'open' ? "r.status = 'open'" : "r.status <> 'open'"}
     ORDER BY ${status === 'open' ? 'r.id ASC' : 'r.handled_at DESC, r.id DESC'} LIMIT $1`,
    [limit],
  );
  return rows.map((r) => ({
    id: r.id,
    kind: r.kind,
    reason: r.reason,
    comment: r.comment,
    status: r.status,
    createdAt: new Date(r.created_at).toISOString(),
    reporter: r.reporter_name,
    targetPlayer: r.kind === 'tribe' ? null : { id: r.target_player_id, name: r.target_name },
    targetTribe: r.kind === 'tribe' ? { id: r.target_tribe_id, name: r.target_name } : null,
    message: r.kind === 'message' ? { subject: r.message_subject ?? '', body: r.message_body ?? '' } : null,
    bio: r.target_bio,
    sameTarget: Math.max(1, r.same_target),
    adminNote: r.admin_note,
    handledBy: r.handled_by,
    handledAt: r.handled_at ? new Date(r.handled_at).toISOString() : null,
  }));
}

/** Clôt un signalement (traité ou rejeté) ou le rouvre, avec une note facultative. */
export async function resolveModerationReport(c: Db, id: number, adminName: string, status: ModerationStatus, note: string | null, now: Date) {
  const res = await c.query(
    `UPDATE moderation_reports SET status = $2, admin_note = $3, handled_by = $4, handled_at = $5 WHERE id = $1`,
    status === 'open' ? [id, status, null, null, null] : [id, status, note?.trim() || null, adminName, now],
  );
  if (!res.rowCount) throw notFound('Signalement introuvable');
}
