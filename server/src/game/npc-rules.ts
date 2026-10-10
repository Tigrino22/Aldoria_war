import {
  BUILDINGS,
  BUILDING_KEYS,
  type BuildingKey,
  type Buildings,
  type UnitCounts,
  UNIT_KEYS,
  UNITS,
  emptyUnits,
  meetsRequirements,
  resolveCombat,
  wallDuringCombat,
} from '@aldoria/shared';

// Règles pures des PNJ : pas de base de données ni d'horloge ici, pour pouvoir les tester facilement.

export type NpcProfile = 'builder' | 'raider';
export const NPC_PROFILES: NpcProfile[] = ['builder', 'raider'];

export const PROFILE_LABEL: Record<NpcProfile, string> = {
  builder: 'Bâtisseur',
  raider: 'Pillard',
};

/** Heure (0-23) dans un fuseau donné. */
export function hourIn(date: Date, timeZone: string): number {
  const parts = new Intl.DateTimeFormat('en-GB', { hour: 'numeric', hourCycle: 'h23', timeZone }).formatToParts(date);
  return Number(parts.find((p) => p.type === 'hour')?.value ?? 0);
}

/** Heures calmes : par défaut de 22 h à 8 h, les PNJ n'attaquent ni n'espionnent les joueurs. */
export function isQuiet(date: Date, timeZone: string, start: number, end: number): boolean {
  const h = hourIn(date, timeZone);
  return start <= end ? h >= start && h < end : h >= start || h < end;
}

/** Niveau maximal que les PNJ visent selon l'âge du monde : ils suivent un rythme régulier, sans dépasser le niveau 20. */
export function npcCap(worldDays: number, difficulty: number): number {
  return Math.max(2, Math.min(20, 2 + Math.floor(Math.max(0, worldDays) * 0.5 * difficulty)));
}

/** Importance donnée à chaque bâtiment : plus le poids est fort, plus le PNJ le monte haut. */
const BUILD_WEIGHTS: Record<NpcProfile, Record<BuildingKey, number>> = {
  builder: { townhall: 1, woodcutter: 1.2, claypit: 1.2, ironmine: 1.1, farm: 1.2, warehouse: 1, market: 0.4, barracks: 0.8, wall: 1.1 },
  raider: { townhall: 0.9, woodcutter: 0.9, claypit: 0.9, ironmine: 1.3, farm: 1.1, warehouse: 0.7, market: 0.1, barracks: 1.4, wall: 0.4 },
};

/** Le prochain bâtiment à monter : le plus en retard par rapport à son poids, sous le plafond, conditions remplies. */
export function chooseBuilding(profile: NpcProfile, levels: Buildings, cap: number): BuildingKey | null {
  let best: BuildingKey | null = null;
  let bestScore = Infinity;
  for (const key of BUILDING_KEYS) {
    const level = levels[key];
    if (level >= Math.min(cap, BUILDINGS[key].maxLevel)) continue;
    if (!meetsRequirements(levels, BUILDINGS[key].requires)) continue;
    // Le marché ne sert à rien à un PNJ avant que le reste ne soit bien avancé.
    if (key === 'market' && cap < 6) continue;
    const score = level / BUILD_WEIGHTS[profile][key];
    if (score < bestScore) {
      bestScore = score;
      best = key;
    }
  }
  return best;
}

/** Armée visée par le PNJ au niveau `cap` (les unités dont il n'a pas encore les bâtiments sont ignorées au recrutement). */
export function armyTarget(profile: NpcProfile, cap: number, difficulty: number): UnitCounts {
  const scale = (n: number) => Math.round(n * cap * difficulty);
  const t = emptyUnits();
  if (profile === 'builder') {
    t.spearman = scale(6);
    t.swordsman = scale(2);
    t.scout = 2;
  } else {
    t.swordsman = scale(6);
    t.cavalry = scale(2);
    t.spearman = scale(2);
    t.scout = 4;
  }
  return t;
}

/** Unité à recruter en priorité : celle qui manque le plus par rapport à la cible, parmi celles qu'il peut recruter. */
export function nextRecruit(
  profile: NpcProfile,
  buildings: Buildings,
  owned: UnitCounts,
  cap: number,
  difficulty: number,
): { unit: (typeof UNIT_KEYS)[number]; count: number }[] {
  const target = armyTarget(profile, cap, difficulty);
  return UNIT_KEYS.filter((k) => target[k] > owned[k] && meetsRequirements(buildings, UNITS[k].requires))
    .map((k) => ({ unit: k, deficit: target[k] - owned[k], ratio: (target[k] - owned[k]) / target[k] }))
    .sort((a, b) => b.ratio - a.ratio)
    .map(({ unit, deficit }) => ({ unit, count: Math.max(1, Math.min(15, Math.ceil(deficit / 3))) }));
}

/** Marge de sécurité demandée avant d'attaquer : la force d'attaque doit dépasser 1,3 fois la défense estimée. */
export const ATTACK_MARGIN = 1.3;

/** Plus petite part de l'armée disponible qui bat la défense estimée avec la marge voulue, ou null si même toute l'armée ne suffit pas. */
export function pickWinningUnits(available: UnitCounts, defenders: UnitCounts, wall: number): UnitCounts | null {
  for (const share of [0.25, 0.35, 0.5, 0.7, 1]) {
    const units = emptyUnits();
    for (const k of UNIT_KEYS) units[k] = Math.floor(available[k] * share);
    if (UNIT_KEYS.every((k) => units[k] === 0)) continue;
    const r = resolveCombat({ attackers: units, defenders: [defenders], wallLevel: wallDuringCombat(wall, units.ram) });
    if (r.attackPower >= ATTACK_MARGIN * r.defensePower) return units;
  }
  return null;
}
