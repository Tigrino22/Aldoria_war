import pg from 'pg';
import { env, rootEnv } from './env';
import { currentWorld, setDefaultWorld } from './world-store';

export type Db = pg.PoolClient;

/**
 * Connexions de la base, chemin de recherche par défaut (schéma public) : elles servent au monde par défaut et aux
 * tables communes à tous les mondes (schéma core : comptes, sessions, liste des mondes).
 */
export const corePool = new pg.Pool({ connectionString: env.databaseUrl, max: 10 });

setDefaultWorld({ id: 1, name: 'Aldoria', schema: 'public', pool: corePool, env: rootEnv, tail: Promise.resolve() });

/** Connexions dont les tables par défaut sont celles d'un schéma de monde. */
export const worldPool = (schema: string) =>
  new pg.Pool({ connectionString: env.databaseUrl, max: 4, options: `-c search_path=${schema}` });

/** Connexions du monde courant : tout le code du jeu passe par là sans se soucier du monde. */
export const pool = {
  query: (...args: unknown[]) => (currentWorld().pool as unknown as { query: (...a: unknown[]) => unknown }).query(...args),
  connect: () => currentWorld().pool.connect(),
  end: () => endPools(),
} as unknown as pg.Pool;

const extraPools = new Set<pg.Pool>();
export const trackPool = (p: pg.Pool) => extraPools.add(p);

async function endPools() {
  await Promise.all([...extraPools].map((p) => p.end()));
  extraPools.clear();
  await corePool.end();
}

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
