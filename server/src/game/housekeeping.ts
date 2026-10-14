import { pool } from '../db';
import { env } from '../env';

const DAY_MS = 86_400_000;
/** Lignes effacées par requête : de petits lots pour ne jamais bloquer la base longtemps. */
const BATCH = 5000;

async function deleteInBatches(sql: string, params: unknown[]): Promise<number> {
  let total = 0;
  for (;;) {
    const n = (await pool.query(sql, params)).rowCount ?? 0;
    total += n;
    if (n < BATCH) return total;
  }
}

/**
 * Ménage de la base, une fois par heure (hors verrou du jeu : rien de ce qui est effacé ne sert encore) :
 * - les mouvements arrivés depuis plus de `commandsKeepDays` jours (la table grossissait sans fin : plus de mille lignes par heure avec les PNJ) ;
 * - les rapports des joueurs plus vieux que `reportsKeepDays` jours, sauf ceux qu'ils ont archivés (0 = tout garder).
 * Les rapports des PNJ ont leur propre ménage, à chaque réflexion (voir npc.ts).
 */
export async function housekeeping(now: Date): Promise<{ commands: number; reports: number }> {
  const commands = await deleteInBatches(
    `DELETE FROM commands WHERE id IN (SELECT id FROM commands WHERE processed AND arrive_at < $1 LIMIT ${BATCH})`,
    [new Date(now.getTime() - Math.max(4, env.commandsKeepDays) * DAY_MS)],
  );
  const reports =
    env.reportsKeepDays > 0
      ? await deleteInBatches(
          `DELETE FROM reports WHERE id IN (SELECT r.id FROM reports r JOIN players p ON p.id = r.player_id
           WHERE NOT p.is_npc AND NOT r.archived AND r.created_at < $1 LIMIT ${BATCH})`,
          [new Date(now.getTime() - env.reportsKeepDays * DAY_MS)],
        )
      : 0;
  return { commands, reports };
}
