import pg from 'pg';
import { env } from './env';

export type Db = pg.PoolClient;

export const pool = new pg.Pool({ connectionString: env.databaseUrl, max: 10 });

/** Exécute `fn` dans une transaction et renvoie son résultat. */
export async function tx<T>(fn: (c: Db) => Promise<T>): Promise<T> {
  const client = await pool.connect();
  try {
    await client.query('BEGIN');
    const result = await fn(client);
    await client.query('COMMIT');
    return result;
  } catch (err) {
    await client.query('ROLLBACK');
    throw err;
  } finally {
    client.release();
  }
}
