import { RESOURCES, type Resources } from './config';

/**
 * Lettres de noblesse, frappées à l'hôtel de ville avec la cagnotte du compte. La cagnotte reçoit ce que chaque village
 * y verse, sans plafond (elle échappe à l'entrepôt).
 *
 * Les lettres ne se consomment pas : pour recruter un noble, il faut avoir frappé au moins autant de lettres que de
 * villages possédés plus nobles déjà là (vivants, en route ou en formation). Une conquête ne change rien (le noble
 * s'installe, un village s'ajoute) ; un noble mort libère sa lettre, qui sert au noble qui le remplace.
 *
 * Chaque lettre frappée ajoute au prix de la suivante `increase` % du prix de base : à 100 %, la 1re lettre coûte le prix
 * de base, la 2e deux fois ce prix, la 3e trois fois, etc.
 */

/** Niveau d’hôtel de ville pour frapper des lettres (celui qu’exige le noble). Tout village peut verser à la cagnotte. */
export const LETTER_TOWNHALL = 10;
/** Lettres frappées d'un coup au plus. */
export const LETTER_BATCH_MAX = 20;

/** Lettres à avoir frappées pour recruter `count` nobles de plus. */
export const lettersRequired = (villages: number, nobles: number, count = 1) => villages + nobles + count - 1;

/** Nobles recrutables avec les lettres déjà frappées. */
export const freeLetters = (minted: number, villages: number, nobles: number) => Math.max(0, minted - lettersRequired(villages, nobles) + 1);

/** Multiplicateur du prix de base pour la lettre n° `n` (1 = première lettre du joueur). */
export const letterFactor = (n: number, increasePercent: number) => 1 + (increasePercent / 100) * Math.max(0, n - 1);

/** Prix de la lettre n° `n`. */
export function letterPriceAt(base: Resources, increasePercent: number, n: number): Resources {
  const f = letterFactor(n, increasePercent);
  const out = {} as Resources;
  for (const r of RESOURCES) out[r] = Math.round(base[r] * f);
  return out;
}

/** Prix total de `count` lettres quand le joueur en a déjà frappé `minted`. */
export function lettersCost(base: Resources, increasePercent: number, minted: number, count: number): Resources {
  const out = { wood: 0, clay: 0, iron: 0, wheat: 0 } as Resources;
  for (let i = 1; i <= count; i++) {
    const p = letterPriceAt(base, increasePercent, minted + i);
    for (const r of RESOURCES) out[r] += p[r];
  }
  return out;
}

/** Lettres (au plus `LETTER_BATCH_MAX`) que la cagnotte peut payer d'un coup, la hausse de chaque lettre comprise. */
export function lettersAffordable(treasury: Resources, base: Resources, increasePercent: number, minted: number): number {
  let n = 0;
  while (n < LETTER_BATCH_MAX) {
    const cost = lettersCost(base, increasePercent, minted, n + 1);
    if (RESOURCES.some((r) => cost[r] > treasury[r])) break;
    n++;
  }
  return n;
}

/** Ce que le propriétaire voit de ses lettres et de sa cagnotte depuis un village. */
export interface NobilityView {
  /** Système activé dans l'administration ; sinon les nobles ne demandent aucune lettre. */
  enabled: boolean;
  /** Lettres frappées depuis le début de la partie (elles ne se consomment pas). */
  minted: number;
  /** Villages possédés et nobles vivants, en route ou en formation : chacun occupe une lettre. */
  villages: number;
  nobles: number;
  /** Nobles recrutables maintenant sans frapper de nouvelle lettre. */
  free: number;
  /** Ressources versées par les villages, communes au compte. */
  treasury: Resources;
  /** Prix de base d'une lettre (la première). */
  base: Resources;
  /** Prix de la prochaine lettre. */
  price: Resources;
  /** Part du prix de base ajoutée à chaque lettre frappée, en %. */
  increase: number;
}
