/**
 * Armées en marche sur la carte. Chacun voit ses propres mouvements, ceux de sa tribu et de ses alliés, ce qui vise ses
 * villages, et toute armée qui passe à portée de vue de l'un de ses villages (sans savoir d'où elle vient ni où elle va).
 * Base des futures interceptions : une armée aperçue pourra être attaquée en rase campagne.
 */

/** Portée de vue d'un village, en cases. */
export const ARMY_SIGHT = 5;

export type MapArmyRelation = 'own' | 'tribe' | 'ally' | 'threat' | 'guest' | 'seen';

export interface MapArmy {
  id: number;
  /** `unknown` pour une armée simplement aperçue : on ne sait pas si elle attaque, renforce ou rentre. */
  type: 'attack' | 'support' | 'return' | 'unknown';
  rel: MapArmyRelation;
  /** Positions en cases (le centre d'un village est en x + 0.5) et instants où l'armée y passe. Pour une armée aperçue, seulement la portion visible. */
  from: { x: number; y: number };
  to: { x: number; y: number };
  fromAt: string;
  toAt: string;
  /** 1 petite troupe, 2 armée, 3 grande armée (2 pour une armée qui vise vos villages : son contenu reste caché). */
  size: 1 | 2 | 3;
  scouts: boolean;
  /** Genres d'unités qu'on voit marcher, du plus nombreux au moins nombreux (fantassins seuls quand le contenu est caché). */
  kinds: ArmyKind[];
  /** Joueur qui l'envoie, quand on le connaît. */
  owner: string | null;
}

/** Silhouettes dessinées sur la carte. */
export type ArmyKind = 'foot' | 'horse' | 'scout' | 'noble' | 'ram';

/** Genres présents dans une armée, du plus gros en population au plus petit (trois au plus, dont le noble s'il y en a un). */
export function armyKinds(u: { spearman: number; halberdier: number; swordsman: number; scout: number; cavalry: number; ram: number; noble: number }): ArmyKind[] {
  const pop: [ArmyKind, number][] = [
    ['foot', u.spearman + u.halberdier + u.swordsman],
    ['horse', u.cavalry * 4],
    ['scout', u.scout * 2],
    ['ram', u.ram * 5],
    ['noble', u.noble * 100],
  ];
  const kinds = pop.filter(([, n]) => n > 0).sort((a, b) => b[1] - a[1]).slice(0, 3).map(([k]) => k);
  // Un noble se voit toujours : c'est lui qui annonce une conquête.
  if (u.noble > 0 && !kinds.includes('noble')) kinds[2] = 'noble';
  return kinds.length ? kinds : ['foot'];
}

/** Taille affichée d'une armée d'après sa population. */
export const armySize = (population: number): 1 | 2 | 3 => (population < 100 ? 1 : population < 2000 ? 2 : 3);

/**
 * Portion d'un trajet visible depuis des villages : l'intervalle [u0, u1] (0 = départ, 1 = arrivée) où l'armée passe à
 * `sight` cases ou moins d'au moins un village, ou null. Plusieurs villages donnent l'enveloppe de leurs intervalles.
 */
export function sightWindow(from: { x: number; y: number }, to: { x: number; y: number }, villages: { x: number; y: number }[], sight = ARMY_SIGHT): [number, number] | null {
  const dx = to.x - from.x;
  const dy = to.y - from.y;
  const a = dx * dx + dy * dy;
  let lo = Infinity;
  let hi = -Infinity;
  for (const v of villages) {
    const ox = from.x - v.x;
    const oy = from.y - v.y;
    const c = ox * ox + oy * oy - sight * sight;
    if (a === 0) {
      if (c <= 0) return [0, 1];
      continue;
    }
    const b = 2 * (dx * ox + dy * oy);
    const disc = b * b - 4 * a * c;
    if (disc < 0) continue;
    const r = Math.sqrt(disc);
    const u0 = Math.max(0, (-b - r) / (2 * a));
    const u1 = Math.min(1, (-b + r) / (2 * a));
    if (u0 > u1) continue;
    lo = Math.min(lo, u0);
    hi = Math.max(hi, u1);
  }
  return lo <= hi ? [lo, hi] : null;
}
