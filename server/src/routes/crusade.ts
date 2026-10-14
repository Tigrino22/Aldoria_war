import type { FastifyInstance } from 'fastify';
import { z } from 'zod';
import { CRUSADE_SEASON_DAYS, CRUSADE_TITLES, CRUSADE_TITLE_HELP, type CrusadeTitleKey, type GloryRankingRow, type PlayerTitleView } from '@aldoria/shared';
import { act } from '../act';
import { requirePlayer } from '../auth';
import { pool } from '../db';
import { GameError } from '../errors';
import { crusadeState } from '../game/crusades';

const TITLE_KEYS = Object.keys(CRUSADE_TITLES) as CrusadeTitleKey[];

/** Croisades : état de la croisade, classement de gloire par saison, titres des joueurs. */
export default async function crusadeRoutes(app: FastifyInstance) {
  app.get('/api/crusade', async (req) => {
    const playerId = await requirePlayer(req);
    return act((c, _o, now) => crusadeState(c, playerId, now));
  });

  /** Saison en cours (la plus récente) et saisons connues. */
  const seasons = async () => (await pool.query('SELECT DISTINCT season FROM crusades ORDER BY season DESC')).rows.map((r) => r.season as number);
  const seasonQuery = z.object({ season: z.coerce.number().int().positive().optional() });

  app.get('/api/ranking/glory/players', async (req) => {
    const playerId = await requirePlayer(req);
    const all = await seasons();
    const season = seasonQuery.parse(req.query).season ?? all[0] ?? 1;
    const { rows } = await pool.query(
      `SELECT p.id, p.username AS name, p.is_npc AS "isNpc", p.title, t.tag, sum(s.glory)::int AS glory, count(*)::int AS crusades
       FROM crusade_scores s JOIN crusades cr ON cr.id = s.crusade_id JOIN players p ON p.id = s.player_id LEFT JOIN tribes t ON t.id = p.tribe_id
       WHERE cr.season = $1 GROUP BY p.id, t.tag HAVING sum(s.glory) > 0 ORDER BY glory DESC, p.id LIMIT 100`,
      [season],
    );
    const ranked: GloryRankingRow[] = rows.map((r, i) => ({ rank: i + 1, ...r, title: r.title ? CRUSADE_TITLES[r.title as CrusadeTitleKey] : null }));
    return { season, seasons: all, seasonDays: CRUSADE_SEASON_DAYS, rows: ranked, me: ranked.find((r) => r.id === playerId) ?? null };
  });

  app.get('/api/ranking/glory/tribes', async (req) => {
    await requirePlayer(req);
    const all = await seasons();
    const season = seasonQuery.parse(req.query).season ?? all[0] ?? 1;
    const { rows } = await pool.query(
      `SELECT t.id, t.name, t.tag, sum(s.glory)::int AS glory, count(DISTINCT s.crusade_id)::int AS crusades,
              (SELECT count(*)::int FROM crusades w WHERE w.season = $1 AND w.winner_tribe_id = t.id) AS wins
       FROM crusade_scores s JOIN crusades cr ON cr.id = s.crusade_id JOIN tribes t ON t.id = s.tribe_id
       WHERE cr.season = $1 GROUP BY t.id HAVING sum(s.glory) > 0 ORDER BY glory DESC, t.id LIMIT 100`,
      [season],
    );
    const ranked: GloryRankingRow[] = rows.map((r, i) => ({ rank: i + 1, ...r }));
    return { season, seasons: all, rows: ranked };
  });

  /** Titres gagnés par le joueur (et ceux qui restent à gagner) et le titre affiché. */
  app.get('/api/me/titles', async (req) => {
    const playerId = await requirePlayer(req);
    const earned = new Map<string, Date>(
      (await pool.query('SELECT title, earned_at FROM player_titles WHERE player_id = $1', [playerId])).rows.map((r) => [r.title, r.earned_at]),
    );
    const current = (await pool.query('SELECT title FROM players WHERE id = $1', [playerId])).rows[0]?.title ?? null;
    const titles: PlayerTitleView[] = TITLE_KEYS.map((key) => ({
      key,
      label: CRUSADE_TITLES[key],
      help: CRUSADE_TITLE_HELP[key],
      earnedAt: earned.has(key) ? new Date(earned.get(key)!).toISOString() : null,
    }));
    return { titles, current };
  });

  app.put('/api/me/title', async (req) => {
    const playerId = await requirePlayer(req);
    const { title } = z.object({ title: z.string().nullable() }).parse(req.body);
    if (title !== null) {
      if (!TITLE_KEYS.includes(title as CrusadeTitleKey)) throw new GameError('Titre inconnu');
      const owned = (await pool.query('SELECT 1 FROM player_titles WHERE player_id = $1 AND title = $2', [playerId, title])).rowCount;
      if (!owned) throw new GameError('Vous n’avez pas encore gagné ce titre');
    }
    await pool.query('UPDATE players SET title = $2 WHERE id = $1', [playerId, title]);
    return { current: title };
  });
}
