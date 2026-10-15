import { MERCHANT_CAPACITY, RESOURCES, distance, emptyResources, type Resource, type Resources } from '@aldoria/shared';

/**
 * Équilibrage automatique des ressources entre les villages d'un joueur, règles pures (sans base de données).
 *
 * Chaque ressource de chaque village est comparée à deux seuils, en % de son entrepôt :
 * - au-dessus de `high`, le village donne l'excédent (en gardant toujours le coût de son prochain bâtiment) ;
 * - sous `low`, ou s'il lui manque de quoi payer son prochain bâtiment, il reçoit.
 * Les receveurs les plus en manque passent d'abord, servis par les donneurs les plus proches, dans la limite de leurs marchands libres.
 */
export interface BalanceSettings {
  enabled: boolean;
  /** % de l'entrepôt sous lequel un village reçoit. */
  low: number;
  /** % de l'entrepôt au-dessus duquel un village donne. */
  high: number;
}

export const DEFAULT_BALANCE: BalanceSettings = { enabled: false, low: 30, high: 70 };
/** Écart minimal entre les deux seuils, pour que les ressources ne fassent pas l'aller-retour. */
export const BALANCE_MIN_GAP = 10;
/** Pas de convoi plus petit que cela : un marchand ne se déplace pas pour une poignée de ressources (la production comble vite ce reste). */
export const MIN_SHIPMENT = 200;

export interface BalanceVillage {
  id: number;
  x: number;
  y: number;
  stock: Resources;
  capacity: number;
  /** Ressources déjà en route vers ce village (convois et échanges). */
  incoming: Resources;
  freeMerchants: number;
  /** Coût du prochain bâtiment du gestionnaire, gardé par le village et réclamé s'il manque ; null sans plan. */
  reserve: Resources | null;
}

export interface Shipment {
  from: number;
  to: number;
  resources: Resources;
}

export function parseBalance(raw: any): { settings: BalanceSettings } | { error: string } {
  const low = Number(raw?.low);
  const high = Number(raw?.high);
  if (!Number.isInteger(low) || low < 0 || low > 90) return { error: 'Le seuil bas doit être entre 0 et 90 %' };
  if (!Number.isInteger(high) || high < 10 || high > 100) return { error: 'Le seuil haut doit être entre 10 et 100 %' };
  if (high < low + BALANCE_MIN_GAP) return { error: `Le seuil haut doit dépasser le seuil bas d'au moins ${BALANCE_MIN_GAP} points` };
  return { settings: { enabled: !!raw?.enabled, low, high } };
}

/** Ce qu'un village peut donner (excédent) et ce qu'il réclame (manque), ressource par ressource. */
export function balanceNeeds(v: BalanceVillage, s: Pick<BalanceSettings, 'low' | 'high'>) {
  const surplus = emptyResources();
  const need = emptyResources();
  for (const r of RESOURCES) {
    // Un bâtiment plus cher que l'entrepôt ne sera jamais payé : il ne compte pas.
    const reserve = v.reserve && v.reserve[r] <= v.capacity ? v.reserve[r] : 0;
    const keep = Math.max((s.high / 100) * v.capacity, reserve);
    surplus[r] = Math.max(0, Math.floor(v.stock[r] - keep));
    // `want` ne dépasse jamais l'entrepôt : ce qui est réclamé y tient toujours.
    const want = Math.max((s.low / 100) * v.capacity, reserve);
    need[r] = Math.max(0, Math.ceil(want - v.stock[r] - v.incoming[r]));
  }
  return { surplus, need };
}

const total = (r: Resources) => RESOURCES.reduce((s, k) => s + r[k], 0);

/** Convois à envoyer maintenant. Un seul convoi par paire de villages, qui peut porter plusieurs ressources. */
export function planBalance(villages: BalanceVillage[], s: Pick<BalanceSettings, 'low' | 'high'>): Shipment[] {
  const state = new Map(villages.map((v) => [v.id, { v, ...balanceNeeds(v, s), merchants: v.freeMerchants }]));
  const receivers = [...state.values()].filter((x) => total(x.need) > 0).sort((a, b) => total(b.need) - total(a.need));
  const shipments: Shipment[] = [];
  for (const rec of receivers) {
    const donors = [...state.values()]
      .filter((d) => d.v.id !== rec.v.id && d.merchants > 0 && total(d.surplus) > 0)
      .sort((a, b) => distance(a.v, rec.v) - distance(b.v, rec.v));
    for (const don of donors) {
      if (total(rec.need) === 0) break;
      const cargo = emptyResources();
      for (const r of RESOURCES) cargo[r] = Math.min(rec.need[r], don.surplus[r]);
      fitMerchants(cargo, don.merchants * MERCHANT_CAPACITY);
      if (total(cargo) < MIN_SHIPMENT) continue;
      for (const r of RESOURCES) {
        rec.need[r] -= cargo[r];
        don.surplus[r] -= cargo[r];
      }
      don.merchants -= Math.ceil(total(cargo) / MERCHANT_CAPACITY);
      shipments.push({ from: don.v.id, to: rec.v.id, resources: cargo });
    }
  }
  return shipments;
}

/** Réduit un chargement à ce que les marchands disponibles peuvent porter, chaque ressource dans la même proportion. */
function fitMerchants(cargo: Resources, capacity: number) {
  const sum = total(cargo);
  if (sum <= capacity) return;
  const ratio = capacity / sum;
  for (const r of RESOURCES) cargo[r] = Math.floor(cargo[r] * ratio);
}

/** « 3 000 bois, 1 200 argile » pour le journal du gestionnaire. */
export function describeCargo(cargo: Resources, names: Record<Resource, string>): string {
  return RESOURCES.filter((r) => cargo[r] > 0)
    .map((r) => `${cargo[r].toLocaleString('fr-FR')} ${names[r].toLowerCase()}`)
    .join(', ');
}
