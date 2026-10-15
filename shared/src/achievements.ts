/**
 * Succès : des paliers bronze, argent et or sur des compteurs que le jeu tient déjà (points, conquêtes, batailles…).
 * Chaque palier atteint donne un badge visible sur le profil et un trésor dans l'inventaire (part de l'entrepôt, réglée
 * dans l'administration). Les seuils ci-dessous sont multipliés par le réglage « Difficulté des succès » (100 = tels quels).
 */

export const ACHIEVEMENT_TIERS = ['bronze', 'silver', 'gold'] as const;
export type AchievementTier = (typeof ACHIEVEMENT_TIERS)[number];

export const TIER_LABELS: Record<AchievementTier, string> = { bronze: 'Bronze', silver: 'Argent', gold: 'Or' };

/** Compteurs d'un joueur sur lesquels portent les succès. */
export interface AchievementStats {
  points: number;
  villages: number;
  conquests: number;
  attackWins: number;
  defenseWins: number;
  killsAttack: number;
  killsDefense: number;
  loot: number;
  quests: number;
  crusadeTitles: number;
}
export type AchievementMetric = keyof AchievementStats;

export interface AchievementDef {
  key: string;
  title: string;
  /** Ce qu'il faut faire, avec `{n}` remplacé par le seuil du palier et `{s}` par le pluriel. */
  goal: string;
  metric: AchievementMetric;
  /** Seuils bronze, argent, or (avant le réglage de difficulté). */
  thresholds: [number, number, number];
}

export const ACHIEVEMENTS: AchievementDef[] = [
  { key: 'builder', title: 'Bâtisseur', goal: 'Atteignez {n} point{s}', metric: 'points', thresholds: [1_000, 15_000, 60_000] },
  { key: 'lord', title: 'Seigneur de domaines', goal: 'Possédez {n} village{s}', metric: 'villages', thresholds: [2, 5, 12] },
  { key: 'conqueror', title: 'Conquérant', goal: 'Prenez {n} village{s} à d’autres joueurs', metric: 'conquests', thresholds: [1, 10, 40] },
  { key: 'raider', title: 'Pillard', goal: 'Rapportez {n} ressource{s} de vos pillages', metric: 'loot', thresholds: [10_000, 250_000, 2_000_000] },
  { key: 'warlord', title: 'Chef de guerre', goal: 'Gagnez {n} attaque{s} contre des joueurs', metric: 'attackWins', thresholds: [10, 100, 500] },
  { key: 'guardian', title: 'Gardien', goal: 'Repoussez {n} attaque{s}', metric: 'defenseWins', thresholds: [10, 100, 500] },
  { key: 'slayer', title: 'Fléau des armées', goal: 'Battez {n} adversaire{s} en attaque', metric: 'killsAttack', thresholds: [500, 5_000, 50_000] },
  { key: 'bulwark', title: 'Rempart', goal: 'Battez {n} adversaire{s} en défense', metric: 'killsDefense', thresholds: [500, 5_000, 50_000] },
  { key: 'crusader', title: 'Croisé', goal: 'Gagnez {n} titre{s} de croisade', metric: 'crusadeTitles', thresholds: [1, 3, 8] },
  { key: 'apprentice', title: 'Premiers pas', goal: 'Terminez {n} quête{s} de départ', metric: 'quests', thresholds: [3, 6, 10] },
];

/** Seuil d'un palier après le réglage de difficulté (en %), jamais sous 1. */
export function achievementThreshold(def: AchievementDef, tier: AchievementTier, scalePercent: number): number {
  const base = def.thresholds[ACHIEVEMENT_TIERS.indexOf(tier)];
  return Math.max(1, Math.round((base * scalePercent) / 100));
}

/** Paliers atteints pour un succès, du plus bas au plus haut. */
export function reachedTiers(def: AchievementDef, stats: AchievementStats, scalePercent: number): AchievementTier[] {
  return ACHIEVEMENT_TIERS.filter((t) => stats[def.metric] >= achievementThreshold(def, t, scalePercent));
}

export function achievementGoal(def: AchievementDef, tier: AchievementTier, scalePercent: number): string {
  const n = achievementThreshold(def, tier, scalePercent);
  return def.goal.replace('{n}', n.toLocaleString('fr-FR')).replace('{s}', n > 1 ? 's' : '');
}

/** Un badge : le plus haut palier obtenu d'un succès. */
export interface AchievementBadge {
  key: string;
  title: string;
  tier: AchievementTier;
}

/** Page des succès d'un joueur. */
export interface AchievementView {
  key: string;
  title: string;
  value: number;
  tiers: { tier: AchievementTier; goal: string; threshold: number; earnedAt: string | null; reward: number }[];
}

export interface AchievementsPage {
  enabled: boolean;
  achievements: AchievementView[];
}
