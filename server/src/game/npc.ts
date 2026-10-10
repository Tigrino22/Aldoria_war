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
  NOBLES_PER_CONQUEST,
  NPC_PROFILES,
  NPC_TRIBE_NAMES,
  SOLO_PROFILES,
  chooseBuilding,
  isQuiet,
  nextRecruit,
  npcCap,
  pickWinningUnits,
  tribeMemberProfiles,
  tribeRelations,
  type NpcProfile,
} from './npc-rules';
import { alertAttackedNpcs, alertTribes, defendStep, grudgesOf, npcTribeOf, opWindowMs, saveTribeState, type TribeInfo } from './npc-tribes';
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
/** Un PNJ qui se venge peut frapper plus souvent : 4 attaques par jour sur des joueurs, 3 sur le même. */
const MAX_REVENGE_RAIDS_PER_NPC_PER_DAY = 4;
const MAX_REVENGE_RAIDS_PER_TARGET_PER_DAY = 3;
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
  const have = (await c.query('SELECT count(*)::int AS n FROM players WHERE is_npc AND tribe_id IS NULL')).rows[0].n as number;
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
  return createNpc(c, now);
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
  for (let i = existing.length; i < wanted; i++) {
    const pick = NPC_TRIBE_NAMES[i % NPC_TRIBE_NAMES.length];
    const lap = Math.floor(i / NPC_TRIBE_NAMES.length);
    const name = lap ? `${pick.name} ${lap + 1}` : pick.name;
    const tag = lap ? `${pick.tag}${lap + 1}` : pick.tag;
    const taken = await c.query('SELECT 1 FROM tribes WHERE lower(name) = lower($1) OR lower(tag) = lower($2)', [name, tag]);
    if (taken.rows.length) continue;
    const { rows } = await c.query('INSERT INTO tribes (name, tag, is_npc, description) VALUES ($1, $2, true, $3) RETURNING id', [
      name,
      tag,
      'Tribu de personnages non joueurs : ils bâtissent, pillent et se défendent entre eux. Seuls leurs membres peuvent la rejoindre.',
    ]);
    ids.push(rows[0].id);
  }
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
  const relations = tribeRelations(ids);
  for (const id of ids) {
    const rel = relations.get(id)!;
    await c.query(
      "UPDATE tribes SET npc_state = npc_state || jsonb_build_object('allies', $2::jsonb, 'rivals', $3::jsonb) WHERE id = $1",
      [id, JSON.stringify(rel.allies), JSON.stringify(rel.rivals)],
    );
  }
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
  /** Village d'un PNJ d'une tribu rivale : cible permise à toute heure. */
  rival: boolean;
  dist: number;
}

async function candidates(
  c: Db,
  npcId: number,
  from: { id: number; x: number; y: number },
  now: Date,
  rivals: number[],
): Promise<Candidate[]> {
  const { rows } = await c.query(
    `SELECT v.id, v.x, v.y, v.owner_id, (p.is_npc IS TRUE) AS rival FROM villages v LEFT JOIN players p ON p.id = v.owner_id
     WHERE v.id <> $1 AND (v.x - $2)^2 + (v.y - $3)^2 <= $5
       AND (v.owner_id IS NULL
            OR (NOT p.is_npc AND (p.protection_until IS NULL OR p.protection_until <= $4))
            OR (p.is_npc AND p.tribe_id = ANY($7::int[])))
       AND NOT EXISTS (SELECT 1 FROM commands cm WHERE cm.target_village_id = v.id AND cm.player_id = $6 AND NOT cm.processed)`,
    [from.id, from.x, from.y, now, RAID_RADIUS * RAID_RADIUS, npcId, rivals],
  );
  return rows.map((r) => ({ id: r.id, x: r.x, y: r.y, ownerId: r.owner_id, rival: r.rival, dist: Math.hypot(r.x - from.x, r.y - from.y) }));
}

/**
 * Un PNJ de type pillard ou conquérant vise aussi les joueurs, mais jamais pendant les heures calmes ni au-delà de ses plafonds.
 * Dans une tribu, seul le chef lance une opération contre un joueur ; les autres s'y joignent si leur troupe peut arriver dans la fenêtre.
 */
async function attackStep(c: Db, outbox: Outbox, npcId: number, profile: NpcProfile, villageId: number, tribe: TribeInfo | null, now: Date) {
  const village = await loadVillage(c, villageId);
  const home = await getTroops(c, villageId, villageId);
  const attackers: UnitCounts = { ...emptyUnits(), swordsman: home.swordsman, cavalry: home.cavalry, ram: home.ram };
  if (attackers.swordsman + attackers.cavalry < 5) return;
  const last = (
    await c.query(
      `SELECT max(sent_at) AS at FROM commands
       WHERE player_id = $1 AND type = 'attack' AND coalesce((units->>'swordsman')::int, 0) + coalesce((units->>'cavalry')::int, 0) > 0`,
      [npcId],
    )
  ).rows[0].at;
  const grudges = await grudgesOf(c, npcId, tribe, now);
  const onCooldown = !!last && now.getTime() - new Date(last).getTime() < (RAID_COOLDOWN_GAME_HOURS * 3_600_000) / env.worldSpeed;
  // La riposte ne respecte pas le délai entre deux attaques : un PNJ attaqué se venge sans attendre.
  if (onCooldown && grudges.length === 0) return;

  const quiet = isQuietAt(now);
  const arrivalOf = (units: UnitCounts, to: { x: number; y: number }) => new Date(now.getTime() + travelTime(units, village, to, env.worldSpeed) * 1000);
  /** Tout PNJ qui a des nobles les emmène, même contre le dernier village d'un joueur, mais pas plus d'une tentative par jour sur un même joueur. */
  const withNobles = async (units: UnitCounts, owner: number | null, rival: boolean): Promise<UnitCounts> => {
    if (home.noble < NOBLES_PER_CONQUEST) return units;
    if (owner !== null && !rival) {
      const recent = (
        await c.query(
          `SELECT 1 FROM commands cm JOIN villages t ON t.id = cm.target_village_id
           WHERE t.owner_id = $1 AND cm.type = 'attack' AND cm.sent_at > $2 AND coalesce((cm.units->>'noble')::int, 0) > 0 LIMIT 1`,
          [owner, new Date(now.getTime() - DAY_MS)],
        )
      ).rows;
      if (recent.length) return units;
    }
    return { ...units, noble: NOBLES_PER_CONQUEST };
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

  const all = await candidates(c, npcId, village, now, tribe?.state.rivals ?? []);
  const barbarians = all.filter((t) => t.ownerId === null);
  const rivalVillages = all.filter((t) => t.rival);
  // Tous les PNJ peuvent s'en prendre aux joueurs sans provocation (dans une tribu, le chef ou le conquérant) : leur type ne règle que leur évolution.
  // Celui qui a été attaqué riposte en plus, sans attendre.
  const isLeader = !tribe || tribe.leaderId === npcId || profile === 'conqueror';
  const opCooldownOk = !tribe || !tribe.state.lastOpAt || now.getTime() - Date.parse(tribe.state.lastOpAt) >= (12 * 3_600_000) / env.worldSpeed;
  const humans = all.filter((t) => t.ownerId !== null && !t.rival);
  const revenge = quiet ? [] : humans.filter((t) => grudges.includes(t.ownerId!));
  const aggressive = !quiet && isLeader && opCooldownOk && !onCooldown ? humans : [];
  let players = [...new Set([...revenge, ...aggressive])];
  const playerRaids = players.length ? await raidsOnPlayersByNpc(c, npcId, now) : 0;
  if (playerRaids >= (revenge.length ? MAX_REVENGE_RAIDS_PER_NPC_PER_DAY : MAX_PLAYER_RAIDS_PER_NPC_PER_DAY)) players = [];
  // Les PNJ en guerre préfèrent frapper les villages rivaux plutôt que les barbares.
  const prey = onCooldown ? [] : rivalVillages.length && rng() < 0.6 ? rivalVillages : barbarians;
  const revengePool = players.filter((t) => revenge.includes(t));
  const pool = revengePool.length ? revengePool : players.length && (prey.length === 0 || rng() < 0.4) ? players : prey;
  if (pool.length === 0) return;
  const target = pool.map((t) => ({ t, score: t.dist + rng() * 6 })).sort((a, b) => a.score - b.score)[0].t;

  const hostileToPlayer = target.ownerId !== null && !target.rival;
  const avenging = hostileToPlayer && grudges.includes(target.ownerId!);
  if (hostileToPlayer && (await raidsOnOwner(c, target.ownerId!, now)) >= (avenging ? MAX_REVENGE_RAIDS_PER_TARGET_PER_DAY : MAX_RAIDS_PER_TARGET_PER_DAY)) return;
  // L'arrivée d'une attaque ou d'un espion chez un joueur ne doit jamais tomber pendant les heures calmes.
  const arrivesQuiet = (units: UnitCounts) => hostileToPlayer && isQuietAt(arrivalOf(units, target));

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
    const picked = pickWinningUnits(attackers, intel.troops, intel.wall);
    if (!picked) return;
    const units = await withNobles(picked, target.ownerId, target.rival);
    if (arrivesQuiet(units)) return;
    await sendCommand(c, outbox, npcId, villageId, { type: 'attack', targetId: target.id, units }, now);
    // Le chef d'une tribu qui frappe un joueur ouvre une opération : les autres membres ont une fenêtre pour le rejoindre.
    if (tribe && hostileToPlayer && !(tribe.state.op && Date.parse(tribe.state.op.landBy) > now.getTime())) {
      const landAt = arrivalOf(units, target);
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
  const tribe = await npcTribeOf(c, npcId);
  for (const v of villages.slice(0, 3)) {
    await economyStep(c, npcId, profile, v.id, cap, now);
    if (tribe) await defendStep(c, outbox, npcId, v.id, tribe, now);
    await attackStep(c, outbox, npcId, profile, v.id, tribe, now);
  }
  // Les rapports d'un PNJ ne servent qu'à ses décisions récentes.
  await c.query("DELETE FROM reports WHERE player_id = $1 AND created_at < $2", [npcId, new Date(now.getTime() - 2 * DAY_MS)]);
}

/** Fait réfléchir tous les PNJ dont l'heure est venue. À appeler sous le verrou du jeu. */
export async function processNpcs(now: Date, limit = 25): Promise<number> {
  await alertTribes(now);
  await alertAttackedNpcs(now);
  await tx((c) => ensureDailyNpc(c, now));
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

