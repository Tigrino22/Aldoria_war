import {
  CITADEL_WALL,
  CRUSADE_GLORY,
  CRUSADE_SEASON_DAYS,
  CRUSADE_TITLES,
  RELIC_DAYS,
  RESOURCES,
  STARTING_BUILDINGS,
  arrivesInWindow,
  citadelGarrison,
  crusadePhase,
  emptyUnits,
  garrisonPopulation,
  gloryForKills,
  guardWavesDue,
  GUARD_WAVE_MINUTES,
  GUARD_WAVE_SHARE,
  nextOpening,
  normalizeUnits,
  parseClock,
  parseWeekdays,
  populationOf,
  resolveCombat,
  shareTreasure,
  subtractUnits,
  totalUnits,
  travelTime,
  treasureFor,
  victoryGlory,
  wallAfterRams,
  wallDuringCombat,
  warehouseCapacity,
  type AttackReportData,
  type Buildings,
  type CrusadeLogEntry,
  type CrusadeScoreRow,
  type CrusadeSide,
  type CrusadeState,
  type CrusadeSummary,
  type CrusadeTitleKey,
  type UnitCounts,
} from '@aldoria/shared';
import { type Db } from '../db';
import { env } from '../env';
import { GameError } from '../errors';
import type { Outbox } from '../notify';
import { addKills, insertCommand } from './commands';
import { createReport } from './reports';
import { areAllied } from './tribe-alliances';
import { addTroops, createVillage, loadVillage, saveVillage, setTroops, syncVillage, type VillageRow } from './village';
import { findFreeSpot } from './world';

/**
 * Croisades (voir shared/src/crusade.ts pour les règles pures).
 * La Citadelle est un village sans propriétaire de genre `citadel` : l'espionnage, les ordres planifiés et les renforts
 * fonctionnent comme ailleurs. Ce module ajoute la fenêtre d'assaut, la bannière, la gloire, la fin de la croisade et ses récompenses.
 */

const DAY_MS = 86_400_000;

const NAMES = [
  'Citadelle de Valmor',
  'Krak des Brumes',
  'Forteresse d’Aubefer',
  'Bastion des Cendres',
  'Citadelle du Couchant',
  'Fort de la Couronne',
  'Citadelle de Montfaucon',
  'Donjon d’Ormeval',
  'Citadelle des Neuf Tours',
  'Forteresse de Pierregarde',
];

export interface CrusadeRow {
  id: number;
  village_id: number | null;
  name: string;
  x: number;
  y: number;
  season: number;
  announced_at: Date;
  opens_at: Date;
  closes_at: Date;
  status: 'announced' | 'open' | 'ended';
  garrison: UnitCounts;
  guard_waves: number;
  wall: number;
  treasure: number;
  breached_at: Date | null;
  holder_tribe_id: number | null;
  holder_player_id: number | null;
  holder_since: Date | null;
  winner_tribe_id: number | null;
  winner_player_id: number | null;
  winner_name: string | null;
  ended_at: Date | null;
}

/** Jours, heure et durée des croisades d'après les réglages du monde. */
export function crusadeSchedule() {
  return {
    weekdays: parseWeekdays(String(env.crusadeDays)) ?? [3, 6],
    minutes: parseClock(String(env.crusadeTime)) ?? 20 * 60 + 30,
    duration: env.crusadeMinutes * 60_000,
    notice: env.crusadeNoticeHours * 3_600_000,
  };
}

const clock = (d: Date) => new Intl.DateTimeFormat('fr-FR', { timeZone: env.npcTimezone, hour: '2-digit', minute: '2-digit' }).format(d);
const dayClock = (d: Date) =>
  new Intl.DateTimeFormat('fr-FR', { timeZone: env.npcTimezone, weekday: 'long', hour: '2-digit', minute: '2-digit' }).format(d);

async function crusadeOfVillage(c: Db, villageId: number, forUpdate = false): Promise<CrusadeRow | null> {
  const { rows } = await c.query(`SELECT * FROM crusades WHERE village_id = $1 ORDER BY id DESC LIMIT 1 ${forUpdate ? 'FOR UPDATE' : ''}`, [villageId]);
  return rows[0] ?? null;
}

/** Camp d'un joueur : sa tribu, ou lui-même s'il n'en a pas. */
async function sideOf(c: Db, playerId: number | null): Promise<{ playerId: number | null; tribeId: number | null }> {
  if (!playerId) return { playerId: null, tribeId: null };
  const tribeId = (await c.query('SELECT tribe_id FROM players WHERE id = $1', [playerId])).rows[0]?.tribe_id ?? null;
  return { playerId, tribeId };
}

/** Le camp tient-il la bannière (sa tribu, une tribu alliée, ou lui-même sans tribu) ? */
async function holdsBanner(c: Db, cr: CrusadeRow, side: { playerId: number | null; tribeId: number | null }): Promise<boolean> {
  if (cr.holder_tribe_id && side.tribeId) return cr.holder_tribe_id === side.tribeId || (await areAllied(c, cr.holder_tribe_id, side.tribeId));
  return !cr.holder_tribe_id && !!cr.holder_player_id && cr.holder_player_id === side.playerId;
}

const hasHolder = (cr: CrusadeRow) => cr.holder_tribe_id !== null || cr.holder_player_id !== null;

/**
 * Refuse un mouvement vers une Citadelle qui n'arriverait pas pendant la fenêtre d'assaut. Les éclaireurs seuls peuvent y aller
 * dès l'annonce. Un renfort n'est permis qu'au camp qui tient la bannière. Sans effet sur un village ordinaire.
 */
export async function assertCitadelMove(c: Db, move: { type: 'attack' | 'support'; playerId: number; target: VillageRow; units: UnitCounts; arriveAt: Date }) {
  if (move.target.kind !== 'citadel') return;
  const cr = await crusadeOfVillage(c, move.target.id);
  if (!cr || cr.status === 'ended') throw new GameError('Cette croisade est terminée');
  const scoutsOnly = move.units.scout > 0 && move.units.scout === totalUnits(move.units);
  if (move.type === 'attack' && scoutsOnly) {
    if (move.arriveAt.getTime() >= new Date(cr.closes_at).getTime()) throw new GameError('Vos éclaireurs arriveraient après la fermeture des portes');
    return;
  }
  if (!arrivesInWindow(move.arriveAt, { opensAt: cr.opens_at, closesAt: cr.closes_at })) {
    throw new GameError(`Les portes de la Citadelle s’ouvrent de ${clock(new Date(cr.opens_at))} à ${clock(new Date(cr.closes_at))} : vos troupes arriveraient à ${clock(move.arriveAt)}`);
  }
  if (move.type === 'support' && !(await holdsBanner(c, cr, await sideOf(c, move.playerId)))) {
    throw new GameError('Seul le camp qui tient la bannière peut envoyer des renforts à la Citadelle');
  }
}

/** Ligne de gloire d'un participant (créée à sa première action à la Citadelle). */
async function addScore(c: Db, crusadeId: number, playerId: number | null, delta: { glory?: number; kills?: number; breaches?: number; captures?: number }) {
  if (!playerId) return;
  const tribeId = (await c.query('SELECT tribe_id FROM players WHERE id = $1', [playerId])).rows[0]?.tribe_id ?? null;
  await c.query(
    `INSERT INTO crusade_scores (crusade_id, player_id, tribe_id, glory, kills, breaches, captures) VALUES ($1, $2, $3, $4, $5, $6, $7)
     ON CONFLICT (crusade_id, player_id) DO UPDATE SET glory = crusade_scores.glory + EXCLUDED.glory, kills = crusade_scores.kills + EXCLUDED.kills,
       breaches = crusade_scores.breaches + EXCLUDED.breaches, captures = crusade_scores.captures + EXCLUDED.captures, tribe_id = EXCLUDED.tribe_id`,
    [crusadeId, playerId, tribeId, delta.glory ?? 0, delta.kills ?? 0, delta.breaches ?? 0, delta.captures ?? 0],
  );
}

export async function grantTitle(c: Db, playerId: number | null, key: CrusadeTitleKey, at: Date, crusadeId: number | null) {
  if (!playerId) return;
  await c.query('INSERT INTO player_titles (player_id, title, earned_at, crusade_id) VALUES ($1, $2, $3, $4) ON CONFLICT DO NOTHING', [playerId, key, at, crusadeId]);
}

async function log(c: Db, crusadeId: number, at: Date, kind: CrusadeLogEntry['kind'], text: string, who: { playerName?: string | null; tribeTag?: string | null } = {}) {
  await c.query('INSERT INTO crusade_log (crusade_id, at, kind, player_name, tribe_tag, text) VALUES ($1, $2, $3, $4, $5, $6)', [
    crusadeId,
    at,
    kind,
    who.playerName ?? null,
    who.tribeTag ?? null,
    text,
  ]);
}

async function nameAndTag(c: Db, playerId: number | null): Promise<{ name: string | null; tag: string | null; tribeName: string | null }> {
  if (!playerId) return { name: null, tag: null, tribeName: null };
  const r = (await c.query('SELECT p.username, t.tag, t.name FROM players p LEFT JOIN tribes t ON t.id = p.tribe_id WHERE p.id = $1', [playerId])).rows[0];
  return { name: r?.username ?? null, tag: r?.tag ?? null, tribeName: r?.name ?? null };
}

const label = (v: { name: string; x: number; y: number }) => `${v.name} (${v.x}|${v.y})`;

/** Renvoie des troupes chez elles depuis la Citadelle (ou d'où elles arrivaient). */
async function sendHome(c: Db, from: VillageRow, homeId: number, playerId: number | null, units: UnitCounts, at: Date) {
  if (totalUnits(units) <= 0) return;
  const home = await loadVillage(c, homeId);
  await insertCommand(c, {
    type: 'return',
    originId: from.id,
    targetId: home.id,
    homeId: home.id,
    playerId,
    units,
    sentAt: at,
    arriveAt: new Date(at.getTime() + travelTime(units, from, home, env.worldSpeed) * 1000),
  });
}

/** Troupes arrivées à la Citadelle hors de la fenêtre d'assaut : elles font demi-tour. */
async function bounce(c: Db, outbox: Outbox, cmd: any, citadel: VillageRow, units: UnitCounts, reason: string) {
  const at = new Date(cmd.arrive_at);
  await sendHome(c, citadel, cmd.home_village_id, cmd.player_id, units, at);
  await createReport(c, outbox, cmd.player_id, 'crusade', `${citadel.name} : ${reason}, vos troupes rentrent`, { citadel: label(citadel), units, reason }, at);
  outbox.push(cmd.player_id, { type: 'village', villageId: cmd.home_village_id });
}

/** Un renfort arrive à la Citadelle : il ne s'installe que si son camp tient toujours la bannière. */
export async function handleCitadelSupport(c: Db, outbox: Outbox, cmd: any, citadel: VillageRow) {
  const at = new Date(cmd.arrive_at);
  const units = normalizeUnits(cmd.units);
  const cr = await crusadeOfVillage(c, citadel.id, true);
  if (!cr || cr.status === 'ended' || !arrivesInWindow(at, { opensAt: cr.opens_at, closesAt: cr.closes_at })) return bounce(c, outbox, cmd, citadel, units, 'les portes sont fermées');
  if (!(await holdsBanner(c, cr, await sideOf(c, cmd.player_id)))) return bounce(c, outbox, cmd, citadel, units, 'la bannière a changé de camp');
  await addTroops(c, citadel.id, cmd.home_village_id, units);
  await addScore(c, cr.id, cmd.player_id, {});
  await createReport(c, outbox, cmd.player_id, 'support', `Vos renforts tiennent ${label(citadel)}`, { units, target: label(citadel) }, at);
  outbox.push(cmd.player_id, { type: 'village', villageId: cmd.home_village_id });
}

/**
 * Une attaque arrive à la Citadelle. Combat ordinaire contre tous ceux qui s'y trouvent (garnison, puis le camp qui tient la bannière),
 * avec la gloire en plus : ennemis tués, brèche, prise de la bannière (un noble doit survivre à l'attaque qui vide la Citadelle).
 */
export async function handleCitadelAttack(c: Db, outbox: Outbox, cmd: any, citadel: VillageRow, origin: VillageRow) {
  const at = new Date(cmd.arrive_at);
  const attackers = normalizeUnits(cmd.units);
  const attackerId: number | null = cmd.player_id;
  const cr = await crusadeOfVillage(c, citadel.id, true);
  if (!cr || cr.status === 'ended' || !arrivesInWindow(at, { opensAt: cr.opens_at, closesAt: cr.closes_at })) return bounce(c, outbox, cmd, citadel, attackers, 'les portes sont fermées');
  const side = await sideOf(c, attackerId);
  // Notre camp tient déjà la bannière : l'attaque devient un renfort.
  if (await holdsBanner(c, cr, side)) {
    await addTroops(c, citadel.id, origin.id, attackers);
    await addScore(c, cr.id, attackerId, {});
    await createReport(c, outbox, attackerId, 'support', `Votre camp tient ${label(citadel)} : vos troupes renforcent la garnison`, { units: attackers, target: label(citadel) }, at);
    outbox.push(attackerId, { type: 'village', villageId: origin.id });
    return;
  }

  const defenderRows = (await c.query('SELECT home_village_id, units FROM troops WHERE village_id = $1 FOR UPDATE', [citadel.id])).rows;
  const defenders = defenderRows.map((r) => normalizeUnits(r.units));
  const defendersBefore = defenders.reduce((sum, g) => {
    for (const k of Object.keys(g) as (keyof UnitCounts)[]) sum[k] += g[k];
    return sum;
  }, emptyUnits());
  const wallBefore = citadel.buildings.wall;
  const result = resolveCombat({ attackers, defenders, wallLevel: wallDuringCombat(wallBefore, attackers.ram) });
  const defenderLosses = emptyUnits();
  for (let i = 0; i < defenderRows.length; i++) {
    const loss = result.defenderLosses[i];
    for (const k of Object.keys(loss) as (keyof UnitCounts)[]) defenderLosses[k] += loss[k];
    await setTroops(c, citadel.id, defenderRows[i].home_village_id, subtractUnits(defenders[i], loss));
  }
  const survivors = subtractUnits(attackers, result.attackerLosses);

  // Gloire et classement de guerre : l'attaquant pour les défenseurs tués, chaque défenseur (hors garnison) pour sa part des attaquants tués.
  const killed = populationOf(defenderLosses);
  await addKills(c, attackerId, 'attack', killed);
  await addScore(c, cr.id, attackerId, { glory: gloryForKills(killed), kills: killed });
  const killedByDefense = populationOf(result.attackerLosses);
  const homeIds = [...new Set(defenderRows.map((r) => r.home_village_id as number).filter((id) => id !== citadel.id))];
  const owners = new Map<number, number>(
    homeIds.length ? (await c.query('SELECT id, owner_id FROM villages WHERE id = ANY($1) AND owner_id IS NOT NULL', [homeIds])).rows.map((r) => [r.id, r.owner_id]) : [],
  );
  const totalWeight = defenders.reduce((s, g) => s + populationOf(g), 0);
  const defenderPlayers = new Set<number>();
  for (const [i, r] of defenderRows.entries()) {
    const owner = owners.get(r.home_village_id);
    if (!owner) continue;
    defenderPlayers.add(owner);
    const share = totalWeight > 0 ? Math.floor((killedByDefense * populationOf(defenders[i])) / totalWeight) : 0;
    await addKills(c, owner, 'defense', share);
    await addScore(c, cr.id, owner, { glory: gloryForKills(share), kills: share });
  }

  let wallDamage: AttackReportData['wallDamage'] = null;
  if (result.attackerWins && survivors.ram > 0) {
    const after = wallAfterRams(wallBefore, survivors.ram);
    if (after < wallBefore) {
      citadel.buildings.wall = after;
      wallDamage = { before: wallBefore, after };
    }
  }
  const who = await nameAndTag(c, attackerId);
  const sideName = who.tag ? `[${who.tag}] ${who.name}` : (who.name ?? 'Un inconnu');
  if (citadel.buildings.wall === 0 && !cr.breached_at) {
    cr.breached_at = at;
    await c.query('UPDATE crusades SET breached_at = $2 WHERE id = $1', [cr.id, at]);
    await addScore(c, cr.id, attackerId, { glory: CRUSADE_GLORY.breach, breaches: 1 });
    await grantTitle(c, attackerId, 'breaker', at, cr.id);
    await log(c, cr.id, at, 'breach', `${sideName} fait tomber la muraille`, { playerName: who.name, tribeTag: who.tag });
  }

  const hadHolder = hasHolder(cr);
  const previous = hadHolder ? await holderSide(c, cr) : null;
  let captured = false;
  if (result.attackerWins) {
    if (survivors.noble > 0) {
      // Le porte-étendard plante la bannière : les survivants restent sur place pour la tenir.
      captured = true;
      await c.query('UPDATE crusades SET holder_tribe_id = $2, holder_player_id = $3, holder_since = $4 WHERE id = $1', [cr.id, side.tribeId, attackerId, at]);
      await addTroops(c, citadel.id, origin.id, survivors);
      await addScore(c, cr.id, attackerId, { glory: CRUSADE_GLORY.capture, captures: 1 });
      await grantTitle(c, attackerId, 'bearer', at, cr.id);
      await log(c, cr.id, at, 'capture', `${sideName} plante la bannière${who.tribeName ? ` de ${who.tribeName}` : ''}`, { playerName: who.name, tribeTag: who.tag });
    } else {
      if (hadHolder) {
        await c.query('UPDATE crusades SET holder_tribe_id = NULL, holder_player_id = NULL, holder_since = NULL WHERE id = $1', [cr.id]);
        await log(c, cr.id, at, 'fall', `${sideName} abat la bannière${previous?.tribeTag ? ` de [${previous.tribeTag}]` : ''} sans porte-étendard pour planter la sienne`, { playerName: who.name, tribeTag: who.tag });
      }
      await sendHome(c, citadel, origin.id, attackerId, survivors, at);
    }
  }
  await saveVillage(c, citadel);

  const base = {
    attackerWins: result.attackerWins,
    attacker: { playerName: who.name, village: { id: origin.id, name: origin.name, x: origin.x, y: origin.y }, units: attackers, losses: result.attackerLosses },
    defender: { playerName: null, village: { id: citadel.id, name: citadel.name, x: citadel.x, y: citadel.y }, units: defendersBefore, losses: defenderLosses },
    wall: wallBefore,
    loot: null,
    loyalty: null,
    conquered: false,
    wallDamage,
  } satisfies AttackReportData;
  const seen = totalUnits(survivors) > 0;
  const attackerView: AttackReportData = seen ? base : { ...base, defender: { ...base.defender, units: null, losses: null }, wall: null, wallDamage: null };
  const outcome = captured ? 'bannière plantée !' : result.attackerWins ? 'victoire' : 'défaite';
  await createReport(c, outbox, attackerId, 'attack', `Assaut sur ${label(citadel)} : ${outcome} (+${gloryForKills(killed)} gloire)`, attackerView, at);
  for (const p of defenderPlayers) {
    if (p === attackerId) continue;
    const title = result.attackerWins ? `${label(citadel)} : la bannière est tombée face à ${sideName}` : `${label(citadel)} tient bon face à ${sideName}`;
    await createReport(c, outbox, p, 'defense', title, base, at);
  }
  outbox.push(attackerId, { type: 'village', villageId: origin.id });
}

async function holderSide(c: Db, cr: CrusadeRow): Promise<CrusadeSide | null> {
  if (!hasHolder(cr)) return null;
  const t = cr.holder_tribe_id ? (await c.query('SELECT tag, name FROM tribes WHERE id = $1', [cr.holder_tribe_id])).rows[0] : null;
  const p = cr.holder_player_id ? (await c.query('SELECT username FROM players WHERE id = $1', [cr.holder_player_id])).rows[0] : null;
  return { tribeId: cr.holder_tribe_id, tribeTag: t?.tag ?? null, tribeName: t?.name ?? null, playerName: p?.username ?? null };
}

// ---------- Annonce, ouverture et fin ----------

/** Armée offensive (population des épéistes, cavaliers et béliers) de la tribu la plus forte, ou du joueur seul le plus fort. */
async function strongestOffense(c: Db): Promise<number> {
  const { rows } = await c.query(
    `SELECT coalesce('t' || p.tribe_id::text, 'p' || p.id::text) AS side,
            sum(coalesce((t.units->>'swordsman')::int, 0) + 4 * coalesce((t.units->>'cavalry')::int, 0) + 5 * coalesce((t.units->>'ram')::int, 0))::float8 AS pop
     FROM troops t JOIN villages v ON v.id = t.home_village_id JOIN players p ON p.id = v.owner_id
     GROUP BY 1 ORDER BY 2 DESC LIMIT 1`,
  );
  return Number(rows[0]?.pop ?? 0);
}

async function worldStart(c: Db): Promise<number> {
  const v = (await c.query("SELECT value FROM world_meta WHERE key = 'started_at'")).rows[0]?.value;
  return v ? Date.parse(v) : Date.now();
}

/** Annonce une croisade : la Citadelle apparaît sur la carte, garnison en place, portes fermées jusqu'à `opensAt`. */
export async function announceCrusade(c: Db, now: Date, opensAt: Date, closesAt: Date, rng: () => number = Math.random): Promise<number> {
  const n = (await c.query('SELECT count(*)::int AS n FROM crusades')).rows[0].n as number;
  const season = Math.floor((opensAt.getTime() - (await worldStart(c))) / (CRUSADE_SEASON_DAYS * DAY_MS)) + 1;
  await awardSeasonHero(c, season, now);
  // Un quart de carte différent à chaque fois, à mi-chemin entre le centre et le bord, pour que personne ne soit toujours loin.
  const half = env.mapSize / 2;
  const angle = ((n % 4) + 0.5) * (Math.PI / 2) + (rng() - 0.5) * 0.6;
  const r = half * (0.25 + rng() * 0.2);
  const spot = await findFreeSpot(c, Math.round(half + Math.cos(angle) * r), Math.round(half + Math.sin(angle) * r), 2);
  const garrisonPop = garrisonPopulation(await strongestOffense(c), env.crusadeGarrison);
  const garrison = citadelGarrison(garrisonPop);
  const name = NAMES[n % NAMES.length];
  const buildings: Buildings = { ...STARTING_BUILDINGS };
  for (const k of Object.keys(buildings) as (keyof Buildings)[]) buildings[k] = 0;
  buildings.wall = CITADEL_WALL;
  const villageId = await createVillage(c, { ownerId: null, name, x: spot.x, y: spot.y, buildings, resources: { wood: 0, clay: 0, iron: 0, wheat: 0 }, at: now, troops: garrison });
  await c.query("UPDATE villages SET kind = 'citadel' WHERE id = $1", [villageId]);
  const { rows } = await c.query(
    `INSERT INTO crusades (village_id, name, x, y, season, announced_at, opens_at, closes_at, garrison, wall, treasure)
     VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11) RETURNING id`,
    [villageId, name, spot.x, spot.y, season, now, opensAt, closesAt, JSON.stringify(garrison), CITADEL_WALL, treasureFor(garrisonPop)],
  );
  const id = rows[0].id as number;
  await log(c, id, now, 'announce', `${name} se dresse en (${spot.x}|${spot.y}) : ses portes s’ouvriront ${dayClock(opensAt)}`);
  return id;
}

/** Au début d'une nouvelle saison, le premier du classement de gloire de la saison précédente devient Héros de la saison. */
async function awardSeasonHero(c: Db, season: number, now: Date) {
  const last = (await c.query('SELECT season FROM crusades ORDER BY id DESC LIMIT 1')).rows[0]?.season as number | undefined;
  if (!last || last >= season) return;
  const top = (
    await c.query(
      `SELECT s.player_id FROM crusade_scores s JOIN crusades cr ON cr.id = s.crusade_id JOIN players p ON p.id = s.player_id
       WHERE cr.season = $1 AND NOT p.is_npc GROUP BY s.player_id ORDER BY sum(s.glory) DESC LIMIT 1`,
      [last],
    )
  ).rows[0];
  if (top) await grantTitle(c, top.player_id, 'hero', now, null);
}

/** Victoires consécutives déjà remportées par ce camp, juste avant cette croisade. */
async function winStreak(c: Db, crusadeId: number, tribeId: number | null, playerId: number | null): Promise<number> {
  const { rows } = await c.query("SELECT winner_tribe_id, winner_player_id FROM crusades WHERE status = 'ended' AND id < $1 ORDER BY id DESC LIMIT 10", [crusadeId]);
  let streak = 0;
  for (const r of rows) {
    const same = tribeId ? r.winner_tribe_id === tribeId : !r.winner_tribe_id && r.winner_player_id === playerId;
    if (!same) break;
    streak++;
  }
  return streak;
}

/** Fin de la croisade : victoire, gloire, trésor, relique, titres ; toutes les troupes encore sur place rentrent. */
export async function endCrusade(c: Db, outbox: Outbox, cr: CrusadeRow, now: Date) {
  const citadel = cr.village_id ? await loadVillage(c, cr.village_id).catch(() => null) : null;
  const winner = await holderSide(c, cr);
  const winnerName = winner ? (winner.tribeName ? `${winner.tribeName} [${winner.tribeTag}]` : winner.playerName) : null;

  if (winner) {
    const streak = await winStreak(c, cr.id, cr.holder_tribe_id, cr.holder_player_id);
    const glory = victoryGlory(streak);
    const winners = (
      cr.holder_tribe_id
        ? await c.query('SELECT player_id FROM crusade_scores WHERE crusade_id = $1 AND tribe_id = $2', [cr.id, cr.holder_tribe_id])
        : await c.query('SELECT player_id FROM crusade_scores WHERE crusade_id = $1 AND player_id = $2', [cr.id, cr.holder_player_id])
    ).rows.map((r) => r.player_id as number);
    for (const p of winners) {
      await addScore(c, cr.id, p, { glory });
      await grantTitle(c, p, 'keeper', now, cr.id);
    }
    const until = new Date(now.getTime() + RELIC_DAYS * DAY_MS);
    if (cr.holder_tribe_id) await c.query('UPDATE tribes SET relic_until = $2 WHERE id = $1', [cr.holder_tribe_id, until]);
    else await c.query('UPDATE players SET relic_until = $2 WHERE id = $1', [cr.holder_player_id, until]);
    await log(c, cr.id, now, 'win', `${winnerName} tient la Citadelle à la fermeture des portes et remporte la Croisade`, { playerName: winner.playerName, tribeTag: winner.tribeTag });
  } else {
    await log(c, cr.id, now, 'hold', `${cr.name} a tenu : personne ne remporte la Croisade`);
  }

  // Gloire finale, champion, trésor et compte rendu de chaque participant.
  const scores = (await c.query('SELECT player_id, glory FROM crusade_scores WHERE crusade_id = $1 ORDER BY glory DESC, player_id', [cr.id])).rows as { player_id: number; glory: number }[];
  if (scores[0] && scores[0].glory > 0) await grantTitle(c, scores[0].player_id, 'champion', now, cr.id);
  const shares = shareTreasure(cr.treasure, new Map(scores.map((s) => [s.player_id, s.glory])));
  for (const [i, s] of scores.entries()) {
    await grantTitle(c, s.player_id, 'crusader', now, cr.id);
    const amount = shares.get(s.player_id) ?? 0;
    const capital = (await c.query('SELECT id FROM villages WHERE owner_id = $1 ORDER BY id LIMIT 1', [s.player_id])).rows[0]?.id as number | undefined;
    let delivered = 0;
    if (capital && amount > 0) {
      const v = await syncVillage(c, capital, now);
      const cap = warehouseCapacity(v.buildings.warehouse);
      for (const r of RESOURCES) {
        const next = Math.max(v[r], Math.min(cap, v[r] + amount));
        delivered += next - v[r];
        v[r] = next;
      }
      await saveVillage(c, v);
      outbox.push(s.player_id, { type: 'village', villageId: capital });
    }
    const won = winner && (await c.query('SELECT 1 FROM crusade_scores WHERE crusade_id = $1 AND player_id = $2 AND (tribe_id = $3 OR player_id = $4)', [cr.id, s.player_id, cr.holder_tribe_id, cr.holder_player_id])).rowCount;
    await createReport(
      c,
      outbox,
      s.player_id,
      'crusade',
      `${cr.name} : ${won ? 'victoire de votre camp !' : winner ? `victoire de ${winnerName}` : 'la Citadelle a tenu'} (${s.glory} gloire)`,
      { crusadeId: cr.id, name: cr.name, rank: i + 1, glory: s.glory, treasure: amount, delivered: Math.floor(delivered), winner: winnerName, won: !!won },
      now,
    );
  }

  // Les troupes encore dans la Citadelle rentrent ; la garnison neutre disparaît. Les ordres pas encore partis sont annulés.
  if (citadel) {
    const rows = (await c.query('SELECT home_village_id, units FROM troops WHERE village_id = $1', [citadel.id])).rows;
    for (const r of rows) {
      if (r.home_village_id !== citadel.id) {
        const owner = (await c.query('SELECT owner_id FROM villages WHERE id = $1', [r.home_village_id])).rows[0]?.owner_id ?? null;
        await sendHome(c, citadel, r.home_village_id, owner, normalizeUnits(r.units), now);
        outbox.push(owner, { type: 'village', villageId: r.home_village_id });
      }
    }
    await c.query('DELETE FROM troops WHERE village_id = $1', [citadel.id]);
    const planned = (await c.query('DELETE FROM planned_commands WHERE target_village_id = $1 RETURNING player_id, origin_village_id, type, units', [citadel.id])).rows;
    for (const p of planned) {
      await addTroops(c, p.origin_village_id, p.origin_village_id, normalizeUnits(p.units));
      outbox.push(p.player_id, { type: 'village', villageId: p.origin_village_id });
    }
  }
  await c.query(
    `UPDATE crusades SET status = 'ended', ended_at = $2, winner_tribe_id = $3, winner_player_id = $4, winner_name = $5 WHERE id = $1`,
    [cr.id, now, winner ? cr.holder_tribe_id : null, winner ? cr.holder_player_id : null, winnerName],
  );
}

/**
 * Tâche de fond : ouvre et ferme les croisades à l'heure, annonce la suivante quand elle approche,
 * et retire les Citadelles des croisades finies dès que plus aucune troupe n'est en route vers elles ou depuis elles.
 */
export async function processCrusades(c: Db, outbox: Outbox, now: Date) {
  const active = (await c.query("SELECT * FROM crusades WHERE status <> 'ended' ORDER BY id FOR UPDATE")).rows as CrusadeRow[];
  for (const cr of active) {
    if (now.getTime() >= new Date(cr.closes_at).getTime()) await endCrusade(c, outbox, cr, now);
    else {
      if (cr.status === 'announced' && now.getTime() >= new Date(cr.opens_at).getTime()) {
        await c.query("UPDATE crusades SET status = 'open' WHERE id = $1", [cr.id]);
        await log(c, cr.id, new Date(cr.opens_at), 'open', `Les portes de ${cr.name} s’ouvrent : l’assaut est lancé`);
      }
      await guardWaves(c, cr, now);
    }
  }
  if (env.crusades && !active.some((cr) => now.getTime() < new Date(cr.closes_at).getTime())) {
    const last = (await c.query('SELECT closes_at FROM crusades ORDER BY id DESC LIMIT 1')).rows[0]?.closes_at as Date | undefined;
    const s = crusadeSchedule();
    const after = new Date(Math.max(now.getTime(), last ? new Date(last).getTime() : 0));
    const opens = nextOpening(after, s.weekdays, s.minutes, env.npcTimezone);
    if (opens.getTime() - now.getTime() <= s.notice) await announceCrusade(c, now, opens, new Date(opens.getTime() + s.duration));
  }
  const stale = (
    await c.query(
      `SELECT cr.village_id FROM crusades cr WHERE cr.status = 'ended' AND cr.village_id IS NOT NULL AND cr.ended_at < $1
       AND NOT EXISTS (SELECT 1 FROM commands cm WHERE NOT cm.processed AND cr.village_id IN (cm.origin_village_id, cm.target_village_id, cm.home_village_id))`,
      [new Date(now.getTime() - 3_600_000)],
    )
  ).rows;
  for (const r of stale) await c.query("DELETE FROM villages WHERE id = $1 AND kind = 'citadel'", [r.village_id]);
}

/**
 * Vagues de la Garde : toutes les 15 minutes de l'assaut, si aucune bannière ne flotte, 15 % de la garnison de départ
 * rejoint la Citadelle. Les vagues tombées pendant qu'un camp tenait la bannière sont perdues (on ne les rattrape pas).
 */
async function guardWaves(c: Db, cr: CrusadeRow, now: Date) {
  const due = guardWavesDue({ opensAt: cr.opens_at, closesAt: cr.closes_at }, now);
  if (due <= (cr.guard_waves ?? 0) || !cr.village_id) return;
  await c.query('UPDATE crusades SET guard_waves = $2 WHERE id = $1', [cr.id, due]);
  if (hasHolder(cr)) return;
  const wave = citadelGarrison(populationOf(normalizeUnits(cr.garrison)) * GUARD_WAVE_SHARE);
  await addTroops(c, cr.village_id, cr.village_id, wave);
  const at = new Date(new Date(cr.opens_at).getTime() + due * GUARD_WAVE_MINUTES * 60_000);
  await log(c, cr.id, at, 'guard', `La Garde renforce ${cr.name} : ${populationOf(wave)} défenseurs rejoignent les remparts`);
}

/** Prochaine ouverture prévue (pour l'affichage), sans rien créer. */
export function upcomingOpening(now: Date): Date | null {
  if (!env.crusades) return null;
  const s = crusadeSchedule();
  return nextOpening(now, s.weekdays, s.minutes, env.npcTimezone);
}

// ---------- Récompenses ----------

/** Bonus de production (fraction) du propriétaire d'un village à l'instant `at` : la relique de sa tribu ou la sienne. */
export async function relicBonus(c: Db, ownerId: number | null, at: Date): Promise<number> {
  if (!ownerId || env.crusadeRelicBonus <= 0) return 0;
  const { rows } = await c.query(
    'SELECT (p.relic_until > $2 OR coalesce(t.relic_until > $2, false)) AS on FROM players p LEFT JOIN tribes t ON t.id = p.tribe_id WHERE p.id = $1',
    [ownerId, at],
  );
  return rows[0]?.on ? env.crusadeRelicBonus / 100 : 0;
}

// ---------- Vues ----------

async function summary(c: Db, cr: CrusadeRow, now: Date): Promise<CrusadeSummary> {
  const wall = cr.village_id ? ((await c.query('SELECT buildings FROM villages WHERE id = $1', [cr.village_id])).rows[0]?.buildings?.wall ?? 0) : 0;
  const holder = await holderSide(c, cr);
  const winner =
    cr.status === 'ended' && cr.winner_name
      ? { tribeId: cr.winner_tribe_id, tribeTag: null, tribeName: cr.winner_name, playerName: null }
      : null;
  return {
    id: cr.id,
    name: cr.name,
    x: cr.x,
    y: cr.y,
    villageId: cr.status === 'ended' ? null : cr.village_id,
    season: cr.season,
    phase: crusadePhase({ opensAt: cr.opens_at, closesAt: cr.closes_at, ended: cr.status === 'ended' }, now),
    announcedAt: new Date(cr.announced_at).toISOString(),
    opensAt: new Date(cr.opens_at).toISOString(),
    closesAt: new Date(cr.closes_at).toISOString(),
    wall: cr.status === 'ended' ? 0 : wall,
    breachedAt: cr.breached_at ? new Date(cr.breached_at).toISOString() : null,
    holder: holder && cr.status !== 'ended' ? { ...holder, since: new Date(cr.holder_since ?? now).toISOString() } : null,
    winner,
    treasure: cr.treasure,
  };
}

export async function crusadeScores(c: Db, crusadeId: number): Promise<CrusadeScoreRow[]> {
  const { rows } = await c.query(
    `SELECT s.player_id, p.username, p.title, t.tag, s.glory, s.kills, s.breaches, s.captures
     FROM crusade_scores s JOIN players p ON p.id = s.player_id LEFT JOIN tribes t ON t.id = s.tribe_id
     WHERE s.crusade_id = $1 ORDER BY s.glory DESC, s.kills DESC, s.player_id LIMIT 50`,
    [crusadeId],
  );
  return rows.map((r, i) => ({
    rank: i + 1,
    playerId: r.player_id,
    username: r.username,
    tribeTag: r.tag,
    title: r.title ? (CRUSADE_TITLES[r.title as CrusadeTitleKey] ?? null) : null,
    glory: r.glory,
    kills: r.kills,
    breaches: r.breaches,
    captures: r.captures,
  }));
}

/** Tout ce qu'affiche la page Croisade : la croisade en cours (ou la dernière), sa chronique, sa gloire, l'historique. */
export async function crusadeState(c: Db, playerId: number, now: Date): Promise<CrusadeState> {
  const s = crusadeSchedule();
  const current = (await c.query("SELECT * FROM crusades WHERE status <> 'ended' ORDER BY id LIMIT 1")).rows[0] as CrusadeRow | undefined;
  const shown = current ?? ((await c.query("SELECT * FROM crusades WHERE status = 'ended' ORDER BY id DESC LIMIT 1")).rows[0] as CrusadeRow | undefined);
  const history = (await c.query("SELECT * FROM crusades WHERE status = 'ended' ORDER BY id DESC LIMIT 10")).rows as CrusadeRow[];
  const me = shown ? (await c.query('SELECT glory, kills, tribe_id FROM crusade_scores WHERE crusade_id = $1 AND player_id = $2', [shown.id, playerId])).rows[0] : null;
  const log = shown
    ? (await c.query('SELECT at, kind, text FROM crusade_log WHERE crusade_id = $1 ORDER BY at DESC, id DESC LIMIT 40', [shown.id])).rows.map((r) => ({
        at: new Date(r.at).toISOString(),
        kind: r.kind,
        text: r.text,
      }))
    : [];
  return {
    enabled: !!env.crusades,
    schedule: { weekdays: s.weekdays, time: String(env.crusadeTime), minutes: env.crusadeMinutes, noticeHours: env.crusadeNoticeHours, timeZone: env.npcTimezone },
    current: shown ? await summary(c, shown, now) : null,
    nextOpening: current ? null : (upcomingOpening(now)?.toISOString() ?? null),
    scores: shown ? await crusadeScores(c, shown.id) : [],
    log,
    me: me ? { glory: me.glory, kills: me.kills, tribeId: me.tribe_id } : null,
    history: await Promise.all(history.map((h) => summary(c, h, now))),
    relicBonus: env.crusadeRelicBonus,
  };
}
