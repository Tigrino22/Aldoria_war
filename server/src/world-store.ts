import { AsyncLocalStorage } from 'node:async_hooks';
import type pg from 'pg';

/**
 * Un serveur fait tourner plusieurs mondes. Chaque monde a son propre schéma PostgreSQL (mêmes tables, données séparées),
 * ses propres réglages et son propre verrou. Le monde « courant » suit chaque requête et chaque tâche de fond grâce à
 * AsyncLocalStorage : `pool`, `env` et le verrou du jeu le consultent, si bien que le code du jeu n'a pas à le transmettre.
 * Sans monde courant (tests, démarrage), c'est le monde par défaut (le schéma public) qui sert.
 */
export interface WorldCtx {
  id: number;
  name: string;
  /** Schéma PostgreSQL des tables du monde (`public` pour le premier monde). */
  schema: string;
  pool: pg.Pool;
  /** Réglages du monde : pour le monde par défaut, c'est l'objet `env` d'origine lui-même. */
  env: Record<string, unknown>;
  /** File du verrou du jeu de ce monde. */
  tail: Promise<unknown>;
}

const store = new AsyncLocalStorage<WorldCtx>();
let fallback: WorldCtx | null = null;

export function setDefaultWorld(w: WorldCtx) {
  fallback = w;
}

/** Monde courant, ou null tant que le monde par défaut n'est pas encore créé (chargement des modules). */
export const peekWorld = (): WorldCtx | null => store.getStore() ?? fallback;

export function currentWorld(): WorldCtx {
  const w = peekWorld();
  if (!w) throw new Error('Aucun monde courant');
  return w;
}

export function defaultWorld(): WorldCtx {
  if (!fallback) throw new Error('Monde par défaut absent');
  return fallback;
}

/** Exécute `fn` dans le monde `w`. */
export function inWorld<T>(w: WorldCtx, fn: () => T): T {
  return store.run(w, fn);
}

/** Mondes chargés, par numéro. */
const registry = new Map<number, WorldCtx>();
export const registerWorld = (w: WorldCtx) => registry.set(w.id, w);
export const allWorlds = () => [...registry.values()].sort((a, b) => a.id - b.id);
/** Monde par son numéro ; le monde par défaut est toujours connu, même avant le chargement de la liste. */
export const worldById = (id: number) => registry.get(id) ?? (fallback?.id === id ? fallback : null);
