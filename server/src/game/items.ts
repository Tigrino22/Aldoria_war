import { RESOURCES, treasureGain, warehouseCapacity, type InventoryItem, type ItemKind, type Resources } from '@aldoria/shared';
import { type Db } from '../db';
import { GameError, forbidden } from '../errors';
import type { Outbox } from '../notify';
import { saveVillage, syncVillage } from './village';

/** Inventaire des joueurs (voir shared/src/items.ts). */

export async function grantItem(c: Db, playerId: number, kind: ItemKind, percent: number, source: string | null, at: Date) {
  await c.query('INSERT INTO player_items (player_id, kind, percent, source, created_at) VALUES ($1, $2, $3, $4, $5)', [playerId, kind, percent, source, at]);
}

export async function listItems(c: Db, playerId: number): Promise<InventoryItem[]> {
  const { rows } = await c.query('SELECT * FROM player_items WHERE player_id = $1 AND used_at IS NULL ORDER BY percent DESC, id', [playerId]);
  return rows.map((r) => ({ id: r.id, kind: r.kind, percent: r.percent, source: r.source, createdAt: new Date(r.created_at).toISOString() }));
}

/** Utilise un trésor sur un village du joueur : l'entrepôt se remplit de la part prévue, sans déborder. */
export async function useItem(c: Db, outbox: Outbox, playerId: number, itemId: number, villageId: number, now: Date): Promise<{ gain: Resources }> {
  const item = (await c.query('SELECT * FROM player_items WHERE id = $1 FOR UPDATE', [itemId])).rows[0];
  if (!item || item.player_id !== playerId) throw new GameError('Objet introuvable', 404);
  if (item.used_at) throw new GameError('Cet objet a déjà été utilisé');
  const v = await syncVillage(c, villageId, now);
  if (v.owner_id !== playerId) throw forbidden("Ce village n'est pas à vous");
  const capacity = warehouseCapacity(v.buildings.warehouse);
  const gain = treasureGain({ wood: v.wood, clay: v.clay, iron: v.iron, wheat: v.wheat }, capacity, item.percent);
  if (RESOURCES.every((r) => gain[r] <= 0)) throw new GameError("L'entrepôt de ce village est déjà plein");
  for (const r of RESOURCES) v[r] += gain[r];
  await saveVillage(c, v);
  await c.query('UPDATE player_items SET used_at = $2, used_village_id = $3 WHERE id = $1', [itemId, now, villageId]);
  outbox.push(playerId, { type: 'village', villageId });
  return { gain };
}
