/**
 * Toutes les écritures du jeu passent par ce verrou : une seule action est traitée à la fois.
 * C'est simple et sûr pour un seul processus serveur (largement suffisant pour quelques milliers de joueurs).
 * Pour passer à plusieurs processus, il faudra le remplacer par des verrous PostgreSQL.
 *
 * Les tâches de fond (PNJ, gestionnaire, mouvements arrivés) prennent le verrou par petits morceaux
 * pour que les clics des joueurs passent entre deux morceaux au lieu d'attendre la fin de toute la passe.
 */
let tail: Promise<unknown> = Promise.resolve();

export function withGameLock<T>(fn: () => Promise<T>): Promise<T> {
  const run = tail.then(fn, fn);
  tail = run.catch(() => undefined);
  return run;
}

/** Exécute un morceau de travail : sous le verrou du jeu en production, directement dans les tests ou si l'appelant le tient déjà. */
export type Locker = <T>(fn: () => Promise<T>) => Promise<T>;
export const unlocked: Locker = (fn) => fn();

/**
 * Lance `fn` sauf si son exécution précédente n'est pas finie : évite d'empiler des passes identiques
 * dans la file du verrou quand une passe dure plus longtemps que l'intervalle du minuteur.
 */
export function skipIfBusy(fn: () => Promise<unknown>): () => Promise<void> {
  let busy = false;
  return async () => {
    if (busy) return;
    busy = true;
    try {
      await fn();
    } finally {
      busy = false;
    }
  };
}
