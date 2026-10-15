import type { Resources } from './config';

/**
 * Lettres de noblesse : frappées à l'hôtel de ville à prix fixe, stockées sur le compte, et consommées par chaque noble recruté.
 * Le noble suivant demande une lettre de plus (réglage `letterStep`) par village possédé et par noble déjà en vie au-delà du premier :
 * le prix d'une lettre tient toujours dans l'entrepôt, c'est leur nombre qui grimpe.
 */

/** Niveau d'hôtel de ville pour frapper des lettres (celui qu'exige le noble). */
export const LETTER_TOWNHALL = 10;
/** Lettres frappées d'un coup au plus. */
export const LETTER_BATCH_MAX = 100;

/** Lettres que demande le noble suivant, pour `villages` villages et `nobles` nobles déjà en vie ou en formation. */
export function lettersForNext(villages: number, nobles: number, step: number): number {
  return 1 + step * Math.max(0, villages + nobles - 1);
}

/** Lettres que demandent `count` nobles recrutés d'un coup (chacun compte pour le suivant). */
export function lettersForNobles(villages: number, nobles: number, count: number, step: number): number {
  let total = 0;
  for (let i = 0; i < count; i++) total += lettersForNext(villages, nobles + i, step);
  return total;
}

/** Nombre de nobles que permettent `letters` lettres. */
export function noblesAffordable(villages: number, nobles: number, letters: number, step: number): number {
  let n = 0;
  let left = letters;
  for (;;) {
    const need = lettersForNext(villages, nobles + n, step);
    if (need > left || n >= 1000) return n;
    left -= need;
    n++;
  }
}

/** Ce que le propriétaire voit de ses lettres depuis un village. */
export interface NobilityView {
  /** Système activé dans l'administration ; sinon les nobles ne demandent aucune lettre. */
  enabled: boolean;
  letters: number;
  /** Prix d'une lettre. */
  price: Resources;
  /** Lettres que demande le prochain noble. */
  next: number;
  villages: number;
  nobles: number;
  step: number;
}
