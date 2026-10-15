import {
  LETTER_BATCH_MAX,
  LETTER_TOWNHALL,
  RESOURCES,
  lettersForNext,
  lettersForNobles,
  scaleResources,
  type NobilityView,
  type Resources,
} from '@aldoria/shared';
import type { Db } from '../db';
import { env } from '../env';
import { GameError, forbidden } from '../errors';
import { unitsOfVillages } from './quests';
import { saveVillage, syncVillage } from './village';

type Q = Pick<Db, 'query'>;

/** Lettres de noblesse (voir shared/src/nobility.ts) : frappe à l'hôtel de ville, coût des nobles, remboursement. */

export const letterPrice = (): Resources => ({ wood: env.letterWood, clay: env.letterClay, iron: env.letterIron, wheat: 0 });

/** Villages et nobles du joueur (en vie, en route, planifiés ou en formation), qui fixent le prix du prochain noble. */
async function nobleBase(c: Q, playerId: number): Promise<{ villages: number; nobles: number }> {
  const ids = (await c.query("SELECT id FROM villages WHERE owner_id = $1 AND kind = 'village'", [playerId])).rows.map((r) => r.id as number);
  return { villages: ids.length, nobles: (await unitsOfVillages(c, ids)).noble };
}

export async function nobilityView(c: Q, playerId: number): Promise<NobilityView> {
  const letters = (await c.query('SELECT noble_letters FROM players WHERE id = $1', [playerId])).rows[0]?.noble_letters ?? 0;
  const { villages, nobles } = await nobleBase(c, playerId);
  return {
    enabled: !!env.nobleLetters,
    letters,
    price: letterPrice(),
    next: env.nobleLetters ? lettersForNext(villages, nobles, env.letterStep) : 0,
    villages,
    nobles,
    step: env.letterStep,
  };
}

/** Frappe `count` lettres avec les ressources d'un village du joueur dont l'hôtel de ville a le niveau voulu. */
export async function mintLetters(c: Db, playerId: number, villageId: number, count: number, now: Date) {
  if (!env.nobleLetters) throw new GameError('Les lettres de noblesse sont désactivées : les nobles n’en demandent pas');
  if (!Number.isInteger(count) || count < 1 || count > LETTER_BATCH_MAX) throw new GameError(`Entre 1 et ${LETTER_BATCH_MAX} lettres à la fois`);
  const v = await syncVillage(c, villageId, now);
  if (v.owner_id !== playerId) throw forbidden("Ce village n'est pas à vous");
  if (v.buildings.townhall < LETTER_TOWNHALL) throw new GameError(`Il faut un hôtel de ville de niveau ${LETTER_TOWNHALL} pour frapper des lettres`);
  const cost = scaleResources(letterPrice(), count);
  if (RESOURCES.some((r) => v[r] < cost[r])) throw new GameError('Pas assez de ressources pour frapper ces lettres');
  for (const r of RESOURCES) v[r] -= cost[r];
  await saveVillage(c, v);
  await c.query('UPDATE players SET noble_letters = noble_letters + $2 WHERE id = $1', [playerId, count]);
}

/** Lettres que coûtent `count` nobles maintenant pour ce joueur (0 si le système est coupé). */
export async function lettersNeeded(c: Q, playerId: number, count: number): Promise<number> {
  if (!env.nobleLetters) return 0;
  const { villages, nobles } = await nobleBase(c, playerId);
  return lettersForNobles(villages, nobles, count, env.letterStep);
}

/** Prélève les lettres d'un recrutement de nobles ; renvoie le nombre prélevé (à garder avec la file pour l'annulation). */
export async function spendLetters(c: Db, playerId: number, count: number): Promise<number> {
  const need = await lettersNeeded(c, playerId, count);
  if (need === 0) return 0;
  const res = await c.query('UPDATE players SET noble_letters = noble_letters - $2 WHERE id = $1 AND noble_letters >= $2 RETURNING noble_letters', [playerId, need]);
  if (!res.rowCount) throw new GameError(`${count > 1 ? 'Ces nobles demandent' : 'Ce noble demande'} ${need} lettre${need > 1 ? 's' : ''} de noblesse : frappez-les à l’hôtel de ville`);
  return need;
}

export async function refundLetters(c: Db, playerId: number, letters: number) {
  if (letters > 0) await c.query('UPDATE players SET noble_letters = noble_letters + $2 WHERE id = $1', [playerId, letters]);
}

/**
 * Pour les PNJ : frappe les lettres qui manquent à `count` nobles avec les ressources du village, s'il peut les payer.
 * Renvoie vrai quand le stock suffit ensuite.
 */
export async function ensureLetters(c: Db, playerId: number, villageId: number, count: number, now: Date): Promise<boolean> {
  if (!env.nobleLetters) return true;
  const need = await lettersNeeded(c, playerId, count);
  const have = (await c.query('SELECT noble_letters FROM players WHERE id = $1', [playerId])).rows[0]?.noble_letters ?? 0;
  const missing = need - have;
  if (missing <= 0) return true;
  if (missing > LETTER_BATCH_MAX) return false;
  try {
    await mintLetters(c, playerId, villageId, missing, now);
    return true;
  } catch (err) {
    if (err instanceof GameError) return false;
    throw err;
  }
}
