import {
  BUILDINGS,
  BUILDING_KEYS,
  RESOURCES,
  UNITS,
  UNIT_KEYS,
  buildingCost,
  meetsRequirements,
  recruitTime,
  warehouseCapacity,
  type BuildingKey,
  type Buildings,
  type Resources,
  type UnitCounts,
  type UnitKey,
} from '@aldoria/shared';

/**
 * Règles du gestionnaire de compte, pures (sans base de données) : elles décident seulement de la prochaine chose à faire.
 * L'exécution passe ensuite par les actions publiques du jeu, qui gardent le dernier mot (coûts, prérequis, file, ferme).
 */
export interface BuildTarget {
  building: BuildingKey;
  level: number;
}

export interface Plan {
  /** Ordre de priorité : on monte le premier bâtiment de la liste qui n'a pas atteint son niveau. */
  buildings: BuildTarget[];
  /** Effectif voulu par unité (troupes au village, en déplacement et en recrutement). */
  troops: Partial<Record<UnitKey, number>>;
  /** Part (0 à 100 %) du coût du prochain bâtiment que les troupes peuvent déjà utiliser. 0 = bâtiments d'abord. */
  troopsShare: number;
}

/** Nombre maximum de lignes de bâtiments dans un plan. */
export const MAX_PLAN_LINES = 60;

/** Durée maximale (en secondes réelles) d'un lot de recrutement, pour que la file reste réactive. */
export const MAX_LOT_SECONDS = 2 * 3600;

/** Prochain bâtiment à monter : le premier objectif non atteint, en passant par un prérequis manquant ou un entrepôt trop petit s'il le faut. */
export function nextBuilding(targets: BuildTarget[], levels: Buildings): { building: BuildingKey; level: number } | null {
  const want = (key: BuildingKey, depth = 0): BuildingKey | null => {
    if (depth > 4) return null;
    const def = BUILDINGS[key];
    for (const [req, lvl] of Object.entries(def.requires) as [BuildingKey, number][]) {
      if (levels[req] < lvl) return want(req, depth + 1);
    }
    if (levels[key] >= def.maxLevel) return null;
    // Un niveau plus cher que ce que l'entrepôt peut contenir ne serait jamais payé : l'entrepôt passe d'abord.
    const cost = buildingCost(key, levels[key] + 1);
    if (key !== 'warehouse' && Math.max(cost.wood, cost.clay, cost.iron, cost.wheat) > warehouseCapacity(levels.warehouse)) return want('warehouse', depth + 1);
    return key;
  };
  for (const t of targets) {
    if (levels[t.building] >= Math.min(t.level, BUILDINGS[t.building].maxLevel)) continue;
    const key = want(t.building);
    if (key) return { building: key, level: levels[key] + 1 };
  }
  return null;
}

/** Ressources mises de côté pour un bâtiment : la part `troopsShare` du coût reste accessible aux troupes. */
export function reserveFor(cost: Resources | null, troopsShare: number, capacity: number): Resources {
  const out = { wood: 0, clay: 0, iron: 0, wheat: 0 };
  if (!cost) return out;
  const keep = 1 - Math.min(100, Math.max(0, troopsShare)) / 100;
  // Un coût plus grand que l'entrepôt ne sera jamais atteint : rien n'est réservé pour lui.
  for (const r of RESOURCES) out[r] = cost[r] > capacity ? 0 : Math.ceil(cost[r] * keep);
  return out;
}

export const troopBudget = (stock: Resources, reserve: Resources): Resources => ({
  wood: Math.max(0, stock.wood - reserve.wood),
  clay: Math.max(0, stock.clay - reserve.clay),
  iron: Math.max(0, stock.iron - reserve.iron),
  wheat: Math.max(0, stock.wheat - reserve.wheat),
});

/**
 * Part de la production que les troupes peuvent prendre sur la réserve du prochain bâtiment (`troopsShare`).
 * `stock` : ressources du village ; `rates` : production horaire réelle.
 */
export interface Dip {
  stock: Resources;
  rates: Resources;
  share: number;
}

/**
 * Prochain lot de troupes : l'unité la plus en retard sur son objectif, dans la limite du budget, de la ferme et de la durée.
 * `budget` est ce qui dépasse le coût du prochain bâtiment. Avec `dip`, un lot peut aussi entamer la réserve du bâtiment,
 * d'au plus `share` % de deux heures de production ; `dipSeconds` dit pendant combien de temps les troupes ne doivent plus
 * y toucher, pour qu'elles n'en prennent jamais plus que `share` % de la production et que le bâtiment avance toujours.
 */
export function nextTroopLot(
  targets: Partial<Record<UnitKey, number>>,
  owned: UnitCounts,
  buildings: Buildings,
  budget: Resources,
  freePopulation: number,
  worldSpeed: number,
  dip?: Dip,
): { unit: UnitKey; count: number; dipSeconds: number } | null {
  const share = dip ? Math.min(100, Math.max(0, dip.share)) / 100 : 0;
  const allow = (r: (typeof RESOURCES)[number]) =>
    !dip || share <= 0 ? 0 : Math.max(0, Math.min(dip.stock[r] - budget[r], share * dip.rates[r] * (MAX_LOT_SECONDS / 3600)));
  const lots: { unit: UnitKey; count: number; late: number; dipSeconds: number }[] = [];
  for (const unit of UNIT_KEYS) {
    const goal = targets[unit] ?? 0;
    const missing = goal - owned[unit];
    const def = UNITS[unit];
    if (missing <= 0 || !meetsRequirements(buildings, def.requires)) continue;
    let count = missing;
    for (const r of RESOURCES) if (def.cost[r] > 0) count = Math.min(count, Math.floor((budget[r] + allow(r)) / def.cost[r]));
    count = Math.min(count, Math.floor(freePopulation / def.population), Math.floor(MAX_LOT_SECONDS / recruitTime(unit, buildings.barracks, worldSpeed)));
    if (count < 1) continue;
    let dipSeconds = 0;
    if (dip && share > 0) {
      for (const r of RESOURCES) {
        const taken = def.cost[r] * count - budget[r];
        if (taken > 0 && dip.rates[r] > 0) dipSeconds = Math.max(dipSeconds, Math.ceil((taken / (share * dip.rates[r])) * 3600));
      }
    }
    lots.push({ unit, count, late: missing / goal, dipSeconds });
  }
  lots.sort((a, b) => b.late - a.late);
  return lots[0] ? { unit: lots[0].unit, count: lots[0].count, dipSeconds: lots[0].dipSeconds } : null;
}

export const costOf = (next: { building: BuildingKey; level: number } | null) => (next ? buildingCost(next.building, next.level) : null);

/** Contrôle une liste reçue du client et renvoie un plan propre, ou un message d'erreur. */
export function parsePlan(raw: any): { plan: Plan } | { error: string } {
  if (!raw || typeof raw !== 'object') return { error: 'Réglage invalide' };
  const buildings: BuildTarget[] = [];
  if (!Array.isArray(raw.buildings) || raw.buildings.length > MAX_PLAN_LINES) return { error: `Liste de bâtiments invalide (${MAX_PLAN_LINES} lignes au plus)` };
  for (const b of raw.buildings) {
    if (!BUILDING_KEYS.includes(b?.building)) return { error: 'Bâtiment inconnu' };
    const level = Number(b.level);
    if (!Number.isInteger(level) || level < 1 || level > BUILDINGS[b.building as BuildingKey].maxLevel) return { error: 'Niveau cible invalide' };
    buildings.push({ building: b.building, level });
  }
  const troops: Plan['troops'] = {};
  for (const [unit, n] of Object.entries(raw.troops ?? {})) {
    if (!UNIT_KEYS.includes(unit as UnitKey)) return { error: 'Unité inconnue' };
    const count = Number(n);
    if (!Number.isInteger(count) || count < 0 || count > 1_000_000) return { error: "Effectif invalide" };
    if (count > 0) troops[unit as UnitKey] = count;
  }
  const share = Number(raw.troopsShare ?? 0);
  if (!Number.isInteger(share) || share < 0 || share > 100) return { error: 'La part des troupes doit être entre 0 et 100' };
  return { plan: { buildings, troops, troopsShare: share } };
}

/**
 * Modèles fournis à chaque joueur à sa première visite, trouvés par recherche locale sur le simulateur (tools/sim/optimize.ts) :
 * les mines montent très tôt et très haut (la production se cumule), la caserne juste assez pour une garde après la protection
 * débutant, puis caserne 25 pour remplir la ferme 20 au plus vite (environ 19 500 places de population vers le jour 45 à x1).
 */
export const PRESETS: { name: string; plan: Plan }[] = [
  {
    name: 'Offensif',
    plan: {
      buildings: [
        { building: 'ironmine', level: 3 }, { building: 'claypit', level: 3 }, { building: 'woodcutter', level: 7 },
        { building: 'claypit', level: 8 }, { building: 'ironmine', level: 10 }, { building: 'woodcutter', level: 10 },
        { building: 'warehouse', level: 6 }, { building: 'farm', level: 6 }, { building: 'claypit', level: 13 },
        { building: 'woodcutter', level: 15 }, { building: 'ironmine', level: 15 }, { building: 'claypit', level: 16 },
        { building: 'barracks', level: 3 }, { building: 'farm', level: 10 }, { building: 'warehouse', level: 14 },
        { building: 'woodcutter', level: 19 }, { building: 'claypit', level: 21 }, { building: 'ironmine', level: 21 },
        { building: 'farm', level: 20 }, { building: 'woodcutter', level: 25 }, { building: 'townhall', level: 8 },
        { building: 'claypit', level: 28 }, { building: 'ironmine', level: 27 }, { building: 'warehouse', level: 19 },
        { building: 'wall', level: 18 }, { building: 'woodcutter', level: 30 }, { building: 'warehouse', level: 24 },
        { building: 'ironmine', level: 30 }, { building: 'claypit', level: 30 }, { building: 'barracks', level: 25 },
        { building: 'market', level: 20 }, { building: 'townhall', level: 20 }, { building: 'warehouse', level: 30 },
      ],
      troops: { swordsman: 11500, cavalry: 1800, ram: 150, scout: 50 },
      troopsShare: 5,
    },
  },
  {
    name: 'Défensif',
    plan: {
      buildings: [
        { building: 'claypit', level: 4 }, { building: 'woodcutter', level: 7 }, { building: 'ironmine', level: 6 },
        { building: 'claypit', level: 9 }, { building: 'ironmine', level: 10 }, { building: 'woodcutter', level: 10 },
        { building: 'warehouse', level: 6 }, { building: 'claypit', level: 11 }, { building: 'farm', level: 6 },
        { building: 'woodcutter', level: 14 }, { building: 'claypit', level: 16 }, { building: 'ironmine', level: 15 },
        { building: 'warehouse', level: 15 }, { building: 'farm', level: 14 }, { building: 'woodcutter', level: 20 },
        { building: 'claypit', level: 21 }, { building: 'wall', level: 11 }, { building: 'ironmine', level: 21 },
        { building: 'woodcutter', level: 27 }, { building: 'market', level: 2 }, { building: 'warehouse', level: 21 },
        { building: 'barracks', level: 3 }, { building: 'claypit', level: 30 }, { building: 'farm', level: 20 },
        { building: 'ironmine', level: 25 }, { building: 'townhall', level: 6 }, { building: 'woodcutter', level: 30 },
        { building: 'market', level: 20 }, { building: 'townhall', level: 20 }, { building: 'ironmine', level: 30 },
        { building: 'wall', level: 20 }, { building: 'barracks', level: 25 }, { building: 'warehouse', level: 30 },
      ],
      troops: { spearman: 9500, halberdier: 9900, scout: 250 },
      troopsShare: 10,
    },
  },
];
