import type { Db } from '../db';

/** Points du classement de guerre : une conquête pèse lourd, une victoire peu, les adversaires battus (en blé) encore moins. */
export const WAR_POINTS = { conquest: 250, win: 5, killsDivisor: 50 } as const;

export const warScore = (s: { conquests: number; attackWins: number; defenseWins: number; killsAttack: number; killsDefense: number }) =>
  s.conquests * WAR_POINTS.conquest + (s.attackWins + s.defenseWins) * WAR_POINTS.win + Math.floor((s.killsAttack + s.killsDefense) / WAR_POINTS.killsDivisor);

/** SQL du même score, pour trier côté base (alias `p` pour la table players). */
export const WAR_SCORE_SQL = `(p.conquests * ${WAR_POINTS.conquest} + (p.attack_wins + p.defense_wins) * ${WAR_POINTS.win} + floor((p.kills_attack + p.kills_defense) / ${WAR_POINTS.killsDivisor}))`;

interface Battle {
  attackerId: number | null;
  /** Ancien propriétaire du village attaqué : rien n'est compté contre un village barbare. */
  defenderId: number | null;
  attackerWins: boolean;
  conquered: boolean;
  village: { name: string; x: number; y: number };
  at: Date;
}

/** Enregistre le résultat d'une bataille pour le classement de guerre et, pour une conquête, dans le journal public. */
export async function recordBattle(c: Db, b: Battle) {
  if (!b.attackerId || !b.defenderId || b.attackerId === b.defenderId) return;
  if (b.attackerWins) await c.query('UPDATE players SET attack_wins = attack_wins + 1 WHERE id = $1', [b.attackerId]);
  else await c.query('UPDATE players SET defense_wins = defense_wins + 1 WHERE id = $1', [b.defenderId]);
  if (!b.conquered) return;
  await c.query('UPDATE players SET conquests = conquests + 1 WHERE id = $1', [b.attackerId]);
  await c.query('UPDATE players SET villages_lost = villages_lost + 1 WHERE id = $1', [b.defenderId]);
  await c.query(
    `INSERT INTO conquest_log (at, conqueror_id, conqueror_name, loser_id, loser_name, village_name, x, y)
     SELECT $1, a.id, a.username, d.id, d.username, $4, $5, $6 FROM players a, players d WHERE a.id = $2 AND d.id = $3`,
    [b.at, b.attackerId, b.defenderId, b.village.name, b.village.x, b.village.y],
  );
}
