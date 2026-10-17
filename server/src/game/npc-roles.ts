import { type UnitKey } from '@aldoria/shared';
import { PRESETS, type BuildTarget, type Plan } from '../manager/rules';

/**
 * Les deux types de PNJ, défensif et offensif, qui sont aussi les rôles de leurs villages. Chaque village suit à la lettre le modèle
 * du gestionnaire de compte de son rôle (ordre de construction et troupes visées), avec deux ajouts : la caserne qu'il faut pour piller
 * dès le début, et les bâtiments du noble (hôtel de ville et caserne 10, entrepôt qui contient son prix) dès que l'économie de base tourne.
 * Règles pures, sans base de données.
 */
export type VillageRole = 'offense' | 'defense';

export const ROLE_LABEL: Record<VillageRole, string> = { offense: 'Offensif', defense: 'Défensif' };

/** Modèle du gestionnaire suivi par un village de PNJ selon son rôle (le même que celui des joueurs). */
export const ROLE_PRESET: Record<VillageRole, string> = { offense: 'Offensif', defense: 'Défensif' };

/**
 * Rôle de chacun des `count` villages d'un PNJ, dans l'ordre de leur création. Avec un seul village, son type décide.
 * Dès le deuxième village, la gestion devient mixte : les rôles alternent (moitié offensive, moitié défensive), en commençant par son type.
 */
export function villageRoles(type: VillageRole, count: number): VillageRole[] {
  const other: VillageRole = type === 'offense' ? 'defense' : 'offense';
  return Array.from({ length: Math.max(0, count) }, (_, i) => (i % 2 === 0 ? type : other));
}

/** Part des troupes (curseur « troupes / bâtiments » du gestionnaire) : 30 % de la production réservée au prochain bâtiment peut aller aux troupes. */
export const NPC_TROOPS_SHARE = 30;

/** Nobles visés par village : deux dans un village offensif (un petit train), un dans un village défensif. Une conquête n'en demande qu'un. */
export const NOBLE_GOAL: Record<VillageRole, number> = { offense: 2, defense: 1 };

/** Unité des pillages : 50 lanciers pour un village défensif, 50 épéistes pour un village offensif. */
export const RAID_UNIT: Record<VillageRole, UnitKey> = { offense: 'swordsman', defense: 'spearman' };
export const RAID_SIZE = 50;

/** Caserne qu'il faut pour recruter l'unité de pillage. */
const RAID_BARRACKS: Record<VillageRole, number> = { offense: 3, defense: 1 };
/** Lignes du modèle construites avant la caserne de pillage : les premières mines. */
const RAID_AFTER = 2;

/** Ce qu'exige un noble : hôtel de ville et caserne 10, et un entrepôt qui contient ses 12 000 d'argile et de fer. */
export const NOBLE_BUILDINGS: BuildTarget[] = [
  { building: 'warehouse', level: 14 },
  { building: 'townhall', level: 10 },
  { building: 'barracks', level: 10 },
];
/** Lignes du modèle construites avant les bâtiments du noble (mines à 15 environ, entrepôt et ferme lancés). */
export const NOBLE_AFTER: Record<VillageRole, number> = { offense: 11, defense: 11 };

/** Plan d'un village de PNJ : le modèle du gestionnaire de son rôle, avec la caserne de pillage et les bâtiments du noble insérés. */
export function npcPlan(role: VillageRole): Plan {
  const preset = PRESETS.find((p) => p.name === ROLE_PRESET[role])!.plan;
  const lines = [...preset.buildings];
  lines.splice(NOBLE_AFTER[role], 0, ...NOBLE_BUILDINGS);
  lines.splice(RAID_AFTER, 0, { building: 'barracks', level: RAID_BARRACKS[role] });
  return {
    buildings: lines,
    troops: { ...preset.troops, [RAID_UNIT[role]]: Math.max(preset.troops[RAID_UNIT[role]] ?? 0, RAID_SIZE), noble: NOBLE_GOAL[role] },
    troopsShare: NPC_TROOPS_SHARE,
  };
}
