import {
  LETTER_BATCH_MAX,
  LETTER_TOWNHALL,
  freeLetters,
  letterPriceAt,
  lettersRequired,
  lettersCost,
  type NobilityView,
  type Resources,
} from '@aldoria/shared';
import type { Db } from '../db';
import { env } from '../env';
import { GameError, forbidden } from '../errors';
import { unitsOfVillages } from './quests';
import { saveVillage, syncVillage } from './village';

type Q = Pick<Db, 'query'>;

/**
 * Lettres de noblesse (voir shared/src/nobility.ts) : cagnotte du compte alimentée par les villages, frappe à l'hôtel de ville
 * (chaque lettre renchérit la suivante), contrôle des lettres au recrutement des nobles.
 */

/** Ressources que la cagnotte accepte (le blé ne sert pas aux lettres). */
const TREASURY = ['wood', 'clay', 'iron'] as const;

export const letterBase = (): Resources => ({ wood: env.letterWood, clay: env.letterClay, iron: env.letterIron, wheat: 0 });

async function treasuryOf(c: Q, playerId: number): Promise<{ minted: number; treasury: Resources }> {
  const p = (await c.query('SELECT letters_minted, treasury_wood, treasury_clay, treasury_iron FROM players WHERE id = $1', [playerId])).rows[0];
  return {
    minted: p?.letters_minted ?? 0,
    treasury: { wood: Number(p?.treasury_wood ?? 0), clay: Number(p?.treasury_clay ?? 0), iron: Number(p?.treasury_iron ?? 0), wheat: 0 },
  };
}

/** Villages du joueur et ses nobles (vivants, en route, en renfort, planifiés ou en formation) : chacun occupe une lettre. */
async function holdings(c: Q, playerId: number): Promise<{ villages: number; nobles: number }> {
  const ids = (await c.query("SELECT id FROM villages WHERE owner_id = $1 AND kind = 'village'", [playerId])).rows.map((r) => r.id as number);
  return { villages: ids.length, nobles: (await unitsOfVillages(c, ids)).noble };
}

export async function nobilityView(c: Q, playerId: number): Promise<NobilityView> {
  const { minted, treasury } = await treasuryOf(c, playerId);
  const { villages, nobles } = await holdings(c, playerId);
  return {
    enabled: !!env.nobleLetters,
    minted,
    villages,
    nobles,
    free: freeLetters(minted, villages, nobles),
    treasury,
    base: letterBase(),
    price: letterPriceAt(letterBase(), env.letterIncrease, minted + 1),
    increase: env.letterIncrease,
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
  // Verrou sur le joueur : deux frappes en même temps paieraient sinon le même rang de lettre.
  const minted = (await c.query('SELECT letters_minted FROM players WHERE id = $1 FOR UPDATE', [playerId])).rows[0].letters_minted as number;
  const cost = lettersCost(letterBase(), env.letterIncrease, minted, count);
  const res = await c.query(
    `UPDATE players SET treasury_wood = treasury_wood - $2, treasury_clay = treasury_clay - $3, treasury_iron = treasury_iron - $4,
       letters_minted = letters_minted + $5
     WHERE id = $1 AND treasury_wood >= $2 AND treasury_clay >= $3 AND treasury_iron >= $4`,
    [playerId, cost.wood, cost.clay, cost.iron, count],
  );
  if (!res.rowCount) throw new GameError('La cagnotte ne suffit pas pour frapper ces lettres');
}

/** Lettres qui manquent pour recruter `count` nobles (0 si le système est coupé). */
export async function missingLetters(c: Q, playerId: number, count: number): Promise<number> {
  if (!env.nobleLetters) return 0;
  const { minted } = await treasuryOf(c, playerId);
  const { villages, nobles } = await holdings(c, playerId);
  return Math.max(0, lettersRequired(villages, nobles, count) - minted);
}

/** Refuse un recrutement de nobles quand les lettres frappées ne couvrent pas villages + nobles. */
export async function checkLetters(c: Q, playerId: number, count: number) {
  const missing = await missingLetters(c, playerId, count);
  if (missing > 0) {
    throw new GameError(
      missing > 1
        ? `Il manque ${missing} lettres de noblesse : chaque noble a la sienne. Frappez-les à l’hôtel de ville`
        : 'Il manque 1 lettre de noblesse : chaque noble a la sienne. Frappez-la à l’hôtel de ville',
    );
  }
}

/**
 * Pour les PNJ : verse ce qu'il faut du village dans la cagnotte puis frappe les lettres qui manquent à `count` nobles.
 * Renvoie vrai quand les lettres suffisent ensuite.
 */
export async function ensureLetters(c: Db, playerId: number, villageId: number, count: number, now: Date): Promise<boolean> {
  if (!env.nobleLetters) return true;
  const { minted, treasury } = await treasuryOf(c, playerId);
  const missing = await missingLetters(c, playerId, count);
  if (missing <= 0) return true;
  if (missing > LETTER_BATCH_MAX) return false;
  const cost = lettersCost(letterBase(), env.letterIncrease, minted, missing);
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

