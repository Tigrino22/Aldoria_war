import { type UnitCounts, UNITS, emptyUnits, populationCapacity, populationOf } from '@aldoria/shared';
import type { NpcProfile } from './npc-rules';

/** Nobles envoyés avec chaque assaut d'un conquérant. */
export const NOBLES_PER_CONQUEST = 4;

/**
 * Rôle d'un village de PNJ : l'armée qu'on y recrute en dépend. Un village offensif forme une force de frappe (épéistes, cavaliers,
 * béliers, nobles) avec une petite garde ; un village défensif aligne lanciers et hallebardiers avec une petite troupe de pillage.
 * Aucun PNJ ne recrute au hasard : chaque unité a sa place dans un rôle. Règles pures, sans base de données.
 */
export type VillageRole = 'offense' | 'defense';

export const ROLE_LABEL: Record<VillageRole, string> = { offense: 'Offensif', defense: 'Défensif' };

/** Part des villages d'un PNJ consacrée à l'attaque : les pillards et conquérants sont surtout offensifs, les bâtisseurs surtout défensifs. */
export const OFFENSE_SHARE: Record<NpcProfile, number> = { builder: 0.3, raider: 0.7, conqueror: 0.6 };

/**
 * Rôle de chacun des `count` villages d'un PNJ, dans l'ordre de leur création. Avec un seul village, le profil décide.
 * Avec plusieurs, l'équilibre est garanti : au moins un village de chaque rôle, offensifs répartis régulièrement (le premier village,
 * la capitale, reste défensif quand il n'y en a qu'un offensif sur deux).
 */
export function villageRoles(profile: NpcProfile, count: number): VillageRole[] {
  const share = OFFENSE_SHARE[profile];
  if (count <= 0) return [];
  if (count === 1) return [share >= 0.5 ? 'offense' : 'defense'];
  const offensive = Math.min(count - 1, Math.max(1, Math.round(count * share)));
  const roles: VillageRole[] = Array(count).fill('defense');
  for (let k = 0; k < offensive; k++) roles[Math.floor(((k + 0.5) * count) / offensive)] = 'offense';
  return roles;
}

/** Niveaux d'avance de la ferme sur le plafond : elle loge l'armée, donc elle monte plus haut que le reste. */
export const FARM_LEAD = 3;

/** Niveau de ferme visé selon le plafond de niveau : la population de ce niveau est l'effectif à atteindre. */
export const farmTarget = (cap: number) => Math.min(20, cap + FARM_LEAD);

/** Éclaireurs d'un village offensif : de plus en plus nombreux avec le niveau et la difficulté (11 au départ, 60 au plus), pour passer les éclaireurs d'un défenseur. */
export const offenseScouts = (cap: number, difficulty: number) => Math.min(60, Math.round((6 + cap * 2.5) * Math.max(1, difficulty)));
/** Éclaireurs d'un village défensif : un tiers de ceux d'un village offensif, jamais moins de 5 (une mission d'espionnage crédible). */
export const defenseScouts = (cap: number, difficulty: number) => Math.max(5, Math.round(offenseScouts(cap, difficulty) / 3));

/**
 * Armée visée par un village de rôle `role` au niveau `cap` : les unités dont les bâtiments manquent encore sont ignorées au recrutement.
 * Les proportions dépendent du rôle ; l'effectif total remplit la ferme visée (`farmTarget`), éclaireurs et nobles compris. Une difficulté
 * inférieure à 1 ne remplit qu'une partie de la ferme.
 */
export function armyTarget(profile: NpcProfile, role: VillageRole, cap: number, difficulty: number): UnitCounts {
  const t = emptyUnits();
  // Proportions de la masse de troupes (par « part »), les éclaireurs et les nobles étant à effectif fixe.
  const shares: Partial<UnitCounts> =
    role === 'offense' ? { swordsman: 7, cavalry: 2, spearman: 1, ram: profile === 'conqueror' ? 1 : 0 } : { spearman: 5, halberdier: 5, swordsman: 1 };
  if (role === 'offense') {
    t.scout = offenseScouts(cap, difficulty);
    // Quatre nobles font tomber la loyauté d'un village dans trois cas sur quatre (20 à 35 points chacun).
    if (profile !== 'builder' && cap >= 10) t.noble = NOBLES_PER_CONQUEST;
  } else {
    t.scout = defenseScouts(cap, difficulty);
  }
  const budget = populationCapacity(farmTarget(cap)) * Math.min(1, Math.max(0, difficulty)) - populationOf(t);
  const perShare = (Object.entries(shares) as [keyof UnitCounts, number][]).reduce((sum, [k, n]) => sum + n * UNITS[k].population, 0);
  const parts = Math.max(0, budget) / perShare;
  for (const [k, n] of Object.entries(shares) as [keyof UnitCounts, number][]) t[k] = Math.floor(n * parts);
  return t;
}
