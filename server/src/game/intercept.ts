import {
  ARMY_SIGHT,
  RESOURCES,
  carryCapacity,
  emptyUnits,
  hasUnits,
  inSight,
  interceptPoint,
  sightWindow,
  normalizeUnits,
  populationOf,
  resolveCombat,
  slowestSpeed,
  subtractUnits,
  totalUnits,
  travelTime,
  type AttackReportData,
  type Resources,
  type UnitCounts,
} from '@aldoria/shared';
import { type Db } from '../db';
import { env } from '../env';
import { forbidden, GameError } from '../errors';
import type { Outbox } from '../notify';
import { addKills, chargeAttackWheat, insertCommand } from './commands';
import { createReport } from './reports';
import { allyTribeIdsOf } from './tribe-alliances';
import { getTroops, loadVillage, setTroops, syncVillage } from './village';

/**
 * Interceptions : une armée étrangère repérée à portée de vue de l'un de nos villages (voir shared/src/armies.ts) peut être
 * attaquée en chemin. Nos troupes partent vers le point de rencontre le plus proche dans le temps ; la bataille a lieu en rase
 * campagne (ni muraille ni défense de village) : nos troupes attaquent, l'armée surprise se défend. Ses survivants poursuivent
 * leur route ; si elle est détruite, nos troupes ramassent son butin. Les nôtres rentrent ensuite au village.
 */

/** Trajet d'un mouvement : depuis son point de rencontre s'il repart d'une bataille, sinon depuis son village d'origine. */
export function pathOf(cmd: { ox: number; oy: number; tx: number; ty: number; meet_x: number | null; meet_y: number | null; type: string; sent_at: Date; arrive_at: Date }) {
  const start = cmd.type === 'return' && cmd.meet_x !== null ? { x: cmd.meet_x, y: cmd.meet_y! } : { x: cmd.ox, y: cmd.oy };
  const end = cmd.type === 'intercept' && cmd.meet_x !== null ? { x: cmd.meet_x, y: cmd.meet_y! } : { x: cmd.tx, y: cmd.ty };
  return { from: start, to: end, t0: new Date(cmd.sent_at).getTime(), t1: new Date(cmd.arrive_at).getTime() };
}

const MOVE_SELECT = `SELECT c.*, o.x AS ox, o.y AS oy, t.x AS tx, t.y AS ty, p.tribe_id, p.username, p.protection_until
  FROM commands c JOIN villages o ON o.id = c.origin_village_id JOIN villages t ON t.id = c.target_village_id LEFT JOIN players p ON p.id = c.player_id`;

/** Envoie des troupes intercepter une armée repérée. */
export async function sendInterception(c: Db, outbox: Outbox, playerId: number, originId: number, input: { commandId: number; units: Partial<UnitCounts> }, now: Date) {
  const origin = await syncVillage(c, originId, now);
  if (origin.owner_id !== playerId) throw forbidden("Ce village n'est pas à vous");
  const target = (await c.query(`${MOVE_SELECT} WHERE c.id = $1 AND NOT c.processed FOR UPDATE OF c`, [input.commandId])).rows[0];
  if (!target || !['attack', 'support', 'return'].includes(target.type)) throw new GameError('Cette armée n’est plus en marche');
  if (target.player_id === playerId) throw new GameError('C’est votre propre armée');
  const me = (await c.query('SELECT tribe_id FROM players WHERE id = $1', [playerId])).rows[0];
  const friends = me?.tribe_id ? [me.tribe_id, ...(await allyTribeIdsOf(c, me.tribe_id))] : [];
  if (target.tribe_id && friends.includes(target.tribe_id)) throw new GameError('Cette armée appartient à votre tribu ou à un allié');
  if (target.protection_until && new Date(target.protection_until) > now) throw new GameError('Ce joueur est encore sous protection débutant');

  // La bataille doit avoir lieu pendant que l'armée passe à portée de vue de l'un de nos villages.
  const path = pathOf(target);
  const mine = (await c.query('SELECT x, y FROM villages WHERE owner_id = $1', [playerId])).rows as { x: number; y: number }[];
  const w = sightWindow(path.from, path.to, mine);
  const span = w ? ([path.t0 + (path.t1 - path.t0) * w[0], path.t0 + (path.t1 - path.t0) * w[1]] as [number, number]) : null;
  if (!span || span[1] <= now.getTime())
    throw new GameError(`Cette armée n'est pas repérée : elle doit passer à ${ARMY_SIGHT} cases ou moins de l'un de vos villages`);

  const units = normalizeUnits(input.units);
  if (totalUnits(units) === 0) throw new GameError('Sélectionnez au moins une unité');
  if (totalUnits(units) === units.scout) throw new GameError('Les éclaireurs seuls ne peuvent pas livrer bataille');
  const available = await getTroops(c, origin.id, origin.id);
  if (!hasUnits(available, units)) throw new GameError("Vous n'avez pas assez de troupes au village");

  const secondsPerTile = (slowestSpeed(units) * 60) / env.worldSpeed;
  const meet = interceptPoint({ x: origin.x, y: origin.y }, secondsPerTile, path, now.getTime(), span);
  if (!meet || !inSight(meet, mine))
    throw new GameError(`Vos troupes n'arriveraient pas à temps : l'armée aura quitté la zone de ${ARMY_SIGHT} cases avant elles`);

  await chargeAttackWheat(c, playerId, origin, units);
  await c.query('UPDATE players SET protection_until = NULL WHERE id = $1 AND protection_until > $2', [playerId, now]);
  await setTroops(c, origin.id, origin.id, subtractUnits(available, units));
  const id = await insertCommand(c, {
    type: 'intercept',
    originId: origin.id,
    targetId: target.target_village_id,
    homeId: origin.id,
    playerId,
    units,
    sentAt: now,
    arriveAt: new Date(meet.at),
  });
  await c.query('UPDATE commands SET target_command_id = $2, meet_x = $3, meet_y = $4 WHERE id = $1', [id, target.id, meet.x, meet.y]);
  outbox.push(playerId, { type: 'village', villageId: origin.id });
  return { id, arriveAt: new Date(meet.at), meet: { x: meet.x, y: meet.y } };
}

const at1 = (n: number) => Math.round(n * 10) / 10;
const place = (p: { x: number; y: number }) => `(${Math.floor(p.x)}|${Math.floor(p.y)})`;

/** Nos troupes rentrent du champ de bataille. */
async function goHome(c: Db, cmd: any, units: UnitCounts, at: Date, loot: Resources | null) {
  if (totalUnits(units) <= 0) return;
  const home = await loadVillage(c, cmd.home_village_id);
  const from = { x: cmd.meet_x, y: cmd.meet_y };
  const id = await insertCommand(c, {
    type: 'return',
    originId: home.id,
    targetId: home.id,
    homeId: home.id,
    playerId: cmd.player_id,
    units,
    loot,
    sentAt: at,
    arriveAt: new Date(at.getTime() + travelTime(units, from, home, env.worldSpeed) * 1000),
  });
  await c.query('UPDATE commands SET meet_x = $2, meet_y = $3 WHERE id = $1', [id, cmd.meet_x, cmd.meet_y]);
}

/** Nos troupes atteignent le point de rencontre : bataille en rase campagne, ou l'armée nous a échappé. */
export async function handleIntercept(c: Db, outbox: Outbox, cmd: any) {
  const at = new Date(cmd.arrive_at);
  const ours = normalizeUnits(cmd.units);
  const home = await loadVillage(c, cmd.home_village_id);
  const field = { x: at1(cmd.meet_x), y: at1(cmd.meet_y) };
  const enemy = cmd.target_command_id ? (await c.query(`${MOVE_SELECT} WHERE c.id = $1 FOR UPDATE OF c`, [cmd.target_command_id])).rows[0] : null;
  if (!enemy || enemy.processed || new Date(enemy.arrive_at).getTime() <= at.getTime()) {
    await goHome(c, cmd, ours, at, null);
    await createReport(c, outbox, cmd.player_id, 'support', `L'armée que vous vouliez intercepter près de ${place(field)} vous a échappé`, { units: ours, target: place(field) }, at);
    outbox.push(cmd.player_id, { type: 'village', villageId: home.id });
    return;
  }
  const theirs = normalizeUnits(enemy.units);
  const result = resolveCombat({ attackers: ours, defenders: [theirs], wallLevel: 0, baseDefense: 0 });
  const ourSurvivors = subtractUnits(ours, result.attackerLosses);
  const theirLosses = result.defenderLosses[0] ?? emptyUnits();
  const theirSurvivors = subtractUnits(theirs, theirLosses);
  await addKills(c, cmd.player_id, 'attack', populationOf(theirLosses));
  await addKills(c, enemy.player_id, 'defense', populationOf(result.attackerLosses));

  // L'armée adverse poursuit sa route avec ses survivants ; détruite, elle laisse son butin sur le champ de bataille.
  let loot: Resources | null = null;
  if (totalUnits(theirSurvivors) > 0) {
    await c.query('UPDATE commands SET units = $2 WHERE id = $1', [enemy.id, JSON.stringify(theirSurvivors)]);
  } else {
    await c.query('UPDATE commands SET processed = true WHERE id = $1', [enemy.id]);
    if (enemy.loot && totalUnits(ourSurvivors) > 0) {
      let room = carryCapacity(ourSurvivors);
      loot = { wood: 0, clay: 0, iron: 0, wheat: 0 };
      for (const r of RESOURCES) {
        const take = Math.min(room, Math.floor(Number(enemy.loot[r] ?? 0)));
        loot[r] = take;
        room -= take;
      }
    }
  }
  await goHome(c, cmd, ourSurvivors, at, loot);

  const enemyHome = await loadVillage(c, enemy.home_village_id);
  const theirName = enemy.username ?? null;
  const ourName = (await c.query('SELECT username FROM players WHERE id = $1', [cmd.player_id])).rows[0]?.username ?? null;
  const data: AttackReportData = {
    attackerWins: result.attackerWins,
    attacker: { playerName: ourName, village: { id: home.id, name: home.name, x: home.x, y: home.y }, units: ours, losses: result.attackerLosses },
    defender: { playerName: theirName, village: { id: enemyHome.id, name: enemyHome.name, x: enemyHome.x, y: enemyHome.y }, units: theirs, losses: theirLosses },
    wall: null,
    loot,
    loyalty: null,
    conquered: false,
    field,
  };
  const outcome = result.attackerWins ? 'armée détruite' : totalUnits(theirSurvivors) < totalUnits(theirs) ? 'elle force le passage' : 'repoussés';
  await createReport(c, outbox, cmd.player_id, 'attack', `Interception près de ${place(field)} : ${outcome}`, data, at);
  if (enemy.player_id) {
    const title = result.attackerWins
      ? `Votre armée a été détruite en chemin près de ${place(field)}`
      : `Votre armée a été attaquée en chemin près de ${place(field)} et poursuit sa route`;
    await createReport(c, outbox, enemy.player_id, 'defense', title, data, at);
    outbox.push(enemy.player_id, { type: 'village', villageId: enemy.home_village_id });
  }
  outbox.push(cmd.player_id, { type: 'village', villageId: home.id });
}
