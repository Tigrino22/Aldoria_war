import type { AdminBugReportView, BugReportInput, BugReportView, BugStatus } from '@aldoria/shared';
import type { Db } from '../db';
import { GameError, notFound } from '../errors';

/** Bugs remontés par les joueurs : chacun voit les siens et la réponse de l'administration. */

/** Bugs qu'un joueur peut envoyer par jour, pour éviter les avalanches. */
export const BUGS_PER_DAY = 10;

const clip = (s: string | undefined, max: number) => (s ?? '').trim().slice(0, max);

export async function createBugReport(c: Db, playerId: number, input: BugReportInput, now: Date): Promise<number> {
  const player = (await c.query('SELECT username FROM players WHERE id = $1', [playerId])).rows[0];
  if (!player) throw notFound('Joueur introuvable');
  const recent = (
    await c.query("SELECT count(*)::int AS n FROM bug_reports WHERE reporter_id = $1 AND created_at > $2::timestamptz - interval '1 day'", [playerId, now])
  ).rows[0].n as number;
  if (recent >= BUGS_PER_DAY) throw new GameError(`${BUGS_PER_DAY} bugs par jour au plus : merci, réessayez demain`);
  const { rows } = await c.query(
    `INSERT INTO bug_reports (reporter_id, reporter_name, page, device, screen, description, created_at)
     VALUES ($1, $2, $3, $4, $5, $6, $7) RETURNING id`,
    [playerId, player.username, clip(input.page, 200), clip(input.device, 300), clip(input.screen, 20), input.description.trim(), now],
  );
  return rows[0].id;
}

const view = (r: any): BugReportView => ({
  id: r.id,
  description: r.description,
  page: r.page,
  status: r.status,
  createdAt: new Date(r.created_at).toISOString(),
  adminNote: r.admin_note,
  handledAt: r.handled_at ? new Date(r.handled_at).toISOString() : null,
});

export async function myBugReports(c: Pick<Db, 'query'>, playerId: number, limit = 20): Promise<BugReportView[]> {
  const { rows } = await c.query('SELECT * FROM bug_reports WHERE reporter_id = $1 ORDER BY id DESC LIMIT $2', [playerId, limit]);
  return rows.map(view);
}

export async function openBugCount(c: Pick<Db, 'query'>): Promise<number> {
  return (await c.query("SELECT count(*)::int AS n FROM bug_reports WHERE status = 'open'")).rows[0].n;
}

/** Bugs pour l'administration : en attente (les plus anciens d'abord), ou déjà traités (les plus récents d'abord). */
export async function listBugReports(c: Pick<Db, 'query'>, status: 'open' | 'closed', limit = 200): Promise<AdminBugReportView[]> {
  const { rows } = await c.query(
    `SELECT * FROM bug_reports WHERE ${status === 'open' ? "status = 'open'" : "status <> 'open'"}
     ORDER BY ${status === 'open' ? 'id ASC' : 'handled_at DESC, id DESC'} LIMIT $1`,
    [limit],
  );
  return rows.map((r) => ({ ...view(r), reporter: r.reporter_name, device: r.device, screen: r.screen, handledBy: r.handled_by }));
}

/** Clôt un bug (corrigé ou non retenu) avec une réponse que le joueur verra, ou le rouvre. */
export async function resolveBugReport(c: Db, id: number, adminName: string, status: BugStatus, note: string | null, now: Date) {
  const res = await c.query(
    'UPDATE bug_reports SET status = $2, admin_note = $3, handled_by = $4, handled_at = $5 WHERE id = $1',
    status === 'open' ? [id, status, null, null, null] : [id, status, note?.trim() || null, adminName, now],
  );
  if (!res.rowCount) throw notFound('Bug introuvable');
}
