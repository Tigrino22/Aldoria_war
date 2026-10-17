import { readdir, readFile } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';
import path from 'node:path';
import type { Db } from './db';
import { corePool } from './db';

const root = path.join(path.dirname(fileURLToPath(import.meta.url)), '..');
/** Tables d'un monde, appliquées à chaque schéma de monde. */
const worldDir = path.join(root, 'migrations');
/** Tables communes à tous les mondes (schéma core). */
const coreDir = path.join(root, 'migrations-core');

async function applyDir(client: Db, dir: string, table: string, label: string) {
  await client.query(`CREATE TABLE IF NOT EXISTS ${table} (name TEXT PRIMARY KEY, applied_at TIMESTAMPTZ NOT NULL DEFAULT now())`);
  const done = new Set((await client.query(`SELECT name FROM ${table}`)).rows.map((r) => r.name));
  const files = (await readdir(dir)).filter((f) => f.endsWith('.sql')).sort();
  for (const file of files) {
    if (done.has(file)) continue;
    const sql = await readFile(path.join(dir, file), 'utf8');
    await client.query('BEGIN');
    try {
      await client.query(sql);
      await client.query(`INSERT INTO ${table} (name) VALUES ($1)`, [file]);
      await client.query('COMMIT');
      console.log(`Migration appliquée (${label}) : ${file}`);
    } catch (err) {
      await client.query('ROLLBACK');
      throw err;
    }
  }
}

/** Crée ou met à jour les tables d'un monde dans son schéma. */
export async function migrateWorldSchema(schema: string) {
  if (!/^[a-z_][a-z0-9_]*$/.test(schema)) throw new Error(`Schéma invalide : ${schema}`);
  const client = await corePool.connect();
  try {
    await client.query(`CREATE SCHEMA IF NOT EXISTS ${schema}`);
    await client.query(`SET search_path TO ${schema}`);
    await applyDir(client, worldDir, 'schema_migrations', schema);
  } finally {
    await client.query('RESET search_path').catch(() => undefined);
    client.release();
  }
}

/** Met toute la base à jour : le monde par défaut (public), les tables communes, puis chaque autre monde. */
export async function migrate(reset = false) {
  if (reset) {
    const client = await corePool.connect();
    try {
      const { rows } = await client.query("SELECT nspname FROM pg_namespace WHERE nspname LIKE 'monde\\_%'");
      for (const r of rows) await client.query(`DROP SCHEMA ${r.nspname} CASCADE`);
      await client.query('DROP SCHEMA IF EXISTS core CASCADE; DROP SCHEMA public CASCADE; CREATE SCHEMA public;');
      console.log('Base de données remise à zéro.');
    } finally {
      client.release();
    }
  }
  await migrateWorldSchema('public');
  const client = await corePool.connect();
  try {
    await client.query('CREATE SCHEMA IF NOT EXISTS core');
    await applyDir(client, coreDir, 'core.schema_migrations', 'core');
  } finally {
    client.release();
  }
  const { rows } = await corePool.query("SELECT schema_name FROM core.worlds WHERE schema_name <> 'public' ORDER BY id");
  for (const r of rows) await migrateWorldSchema(r.schema_name);
}

if (process.argv[1] && fileURLToPath(import.meta.url) === path.resolve(process.argv[1])) {
  migrate(process.argv.includes('--reset'))
    .then(() => console.log('Base de données à jour.'))
    .catch((err) => {
      console.error(err);
      process.exitCode = 1;
    })
    .finally(() => corePool.end());
}
