import {
  MarketOfferView,
  RESOURCES,
  Resource,
  distance,
  emptyResources,
  emptyUnits,
  merchantCount,
  merchantTravelTime,
  merchantsNeeded,
  warehouseCapacity,
} from '@aldoria/shared';
import type { Db } from '../db';
import { env } from '../env';
import { GameError, forbidden } from '../errors';
import type { Outbox } from '../notify';
import { insertCommand } from './commands';
import { MAX_PLAYER_OFFERS, MIN_OFFER_AMOUNT, OFFER_LIFETIME_HOURS, rateOk } from './market-rules';
import { busyMerchants, loadVillage, saveVillage, syncVillage } from './village';

const isResource = (r: unknown): r is Resource => (RESOURCES as readonly string[]).includes(r as string);
const lifetimeMs = () => (OFFER_LIFETIME_HOURS * 3_600_000) / env.worldSpeed;

export async function freeMerchants(c: Db, villageId: number, marketLevel: number) {
  return merchantCount(marketLevel) - (await busyMerchants(c, villageId));
}

/** Publie une offre : les ressources offertes sont retirées du village et gardées jusqu'à l'acceptation, l'annulation ou l'expiration. */
export async function createOffer(
  c: Db,
  outbox: Outbox,
  playerId: number,
  villageId: number,
  input: { give: Resource; giveAmount: number; want: Resource; wantAmount: number },
  now: Date,
  maxOpen = MAX_PLAYER_OFFERS,
): Promise<number> {
  const v = await syncVillage(c, villageId, now);
  if (v.owner_id !== playerId) throw forbidden("Ce village n'est pas à vous");
  if (!isResource(input.give) || !isResource(input.want)) throw new GameError('Ressource inconnue');
  if (input.give === input.want) throw new GameError('Choisissez deux ressources différentes');
  const give = Math.floor(input.giveAmount);
  const want = Math.floor(input.wantAmount);
  if (!(give >= MIN_OFFER_AMOUNT && want >= MIN_OFFER_AMOUNT)) throw new GameError(`Une offre porte sur au moins ${MIN_OFFER_AMOUNT} ressources de chaque côté`);
  if (!rateOk(give, want)) throw new GameError('Taux déséquilibré : demandez entre la moitié et le double de ce que vous donnez');
  if (v.buildings.market < 1) throw new GameError("Construisez d'abord un marché");
  const open = (await c.query("SELECT count(*)::int AS n FROM market_offers WHERE player_id = $1 AND status = 'open'", [playerId])).rows[0].n as number;
  if (open >= maxOpen) throw new GameError(`Vous ne pouvez pas avoir plus de ${maxOpen} offres ouvertes`);
  if (Math.floor(v[input.give]) < give) throw new GameError("Vous n'avez pas assez de ressources");
  const need = merchantsNeeded({ ...emptyResources(), [input.give]: give });
  if (need > (await freeMerchants(c, v.id, v.buildings.market))) throw new GameError("Pas assez de marchands libres pour livrer cette offre");

  v[input.give] -= give;
  await saveVillage(c, v);
  const { rows } = await c.query(
    `INSERT INTO market_offers (village_id, player_id, give_resource, give_amount, want_resource, want_amount, expires_at)
     VALUES ($1, $2, $3, $4, $5, $6, $7) RETURNING id`,
    [v.id, playerId, input.give, give, input.want, want, new Date(now.getTime() + lifetimeMs())],
  );
  outbox.push(playerId, { type: 'village', villageId: v.id });
  return rows[0].id;
}

/** Rend les ressources réservées d'une offre à son village (dans la limite de l'entrepôt) et la clôt. */
async function closeOffer(c: Db, outbox: Outbox, offer: any, status: 'cancelled' | 'expired', now: Date) {
  const v = await syncVillage(c, offer.village_id, now);
  const cap = warehouseCapacity(v.buildings.warehouse);
  const r = offer.give_resource as Resource;
  v[r] = Math.max(v[r], Math.min(cap, v[r] + offer.give_amount));
  await saveVillage(c, v);
  await c.query('UPDATE market_offers SET status = $2 WHERE id = $1', [offer.id, status]);
  outbox.push(offer.player_id, { type: 'village', villageId: v.id });
}

export async function cancelOffer(c: Db, outbox: Outbox, playerId: number, offerId: number, now: Date) {
  const offer = (await c.query('SELECT * FROM market_offers WHERE id = $1 FOR UPDATE', [offerId])).rows[0];
  if (!offer || offer.status !== 'open') throw new GameError('Cette offre n\'est plus disponible');
  if (offer.player_id !== playerId) throw forbidden("Cette offre n'est pas à vous");
  await closeOffer(c, outbox, offer, 'cancelled', now);
}

/** Clôt les offres arrivées à échéance et rend leurs ressources. */
export async function expireOffers(c: Db, outbox: Outbox, now: Date): Promise<number> {
  const { rows } = await c.query("SELECT * FROM market_offers WHERE status = 'open' AND expires_at <= $1 FOR UPDATE", [now]);
  for (const offer of rows) await closeOffer(c, outbox, offer, 'expired', now);
  return rows.length;
}

/**
 * Accepte une offre depuis un village de l'acceptant : il paie la ressource demandée, et deux convois de marchands
 * partent, un dans chaque sens (les ressources offertes étaient déjà réservées).
 */
export async function acceptOffer(c: Db, outbox: Outbox, playerId: number, villageId: number, offerId: number, now: Date) {
  const offer = (await c.query('SELECT * FROM market_offers WHERE id = $1 FOR UPDATE', [offerId])).rows[0];
  if (!offer || offer.status !== 'open' || new Date(offer.expires_at) <= now) throw new GameError("Cette offre n'est plus disponible");
  if (offer.player_id === playerId) throw new GameError('Vous ne pouvez pas accepter votre propre offre');
  const buyer = await syncVillage(c, villageId, now);
  if (buyer.owner_id !== playerId) throw forbidden("Ce village n'est pas à vous");
  if (buyer.buildings.market < 1) throw new GameError("Construisez d'abord un marché");
  const seller = await syncVillage(c, offer.village_id, now);

  const pay = offer.want_resource as Resource;
  const get = offer.give_resource as Resource;
  if (Math.floor(buyer[pay]) < offer.want_amount) throw new GameError("Vous n'avez pas assez de ressources");
  const buyerNeed = merchantsNeeded({ ...emptyResources(), [pay]: offer.want_amount });
  if (buyerNeed > (await freeMerchants(c, buyer.id, buyer.buildings.market))) throw new GameError('Pas assez de marchands libres');
  const sellerNeed = merchantsNeeded({ ...emptyResources(), [get]: offer.give_amount });
  if (sellerNeed > (await freeMerchants(c, seller.id, seller.buildings.market))) throw new GameError("Le vendeur n'a pas assez de marchands libres pour le moment");

  buyer[pay] -= offer.want_amount;
  await saveVillage(c, buyer);
  await c.query("UPDATE market_offers SET status = 'accepted' WHERE id = $1", [offer.id]);
  const travel = merchantTravelTime(buyer, seller, env.worldSpeed) * 1000;
  // Le convoi de l'acceptant vers le vendeur, et celui du vendeur vers l'acceptant.
  await insertCommand(c, {
    type: 'trade', originId: buyer.id, targetId: seller.id, homeId: buyer.id, playerId,
    units: emptyUnits(), loot: { ...emptyResources(), [pay]: offer.want_amount }, merchants: buyerNeed, sentAt: now, arriveAt: new Date(now.getTime() + travel),
  });
  await insertCommand(c, {
    type: 'trade', originId: seller.id, targetId: buyer.id, homeId: seller.id, playerId: offer.player_id,
    units: emptyUnits(), loot: { ...emptyResources(), [get]: offer.give_amount }, merchants: sellerNeed, sentAt: now, arriveAt: new Date(now.getTime() + travel),
  });
  outbox.push(playerId, { type: 'village', villageId: buyer.id });
  outbox.push(offer.player_id, { type: 'village', villageId: seller.id });
  return { arriveAt: new Date(now.getTime() + travel) };
}

const view = (row: any, from: { x: number; y: number }): MarketOfferView => ({
  id: row.id,
  villageId: row.village_id,
  villageName: row.village_name,
  x: row.x,
  y: row.y,
  ownerName: row.owner_name,
  isNpc: row.is_npc,
  give: { resource: row.give_resource, amount: row.give_amount },
  want: { resource: row.want_resource, amount: row.want_amount },
  expiresAt: new Date(row.expires_at).toISOString(),
  distance: Math.round(distance(row, from) * 10) / 10,
});

const SELECT_OFFERS = `
  SELECT o.*, v.name AS village_name, v.x, v.y, p.username AS owner_name, p.is_npc
  FROM market_offers o JOIN villages v ON v.id = o.village_id JOIN players p ON p.id = o.player_id`;

/** Offres ouvertes des autres joueurs, les plus proches du village indiqué d'abord. */
export async function listOffers(c: Db, playerId: number, villageId: number, now: Date): Promise<MarketOfferView[]> {
  const from = await loadVillage(c, villageId);
  if (from.owner_id !== playerId) throw forbidden("Ce village n'est pas à vous");
  const { rows } = await c.query(`${SELECT_OFFERS} WHERE o.status = 'open' AND o.expires_at > $1 AND o.player_id <> $2`, [now, playerId]);
  return rows.map((r) => view(r, from)).sort((a, b) => a.distance - b.distance);
}

/** Offres ouvertes publiées depuis un village du joueur. */
export async function myOffers(c: Db, playerId: number, villageId: number, now: Date): Promise<MarketOfferView[]> {
  const from = await loadVillage(c, villageId);
  if (from.owner_id !== playerId) throw forbidden("Ce village n'est pas à vous");
  const { rows } = await c.query(`${SELECT_OFFERS} WHERE o.status = 'open' AND o.expires_at > $1 AND o.player_id = $2 ORDER BY o.id`, [now, playerId]);
  return rows.map((r) => view(r, from));
}
