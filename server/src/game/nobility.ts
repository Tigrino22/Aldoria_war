import {
  LETTER_BATCH_MAX,
  LETTER_TOWNHALL,
  letterPriceFor,
  scaleResources,
  type NobilityView,
  type Resources,
} from '@aldoria/shared';
import type { Db } from '../db';
import { env } from '../env';
import { GameError, forbidden } from '../errors';
import { saveVillage, syncVillage } from './village';

type Q = Pick<Db, 'query'>;

/**
 * Lettres de noblesse (voir shared/src/nobility.ts) : cagnotte du compte alimentée par les villages, frappe à l'hôtel de ville
 * au prix du moment, une lettre par noble, remboursement à l'annulation.
 */

/** Ressources que la cagnotte accepte (le blé ne sert pas aux lettres). */
const TREASURY = ['wood', 'clay', 'iron'] as const;

export const letterBase = (): Resources => ({ wood: env.letterWood, clay: env.letterClay, iron: env.letterIron, wheat: 0 });

async function villagesOf(c: Q, playerId: number): Promise<number> {
  return Number((await c.query("SELECT count(*) AS n FROM villages WHERE owner_id = $1 AND kind = 'village'", [playerId])).rows[0].n);
}

/** Prix d'une lettre pour ce joueur maintenant. */
export async function letterPrice(c: Q, playerId: number): Promise<Resources> {
  return letterPriceFor(letterBase(), env.letterGrowth, await villagesOf(c, playerId));
}

async function treasuryOf(c: Q, playerId: number): Promise<{ letters: number; treasury: Resources }> {
  const p = (await c.query('SELECT noble_letters, treasury_wood, treasury_clay, treasury_iron FROM players WHERE id = $1', [playerId])).rows[0];
  return {
    letters: p?.noble_letters ?? 0,
    treasury: { wood: Number(p?.treasury_wood ?? 0), clay: Number(p?.treasury_clay ?? 0), iron: Number(p?.treasury_iron ?? 0), wheat: 0 },
  };
}

export async function nobilityView(c: Q, playerId: number): Promise<NobilityView> {
  const { letters, treasury } = await treasuryOf(c, playerId);
  const villages = await villagesOf(c, playerId);
  return {
    enabled: !!env.nobleLetters,
    letters,
    treasury,
    price: letterPriceFor(letterBase(), env.letterGrowth, villages),
    nextPrice: letterPriceFor(letterBase(), env.letterGrowth, villages + 1),
    villages,
    growth: env.letterGrowth,
  };
}

/** Verse des ressources d'un village du joueur dans la cagnotte (au plus ce que le village a en stock). */
export async function depositTreasury(c: Db, playerId: number, villageId: number, amounts: Resources, now: Date) {
  if (!env.nobleLetters) throw new GameError('Les lettres de noblesse sont désactivées');
  const v = await syncVillage(c, villageId, now);
  if (v.owner_id !== playerId) throw forbidden("Ce village n'est pas à vous");
  const give = { wood: 0, clay: 0, iron: 0, wheat: 0 } as Resources;
  for (const r of TREASURY) give[r] = Math.max(0, Math.min(Math.floor(amounts[r] ?? 0), Math.floor(v[r])));
  if (TREASURY.every((r) => give[r] === 0)) throw new GameError('Rien à verser');
  for (const r of TREASURY) v[r] -= give[r];
  await saveVillage(c, v);
  await c.query('UPDATE players SET treasury_wood = treasury_wood + $2, treasury_clay = treasury_clay + $3, treasury_iron = treasury_iron + $4 WHERE id = $1', [
    playerId,
    give.wood,
    give.clay,
    give.iron,
  ]);
  return give;
}

/** Frappe `count` lettres avec la cagnotte, à l'hôtel de ville d'un village du joueur. */
export async function mintLetters(c: Db, playerId: number, villageId: number, count: number) {
  if (!env.nobleLetters) throw new GameError('Les lettres de noblesse sont désactivées : les nobles n’en demandent pas');
  if (!Number.isInteger(count) || count < 1 || count > LETTER_BATCH_MAX) throw new GameError(`Entre 1 et ${LETTER_BATCH_MAX} lettres à la fois`);
  const v = (await c.query('SELECT owner_id, buildings FROM villages WHERE id = $1', [villageId])).rows[0];
  if (!v || v.owner_id !== playerId) throw forbidden("Ce village n'est pas à vous");
  if ((v.buildings?.townhall ?? 0) < LETTER_TOWNHALL) throw new GameError(`Il faut un hôtel de ville de niveau ${LETTER_TOWNHALL} pour frapper des lettres`);
  const cost = scaleResources(await letterPrice(c, playerId), count);
  const res = await c.query(
    `UPDATE players SET treasury_wood = treasury_wood - $2, treasury_clay = treasury_clay - $3, treasury_iron = treasury_iron - $4,
       noble_letters = noble_letters + $5
     WHERE id = $1 AND treasury_wood >= $2 AND treasury_clay >= $3 AND treasury_iron >= $4`,
    [playerId, cost.wood, cost.clay, cost.iron, count],
  );
  if (!res.rowCount) throw new GameError('La cagnotte ne suffit pas pour frapper ces lettres');
}

/** Prélève une lettre par noble recruté ; renvoie le nombre prélevé (gardé avec la file pour l'annulation). */
export async function spendLetters(c: Db, playerId: number, count: number): Promise<number> {
  if (!env.nobleLetters) return 0;
  const res = await c.query('UPDATE players SET noble_letters = noble_letters - $2 WHERE id = $1 AND noble_letters >= $2', [playerId, count]);
  if (!res.rowCount) throw new GameError(`${count > 1 ? `Ces nobles demandent ${count} lettres` : 'Ce noble demande une lettre'} de noblesse : frappez-les à l’hôtel de ville`);
  return count;
}

export async function refundLetters(c: Db, playerId: number, letters: number) {
  if (letters > 0) await c.query('UPDATE players SET noble_letters = noble_letters + $2 WHERE id = $1', [playerId, letters]);
}

/**
 * Pour les PNJ : verse ce qu'il faut du village dans la cagnotte puis frappe les lettres qui manquent à `count` nobles.
 * Renvoie vrai quand le stock de lettres suffit ensuite.
 */
export async function ensureLetters(c: Db, playerId: number, villageId: number, count: number, now: Date): Promise<boolean> {
  if (!env.nobleLetters) return true;
  const { letters, treasury } = await treasuryOf(c, playerId);
  const missing = count - letters;
  if (missing <= 0) return true;
  if (missing > LETTER_BATCH_MAX) return false;
  const cost = scaleResources(await letterPrice(c, playerId), missing);
  const v = await syncVillage(c, villageId, now);
  const lack = { wood: 0, clay: 0, iron: 0, wheat: 0 } as Resources;
  for (const r of TREASURY) lack[r] = Math.max(0, cost[r] - treasury[r]);
  try {
    // Trop cher pour ce village d'un coup (le prix monte au-delà de l'entrepôt) : il verse la moitié de son stock utile
    // et réessaiera à la prochaine réflexion, comme un joueur qui remplit la cagnotte peu à peu.
    if (TREASURY.some((r) => v[r] < lack[r])) {
      const part = { wood: 0, clay: 0, iron: 0, wheat: 0 } as Resources;
      for (const r of TREASURY) part[r] = Math.min(lack[r], Math.floor(v[r] / 2));
      if (TREASURY.some((r) => part[r] > 0)) await depositTreasury(c, playerId, villageId, part, now);
      return false;
    }
    if (TREASURY.some((r) => lack[r] > 0)) await depositTreasury(c, playerId, villageId, lack, now);
    await mintLetters(c, playerId, villageId, missing);
    return true;
  } catch (err) {
    if (err instanceof GameError) return false;
    throw err;
  }
}

