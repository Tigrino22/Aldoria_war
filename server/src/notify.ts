import type { WebSocket } from 'ws';

export type Notice =
  | { type: 'village'; villageId: number }
  | { type: 'incoming'; villageId: number; arriveAt: string }
  | { type: 'report'; title: string }
  | { type: 'message'; from: string }
  | { type: 'me' };

const sockets = new Map<number, Set<WebSocket>>();

export function register(playerId: number, socket: WebSocket) {
  let set = sockets.get(playerId);
  if (!set) sockets.set(playerId, (set = new Set()));
  set.add(socket);
  socket.on('close', () => {
    set!.delete(socket);
    if (set!.size === 0) sockets.delete(playerId);
  });
}

/** Les notifications sont collectées pendant une transaction puis envoyées après le COMMIT. */
export class Outbox {
  private items: { playerId: number; notice: Notice }[] = [];
  push(playerId: number | null | undefined, notice: Notice) {
    if (playerId) this.items.push({ playerId, notice });
  }
  flush() {
    for (const { playerId, notice } of this.items) {
      const payload = JSON.stringify(notice);
      for (const s of sockets.get(playerId) ?? []) if (s.readyState === 1) s.send(payload);
    }
    this.items = [];
  }
}
