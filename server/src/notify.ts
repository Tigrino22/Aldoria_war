import type { WebSocket } from 'ws';
import { currentWorld } from './world-store';

export type Notice =
  | { type: 'village'; villageId: number }
  | { type: 'incoming'; villageId: number; arriveAt: string }
  | { type: 'report'; title: string }
  | { type: 'message'; from: string }
  | { type: 'me' };

/** Connexions ouvertes, par monde puis par joueur (les numéros de joueur ne sont uniques que dans un monde). */
const sockets = new Map<string, Set<WebSocket>>();
const keyOf = (worldId: number, playerId: number) => `${worldId}:${playerId}`;

export function register(worldId: number, playerId: number, socket: WebSocket) {
  const key = keyOf(worldId, playerId);
  let set = sockets.get(key);
  if (!set) sockets.set(key, (set = new Set()));
  set.add(socket);
  socket.on('close', () => {
    set!.delete(socket);
    if (set!.size === 0) sockets.delete(key);
  });
}

/** Les notifications sont collectées pendant une transaction puis envoyées après le COMMIT. */
export class Outbox {
  private items: { playerId: number; notice: Notice }[] = [];
  private readonly worldId = currentWorld().id;
  push(playerId: number | null | undefined, notice: Notice) {
    if (playerId) this.items.push({ playerId, notice });
  }
  flush() {
    // Une même notification n'est envoyée qu'une fois : chaque « village » reçu déclenche un rechargement côté client.
    const sent = new Set<string>();
    for (const { playerId, notice } of this.items) {
      const payload = JSON.stringify(notice);
      const key = `${playerId}:${payload}`;
      if (sent.has(key)) continue;
      sent.add(key);
      for (const s of sockets.get(keyOf(this.worldId, playerId)) ?? []) if (s.readyState === 1) s.send(payload);
    }
    this.items = [];
  }
}
