import { UNIT_KEYS, type UnitCounts } from './config';
import { emptyUnits, totalUnits } from './formulas';

/**
 * Découpe des ordres du point de ralliement en mouvements, partagée par le serveur (qui l'applique) et le client (qui l'affiche
 * avant l'envoi). Fonctions pures : pas d'horloge ni de base de données.
 */

/** Écart par défaut, et limite, entre deux nobles d'un train. */
export const DEFAULT_NOBLE_GAP_SECONDS = 1;
export const MAX_NOBLE_GAP_SECONDS = 10;
/** Un ordre ne se planifie pas plus de deux semaines à l'avance. */
export const MAX_ORDER_HORIZON_MS = 14 * 86_400_000;
/** Épéistes proposés pour escorter chaque noble : un noble seul ne survit pas à la défense de base d'un village. */
export const DEFAULT_NOBLE_ESCORT = 2;

export interface OrderPart {
  units: UnitCounts;
  departAt: Date;
  arriveAt: Date;
}

/** Train de nobles : `nobles` mouvements d'un noble et de son escorte, `gapMs` d'écart entre deux arrivées. */
export interface NobleTrain {
  nobles: number;
  /** Unités qui accompagnent chaque noble (jamais d'autre noble). */
  escort: UnitCounts;
  gapMs: number;
}

/** Unités à retirer du village pour un ordre : l'assaut, plus chaque noble avec son escorte. */
export function orderTotal(strike: UnitCounts, train: NobleTrain | null): UnitCounts {
  const total = { ...strike };
  if (!train) return total;
  total.noble += train.nobles;
  for (const k of UNIT_KEYS) total[k] += train.nobles * train.escort[k];
  return total;
}

export type OrderPlan = { parts: OrderPart[]; error?: undefined } | { parts?: undefined; error: string };

/**
 * Découpe un ordre en mouvements : l'assaut (s'il y a des troupes), puis, pour un train, un mouvement par noble avec son escorte.
 * `landAt` est l'arrivée du premier mouvement ; `null` choisit la plus proche possible, celle où le mouvement le plus lent part tout de suite.
 * Renvoie un message d'erreur en français quand l'ordre est impossible.
 */
export function planOrderParts(
  strike: UnitCounts,
  train: NobleTrain | null,
  opts: { landAt: Date | null; now: Date; travelMs: (u: UnitCounts) => number },
): OrderPlan {
  const pieces: UnitCounts[] = [];
  if (totalUnits(strike) > 0) pieces.push(strike);
  if (train) {
    if (train.nobles < 1) return { error: 'Un train de nobles demande au moins un noble' };
    for (let i = 0; i < train.nobles; i++) pieces.push({ ...train.escort, noble: 1 });
  }
  if (pieces.length === 0) return { error: 'Sélectionnez au moins une unité' };
  const gapMs = train?.gapMs ?? 0;
  const offsets = pieces.map((_, i) => i * gapMs);
  const travels = pieces.map((u) => opts.travelMs(u));
  const earliest = Math.max(...pieces.map((_, i) => opts.now.getTime() + travels[i] - offsets[i]));
  const land = opts.landAt ? opts.landAt.getTime() : earliest;
  if (land < earliest) {
    const slowest = Math.max(...travels.map((t, i) => t - offsets[i]));
    return { error: `Heure d'arrivée trop proche : le trajet le plus long demande ${Math.ceil(slowest / 1000)} s` };
  }
  if (land - opts.now.getTime() > MAX_ORDER_HORIZON_MS) return { error: 'Heure d’arrivée trop lointaine : 14 jours au plus' };
  return { parts: pieces.map((u, i) => ({ units: u, arriveAt: new Date(land + offsets[i]), departAt: new Date(land + offsets[i] - travels[i]) })) };
}

