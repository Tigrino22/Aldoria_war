import {
  STARTING_BUILDINGS,
  STARTING_RESOURCES,
  type BuildingKey,
  type Buildings,
  type ScoutReportData,
  type UnitCounts,
  emptyUnits,
  normalizeUnits,
  travelTime,
} from '@aldoria/shared';
import { pool, tx, type Db } from '../db';
import { env } from '../env';
import { GameError } from '../errors';
import { Outbox } from '../notify';
import { sendCommand } from './commands';
import { pickNpcName } from './npc-names';
import {
  NPC_PROFILES,
  chooseBuilding,
  isQuiet,
  nextRecruit,
  npcCap,
  pickWinningUnits,
  type NpcProfile,
} from './npc-rules';
import { createVillage, enqueueBuild, enqueueRecruit, getTroops, loadVillage, syncVillage } from './village';

let rng: () => number = Math.random;
/** Permet aux tests de rendre les décisions des PNJ déterministes. */
export const setNpcRandom = (fn: () => number) => (rng = fn);

/** Un PNJ agit toutes les 10 à 20 minutes, plus souvent quand le monde va vite. */
const delayMs = () => Math.max(30_000, ((10 + rng() * 10) * 60_000) / Math.sqrt(env.worldSpeed));
/** Délai avant qu'un PNJ qui a perdu tous ses villages ne reparte ailleurs. */
const respawnMs = () => (2 * 3_600_000) / Math.sqrt(env.worldSpeed);
/** Rayon (en cases) dans lequel un PNJ cherche des cibles. */
const RAID_RADIUS = 20;
/** Au plus 2 attaques par PNJ et par jour sur des joueurs, et 1 attaque par jour (tous PNJ confondus) sur un même joueur. */
const MAX_PLAYER_RAIDS_PER_NPC_PER_DAY = 2;
const MAX_RAIDS_PER_TARGET_PER_DAY = 1;
const DAY_MS = 86_400_000;
/** Délai minimal (en heures de jeu) entre deux attaques armées d'un même PNJ, pour qu'il ne vide pas les barbares à lui seul. */
const RAID_COOLDOWN_GAME_HOURS = 6;
/** Délai minimal (en heures de jeu) entre deux missions d'espionnage d'un même PNJ. */
const SCOUT_COOLDOWN_GAME_HOURS = 4;

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
export async function createNpc(c: Db, now: Date, profile?: NpcProfile): Promise<number> {
  const { first, username } = await uniqueNpcName(c);
  const chosen = profile ?? NPC_PROFILES[Math.floor(rng() * NPC_PROFILES.length)];
  const { rows } = await c.query(
    `INSERT INTO players (username, password_hash, is_npc, npc_profile, npc_next_action_at)
     VALUES ($1, '!', true, $2, $3) RETURNING id`,
    [username, chosen, new Date(now.getTime() + rng() * 10 * 60_000)],
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

/** Complète la population de PNJ jusqu'à `NPC_COUNT` (sans jamais en retirer). */
export async function ensureNpcs(c: Db, now: Date) {
  await renameLegacyNpcs(c);
  const have = (await c.query('SELECT count(*)::int AS n FROM players WHERE is_npc')).rows[0].n as number;
  for (let i = have; i < env.npcCount; i++) await createNpc(c, now);
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
  return { troops: normalizeUnits(data.intel.troops), wall: data.intel.buildings.wall ?? 0 };
}

async function raidsOnPlayersByNpc(c: Db, npcId: number, now: Date): Promise<number> {
  const { rows } = await c.query(
    `SELECT count(*)::int AS n FROM commands cm JOIN villages t ON t.id = cm.target_village_id
     WHERE cm.player_id = $1 AND cm.type = 'attack' AND cm.sent_at > $2 AND t.owner_id IS NOT NULL
       AND coalesce((cm.units->>'swordsman')::int, 0) + coalesce((cm.units->>'cavalry')::int, 0) > 0`,
    [npcId, new Date(now.getTime() - DAY_MS)],
  );
  return rows[0].n;
}

async function raidsOnOwner(c: Db, ownerId: number, now: Date): Promise<number> {
  const { rows } = await c.query(
    `SELECT count(*)::int AS n FROM commands cm
     JOIN villages t ON t.id = cm.target_village_id JOIN players a ON a.id = cm.player_id
     WHERE t.owner_id = $1 AND a.is_npc AND cm.type = 'attack' AND cm.sent_at > $2
       AND coalesce((cm.units->>'swordsman')::int, 0) + coalesce((cm.units->>'cavalry')::int, 0) > 0`,
    [ownerId, new Date(now.getTime() - DAY_MS)],
  );
  return rows[0].n;
}

interface Candidate {
  id: number;
  x: number;
  y: number;
  ownerId: number | null;
  dist: number;
}

async function candidates(c: Db, npcId: number, from: { id: number; x: number; y: number }, now: Date): Promise<Candidate[]> {
  const { rows } = await c.query(
    `SELECT v.id, v.x, v.y, v.owner_id FROM villages v LEFT JOIN players p ON p.id = v.owner_id
     WHERE v.id <> $1 AND (v.x - $2)^2 + (v.y - $3)^2 <= $5
       AND (v.owner_id IS NULL OR (NOT p.is_npc AND (p.protection_until IS NULL OR p.protection_until <= $4)))
       AND NOT EXISTS (SELECT 1 FROM commands cm WHERE cm.target_village_id = v.id AND cm.player_id = $6 AND NOT cm.processed)`,
    [from.id, from.x, from.y, now, RAID_RADIUS * RAID_RADIUS, npcId],
  );
  return rows.map((r) => ({ id: r.id, x: r.x, y: r.y, ownerId: r.owner_id, dist: Math.hypot(r.x - from.x, r.y - from.y) }));
}

/** Un PNJ de type pillard vise aussi les joueurs, mais jamais pendant les heures calmes ni au-delà de ses plafonds. */
async function attackStep(c: Db, outbox: Outbox, npcId: number, profile: NpcProfile, villageId: number, now: Date) {
  const village = await loadVillage(c, villageId);
  const home = await getTroops(c, villageId, villageId);
  const attackers: UnitCounts = { ...emptyUnits(), swordsman: home.swordsman, cavalry: home.cavalry };
  if (attackers.swordsman + attackers.cavalry < 5) return;
  const last = (
    await c.query(
      `SELECT max(sent_at) AS at FROM commands
       WHERE player_id = $1 AND type = 'attack' AND coalesce((units->>'swordsman')::int, 0) + coalesce((units->>'cavalry')::int, 0) > 0`,
      [npcId],
    )
  ).rows[0].at;
  if (last && now.getTime() - new Date(last).getTime() < (RAID_COOLDOWN_GAME_HOURS * 3_600_000) / env.worldSpeed) return;

  const quiet = isQuietAt(now);
  const all = await candidates(c, npcId, village, now);
  const barbarians = all.filter((t) => t.ownerId === null);
  let players = profile === 'raider' && !quiet ? all.filter((t) => t.ownerId !== null) : [];
  if (players.length && (await raidsOnPlayersByNpc(c, npcId, now)) >= MAX_PLAYER_RAIDS_PER_NPC_PER_DAY) players = [];
  const pool = players.length && (barbarians.length === 0 || rng() < 0.4) ? players : barbarians;
  if (pool.length === 0) return;
  const target = pool.map((t) => ({ t, score: t.dist + rng() * 6 })).sort((a, b) => a.score - b.score)[0].t;

  const hostileToPlayer = target.ownerId !== null;
  if (hostileToPlayer && (await raidsOnOwner(c, target.ownerId!, now)) >= MAX_RAIDS_PER_TARGET_PER_DAY) return;
  // L'arrivée d'une attaque ou d'un espion chez un joueur ne doit jamais tomber pendant les heures calmes.
  const arrivesQuiet = (units: UnitCounts) => hostileToPlayer && isQuietAt(new Date(now.getTime() + travelTime(units, village, target, env.worldSpeed) * 1000));

  const intel = await freshScoutIntel(c, npcId, target.id, now);
  try {
    if (!intel) {
      if (home.scout < 1) return;
      const lastScout = (
        await c.query("SELECT max(sent_at) AS at FROM commands WHERE player_id = $1 AND type = 'attack' AND coalesce((units->>'scout')::int, 0) > 0", [npcId])
      ).rows[0].at;
      if (lastScout && now.getTime() - new Date(lastScout).getTime() < (SCOUT_COOLDOWN_GAME_HOURS * 3_600_000) / env.worldSpeed) return;
      const scouts = { ...emptyUnits(), scout: Math.min(2, home.scout) };
      if (arrivesQuiet(scouts)) return;
      await sendCommand(c, outbox, npcId, villageId, { type: 'attack', targetId: target.id, units: scouts }, now);
      return;
    }
    const units = pickWinningUnits(attackers, intel.troops, intel.wall);
    if (!units || arrivesQuiet(units)) return;
    await sendCommand(c, outbox, npcId, villageId, { type: 'attack', targetId: target.id, units }, now);
  } catch (err) {
    if (!(err instanceof GameError)) throw err;
  }
}

async function economyStep(c: Db, npcId: number, profile: NpcProfile, villageId: number, cap: number, now: Date) {
  const v = await syncVillage(c, villageId, now);
  const queued = (await c.query('SELECT building, level FROM build_queue WHERE village_id = $1', [villageId])).rows;
  const levels: Buildings = { ...v.buildings };
  for (const q of queued) levels[q.building as BuildingKey] = Math.max(levels[q.building as BuildingKey], q.level);
  const next = chooseBuilding(profile, levels, cap);
  if (next) {
    try {
      await enqueueBuild(c, villageId, next, now);
    } catch (err) {
      if (!(err instanceof GameError)) throw err;
    }
  }

  const inQueue = (await c.query('SELECT count(*)::int AS n FROM recruit_queue WHERE village_id = $1', [villageId])).rows[0].n;
  if (inQueue > 0 || v.buildings.barracks < 1) return;
  const owned = await getTroops(c, villageId, villageId);
  const away = (await c.query("SELECT units FROM commands WHERE home_village_id = $1 AND NOT processed AND type IN ('attack', 'support', 'return')", [villageId])).rows;
  for (const r of away) {
    const u = normalizeUnits(r.units);
    for (const k of Object.keys(owned) as (keyof UnitCounts)[]) owned[k] += u[k];
  }
  for (const choice of nextRecruit(profile, v.buildings, owned, cap, env.npcDifficulty).slice(0, 3)) {
    try {
      await enqueueRecruit(c, villageId, choice.unit, choice.count, now);
      return;
    } catch (err) {
      if (!(err instanceof GameError)) throw err;
    }
  }
}

/** Une séance de réflexion : respawn si besoin, construction, recrutement, puis éventuellement une attaque. */
export async function npcThink(c: Db, outbox: Outbox, npcId: number, now: Date) {
  const npc = (await c.query('SELECT id, username, npc_profile, npc_state FROM players WHERE id = $1 AND is_npc FOR UPDATE', [npcId])).rows[0];
  if (!npc) return;
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
    return;
  }

  const cap = npcCap(await worldDays(c, now), env.npcDifficulty);
  for (const v of villages.slice(0, 3)) {
    await economyStep(c, npcId, profile, v.id, cap, now);
    await attackStep(c, outbox, npcId, profile, v.id, now);
  }
  // Les rapports d'un PNJ ne servent qu'à ses décisions récentes.
  await c.query("DELETE FROM reports WHERE player_id = $1 AND created_at < $2", [npcId, new Date(now.getTime() - 2 * DAY_MS)]);
}

/** Fait réfléchir tous les PNJ dont l'heure est venue. À appeler sous le verrou du jeu. */
export async function processNpcs(now: Date, limit = 25): Promise<number> {
  const due = (
    await pool.query('SELECT id FROM players WHERE is_npc AND npc_next_action_at <= $1 ORDER BY npc_next_action_at LIMIT $2', [now, limit])
  ).rows;
  for (const { id } of due) {
    const outbox = new Outbox();
    try {
      await tx((c) => npcThink(c, outbox, id, now));
      outbox.flush();
    } catch (err) {
      console.error(`PNJ ${id} : réflexion échouée`, err);
    }
    await pool.query('UPDATE players SET npc_next_action_at = $2 WHERE id = $1', [id, new Date(now.getTime() + delayMs())]);
  }
  return due.length;
}

