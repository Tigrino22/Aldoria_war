import {
  BUILDINGS,
  BUILDING_KEYS,
  RESOURCES,
  UNITS,
  UNIT_KEYS,
  buildingCost,
  meetsRequirements,
  recruitTime,
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

/** Durée maximale (en secondes de jeu) d'un lot de recrutement, pour que la file reste réactive. */
export const MAX_LOT_SECONDS = 2 * 3600;

/** Prochain bâtiment à monter : le premier objectif non atteint, en passant par un prérequis manquant s'il le faut. */
export function nextBuilding(targets: BuildTarget[], levels: Buildings): { building: BuildingKey; level: number } | null {
  const want = (key: BuildingKey, depth = 0): BuildingKey | null => {
    if (depth > 4) return null;
    const def = BUILDINGS[key];
    for (const [req, lvl] of Object.entries(def.requires) as [BuildingKey, number][]) {
      if (levels[req] < lvl) return want(req, depth + 1);
    }
    return levels[key] < def.maxLevel ? key : null;
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

/** Prochain lot de troupes : l'unité la plus en retard sur son objectif, dans la limite du budget, de la ferme et de la durée. */
export function nextTroopLot(
  targets: Partial<Record<UnitKey, number>>,
  owned: UnitCounts,
  buildings: Buildings,
  budget: Resources,
  freePopulation: number,
  worldSpeed: number,
): { unit: UnitKey; count: number } | null {
  const lots: { unit: UnitKey; count: number; late: number }[] = [];
  for (const unit of UNIT_KEYS) {
    const goal = targets[unit] ?? 0;
    const missing = goal - owned[unit];
    const def = UNITS[unit];
    if (missing <= 0 || !meetsRequirements(buildings, def.requires)) continue;
    let count = missing;
    for (const r of RESOURCES) if (def.cost[r] > 0) count = Math.min(count, Math.floor(budget[r] / def.cost[r]));
    count = Math.min(count, Math.floor(freePopulation / def.population), Math.floor(MAX_LOT_SECONDS / recruitTime(unit, buildings.barracks, worldSpeed)));
    if (count >= 1) lots.push({ unit, count, late: missing / goal });
  }
  lots.sort((a, b) => b.late - a.late);
  return lots[0] ? { unit: lots[0].unit, count: lots[0].count } : null;
}

export const costOf = (next: { building: BuildingKey; level: number } | null) => (next ? buildingCost(next.building, next.level) : null);

/** Contrôle une liste reçue du client et renvoie un plan propre, ou un message d'erreur. */
export function parsePlan(raw: any): { plan: Plan } | { error: string } {
  if (!raw || typeof raw !== 'object') return { error: 'Réglage invalide' };
  const buildings: BuildTarget[] = [];
  if (!Array.isArray(raw.buildings) || raw.buildings.length > 40) return { error: 'Liste de bâtiments invalide (40 lignes au plus)' };
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

/** Modèles fournis à chaque joueur à sa première visite. */
export const PRESETS: { name: string; plan: Plan }[] = [
  {
    name: 'Offensif',
    plan: {
      buildings: [
        { building: 'farm', level: 8 }, { building: 'warehouse', level: 8 }, { building: 'barracks', level: 10 },
        { building: 'woodcutter', level: 10 }, { building: 'claypit', level: 10 }, { building: 'ironmine', level: 10 },
        { building: 'farm', level: 15 }, { building: 'barracks', level: 15 }, { building: 'warehouse', level: 14 },
        { building: 'farm', level: 20 }, { building: 'barracks', level: 20 },
      ],
      troops: { swordsman: 2000, cavalry: 800, ram: 100, scout: 40 },
      troopsShare: 30,
    },
  },
  {
    name: 'Défensif',
    plan: {
      buildings: [
        { building: 'farm', level: 10 }, { building: 'warehouse', level: 10 }, { building: 'barracks', level: 8 },
        { building: 'wall', level: 10 }, { building: 'woodcutter', level: 10 }, { building: 'claypit', level: 10 },
        { building: 'ironmine', level: 10 }, { building: 'farm', level: 20 }, { building: 'wall', level: 20 },
        { building: 'warehouse', level: 16 },
      ],
      troops: { spearman: 3000, halberdier: 2000, swordsman: 300, scout: 30 },
      troopsShare: 30,
    },
  },
];
