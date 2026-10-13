import {
  MERCHANT_CAPACITY,
  STARTING_BUILDINGS,
  STARTING_RESOURCES,
  type BuildingKey,
  type Buildings,
  type ScoutReportData,
  type UnitCounts,
  emptyUnits,
  normalizeUnits,
  travelTime,
  warehouseCapacity,
} from '@aldoria/shared';
import { pool, tx, type Db } from '../db';
import { env } from '../env';
import { GameError } from '../errors';
import { Outbox } from '../notify';
import { unlocked, type Locker } from '../lock';
import { processDueEvents, sendCommand } from './commands';
import { pickNpcName } from './npc-names';
import {
  NOBLES_PER_CONQUEST,
  pointRatioOk,
  NPC_PROFILES,
  npcTribeNameCandidates,
  SOLO_PROFILES,
  chooseBuilding,
  consecutiveScoutFailures,
  isQuiet,
  nextRecruit,
  npcCap,
  pickRaidUnits,
  pickWinningUnits,
  MIN_LOOT,
  SCOUT_MEMORY_GAME_HOURS,
  scoutPaused,
  scoutWave,
  type ScoutFailures,
  tribeMemberProfiles,
  tribeRelations,
  type NpcProfile,
} from './npc-rules';
import { alertAttackedNpcs, alertTribes, defendStep, grudgesOf, npcTribeOf, opWindowMs, saveTribeState, type TribeInfo } from './npc-tribes';
import { villageRoles, type VillageRole } from './npc-roles';
import { nextOffensiveAt, offensiveDue, parseNextOffensive, pickOffensiveUnits, recentlyHit } from './npc-offensive';
import { npcGrudgesOf, refreshWars, warEnemiesOf, WAR_RADIUS } from './npc-wars';
import { refreshTribeWars } from './tribe-wars';
import { raidStep } from './npc-raids';
import { pickIntel } from './intel';
import { acceptOffer, createOffer, expireOffers, freeMerchants } from './market';

/** Nombre maximal d'échanges (acceptations ou publications) d'un PNJ par village et par réflexion. */
const MARKET_ROUNDS = 10;
import { npcAccepts, planOffer } from './market-rules';
import { createVillage, enqueueBuild, enqueueRecruit, getTroops, loadVillage, resourcesOf, syncVillage } from './village';

let rng: () => number = Math.random;
/** Permet aux tests de rendre les décisions des PNJ déterministes. */
export const setNpcRandom = (fn: () => number) => (rng = fn);

/** Un PNJ agit en moyenne toutes les `npcThinkMinutes` minutes (de la moitié à une fois et demie), plus souvent quand le monde va vite. */
const delayMs = () => Math.max(30_000, ((0.5 + rng()) * env.npcThinkMinutes * 60_000) / Math.sqrt(env.worldSpeed));
/** Délai avant qu'un PNJ qui a perdu tous ses villages ne reparte ailleurs. */
const respawnMs = () => (2 * 3_600_000) / Math.sqrt(env.worldSpeed);
/** Rayon (en cases) dans lequel un PNJ cherche des cibles. */
const RAID_RADIUS = 20;
/** Épéistes qui accompagnent chaque noble d'un train. */
const NOBLE_ESCORT = 2;
/** Nombre maximal de nobles dans un train. */
const MAX_TRAIN = 6;
const DAY_MS = 86_400_000;
/** Délai minimal (en heures de jeu) entre deux missions d'espionnage d'un même PNJ chez un joueur ou un PNJ (les barbares ne comptent pas). */
const SCOUT_COOLDOWN_GAME_HOURS = 4;
/** Même délai en temps de guerre (guerre de tribu, riposte, offensive) : les espionnages s'enchaînent bien plus vite. */
const WAR_SCOUT_COOLDOWN_GAME_HOURS = 1;

/**
 * Échecs d'espionnage récents de ce PNJ (voir `consecutiveScoutFailures`), par village visé et par propriétaire : un PNJ qui change de village
 * chez le même joueur garde la vague qu'il avait atteinte.
 */
async function scoutFailures(c: Db, npcId: number, now: Date): Promise<{ byVillage: Map<number, ScoutFailures>; byOwner: Map<number, ScoutFailures> }> {
  const since = new Date(now.getTime() - (SCOUT_MEMORY_GAME_HOURS * 3_600_000) / env.worldSpeed);
  const { rows } = await c.query(
    `SELECT r.village_id, v.owner_id, r.ok, r.created_at FROM (
       SELECT (data->'defender'->'village'->>'id')::int AS village_id, (data->'intel' IS NOT NULL AND data->'intel' <> 'null'::jsonb) AS ok, created_at, id
       FROM reports WHERE player_id = $1 AND type = 'scout' AND created_at > $2 ORDER BY created_at DESC, id DESC LIMIT 300
     ) r LEFT JOIN villages v ON v.id = r.village_id ORDER BY r.created_at DESC, r.id DESC`,
    [npcId, since],
  );
  const at = (r: { created_at: Date }) => new Date(r.created_at).getTime();
  return {
    byVillage: consecutiveScoutFailures(rows.map((r) => ({ villageId: r.village_id as number, ok: r.ok as boolean, at: at(r) }))),
    byOwner: consecutiveScoutFailures(rows.filter((r) => r.owner_id !== null).map((r) => ({ villageId: r.owner_id as number, ok: r.ok as boolean, at: at(r) }))),
  };
}

/** Éclaireurs vus chez une cible lors du dernier renseignement du PNJ (espionnage réussi ou attaque), ou undefined s'il n'en a pas. */
async function knownScoutsAt(c: Db, npcId: number, villageId: number): Promise<number | undefined> {
  const { rows } = await c.query(
    `SELECT type, data, created_at FROM reports WHERE player_id = $1 AND type IN ('scout', 'attack') AND (data->'defender'->'village'->>'id')::int = $2
     ORDER BY created_at DESC, id DESC LIMIT 20`,
    [npcId, villageId],
  );
  return pickIntel(rows)?.troops.scout;
}

const isQuietAt = (d: Date) => isQuiet(d, env.npcTimezone, env.npcQuietStart, env.npcQuietEnd);

async function worldDays(c: Db, now: Date): Promise<number> {
  const started = (await c.query("SELECT value FROM world_meta WHERE key = 'started_at'")).rows[0]?.value;
  return started ? ((now.getTime() - Date.parse(started)) / DAY_MS) * env.worldSpeed : 0;
}

// ---------- Création ----------

async function npcSpot(c: Db): Promise<{ x: number; y: number }> {
  const size = env.mapSize;
  const center = size / 2;
  for (let attempt = 0; attempt < 200; attempt++) {
    // Entre le centre (réservé aux joueurs) et le bord, à bonne distance des autres villages.
    const r = Math.min(12, center * 0.3) + rng() * (center * 0.8 - Math.min(12, center * 0.3));
    const angle = rng() * Math.PI * 2;
    const x = Math.round(center + Math.cos(angle) * r);
    const y = Math.round(center + Math.sin(angle) * r);
    if (x < 1 || y < 1 || x >= size - 1 || y >= size - 1) continue;
    const near = await c.query('SELECT 1 FROM villages WHERE (x - $1)^2 + (y - $2)^2 < 9 LIMIT 1', [x, y]);
    if (near.rows.length === 0) return { x, y };
  }
  throw new Error('Pas de place pour un PNJ sur la carte');
}

async function uniqueNpcName(c: Db): Promise<{ first: string; username: string }> {
  const username = await pickNpcName(rng, async (name) => (await c.query('SELECT 1 FROM players WHERE lower(username) = lower($1)', [name])).rows.length > 0);
  return { first: username, username };
}

async function spawnNpcVillage(c: Db, playerId: number, first: string, now: Date): Promise<number> {
  const spot = await npcSpot(c);
  return createVillage(c, {
    ownerId: playerId,
    name: `Domaine de ${first}`,
    x: spot.x,
    y: spot.y,
    buildings: { ...STARTING_BUILDINGS },
    resources: { ...STARTING_RESOURCES },
    at: now,
  });
}

/** Crée un joueur PNJ avec son village de départ. Son mot de passe n'est pas un hachage valide : personne ne peut s'y connecter. */
export async function createNpc(c: Db, now: Date, profile?: NpcProfile, tribeId?: number): Promise<number> {
  const { first, username } = await uniqueNpcName(c);
  const chosen = profile ?? SOLO_PROFILES[Math.floor(rng() * SOLO_PROFILES.length)];
  const { rows } = await c.query(
    `INSERT INTO players (username, password_hash, is_npc, npc_profile, npc_next_action_at, tribe_id)
     VALUES ($1, '!', true, $2, $3, $4) RETURNING id`,
    [username, chosen, new Date(now.getTime() + rng() * 10 * 60_000), tribeId ?? null],
  );
  await spawnNpcVillage(c, rows[0].id, first, now);
  return rows[0].id;
}

/** Les premiers PNJ portaient « (PNJ) » à la fin de leur nom : ils reçoivent un nom thématique, comme les nouveaux. */
export async function renameLegacyNpcs(c: Db) {
  const old = (await c.query("SELECT id FROM players WHERE is_npc AND username LIKE '% (PNJ)' ORDER BY id")).rows;
  for (const { id } of old) {
    const { username } = await uniqueNpcName(c);
    await c.query('UPDATE players SET username = $2 WHERE id = $1', [id, username]);
  }
}

/** Complète la population de PNJ solitaires jusqu'à `NPC_COUNT` (sans jamais en retirer). Les membres de tribus comptent à part. */
export async function ensureNpcs(c: Db, now: Date) {
  await renameLegacyNpcs(c);
  const have = (await c.query(env.npcTribeMax > 0 ? 'SELECT count(*)::int AS n FROM players WHERE is_npc' : 'SELECT count(*)::int AS n FROM players WHERE is_npc AND tribe_id IS NULL')).rows[0].n as number;
  for (let i = have; i < env.npcCount; i++) await createNpc(c, now);
}

/** Un nouveau PNJ solitaire arrive tous les `24 h / NPC_DAILY`, sans dépasser `NPC_MAX` PNJ en tout. Renvoie son identifiant s'il y en a un. */
export async function ensureDailyNpc(c: Db, now: Date, opts: { perDay?: number; max?: number } = {}): Promise<number | null> {
  const perDay = opts.perDay ?? env.npcDaily;
  const max = opts.max ?? env.npcMax;
  if (perDay <= 0) return null;
  const { rows } = await c.query('SELECT count(*)::int AS n, max(created_at) AS last FROM players WHERE is_npc');
  if (rows[0].n >= max) return null;
  if (rows[0].last && now.getTime() - new Date(rows[0].last).getTime() < DAY_MS / perDay) return null;
  const id = await createNpc(c, now);
  await assignNpcToTribe(c, id);
  return id;
}

const TRIBE_DESCRIPTION = 'Une compagnie soudée : ses membres se défendent les uns les autres.';

/** Crée une tribu de PNJ au nom encore libre. */
async function createNpcTribe(c: Db): Promise<number> {
  const free: { name: string; tag: string }[] = [];
  for (const cand of npcTribeNameCandidates()) {
    const taken = await c.query('SELECT 1 FROM tribes WHERE lower(name) = lower($1) OR lower(tag) = lower($2)', [cand.name, cand.tag]);
    if (!taken.rows.length) free.push(cand);
  }
  let pick = free.length ? free[Math.floor(rng() * free.length)] : null;
  if (!pick) {
    const n = (await c.query('SELECT count(*)::int AS n FROM tribes')).rows[0].n as number;
    pick = { name: `Compagnie ${n + 1}`, tag: `C${n + 1}`.slice(0, 6) };
  }
  const { rows } = await c.query('INSERT INTO tribes (name, tag, is_npc, description) VALUES ($1, $2, true, $3) RETURNING id', [pick.name, pick.tag, TRIBE_DESCRIPTION]);
  return rows[0].id;
}

/** Redistribue alliances et rivalités entre toutes les tribus de PNJ (appelé quand leur nombre change). */
export async function refreshTribeRelations(c: Db) {
  await c.query("UPDATE tribes SET description = $1 WHERE is_npc AND description LIKE 'Tribu de personnages non joueurs%'", [TRIBE_DESCRIPTION]);
  const ids = (await c.query('SELECT id FROM tribes WHERE is_npc ORDER BY id')).rows.map((r) => r.id as number);
  const relations = tribeRelations(ids);
  for (const id of ids) {
    const rel = relations.get(id)!;
    await c.query("UPDATE tribes SET npc_state = npc_state || jsonb_build_object('allies', $2::jsonb, 'rivals', $3::jsonb) WHERE id = $1", [
      id,
      JSON.stringify(rel.allies),
      JSON.stringify(rel.rivals),
    ]);
  }
}

/**
 * Fait entrer un PNJ sans tribu dans la tribu de PNJ la moins peuplée qui a encore de la place, ou fonde une nouvelle tribu s'il n'y en a pas.
 * Les tribus restent ainsi de taille comparable, et le premier membre d'une tribu en devient le chef.
 */
export async function assignNpcToTribe(c: Db, npcId: number, max: number = env.npcTribeMax): Promise<number | null> {
  if (max <= 0) return null;
  const open = (
    await c.query(
      `SELECT t.id, t.leader_id, count(p.id)::int AS n FROM tribes t LEFT JOIN players p ON p.tribe_id = t.id
       WHERE t.is_npc GROUP BY t.id HAVING count(p.id) < $1 ORDER BY count(p.id), t.id LIMIT 1`,
      [max],
    )
  ).rows[0];
  let tribeId: number;
  let created = false;
  if (open) tribeId = open.id;
  else {
    tribeId = await createNpcTribe(c);
    created = true;
  }
  await c.query('UPDATE players SET tribe_id = $2 WHERE id = $1', [npcId, tribeId]);
  if (created || !open?.leader_id) await c.query('UPDATE tribes SET leader_id = $2 WHERE id = $1 AND leader_id IS NULL', [tribeId, npcId]);
  if (created) await refreshTribeRelations(c);
  return tribeId;
}

/** Place tous les PNJ encore sans tribu (les anciens PNJ solitaires comme les nouveaux arrivants). */
export async function assignTriblessNpcs(c: Db, max: number = env.npcTribeMax) {
  if (max <= 0) return;
  const rows = (await c.query('SELECT id FROM players WHERE is_npc AND tribe_id IS NULL ORDER BY id')).rows;
  for (const { id } of rows) await assignNpcToTribe(c, id, max);
}

/**
 * Complète les tribus de PNJ jusqu'à `NPC_TRIBES` tribus de `NPC_TRIBE_SIZE` membres (sans jamais en retirer),
 * puis (re)distribue alliances et rivalités. Le premier membre de chaque tribu en est le chef.
 */
export async function ensureNpcTribes(c: Db, now: Date, opts: { tribes?: number; size?: number } = {}) {
  const wanted = opts.tribes ?? env.npcTribes;
  const size = opts.size ?? env.npcTribeSize;
  const existing = (await c.query('SELECT id FROM tribes WHERE is_npc ORDER BY id')).rows.map((r) => r.id as number);
  const ids = [...existing];
  for (let i = existing.length; i < wanted; i++) ids.push(await createNpcTribe(c));
  for (const id of ids) {
    const members = (await c.query('SELECT count(*)::int AS n FROM players WHERE tribe_id = $1', [id])).rows[0].n as number;
    const profiles = tribeMemberProfiles(size);
    let leader: number | null = null;
    for (let i = members; i < size; i++) {
      const npcId = await createNpc(c, now, profiles[i], id);
      if (i === 0) leader = npcId;
    }
    if (leader) await c.query('UPDATE tribes SET leader_id = $2 WHERE id = $1', [id, leader]);
  }
  await refreshTribeRelations(c);
}

// ---------- Réflexion ----------

async function freshScoutIntel(c: Db, npcId: number, villageId: number, now: Date) {
  const { rows } = await c.query(
    `SELECT data, created_at FROM reports
     WHERE player_id = $1 AND type = 'scout' AND (data->'defender'->'village'->>'id')::int = $2
     ORDER BY created_at DESC, id DESC LIMIT 1`,
    [npcId, villageId],
  );
  const row = rows[0];
  if (!row) return null;
  const data = row.data as ScoutReportData;
  if (!data.intel) return null;
  // Un renseignement reste valable une heure réelle (moins quand le monde va vite).
  const maxAge = (60 * 60_000) / Math.min(env.worldSpeed, 6);
  if (now.getTime() - new Date(row.created_at).getTime() > maxAge) return null;
  // Si le PNJ a frappé ce village depuis le rapport, les ressources indiquées ne valent plus rien : il faut espionner de nouveau.
  const raided = (
    await c.query(
      `SELECT 1 FROM commands WHERE player_id = $1 AND target_village_id = $2 AND type = 'attack' AND sent_at >= $3
       AND coalesce((units->>'swordsman')::int, 0) + coalesce((units->>'cavalry')::int, 0) > 0 LIMIT 1`,
      [npcId, villageId, row.created_at],
    )
  ).rows;
  if (raided.length) return null;
  return { troops: normalizeUnits(data.intel.troops), wall: data.intel.buildings.wall ?? 0, resources: data.intel.resources };
}

interface Candidate {
  id: number;
  x: number;
  y: number;
  ownerId: number | null;
  /** Village d'un PNJ d'une tribu rivale : cible permise à toute heure. */
  rival: boolean;
  /** Village d'un ennemi déclaré : tribu en guerre contre la nôtre, ou PNJ qui nous a attaqués. */
  enemy: boolean;
  /** Points de tous les villages du propriétaire (0 pour un village barbare). */
  ownerPoints: number;
  dist: number;
}

/** Qui un PNJ peut viser en plus des barbares et des joueurs : les tribus rivales, les tribus en guerre et les PNJ qui l'ont attaqué. */
interface Hostiles {
  rivals: number[];
  warTribes: number[];
  grudges: number[];
}

async function candidates(c: Db, npcId: number, from: { id: number; x: number; y: number }, now: Date, hostiles: Hostiles): Promise<Candidate[]> {
  const { rows } = await c.query(
    `SELECT v.id, v.x, v.y, v.owner_id, p.tribe_id AS owner_tribe, (p.is_npc IS TRUE) AS rival, coalesce((SELECT sum(w.points) FROM villages w WHERE w.owner_id = v.owner_id), 0)::int AS owner_points FROM villages v LEFT JOIN players p ON p.id = v.owner_id
     WHERE v.id <> $1
       AND ((v.x - $2)^2 + (v.y - $3)^2 <= $5 OR (p.tribe_id = ANY($8::int[]) AND (v.x - $2)^2 + (v.y - $3)^2 <= $9))
       AND (v.owner_id IS NULL
            OR (NOT p.is_npc AND (p.protection_until IS NULL OR p.protection_until <= $4))
            OR (p.is_npc AND (p.tribe_id = ANY($7::int[]) OR p.tribe_id = ANY($8::int[]) OR p.id = ANY($10::int[]))))
       AND NOT EXISTS (SELECT 1 FROM commands cm WHERE cm.target_village_id = v.id AND cm.player_id = $6 AND NOT cm.processed)`,
    [from.id, from.x, from.y, now, RAID_RADIUS * RAID_RADIUS, npcId, hostiles.rivals, hostiles.warTribes, WAR_RADIUS * WAR_RADIUS, hostiles.grudges],
  );
  return rows.map((r) => ({
    id: r.id,
    x: r.x,
    y: r.y,
    ownerId: r.owner_id,
    rival: r.rival,
    // Un village de la tribu ennemie en guerre est un ennemi, de PNJ comme de joueur ; la rancune ne vaut qu'entre PNJ.
    enemy: hostiles.warTribes.includes(r.owner_tribe) || (r.rival && hostiles.grudges.includes(r.owner_id)),
    ownerPoints: r.owner_points,
    dist: Math.hypot(r.x - from.x, r.y - from.y),
  }));
}

/**
 * Un PNJ de type pillard ou conquérant vise aussi les joueurs, mais jamais pendant les heures calmes ni au-delà de ses plafonds.
 * Dans une tribu, seul le chef lance une opération contre un joueur ; les autres s'y joignent si leur troupe peut arriver dans la fenêtre.
 */
async function attackStep(c: Db, outbox: Outbox, npcId: number, profile: NpcProfile, villageId: number, cap: number, tribe: TribeInfo | null, now: Date) {
  const village = await loadVillage(c, villageId);
  const home = await getTroops(c, villageId, villageId);
  const attackers: UnitCounts = { ...emptyUnits(), swordsman: home.swordsman, cavalry: home.cavalry, ram: home.ram };
  if (attackers.swordsman + attackers.cavalry < 5) return;
  const grudges = await grudgesOf(c, npcId, tribe, now);
  const quiet = isQuietAt(now);
  const arrivalOf = (units: UnitCounts, to: { x: number; y: number }) => new Date(now.getTime() + travelTime(units, village, to, env.worldSpeed) * 1000);
  /**
   * « Train de nobles » : un PNJ qui a au moins 4 nobles les envoie un par un, arrivant à une seconde d'écart juste après l'assaut qui nettoie la défense.
   * Renvoie le nombre de nobles du train (0 si aucun).
   */
  const trainSize = (): number => {
    if (home.noble < NOBLES_PER_CONQUEST) return 0;
    return Math.min(home.noble, MAX_TRAIN);
  };

  // 1. Une opération de la tribu est en cours : on tente de s'y joindre.
  const op = tribe?.state.op;
  if (tribe && op && Date.parse(op.landBy) > now.getTime() && !op.joined.includes(npcId) && !quiet) {
    const target = await loadVillage(c, op.targetId).catch(() => null);
    const units = target && pickWinningUnits(attackers, op.troops, op.wall);
    if (target && units) {
      const arrival = arrivalOf(units, target);
      const inWindow = arrival.getTime() >= Date.parse(op.landAt) - opWindowMs() && arrival.getTime() <= Date.parse(op.landBy);
      if (inWindow && !isQuietAt(arrival)) {
        try {
          await sendCommand(c, outbox, npcId, villageId, { type: 'attack', targetId: target.id, units }, now);
          op.joined.push(npcId);
          await saveTribeState(c, tribe);
          return;
        } catch (err) {
          if (!(err instanceof GameError)) throw err;
        }
      }
    }
  }
  if (tribe && op && Date.parse(op.landBy) <= now.getTime()) {
    tribe.state.op = null;
    await saveTribeState(c, tribe);
  }

  const warTribes = warEnemiesOf(tribe, now);
  // Une cible dont les éclaireurs ont été tués trois fois de suite est laissée tranquille un temps : mieux vaut en viser une autre.
  // Après la pause, le PNJ y retourne avec la plus forte vague d'éclaireurs.
  const failures = await scoutFailures(c, npcId, now);
  const all = (await candidates(c, npcId, village, now, { rivals: tribe?.state.rivals ?? [], warTribes, grudges: await npcGrudgesOf(c, npcId, tribe, now) })).filter(
    (t) => !scoutPaused(failures.byVillage.get(t.id), now, env.worldSpeed),
  );
  const barbarians = all.filter((t) => t.ownerId === null);
  const rivalVillages = all.filter((t) => t.rival);
  // Tous les PNJ peuvent s'en prendre aux joueurs sans provocation (dans une tribu, le chef ou le conquérant) : leur type ne règle que leur évolution.
  // Celui qui a été attaqué riposte en plus, sans attendre.
  const isLeader = !tribe || tribe.leaderId === npcId || profile === 'conqueror';
  const opCooldownOk = !tribe || !tribe.state.lastOpAt || now.getTime() - Date.parse(tribe.state.lastOpAt) >= (12 * 3_600_000) / env.worldSpeed;
  const humans = all.filter((t) => t.ownerId !== null && !t.rival);
  const revenge = quiet ? [] : humans.filter((t) => grudges.includes(t.ownerId!));
  // En guerre contre une tribu de joueurs, tous les membres frappent ses villages (pas seulement le chef), sans condition de taille : jamais pendant les heures calmes.
  const warPlayers = quiet ? [] : humans.filter((t) => t.enemy);
  // Sans provocation, un PNJ ne s'attaque qu'à un joueur de sa taille : entre 70 % et 150 % de ses points.
  const myPoints = (await c.query('SELECT coalesce(sum(points), 0)::int AS p FROM villages WHERE owner_id = $1', [npcId])).rows[0].p as number;
  const sameSize = humans.filter((t) => pointRatioOk(myPoints, t.ownerPoints));
  const aggressive = !quiet && isLeader && opCooldownOk ? sameSize : [];
  const players = [...new Set([...revenge, ...aggressive, ...warPlayers])];
  // Un Bâtisseur se développe surtout en pillant les barbares et ne s'en prend que de temps en temps à un joueur.
  // Les ennemis déclarés (guerre de tribu, PNJ qui nous a attaqués) passent avant tout ; viennent ensuite les rivaux, puis les barbares.
  // Un village de joueur ne se vise jamais pendant les heures calmes, même en guerre.
  const enemyVillages = all.filter((t) => t.enemy && (t.rival || !quiet));
  const prey = enemyVillages.length && rng() < 0.9 ? enemyVillages : rivalVillages.length && rng() < 0.6 ? rivalVillages : barbarians;
  const revengePool = players.filter((t) => revenge.includes(t));
  // Quand une guerre ou une vengeance contre un autre PNJ occupe la tribu, les joueurs passent au second plan.
  const playerChance = enemyVillages.length ? 0.1 : profile === 'builder' ? 0.15 : 0.4;
  const pool = revengePool.length ? revengePool : players.length && (prey.length === 0 || rng() < playerChance) ? players : prey;
  // Offensive occasionnelle : à l'heure programmée, le PNJ vise un ennemi de guerre, un rival ou un joueur de sa taille (jamais celui qu'un PNJ a déjà frappé
  // pendant la période), garde la même cible d'un tour à l'autre le temps de l'espionner, puis frappe avec une part de son armée.
  const npcState = (await c.query('SELECT npc_state FROM players WHERE id = $1', [npcId])).rows[0]?.npc_state ?? {};
  let nextOff = parseNextOffensive(npcState);
  if (nextOff === null && env.npcOffensive) {
    nextOff = nextOffensiveAt(now, rng()).getTime();
    await c.query("UPDATE players SET npc_state = npc_state || jsonb_build_object('offensive', jsonb_build_object('nextAt', $2::text)) WHERE id = $1", [npcId, new Date(nextOff).toISOString()]);
  }
  let offensive = false;
  let offensivePool: Candidate[] = [];
  if (!revengePool.length && offensiveDue(nextOff, now)) {
    const fresh = sameSize.filter((t) => !quiet);
    const hitSafe: Candidate[] = [];
    for (const t of fresh) if (!(await recentlyHit(c, t.ownerId!, now))) hitSafe.push(t);
    offensivePool = [...warPlayers, ...enemyVillages, ...hitSafe, ...rivalVillages.filter((t) => !t.enemy)];
    offensive = offensivePool.length > 0;
  }
  if (!offensive && pool.length === 0) return;
  const keptId = offensive ? (npcState.offensive?.targetId as number | undefined) : undefined;
  const target = (offensive ? offensivePool.find((t) => t.id === keptId) : undefined) ?? (offensive ? offensivePool : pool).map((t) => ({ t, score: t.dist + rng() * 6 })).sort((a, b) => a.score - b.score)[0].t;
  if (offensive) {
    await c.query("UPDATE players SET npc_state = npc_state || jsonb_build_object('offensive', jsonb_build_object('nextAt', $2::text, 'targetId', $3::int)) WHERE id = $1", [npcId, new Date(nextOff!).toISOString(), target.id]);
  }
  const finishOffensive = async (factor: number) =>
    c.query("UPDATE players SET npc_state = npc_state || jsonb_build_object('offensive', jsonb_build_object('nextAt', $2::text)) WHERE id = $1", [npcId, nextOffensiveAt(now, rng(), factor).toISOString()]);

  const hostileToPlayer = target.ownerId !== null && !target.rival;
  // L'arrivée d'une attaque ou d'un espion chez un joueur ne doit jamais tomber pendant les heures calmes.
  const arrivesQuiet = (units: UnitCounts) => hostileToPlayer && isQuietAt(arrivalOf(units, target));

  const intel = await freshScoutIntel(c, npcId, target.id, now);
  try {
    if (!intel) {
      // En guerre, en riposte ou pendant une offensive, le PNJ espionne plus souvent et engage le gros de ses éclaireurs.
      const war = offensive || target.enemy || (hostileToPlayer && grudges.includes(target.ownerId!));
      const cooldownHours = war ? WAR_SCOUT_COOLDOWN_GAME_HOURS : SCOUT_COOLDOWN_GAME_HOURS;
      // Seuls comptent les espionnages chez un joueur ou un PNJ : les éclaireurs du pillage intensif vers les barbares ne retardent rien.
      const lastScout = (
        await c.query(
          `SELECT max(cm.sent_at) AS at FROM commands cm JOIN villages v ON v.id = cm.target_village_id
           WHERE cm.player_id = $1 AND cm.type = 'attack' AND coalesce((cm.units->>'scout')::int, 0) > 0 AND v.owner_id IS NOT NULL`,
          [npcId],
        )
      ).rows[0].at;
      if (lastScout && now.getTime() - new Date(lastScout).getTime() < (cooldownHours * 3_600_000) / env.worldSpeed) return;
      // Après un échec, on envoie bien plus d'éclaireurs : 10, puis 25, puis 60 (au moins le double de ceux déjà vus chez la cible).
      const failed = Math.max(failures.byVillage.get(target.id)?.count ?? 0, target.ownerId !== null ? (failures.byOwner.get(target.ownerId)?.count ?? 0) : 0);
      const count = scoutWave(failed, home.scout, { knownScouts: await knownScoutsAt(c, npcId, target.id), war });
      if (count === 0) return;
      const scouts = { ...emptyUnits(), scout: count };
      if (arrivesQuiet(scouts)) return;
      await sendCommand(c, outbox, npcId, villageId, { type: 'attack', targetId: target.id, units: scouts }, now);
      return;
    }
    // Les troupes dépendent du butin : assez pour gagner et emporter l'essentiel du stock, toute l'armée s'il le faut.
    // Pour se venger ou faire la guerre, un PNJ frappe fort : au moins 70 % de son armée offensive.
    if (offensive) {
      // Offensive : une part de l'armée part dans tous les cas, même trop faible pour vaincre (elle déstabilise) ; pas de train de nobles ni de seuil de butin.
      const units = pickOffensiveUnits(attackers);
      if (!units) return void (await finishOffensive(4));
      const arrival = arrivalOf(units, target);
      if (hostileToPlayer && isQuietAt(arrival)) return;
      await sendCommand(c, outbox, npcId, villageId, { type: 'attack', targetId: target.id, units }, now);
      await finishOffensive(1);
      return;
    }
    const avenging = (hostileToPlayer && grudges.includes(target.ownerId!)) || target.enemy;
    // Chaque noble du train part avec une petite escorte d'épéistes (un noble seul ne survit pas à la défense de base) : on la met de côté avant de choisir l'assaut.
    let nobles = trainSize();
    if (nobles > 0) nobles = Math.min(nobles, Math.floor(Math.max(0, attackers.swordsman - 5) / NOBLE_ESCORT));
    if (nobles < 2) nobles = 0;
    const raid = pickRaidUnits({ ...attackers, swordsman: attackers.swordsman - nobles * NOBLE_ESCORT }, intel.troops, intel.wall, intel.resources, avenging ? 0.7 : 0);
    if (!raid) return;
    const units = raid.units;
    // Hors riposte et conquête, un pillage ne vaut le déplacement que s'il y a de quoi remplir les sacs.
    if (!avenging && nobles === 0 && raid.loot < MIN_LOOT) return;
    // Tous les envois arrivent à la suite : l'assaut d'abord, puis un noble par seconde.
    const single = { ...emptyUnits(), noble: 1, swordsman: NOBLE_ESCORT };
    const naturals = [arrivalOf(units, target), ...(nobles ? [arrivalOf(single, target)] : [])];
    const landTime = Math.max(...naturals.map((d) => d.getTime()));
    if (hostileToPlayer && isQuietAt(new Date(landTime + nobles * 1000))) return;
    const strike = await sendCommand(c, outbox, npcId, villageId, { type: 'attack', targetId: target.id, units }, now);
    await c.query('UPDATE commands SET arrive_at = $2 WHERE id = $1', [strike.id, new Date(landTime)]);
    for (let i = 0; i < nobles; i++) {
      const sent = await sendCommand(c, outbox, npcId, villageId, { type: 'attack', targetId: target.id, units: single }, now);
      await c.query('UPDATE commands SET arrive_at = $2 WHERE id = $1', [sent.id, new Date(landTime + (i + 1) * 1000)]);
    }
    // Le chef d'une tribu qui frappe un joueur ouvre une opération : les autres membres ont une fenêtre pour le rejoindre.
    if (tribe && hostileToPlayer && !(tribe.state.op && Date.parse(tribe.state.op.landBy) > now.getTime())) {
      const landAt = new Date(landTime);
      tribe.state.op = {
        targetId: target.id,
        landAt: landAt.toISOString(),
        landBy: new Date(landAt.getTime() + opWindowMs()).toISOString(),
        troops: intel.troops,
        wall: intel.wall,
        joined: [npcId],
      };
      tribe.state.lastOpAt = now.toISOString();
      await saveTribeState(c, tribe);
    }
  } catch (err) {
    if (!(err instanceof GameError)) throw err;
  }
}

/** Construit le prochain bâtiment du plan du PNJ. */
async function buildStep(c: Db, profile: NpcProfile, villageId: number, cap: number, now: Date) {
  const v = await syncVillage(c, villageId, now);
  const queued = (await c.query('SELECT building, level FROM build_queue WHERE village_id = $1', [villageId])).rows;
  const levels: Buildings = { ...v.buildings };
  for (const q of queued) levels[q.building as BuildingKey] = Math.max(levels[q.building as BuildingKey], q.level);
  const next = chooseBuilding(profile, levels, cap);
  if (!next) return;
  try {
    await enqueueBuild(c, villageId, next, now);
  } catch (err) {
    if (!(err instanceof GameError)) throw err;
  }
}

/**
 * Recrutement : la file se remplit dès qu'il lui reste moins de deux réflexions de travail (elle ne reste donc jamais vide entre deux réflexions),
 * avec jusqu'à `npcRecruitBatches` lots de types différents, chacun d'au plus `npcRecruitBatch` unités.
 */
async function recruitStep(c: Db, profile: NpcProfile, role: VillageRole, villageId: number, cap: number, now: Date) {
  const v = await syncVillage(c, villageId, now);
  if (v.buildings.barracks < 1) return;
  const { rows: q } = await c.query(
    `SELECT coalesce(extract(epoch FROM max(start_at + make_interval(secs => count * unit_seconds)) - $2::timestamptz), 0)::float AS left FROM recruit_queue WHERE village_id = $1`,
    [villageId, now],
  );
  if (q[0].left > (2 * env.npcThinkMinutes * 60) / Math.sqrt(env.worldSpeed)) return;
  const owned = await getTroops(c, villageId, villageId);
  const away = (await c.query("SELECT units FROM commands WHERE home_village_id = $1 AND NOT processed AND type IN ('attack', 'support', 'return')", [villageId])).rows;
  for (const r of away) {
    const u = normalizeUnits(r.units);
    for (const k of Object.keys(owned) as (keyof UnitCounts)[]) owned[k] += u[k];
  }
  const queuedUnits = (await c.query('SELECT unit, count - delivered AS n FROM recruit_queue WHERE village_id = $1', [villageId])).rows;
  for (const r of queuedUnits) owned[r.unit as keyof UnitCounts] += r.n;
  let batches = 0;
  for (const choice of nextRecruit(profile, role, v.buildings, owned, cap, env.npcDifficulty, env.npcRecruitBatch)) {
    if (batches >= env.npcRecruitBatches) break;
    // Trop cher ou trop de monde pour la ferme : on réduit le lot de moitié jusqu'à ce qu'il passe.
    for (let count = choice.count; count >= 1; count = Math.floor(count / 2)) {
      try {
        await enqueueRecruit(c, villageId, choice.unit, count, now);
        batches++;
        break;
      } catch (err) {
        if (!(err instanceof GameError)) throw err;
      }
    }
  }
}

async function economyStep(c: Db, npcId: number, profile: NpcProfile, role: VillageRole, villageId: number, cap: number, now: Date) {
  // Le premier servi prend les ressources : par défaut l'armée, sauf si l'administration remet la construction en tête.
  if (env.npcArmyFirst) {
    await recruitStep(c, profile, role, villageId, cap, now);
    await buildStep(c, profile, villageId, cap, now);
  } else {
    await buildStep(c, profile, villageId, cap, now);
    await recruitStep(c, profile, role, villageId, cap, now);
  }
}

/**
 * Marché : un PNJ rééquilibre ses ressources sans limite de distance, d'offres ni de fréquence. Il accepte les offres qui lui
 * apportent ce qui lui manque contre son excédent, puis publie les siennes, jusqu'à épuisement de ses marchands libres.
 */
async function marketStep(c: Db, outbox: Outbox, npcId: number, profile: NpcProfile, villageId: number, now: Date) {
  for (let round = 0; round < MARKET_ROUNDS; round++) {
    const v = await syncVillage(c, villageId, now);
    if (v.buildings.market < 1) return;
    const free = await freeMerchants(c, villageId, v.buildings.market);
    if (free < 1) return;
    const npc = { stock: resourcesOf(v), capacity: warehouseCapacity(v.buildings.warehouse) };

    const { rows } = await c.query(
      `SELECT o.id, o.give_resource, o.give_amount, o.want_resource, o.want_amount, (o.give_amount::float / o.want_amount) AS rate
       FROM market_offers o
       WHERE o.status = 'open' AND o.expires_at > $1 AND o.player_id <> $2
       ORDER BY rate DESC, o.id LIMIT 50`,
      [now, npcId],
    );
    let done = false;
    for (const o of rows) {
      const offer = { give: o.give_resource, giveAmount: o.give_amount, want: o.want_resource, wantAmount: o.want_amount };
      if (!npcAccepts(npc, offer)) continue;
      try {
        await acceptOffer(c, outbox, npcId, villageId, o.id, now);
        done = true;
        break;
      } catch (err) {
        if (!(err instanceof GameError)) throw err;
      }
    }
    if (done) continue;

    const plan = planOffer(npc, profile, free * MERCHANT_CAPACITY);
    if (!plan) return;
    try {
      await createOffer(c, outbox, npcId, villageId, plan, now, Infinity);
    } catch (err) {
      if (!(err instanceof GameError)) throw err;
      return;
    }
  }
}

/** Une séance de réflexion : respawn si besoin, construction, recrutement, puis éventuellement une attaque. */
/** Fait réfléchir un PNJ. Renvoie vrai s'il en veut à un joueur (il repensera alors plus vite). */
export async function npcThink(c: Db, outbox: Outbox, npcId: number, now: Date): Promise<boolean> {
  const npc = (await c.query('SELECT id, username, npc_profile, npc_state FROM players WHERE id = $1 AND is_npc FOR UPDATE', [npcId])).rows[0];
  if (!npc) return false;
  const profile = (NPC_PROFILES.includes(npc.npc_profile) ? npc.npc_profile : 'builder') as NpcProfile;
  const villages = (await c.query('SELECT id FROM villages WHERE owner_id = $1 ORDER BY id', [npcId])).rows;

  if (villages.length === 0) {
    const lostAt = npc.npc_state?.lostAt ? Date.parse(npc.npc_state.lostAt) : null;
    if (lostAt === null) {
      await c.query("UPDATE players SET npc_state = jsonb_build_object('lostAt', $2::text) WHERE id = $1", [npcId, now.toISOString()]);
    } else if (now.getTime() - lostAt >= respawnMs()) {
      await spawnNpcVillage(c, npcId, npc.username, now);
      await c.query("UPDATE players SET npc_state = '{}'::jsonb WHERE id = $1", [npcId]);
    }
    return false;
  }

  const cap = npcCap(await worldDays(c, now), env.npcDifficulty);
  const tribe = await npcTribeOf(c, npcId, now);
  let angry = false;
  // Les villages se partagent entre offensifs et défensifs selon le profil du PNJ (voir npc-roles.ts).
  const roles = villageRoles(profile, villages.length);
  for (const [i, v] of villages.slice(0, 3).entries()) {
    await economyStep(c, npcId, profile, roles[i], v.id, cap, now);
    await marketStep(c, outbox, npcId, profile, v.id, now);
    if (tribe) await defendStep(c, outbox, npcId, v.id, tribe, now);
    // Un PNJ en colère enchaîne jusqu'à trois attaques par réflexion, sur des villages différents de l'agresseur.
    const angryHere = (await grudgesOf(c, npcId, tribe, now)).length > 0;
    angry ||= angryHere;
    for (let k = 0; k < (angryHere ? 3 : 1); k++) {
      // Attaques en route avant et après l'étape (aucune ne peut arriver pendant) : si rien n'est parti, inutile d'insister.
      const openAttacks = async () =>
        (await c.query("SELECT count(*)::int AS n FROM commands WHERE player_id = $1 AND type = 'attack' AND NOT processed", [npcId])).rows[0].n as number;
      const before = await openAttacks();
      await attackStep(c, outbox, npcId, profile, v.id, cap, tribe, now);
      if ((await openAttacks()) === before) break;
    }
  }
  // Pillage intensif : chaque village (pas seulement les trois premiers) envoie ses pillages vers les villages sans défense qu'il connaît.
  const hostiles = { tribes: [...(tribe?.state.rivals ?? []), ...warEnemiesOf(tribe, now)], npcs: await npcGrudgesOf(c, npcId, tribe, now) };
  for (const v of villages) await raidStep(c, outbox, npcId, v.id, hostiles, now);
  // Les rapports d'un PNJ ne servent qu'à ses décisions récentes et au suivi des guerres de l'administration (72 h au plus).
  await c.query("DELETE FROM reports WHERE player_id = $1 AND created_at < $2", [npcId, new Date(now.getTime() - 3 * DAY_MS)]);
  return angry;
}

/**
 * Fait réfléchir tous les PNJ dont l'heure est venue. Chaque étape (alertes, guerres, puis chaque PNJ) passe par `lock` :
 * en production, le verrou du jeu est pris étape par étape pour que les joueurs n'attendent pas la fin de toute la passe,
 * et `clock` donne l'heure réelle de chaque étape. Sans ces options (tests), tout se fait à l'instant `now`.
 */
export async function processNpcs(now: Date, limit = 25, opts: { lock?: Locker; clock?: () => Date } = {}): Promise<number> {
  const lock = opts.lock ?? unlocked;
  const at = () => opts.clock?.() ?? now;
  await lock(() => alertTribes(at()));
  await lock(() => alertAttackedNpcs(at()));
  await lock(() => refreshWars(at()));
  await lock(() => refreshTribeWars(at()));
  await lock(() => tx((c) => ensureDailyNpc(c, at())));
  await lock(async () => {
    const outbox = new Outbox();
    await tx((c) => expireOffers(c, outbox, at()));
    outbox.flush();
  });
  const due = (
    await pool.query('SELECT id FROM players WHERE is_npc AND npc_next_action_at <= $1 ORDER BY npc_next_action_at LIMIT $2', [now, limit])
  ).rows;
  for (const { id } of due) {
    await lock(async () => {
      const t = at();
      // Entre deux PNJ, des joueurs ont pu agir : les mouvements arrivés entre-temps sont traités avant la réflexion.
      if (opts.clock) await processDueEvents(t);
      const outbox = new Outbox();
      let angry = false;
      try {
        angry = await tx((c) => npcThink(c, outbox, id, t));
        outbox.flush();
      } catch (err) {
        console.error(`PNJ ${id} : réflexion échouée`, err);
      }
      await pool.query('UPDATE players SET npc_next_action_at = $2 WHERE id = $1', [id, new Date(t.getTime() + (angry ? Math.max(30_000, delayMs() / 4) : delayMs()))]);
    });
  }
  return due.length;
}
