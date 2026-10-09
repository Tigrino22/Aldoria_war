import type { Db } from '../db';
import type { Outbox } from '../notify';

export async function createReport(
  c: Db,
  outbox: Outbox,
  playerId: number | null,
  type: string,
  title: string,
  data: unknown,
  at: Date,
) {
  if (!playerId) return;
  await c.query('INSERT INTO reports (player_id, type, title, data, created_at) VALUES ($1, $2, $3, $4, $5)', [
    playerId,
    type,
    title,
    JSON.stringify(data),
    at,
  ]);
  outbox.push(playerId, { type: 'report', title });
}
