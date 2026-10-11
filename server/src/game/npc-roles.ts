import { type UnitCounts, emptyUnits } from '@aldoria/shared';
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

/** Éclaireurs d'un village offensif : de plus en plus nombreux avec le niveau et la difficulté, pour passer les éclaireurs d'un défenseur. */
export const offenseScouts = (cap: number, difficulty: number) => Math.min(30, Math.round((4 + cap * 1.5) * Math.max(1, difficulty)));

/** Armée visée par un village de rôle `role` au niveau `cap` : les unités dont les bâtiments manquent encore sont ignorées au recrutement. */
export function armyTarget(profile: NpcProfile, role: VillageRole, cap: number, difficulty: number): UnitCounts {
  // Un village dont le rôle ne correspond pas au tempérament du PNJ (un bâtisseur qui attaque, un pillard qui défend) y met moins d'efforts.
  const fit = (role === 'offense') === (profile !== 'builder') ? 1 : 0.6;
  const scale = (n: number) => Math.round(n * cap * difficulty);
  const t = emptyUnits();
  if (role === 'offense') {
    t.swordsman = scale(7 * fit);
    t.cavalry = scale(2 * fit);
    t.scout = offenseScouts(cap, difficulty);
    t.spearman = scale(1);
    if (profile === 'conqueror') t.ram = scale(1);
    // Quatre nobles font tomber la loyauté d'un village dans trois cas sur quatre (20 à 35 points chacun).
    if (profile !== 'builder' && cap >= 10) t.noble = NOBLES_PER_CONQUEST;
  } else {
    t.spearman = scale(5 * fit);
    t.halberdier = scale(5 * fit);
    t.swordsman = scale(1);
    t.scout = 2;
  }
  return t;
}
