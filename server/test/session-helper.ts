import { createSession } from '../src/auth';
import { corePool, pool } from '../src/db';
import { currentWorld } from '../src/world-store';

/** Session d'un joueur créé directement en base : son compte (même pseudo), son inscription dans le monde courant et un jeton. */
export async function sessionForPlayer(playerId: number): Promise<string> {
  const { username } = (await pool.query('SELECT username FROM players WHERE id = $1', [playerId])).rows[0];
  const w = currentWorld();
  const account = (
    await corePool.query(
      `INSERT INTO core.accounts (username, password_hash) VALUES ($1, '!')
       ON CONFLICT (lower(username)) DO UPDATE SET username = EXCLUDED.username RETURNING id`,
      [username],
    )
  ).rows[0].id as number;
  await corePool.query('INSERT INTO core.memberships (account_id, world_id, player_id) VALUES ($1, $2, $3) ON CONFLICT DO NOTHING', [account, w.id, playerId]);
  return createSession(account, w.id);
}
