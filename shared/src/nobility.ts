import { RESOURCES, type Resources } from './config';

/**
 * Lettres de noblesse : chaque noble consomme une lettre, frappée à l'hôtel de ville avec la cagnotte du compte.
 * La cagnotte reçoit ce que chaque village y verse, sans plafond (elle échappe à l'entrepôt). Le prix d'une lettre monte
 * de `growth` % par village possédé au-delà du premier : les nobles d'une même conquête paient le même prix, et chaque
 * village conquis renchérit les suivants.
 */

/** Niveau d’hôtel de ville pour frapper des lettres (celui qu’exige le noble). Tout village peut verser à la cagnotte. */
export const LETTER_TOWNHALL = 10;
/** Lettres frappées d'un coup au plus. */
export const LETTER_BATCH_MAX = 20;

/** Prix d'une lettre pour un joueur qui possède `villages` villages. */
export function letterPriceFor(base: Resources, growthPercent: number, villages: number): Resources {
  const factor = Math.pow(1 + growthPercent / 100, Math.max(0, villages - 1));
  const out = {} as Resources;
  for (const r of RESOURCES) out[r] = Math.round(base[r] * factor);
  return out;
}

/** Lettres que la cagnotte peut payer au prix `price`. */
export function lettersAffordable(treasury: Resources, price: Resources): number {
  let max = Infinity;
  for (const r of RESOURCES) if (price[r] > 0) max = Math.min(max, Math.floor(treasury[r] / price[r]));
  return max === Infinity ? LETTER_BATCH_MAX : Math.max(0, max);
}

/** Ce que le propriétaire voit de ses lettres et de sa cagnotte depuis un village. */
export interface NobilityView {
  /** Système activé dans l'administration ; sinon les nobles ne demandent aucune lettre. */
  enabled: boolean;
  letters: number;
  /** Ressources versées par les villages, communes au compte. */
  treasury: Resources;
  /** Prix d'une lettre maintenant. */
  price: Resources;
  /** Prix d'une lettre après le prochain village conquis. */
  nextPrice: Resources;
  villages: number;
  /** Hausse du prix par village possédé, en %. */
  growth: number;
}
