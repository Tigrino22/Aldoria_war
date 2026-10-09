/**
 * Toutes les écritures du jeu passent par ce verrou : une seule action est traitée à la fois.
 * C'est simple et sûr pour un seul processus serveur (largement suffisant pour quelques milliers de joueurs).
 * Pour passer à plusieurs processus, il faudra le remplacer par des verrous PostgreSQL.
 */
let tail: Promise<unknown> = Promise.resolve();

export function withGameLock<T>(fn: () => Promise<T>): Promise<T> {
  const run = tail.then(fn, fn);
  tail = run.catch(() => undefined);
  return run;
}
