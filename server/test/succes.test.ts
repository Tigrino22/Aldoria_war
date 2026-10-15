import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { ACHIEVEMENTS, achievementThreshold, reachedTiers, type AchievementStats } from '@aldoria/shared';
import { buildApp } from '../src/app';
import { pool, tx } from '../src/db';
import { env } from '../src/env';
import { migrate } from '../src/migrate';
import { Outbox } from '../src/notify';
import { processAchievements } from '../src/game/achievements';

let app: Awaited<ReturnType<typeof buildApp>>;

async function register(username: string) {
  const res = await app.inject({ method: 'POST', url: '/api/auth/register', payload: { username, password: 'secret123' } });
  expect(res.statusCode).toBe(200);
  return { authorization: `Bearer ${res.json().token as string}` };
}

beforeAll(async () => {
  await migrate(true);
  app = await buildApp();
});
afterAll(async () => {
  await app.close();
  await pool.end();
});

const zero: AchievementStats = { points: 0, villages: 0, conquests: 0, attackWins: 0, defenseWins: 0, killsAttack: 0, killsDefense: 0, loot: 0, quests: 0, crusadeTitles: 0 };
const warlord = ACHIEVEMENTS.find((a) => a.key === 'warlord')!;

describe('règles des succès', () => {
  it('les seuils suivent le réglage de difficulté', () => {
    expect(achievementThreshold(warlord, 'bronze', 100)).toBe(10);
    expect(achievementThreshold(warlord, 'gold', 50)).toBe(250);
    expect(achievementThreshold(warlord, 'bronze', 1)).toBe(1);
    expect(reachedTiers(warlord, { ...zero, attackWins: 120 }, 100)).toEqual(['bronze', 'silver']);
    expect(reachedTiers(warlord, { ...zero, attackWins: 120 }, 20)).toEqual(['bronze', 'silver', 'gold']);
  });

  it('chaque succès a trois seuils croissants et une clé unique', () => {
    expect(new Set(ACHIEVEMENTS.map((a) => a.key)).size).toBe(ACHIEVEMENTS.length);
    for (const a of ACHIEVEMENTS) expect(a.thresholds[0] < a.thresholds[1] && a.thresholds[1] < a.thresholds[2]).toBe(true);
  });
});

describe('succès des joueurs', () => {
  it('donne badge, coffre et rapport une seule fois par palier, et rien aux PNJ ni quand c’est désactivé', async () => {
    const h = await register('Vaillant');
    const id = (await pool.query("SELECT id FROM players WHERE username = 'Vaillant'")).rows[0].id as number;
    const page = async () => (await app.inject({ method: 'GET', url: '/api/achievements', headers: h })).json();
    const tierOf = (p: any, key: string) => p.achievements.find((a: any) => a.key === key).tiers.filter((t: any) => t.earnedAt).map((t: any) => t.tier);

    // Le village de départ ne suffit à rien.
    expect(tierOf(await page(), 'warlord')).toEqual([]);

    await pool.query('UPDATE players SET attack_wins = 10 WHERE id = $1', [id]);
    const p1 = await page();
    expect(tierOf(p1, 'warlord')).toEqual(['bronze']);
    expect(p1.achievements.find((a: any) => a.key === 'warlord').value).toBe(10);
    // Un deuxième passage ne redonne rien.
    await page();
    const items = (await pool.query("SELECT percent, source FROM player_items WHERE player_id = $1 AND kind = 'chest'", [id])).rows;
    expect(items).toEqual([{ percent: env.achievementRewardBronze, source: 'Chef de guerre · Bronze' }]);
    expect((await pool.query("SELECT title FROM reports WHERE player_id = $1 AND type = 'achievement'", [id])).rows).toEqual([
      { title: 'Succès obtenu : Chef de guerre (Bronze)' },
    ]);

    // Badge sur le profil : le plus haut palier.
    await pool.query('UPDATE players SET attack_wins = 100, loot_total = 10000 WHERE id = $1', [id]);
    await tx(async (c) => processAchievements(c, new Outbox(), new Date()));
    const profile = (await app.inject({ method: 'GET', url: '/api/players/Vaillant', headers: h })).json();
    expect(profile.badges).toEqual([
      { key: 'raider', title: 'Pillard', tier: 'bronze' },
      { key: 'warlord', title: 'Chef de guerre', tier: 'silver' },
    ]);
    expect((await pool.query("SELECT title FROM reports WHERE player_id = $1 AND type = 'achievement' ORDER BY id DESC LIMIT 1", [id])).rows[0].title).toBe('2 succès obtenus');

    // Désactivés : plus aucun nouveau palier.
    env.achievements = 0;
    await pool.query('UPDATE players SET attack_wins = 500 WHERE id = $1', [id]);
    await tx(async (c) => processAchievements(c, new Outbox(), new Date()));
    expect(tierOf(await page(), 'warlord')).toEqual(['bronze', 'silver']);
    env.achievements = 1;

    // Les PNJ ne reçoivent rien.
    await pool.query('UPDATE players SET is_npc = true, defense_wins = 500 WHERE id = $1', [id]);
    await tx(async (c) => processAchievements(c, new Outbox(), new Date()));
    expect((await pool.query("SELECT count(*)::int AS n FROM player_achievements WHERE player_id = $1 AND key = 'guardian'", [id])).rows[0].n).toBe(0);
  });
});

describe('libellés', () => {
  it('accorde le pluriel au seuil', async () => {
    const { achievementGoal } = await import('@aldoria/shared');
    const crusader = ACHIEVEMENTS.find((a) => a.key === 'crusader')!;
    expect(achievementGoal(crusader, 'bronze', 100)).toBe('Gagnez 1 titre de croisade');
    expect(achievementGoal(crusader, 'silver', 100)).toBe('Gagnez 3 titres de croisade');
  });
});
