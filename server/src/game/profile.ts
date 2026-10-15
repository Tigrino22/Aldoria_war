import { CRUSADE_TITLES, PROFILE_CONQUESTS, cleanBio, type CrusadeTitleKey, type PlayerProfile } from '@aldoria/shared';
import type { Db } from '../db';
import { GameError, notFound } from '../errors';
import { badgesOf } from './achievements';

type Q = Pick<Db, 'query'>;

/** Profil public d'un joueur (sans le bouton d'invitation, qui dépend de qui regarde). */
export async function playerProfile(c: Q, name: string, now: Date): Promise<PlayerProfile & { isNpc: boolean; tribeId: number | null }> {
  const p = (
    await c.query(
      `SELECT p.id, p.username, p.is_npc, p.created_at, p.protection_until, p.kills_attack::float8 AS kills_attack, p.kills_defense::float8 AS kills_defense,
              p.title, p.bio, p.conquests, p.villages_lost, p.attack_wins, p.defense_wins, t.id AS tribe_id, t.tag, t.name AS tribe_name
       FROM players p LEFT JOIN tribes t ON t.id = p.tribe_id WHERE lower(p.username) = lower($1)`,
      [name],
    )
  ).rows[0];
  if (!p) throw notFound('Joueur introuvable');
  const villages = (await c.query('SELECT id, name, x, y, points FROM villages WHERE owner_id = $1 ORDER BY points DESC, id', [p.id])).rows;
  const points = villages.reduce((sum, v) => sum + v.points, 0);
  const rank = (
    await c.query(
      `SELECT count(*)::int + 1 AS rank FROM (
         SELECT p2.id, coalesce(sum(v.points), 0) AS pts FROM players p2 LEFT JOIN villages v ON v.owner_id = p2.id GROUP BY p2.id
       ) s WHERE s.pts > $1`,
      [points],
    )
  ).rows[0].rank as number;
  const conquests = (
    await c.query(
      `SELECT at, conqueror_id, conqueror_name, loser_name, village_name, x, y FROM conquest_log
       WHERE conqueror_id = $1 OR loser_id = $1 ORDER BY at DESC, id DESC LIMIT $2`,
      [p.id, PROFILE_CONQUESTS],
    )
  ).rows;
  return {
    id: p.id,
    username: p.username,
    isNpc: p.is_npc,
    tribeId: p.tribe_id,
    invite: 'none',
    createdAt: new Date(p.created_at).toISOString(),
    protected: !!p.protection_until && new Date(p.protection_until) > now,
    points,
    rank,
    killsAttack: p.kills_attack,
    killsDefense: p.kills_defense,
    tribe: p.tribe_id ? { id: p.tribe_id, tag: p.tag, name: p.tribe_name } : null,
    villages,
    title: p.title ? CRUSADE_TITLES[p.title as CrusadeTitleKey] : null,
    titles: (await c.query('SELECT title FROM player_titles WHERE player_id = $1 ORDER BY earned_at', [p.id])).rows
      .map((r) => CRUSADE_TITLES[r.title as CrusadeTitleKey])
      .filter(Boolean),
    glory: (await c.query('SELECT coalesce(sum(glory), 0)::int AS g FROM crusade_scores WHERE player_id = $1', [p.id])).rows[0].g as number,
    bio: p.bio,
    war: { conquests: p.conquests, villagesLost: p.villages_lost, attackWins: p.attack_wins, defenseWins: p.defense_wins },
    conquests: conquests.map((k) => {
      const won = k.conqueror_id === p.id;
      return {
        at: new Date(k.at).toISOString(),
        won,
        village: { name: k.village_name, x: k.x, y: k.y },
        other: won ? k.loser_name : k.conqueror_name,
      };
    }),
    badges: await badgesOf(c, p.id),
  };
}

/** Enregistre la présentation du joueur (vide pour l'effacer). */
export async function setBio(c: Q, playerId: number, raw: string): Promise<string> {
  const res = cleanBio(raw);
  if ('error' in res) throw new GameError(`Présentation trop longue : ${res.error}`);
  await c.query('UPDATE players SET bio = $2 WHERE id = $1', [playerId, res.bio]);
  return res.bio;
}

/** L'administration efface une présentation inappropriée. */
export async function clearBio(c: Q, playerId: number) {
  const res = await c.query("UPDATE players SET bio = '' WHERE id = $1", [playerId]);
  if (!res.rowCount) throw notFound('Joueur introuvable');
}
