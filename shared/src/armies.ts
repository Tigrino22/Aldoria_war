/**
 * Armées en marche sur la carte. Chacun voit ses propres mouvements, ceux de sa tribu et de ses alliés, et le trajet des
 * attaques et renforts qui visent ses villages. Une armée étrangère n'est repérée qu'à 10 cases ou moins de l'un de ses
 * villages : on voit alors sa composition, et on peut l'intercepter (bataille en rase campagne). Une interception lancée
 * pendant qu'elle est repérée la poursuit jusqu'à la rattraper, même si elle sort ensuite de la zone.
 */

/** Portée de vue d'un village, en cases : en deçà, une armée étrangère est repérée (composition visible, interception possible). */
export const ARMY_SIGHT = 10;

export type MapArmyRelation = 'own' | 'tribe' | 'ally' | 'threat' | 'guest' | 'seen';

export interface MapArmy {
  id: number;
  /** `unknown` pour une armée simplement aperçue : on ne sait pas si elle attaque, renforce ou rentre. */
  type: 'attack' | 'support' | 'return' | 'intercept' | 'unknown';
  rel: MapArmyRelation;
  /** Armée ennemie qu'on peut intercepter pendant qu'elle est repérée (entre `spotFrom` et `spotTo`). */
  interceptable: boolean;
  /** Période où l'armée passe à portée de vue d'un de vos villages (null si jamais) : sa composition n'est visible qu'alors. */
  spotFrom: string | null;
  spotTo: string | null;
  /** Positions en cases (le centre d'un village est en x + 0.5) et instants où l'armée y passe. Pour une armée aperçue, seulement la portion visible. */
  from: { x: number; y: number };
  to: { x: number; y: number };
  fromAt: string;
  toAt: string;
  /** 1 petite troupe, 2 armée, 3 grande armée (2 pour une armée étrangère pas encore repérée : son contenu reste caché). */
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

interface Path {
  from: { x: number; y: number };
  to: { x: number; y: number };
  t0: number;
  t1: number;
}

/** Position d'une armée sur son trajet à l'instant `t` (en millisecondes). */
export function armyAt(p: Path, t: number): { x: number; y: number } {
  const u = Math.min(1, Math.max(0, (t - p.t0) / Math.max(1, p.t1 - p.t0)));
  return { x: p.from.x + (p.to.x - p.from.x) * u, y: p.from.y + (p.to.y - p.from.y) * u };
}

/** L'armée est-elle à portée de vue de l'un des villages ? */
export const inSight = (pos: { x: number; y: number }, villages: { x: number; y: number }[], sight = ARMY_SIGHT) =>
  villages.some((v) => (v.x - pos.x) ** 2 + (v.y - pos.y) ** 2 <= sight * sight);

/**
 * Point de rencontre le plus tôt possible entre des troupes qui partent de `origin` à `now` (à `secondsPerTile` secondes
 * par case) et une armée en marche, avant qu'elle n'arrive. Null si elles n'arrivent pas à temps.
 */
export function interceptPoint(
  origin: { x: number; y: number },
  secondsPerTile: number,
  p: Path,
  now: number,
  /** Instants entre lesquels la rencontre doit avoir lieu (par défaut tout le trajet restant). */
  within: [number, number] = [p.t0, p.t1],
): { x: number; y: number; at: number } | null {
  const end = Math.min(p.t1, within[1]);
  if (now >= end) return null;
  // Avance sur l'heure de rencontre : positive quand nos troupes peuvent être là à temps.
  const slack = (t: number) => {
    const pos = armyAt(p, t);
    return t - now - Math.hypot(pos.x - origin.x, pos.y - origin.y) * secondsPerTile * 1000;
  };
  const start = Math.max(now, p.t0, within[0]);
  const steps = 240;
  let prev = start;
  for (let i = 0; i <= steps; i++) {
    const t = start + ((end - start) * i) / steps;
    if (t >= end) break;
    if (slack(t) >= 0) {
      let lo = i === 0 ? t : prev;
      let hi = t;
      for (let k = 0; k < 30 && hi - lo > 200; k++) {
        const mid = (lo + hi) / 2;
        if (slack(mid) >= 0) hi = mid;
        else lo = mid;
      }
      const at = Math.ceil(hi / 1000) * 1000;
      if (at >= end) return null;
      return { ...armyAt(p, at), at };
    }
    prev = t;
  }
  return null;
}
