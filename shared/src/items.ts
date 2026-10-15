import { RESOURCES, type Resources } from './config';

/**
 * Inventaire : objets que le joueur garde pour plus tard. Pour l'instant un seul genre, le trésor d'un bastion, reçu par chaque
 * membre de la tribu qui prend le contrôle d'une province : il remplit une part de l'entrepôt du village choisi.
 */
export type ItemKind = 'treasure';

export const ITEM_LABEL: Record<ItemKind, string> = { treasure: 'Trésor de bastion' };

export interface InventoryItem {
  id: number;
  kind: ItemKind;
  /** Part de l'entrepôt remplie, en %. */
  percent: number;
  source: string | null;
  createdAt: string;
}

/** Ressources qu'apporte un trésor : `percent` % de la capacité de l'entrepôt pour chaque ressource, sans dépasser la capacité. */
export function treasureGain(resources: Resources, capacity: number, percent: number): Resources {
  const out = {} as Resources;
  for (const r of RESOURCES) out[r] = Math.max(0, Math.min(Math.floor((capacity * percent) / 100), Math.floor(capacity - resources[r])));
  return out;
}
