import { tx, type Db } from './db';
import { processDueEvents } from './game/commands';
import { withGameLock } from './lock';
import { Outbox } from './notify';

/**
 * Point d'entrée de toute action de jeu : sous le verrou, on traite d'abord les mouvements arrivés,
 * puis l'action dans une transaction, puis on envoie les notifications.
 */
export function act<T>(fn: (c: Db, outbox: Outbox, now: Date) => Promise<T>): Promise<T> {
  return withGameLock(async () => {
    const now = new Date();
    await processDueEvents(now);
    const outbox = new Outbox();
    const result = await tx((c) => fn(c, outbox, now));
    outbox.flush();
    return result;
  });
}
