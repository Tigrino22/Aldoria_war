import {
  ACHIEVEMENTS,
  ACHIEVEMENT_TIERS,
  TIER_LABELS,
  achievementGoal,
  achievementThreshold,
  reachedTiers,
  type AchievementBadge,
  type AchievementStats,
  type AchievementTier,
  type AchievementsPage,
} from '@aldoria/shared';
import type { Db } from '../db';
import { env } from '../env';
import type { Outbox } from '../notify';
import { grantItem } from './items';
import { createReport } from './reports';

type Q = Pick<Db, 'query'>;

/** Succès (voir shared/src/achievements.ts) : compteurs des joueurs, paliers gagnés, badges et coffres. */

const rewardOf = (tier: AchievementTier): number =>
  tier === 'gold' ? env.achievementRewardGold : tier === 'silver' ? env.achievementRewardSilver : env.achievementRewardBronze;

/** Compteurs de plusieurs joueurs d'un coup (une seule requête). */
export async function loadAchievementStats(c: Q, playerIds: number[]): Promise<Map<number, AchievementStats>> {
  const { rows } = await c.query(
    `SELECT p.id, p.conquests, p.attack_wins, p.defense_wins, p.kills_attack::float8 AS kills_attack, p.kills_defense::float8 AS kills_defense,
            p.loot_total::float8 AS loot,
            (SELECT coalesce(sum(points), 0)::int FROM villages WHERE owner_id = p.id) AS points,
            (SELECT count(*)::int FROM villages WHERE owner_id = p.id) AS villages,
            (SELECT count(*)::int FROM quest_claims WHERE player_id = p.id) AS quests,
            (SELECT count(*)::int FROM player_titles WHERE player_id = p.id) AS titles
     FROM players p WHERE p.id = ANY($1)`,
    [playerIds],
  );
  return new Map(
    rows.map((r) => [
      r.id,
      {
        points: r.points,
        villages: r.villages,
        conquests: r.conquests,
        attackWins: r.attack_wins,
        defenseWins: r.defense_wins,
        killsAttack: r.kills_attack,
        killsDefense: r.kills_defense,
        loot: r.loot,
        quests: r.quests,
        crusadeTitles: r.titles,
      },
    ]),
  );
}

/**
 * Donne aux joueurs les paliers qu'ils viennent d'atteindre : un badge, un coffre par palier (si le réglage le prévoit)
 * et un seul rapport qui les résume. Rien pour les PNJ, ni quand les succès sont désactivés.
 */
export async function awardAchievements(c: Db, outbox: Outbox, playerIds: number[], now: Date): Promise<number> {
  if (!env.achievements || !playerIds.length) return 0;
  const humans = (await c.query('SELECT id FROM players WHERE id = ANY($1) AND NOT is_npc', [playerIds])).rows.map((r) => r.id as number);
  if (!humans.length) return 0;
  const stats = await loadAchievementStats(c, humans);
  const owned = new Set(
    (await c.query('SELECT player_id, key, tier FROM player_achievements WHERE player_id = ANY($1)', [humans])).rows.map((r) => `${r.player_id}:${r.key}:${r.tier}`),
  );
  let awarded = 0;
  for (const id of humans) {
    const s = stats.get(id);
    if (!s) continue;
    const fresh: { title: string; tier: AchievementTier; goal: string; reward: number }[] = [];
    for (const def of ACHIEVEMENTS) {
      for (const tier of reachedTiers(def, s, env.achievementScale)) {
        if (owned.has(`${id}:${def.key}:${tier}`)) continue;
        const ins = await c.query(
          'INSERT INTO player_achievements (player_id, key, tier, earned_at) VALUES ($1, $2, $3, $4) ON CONFLICT DO NOTHING RETURNING key',
          [id, def.key, tier, now],
        );
        if (!ins.rowCount) continue;
        const reward = rewardOf(tier);
        if (reward > 0) await grantItem(c, id, 'chest', reward, `${def.title} · ${TIER_LABELS[tier]}`, now);
        fresh.push({ title: def.title, tier, goal: achievementGoal(def, tier, env.achievementScale), reward });
      }
    }
    if (!fresh.length) continue;
    awarded += fresh.length;
    const title =
      fresh.length === 1 ? `Succès obtenu : ${fresh[0].title} (${TIER_LABELS[fresh[0].tier]})` : `${fresh.length} succès obtenus`;
    await createReport(c, outbox, id, 'achievement', title, { earned: fresh }, now);
    outbox.push(id, { type: 'me' });
  }
  return awarded;
}

/** Passe régulière sur tous les joueurs (hors PNJ). */
export async function processAchievements(c: Db, outbox: Outbox, now: Date): Promise<number> {
  if (!env.achievements) return 0;
  const ids = (await c.query('SELECT id FROM players WHERE NOT is_npc')).rows.map((r) => r.id as number);
  return awardAchievements(c, outbox, ids, now);
}

/** Page des succès d'un joueur : progression, paliers gagnés et coffres prévus. */
export async function achievementsPage(c: Q, playerId: number): Promise<AchievementsPage> {
  const stats = (await loadAchievementStats(c, [playerId])).get(playerId);
  const earned = new Map(
    (await c.query('SELECT key, tier, earned_at FROM player_achievements WHERE player_id = $1', [playerId])).rows.map((r) => [
      `${r.key}:${r.tier}`,
      new Date(r.earned_at).toISOString(),
    ]),
  );
  return {
    enabled: !!env.achievements,
    achievements: ACHIEVEMENTS.map((def) => ({
      key: def.key,
      title: def.title,
      value: stats?.[def.metric] ?? 0,
      tiers: ACHIEVEMENT_TIERS.map((tier) => ({
        tier,
        goal: achievementGoal(def, tier, env.achievementScale),
        threshold: achievementThreshold(def, tier, env.achievementScale),
        earnedAt: earned.get(`${def.key}:${tier}`) ?? null,
        reward: rewardOf(tier),
      })),
    })),
  };
}

/** Badges d'un joueur pour son profil : le plus haut palier de chaque succès, dans l'ordre des succès. */
export async function badgesOf(c: Q, playerId: number): Promise<AchievementBadge[]> {
  const best = new Map<string, AchievementTier>();
  for (const r of (await c.query('SELECT key, tier FROM player_achievements WHERE player_id = $1', [playerId])).rows) {
    const cur = best.get(r.key);
    if (!cur || ACHIEVEMENT_TIERS.indexOf(r.tier) > ACHIEVEMENT_TIERS.indexOf(cur)) best.set(r.key, r.tier);
  }
  return ACHIEVEMENTS.filter((d) => best.has(d.key)).map((d) => ({ key: d.key, title: d.title, tier: best.get(d.key)! }));
}

/** Ressources pillées par un joueur, pour le succès « Pillard ». */
export async function addLoot(c: Db, playerId: number | null, amount: number) {
  if (!playerId || amount <= 0) return;
  await c.query('UPDATE players SET loot_total = loot_total + $2 WHERE id = $1', [playerId, Math.floor(amount)]);
}
