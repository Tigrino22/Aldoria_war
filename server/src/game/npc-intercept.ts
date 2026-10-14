import { ARMY_SIGHT, emptyUnits, normalizeUnits, resolveCombat, totalUnits, type UnitCounts } from '@aldoria/shared';
import type { Db } from '../db';
import { env } from '../env';
import { GameError } from '../errors';
import type { Outbox } from '../notify';
import { sendInterception } from './intercept';
import { getTroops } from './village';

/**
 * Interceptions des PNJ : une armée hostile repérée à portée de vue d'un village de PNJ (10 cases, voir shared/src/armies.ts)
 * peut être attaquée en chemin, comme le ferait un joueur. Le PNJ intercepte :
 * - les attaques qui visent ses villages, ceux de sa tribu ou d'une tribu alliée ;
 * - les armées (attaque, renfort, retour) de ses ennemis : tribus rivales ou en guerre, joueurs et PNJ à qui il en veut.
 * Il ne part que s'il est sûr de gagner en rase campagne (avec la marge de sécurité des attaques), jamais contre un joueur
 * sous protection débutant ni pendant les heures calmes. Au plus une interception par village et par réflexion.
 */

/** Parts de l'armée essayées : la moitié d'abord, tout ensuite. */
const SHARES = [0.5, 1];

export interface InterceptHostiles {
  /** Tribu du PNJ et tribus alliées : on ne les intercepte jamais, on protège leurs villages. */
  friends: number[];
  /** Tribus rivales ou en guerre, et joueurs ou PNJ à qui il en veut. */
  tribes: number[];
  players: number[];
  /** Heures calmes en ce moment : aucune interception contre un joueur. */
  quiet: boolean;
}

/** Troupes que le PNJ peut lancer à l'interception : fantassins et cavaliers (ni éclaireurs, ni nobles, ni béliers trop lents). */
export function interceptUnits(available: UnitCounts, share: number): UnitCounts {
  const u = emptyUnits();
  for (const k of ['spearman', 'halberdier', 'swordsman', 'cavalry'] as const) u[k] = Math.floor(available[k] * share);
  return u;
}

/** Vrai si ces troupes battent l'armée en rase campagne avec la marge de sécurité voulue. */
export function winsInField(ours: UnitCounts, theirs: UnitCounts, marginPct = env.npcAttackMargin): boolean {
  if (totalUnits(ours) === 0) return false;
  const r = resolveCombat({ attackers: ours, defenders: [theirs], wallLevel: 0, baseDefense: 0 });
  return r.attackerWins && r.attackPower >= r.defensePower * (1 + marginPct / 100);
}

export async function interceptStep(c: Db, outbox: Outbox, npcId: number, villageId: number, hostiles: InterceptHostiles, now: Date): Promise<boolean> {
  const home = (await c.query('SELECT x, y FROM villages WHERE id = $1', [villageId])).rows[0];
  if (!home) return false;
  const { rows } = await c.query(
    `SELECT c.id, c.type, c.units, c.player_id, p.tribe_id, NOT p.is_npc AS human, p.protection_until > $2 AS protected,
            t.owner_id AS t_owner, tp.tribe_id AS t_tribe
     FROM commands c JOIN villages o ON o.id = c.origin_village_id JOIN villages t ON t.id = c.target_village_id
     JOIN players p ON p.id = c.player_id LEFT JOIN players tp ON tp.id = t.owner_id
     WHERE NOT c.processed AND c.arrive_at > $2 AND c.type IN ('attack', 'support', 'return') AND c.player_id <> $1
       AND $3 BETWEEN least(o.x, t.x, coalesce(c.meet_x, o.x)) - $5 AND greatest(o.x, t.x, coalesce(c.meet_x, o.x)) + $5
       AND $4 BETWEEN least(o.y, t.y, coalesce(c.meet_y, o.y)) - $5 AND greatest(o.y, t.y, coalesce(c.meet_y, o.y)) + $5
       AND NOT EXISTS (SELECT 1 FROM commands i WHERE i.type = 'intercept' AND NOT i.processed AND i.target_command_id = c.id AND i.player_id = $1)
     ORDER BY c.arrive_at LIMIT 20`,
    [npcId, now, home.x, home.y, ARMY_SIGHT],
  );
  const friendly = (tribe: number | null) => tribe !== null && hostiles.friends.includes(tribe);
  for (const r of rows) {
    if (friendly(r.tribe_id)) continue;
    if (r.human && (hostiles.quiet || r.protected)) continue;
    const defends = r.type === 'attack' && (r.t_owner === npcId || friendly(r.t_tribe));
    const enemy = hostiles.players.includes(r.player_id) || (r.tribe_id !== null && hostiles.tribes.includes(r.tribe_id));
    if (!defends && !enemy) continue;
    const theirs = normalizeUnits(r.units);
    const available = await getTroops(c, villageId, villageId);
    const units = SHARES.map((s) => interceptUnits(available, s)).find((u) => winsInField(u, theirs));
    if (!units) continue;
    // L'envoi vérifie le reste (armée repérée, rencontre possible, rations) : un refus n'est pas une erreur.
    await c.query('SAVEPOINT interception');
    try {
      await sendInterception(c, outbox, npcId, villageId, { commandId: r.id, units }, now);
      await c.query('RELEASE SAVEPOINT interception');
      return true;
    } catch (err) {
      await c.query('ROLLBACK TO SAVEPOINT interception');
      if (!(err instanceof GameError)) throw err;
    }
  }
  return false;
}
