import { RESOURCES, type Resources } from './config';

/**
 * Inventaire : objets que le joueur garde pour plus tard. Pour l'instant un seul genre, le trésor, reçu par chaque membre de la
 * tribu qui prend le contrôle d'une province ou pour un palier de succès : il remplit une part de l'entrepôt du village choisi.
 */
/** `treasure` : trésor d'un bastion ; `chest` : coffre d'un palier de succès. Les deux s'utilisent de la même façon. */
export type ItemKind = 'treasure' | 'chest';

export const ITEM_LABEL: Record<ItemKind, string> = { treasure: 'Trésor de bastion', chest: 'Coffre de succès' };

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
