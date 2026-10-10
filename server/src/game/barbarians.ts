import { BUILDING_KEYS, type Buildings, type UnitCounts, emptyUnits } from '@aldoria/shared';

/** Niveau de développement d'un village barbare : plus il est loin du centre, plus il est fort. */
export function barbarianTier(x: number, y: number, mapSize: number): number {
  const dist = Math.hypot(x - mapSize / 2, y - mapSize / 2) / (mapSize / 2);
  return Math.max(1, Math.round(2 + dist * 6));
}

/** Les barbares montent aussi avec l'âge du monde : un niveau de plus tous les 10 jours de jeu. */
export function barbarianCap(tier: number, worldDays: number): number {
  return Math.min(20, tier + Math.floor(Math.max(0, worldDays) / 10));
}

/** Garnison qu'un village barbare retrouve peu à peu quand il a été pillé. */
export function barbarianTroopTarget(cap: number): UnitCounts {
  return { ...emptyUnits(), spearman: cap * 8, swordsman: cap * 3 };
}

/** Part de la garnison cible regagnée par heure de jeu. */
export const BARBARIAN_TROOP_REGEN_PER_HOUR = 0.04;
/** Niveaux de bâtiment gagnés par heure de jeu, tous bâtiments confondus. */
export const BARBARIAN_BUILD_PER_HOUR = 0.04;

/** Arrondi aléatoire non biaisé : 2,3 donne 2 sept fois sur dix et 3 trois fois sur dix. */
function stochasticRound(value: number, rng: () => number): number {
  const base = Math.floor(value);
  return base + (rng() < value - base ? 1 : 0);
}

/**
 * Fait repousser un village barbare sur `gameHours` heures de jeu : la garnison revient vers sa cible
 * et quelques bâtiments montent, sans dépasser le plafond du village. Pur : le hasard est injecté.
 */
export function growBarbarian(
  state: { buildings: Buildings; troops: UnitCounts },
  gameHours: number,
  cap: number,
  rng: () => number,
): { buildings: Buildings; troops: UnitCounts; changed: boolean } {
  const buildings = { ...state.buildings };
  const troops = { ...state.troops };
  let changed = false;
  if (gameHours <= 0) return { buildings, troops, changed };

  const target = barbarianTroopTarget(cap);
  for (const unit of ['spearman', 'swordsman'] as const) {
    const deficit = target[unit] - troops[unit];
    if (deficit <= 0) continue;
    const gain = Math.min(deficit, stochasticRound(gameHours * Math.max(0.5, target[unit] * BARBARIAN_TROOP_REGEN_PER_HOUR), rng));
    if (gain > 0) {
      troops[unit] += gain;
      changed = true;
    }
  }

  // Le marché n'existe pas chez les barbares ; la caserne et la muraille suivent le même plafond que le reste.
  const growable = BUILDING_KEYS.filter((k) => k !== 'market');
  const levels = stochasticRound(gameHours * BARBARIAN_BUILD_PER_HOUR, rng);
  for (let i = 0; i < levels; i++) {
    const open = growable.filter((k) => buildings[k] < cap);
    if (open.length === 0) break;
    const key = open[Math.floor(rng() * open.length)];
    buildings[key] += 1;
    changed = true;
  }
  return { buildings, troops, changed };
}
