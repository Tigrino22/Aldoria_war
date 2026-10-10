import { MERCHANT_CAPACITY, RESOURCES, type Resource, type Resources } from '@aldoria/shared';

// Règles pures du marché : pas de base de données ni d'horloge ici, pour pouvoir les tester facilement.

/** Durée de vie d'une offre, en heures de jeu (divisée par la vitesse du monde). */
export const OFFER_LIFETIME_HOURS = 24;
/** Taux accepté : ce qu'on demande doit valoir entre la moitié et le double de ce qu'on donne. */
export const MIN_RATE = 0.5;
export const MAX_RATE = 2;
export const MIN_OFFER_AMOUNT = 50;
export const MAX_PLAYER_OFFERS = 5;
export const MAX_NPC_OFFERS = 2;
/** Rayon (en cases) dans lequel un PNJ cherche des offres à accepter. */
export const NPC_TRADE_RADIUS = 25;
/** Au-dessus de cette part de l'entrepôt, une ressource est en excédent pour un PNJ ; en dessous de la seconde, en manque. */
export const SURPLUS_SHARE = 0.7;
export const SHORTAGE_SHARE = 0.25;

/** Une offre est équilibrée si le taux (demandé / donné) reste entre 0,5 et 2. */
export function rateOk(give: number, want: number): boolean {
  if (give <= 0 || want <= 0) return false;
  const rate = want / give;
  return rate >= MIN_RATE && rate <= MAX_RATE;
}

export interface NpcStock {
  stock: Resources;
  capacity: number;
}

/** Ressources en excédent et en manque d'un village, d'après le remplissage de l'entrepôt. */
export function marketNeeds({ stock, capacity }: NpcStock): { surplus: Resource[]; shortage: Resource[] } {
  const surplus: Resource[] = [];
  const shortage: Resource[] = [];
  for (const r of RESOURCES) {
    const share = stock[r] / capacity;
    if (share > SURPLUS_SHARE) surplus.push(r);
    else if (share < SHORTAGE_SHARE) shortage.push(r);
  }
  return { surplus, shortage };
}

/** Offre qu'un PNJ publie : il donne 30 % d'une ressource en excédent contre celle qui lui manque le plus. */
export function planOffer(npc: NpcStock, profile: 'builder' | 'raider' | 'conqueror'): { give: Resource; giveAmount: number; want: Resource; wantAmount: number } | null {
  const { surplus, shortage } = marketNeeds(npc);
  if (!surplus.length || !shortage.length) return null;
  const give = surplus.reduce((a, b) => (npc.stock[b] > npc.stock[a] ? b : a));
  const want = shortage.reduce((a, b) => (npc.stock[b] < npc.stock[a] ? b : a));
  const giveAmount = Math.min(MERCHANT_CAPACITY, Math.floor((npc.stock[give] * 0.3) / 10) * 10);
  if (giveAmount < 100) return null;
  // Un bâtisseur négocie un peu mieux (0,9 contre 1), les autres échangent à parité.
  const wantAmount = Math.round((giveAmount * (profile === 'builder' ? 0.9 : 1)) / 10) * 10;
  return rateOk(giveAmount, wantAmount) ? { give, giveAmount, want, wantAmount } : null;
}

/** Un PNJ accepte une offre qui lui apporte une ressource en manque contre une en excédent, sans le laisser à court. */
export function npcAccepts(npc: NpcStock, offer: { give: Resource; giveAmount: number; want: Resource; wantAmount: number }): boolean {
  const { surplus, shortage } = marketNeeds(npc);
  // « give » est ce que le PNJ reçoit, « want » ce qu'il paie.
  if (!shortage.includes(offer.give) || !surplus.includes(offer.want)) return false;
  if (npc.stock[offer.want] < offer.wantAmount) return false;
  const left = (npc.stock[offer.want] - offer.wantAmount) / npc.capacity;
  if (left < SURPLUS_SHARE - 0.25) return false;
  // Le taux ne doit pas lui être trop défavorable.
  return offer.giveAmount / offer.wantAmount >= 0.9;
}
