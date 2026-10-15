import {
  HOLY_GARRISON,
  HOLY_WALL,
  PROVINCE_BONUSES,
  PROVINCE_BONUS_LABEL,
  STARTING_BUILDINGS,
  bastionGarrison,
  controlAt,
  emptyUnits,
  generateSeeds,
  normalizeUnits,
  populationOf,
  provinceGrid,
  provinceNeighbours,
  provinceTiers,
  resolveCombat,
  subtractUnits,
  totalUnits,
  travelTime,
  wallAfterRams,
  wallDuringCombat,
  type AttackReportData,
  type Buildings,
  type ProvinceBonus,
  type ProvinceSeed,
  type ProvinceTier,
  type TierRules,
  type ProvinceView,
  type ProvincesState,
  type UnitCounts,
  type WorldVictoryView,
} from '@aldoria/shared';
import { type Db } from '../db';
import { env } from '../env';
import { GameError } from '../errors';
import type { Outbox } from '../notify';
import { addKills, insertCommand } from './commands';
import { grantTitle } from './crusades';
import { grantItem } from './items';
import { createReport } from './reports';
import { areAllied } from './tribe-alliances';
import { addTroops, createVillage, loadVillage, saveVillage, setTroops, type VillageRow } from './village';
import { findFreeSpot } from './world';

/**
 * Provinces (voir shared/src/provinces.ts pour les règles pures).
 * Chaque bastion est un village sans propriétaire de genre `bastion` : l'espionnage, les ordres planifiés et les renforts
 * fonctionnent comme ailleurs. Ce module ajoute la bannière, la tenue, le contrôle, les bonus, l'accès à la Terre sainte et la victoire.
 */

const NAMES = [
  'Marche de Valbrune',
  'Comté d’Aubefer',
  'Val des Saules',
  'Duché de Pierregarde',
  'Baronnie de Montcler',
  'Terres de Cendrelune',
  'Marche du Givre',
  'Comté de Rochenoire',
  'Plaines d’Orvanne',
  'Vicomté de Brumeval',
  'Haut-Pays de Kermor',
  'Comté des Trois Gués',
  'Marais de Fenwald',
  'Duché d’Argencourt',
  'Collines de Saint-Aubin',
  'Baronnie de Hautefort',
  'Val de Ronceval',
  'Marche de Corbières',
  'Forêt de Dunmoor',
  'Comté de Lisaire',
  'Côtes de Mervent',
  'Plateau de Vérone',
  'Baronnie d’Escalle',
  'Landes de Grisaille',
  'Duché de Belcastel',
  'Vallée de l’Ombre',
  'Comté de Thalor',
  'Marche d’Ysengrin',
  'Combe de Valfroide',
  'Terres de Sombrebois',
];
const HOLY_NAME = 'Terre sainte';

/** « Marche de Valbrune » → « Bastion de Valbrune », « Comté d’Aubefer » → « Bastion d’Aubefer ». */
export function bastionName(province: string): string {
  const m = province.match(/^\S+(?: \S+)?? (de l’|de la |des |du |de |d’)(.+)$/u);
  if (!m) return `Bastion de ${province}`;
  return `Bastion ${m[1]}${m[2]}`;
}
const SANCTUARY_NAME = 'Sanctuaire';

export interface ProvinceRow {
  id: number;
  name: string;
  kind: 'province' | 'holy';
  x: number;
  y: number;
  weight: number;
  bonus: ProvinceBonus | null;
  tier: ProvinceTier | 0 | null;
  bastion_village_id: number | null;
  holder_tribe_id: number | null;
  holder_since: Date | null;
  control_notified: boolean;
}

/** Garde, muraille et bonus d'un niveau, d'après les réglages du monde. */
export function tierRules(tier: ProvinceTier): TierRules {
  return { tier, garrison: env[`provinceGarrison${tier}`], wall: env[`provinceWall${tier}`], bonus: env[`provinceBonus${tier}`], treasure: env[`provinceTreasure${tier}`] };
}

/** Bonus (%) d'une province selon son niveau ; la Terre sainte n'en donne pas. */
const tierBonus = (tier: ProvinceTier | 0 | null) => (tier ? tierRules(tier).bonus : 0);

/** Les provinces contrôlées : bannière plantée depuis au moins la durée de tenue. */
const controlled = (p: { holder_tribe_id: number | null; holder_since: Date | null }, at: Date) =>
  p.holder_tribe_id !== null && p.holder_since !== null && controlAt(p.holder_since, env.provinceHoldHours).getTime() <= at.getTime();

// ---------- Création ----------

/** Au premier démarrage avec les provinces, découpe la carte et dresse les bastions (sans déplacer de village). */
export async function ensureProvinces(c: Db, now: Date, rng: () => number = Math.random) {
  if (!env.provinces) return;
  if (!(await c.query('SELECT 1 FROM provinces LIMIT 1')).rows.length) await createProvinces(c, now, rng);
  await ensureProvinceTiers(c, rng);
}

async function createProvinces(c: Db, now: Date, rng: () => number) {
  const seeds = generateSeeds(env.mapSize, rng);
  const names = [...NAMES].sort(() => rng() - 0.5);
  // Bonus répartis à parts égales, dans un ordre au hasard.
  const bonuses: ProvinceBonus[] = [];
  while (bonuses.length < seeds.length) bonuses.push(...[...PROVINCE_BONUSES].sort(() => rng() - 0.5));
  for (const [i, s] of seeds.entries()) {
    const holy = s.kind === 'holy';
    const name = holy ? HOLY_NAME : (names[(i - 1) % names.length] ?? `Province ${i}`);
    const spot = await findFreeSpot(c, s.x, s.y, 1);
    const buildings: Buildings = { ...STARTING_BUILDINGS };
    for (const k of Object.keys(buildings) as (keyof Buildings)[]) buildings[k] = 0;
    buildings.wall = holy ? HOLY_WALL : env.provinceWall1;
    const villageId = await createVillage(c, {
      ownerId: null,
      name: holy ? SANCTUARY_NAME : bastionName(name),
      x: spot.x,
      y: spot.y,
      buildings,
      resources: { wood: 0, clay: 0, iron: 0, wheat: 0 },
      at: now,
      troops: bastionGarrison(holy ? HOLY_GARRISON : env.provinceGarrison1),
    });
    await c.query("UPDATE villages SET kind = 'bastion' WHERE id = $1", [villageId]);
    await c.query('INSERT INTO provinces (name, kind, x, y, weight, bonus, bastion_village_id) VALUES ($1, $2, $3, $4, $5, $6, $7)', [
      name,
      s.kind,
      spot.x,
      spot.y,
      s.weight,
      holy ? null : bonuses[i - 1],
      villageId,
    ]);
  }
}

/**
 * Niveaux des provinces, une seule fois par monde (au démarrage qui suit leur création ou l'arrivée des niveaux) : chaque province
 * reçoit son niveau d'après sa distance à la Terre sainte ; les bastions sans bannière reçoivent la garde et la muraille de leur
 * niveau, et leurs bonus sont redistribués pour que chaque niveau ait de tout (production, recrutement, vitesse). Les provinces
 * déjà tenues gardent leur bonus.
 */
export async function ensureProvinceTiers(c: Db, rng: () => number = Math.random) {
  if (!(await c.query('SELECT 1 FROM provinces WHERE tier IS NULL LIMIT 1')).rows.length) return;
  const rows = (await c.query('SELECT * FROM provinces ORDER BY id FOR UPDATE')).rows as ProvinceRow[];
  const grid = provinceGrid(env.mapSize, rows);
  const tiers = provinceTiers(rows, provinceNeighbours(grid, env.mapSize, rows.length), rows.findIndex((r) => r.kind === 'holy'));
  for (const [i, p] of rows.entries()) p.tier = p.kind === 'holy' ? 0 : tiers[i] || 1;
  for (const tier of [1, 2, 3] as const) {
    const free = rows.filter((p) => p.tier === tier && p.holder_tribe_id === null).sort(() => rng() - 0.5);
    const deck: ProvinceBonus[] = [];
    while (deck.length < free.length) deck.push(...[...PROVINCE_BONUSES].sort(() => rng() - 0.5));
    free.forEach((p, k) => (p.bonus = deck[k]));
  }
  for (const p of rows) await c.query('UPDATE provinces SET tier = $2, bonus = $3 WHERE id = $1', [p.id, p.tier, p.kind === 'holy' ? null : p.bonus]);
  await refreshNeutralBastions(c);
}

/**
 * Remet la garde neutre et la muraille des bastions sans bannière aux valeurs de leur niveau (au premier calcul des niveaux et
 * quand l'administrateur change ces réglages). Les troupes d'autres joueurs encore sur place ne sont pas touchées.
 */
export async function refreshNeutralBastions(c: Db) {
  const { rows } = await c.query("SELECT tier, bastion_village_id FROM provinces WHERE kind = 'province' AND holder_tribe_id IS NULL AND bastion_village_id IS NOT NULL AND tier > 0");
  for (const r of rows) {
    const rules = tierRules(r.tier);
    await setTroops(c, r.bastion_village_id, r.bastion_village_id, bastionGarrison(rules.garrison));
    await c.query(`UPDATE villages SET buildings = jsonb_set(buildings, '{wall}', to_jsonb($2::int)) WHERE id = $1`, [r.bastion_village_id, rules.wall]);
  }
}

// ---------- Géographie ----------

let geoCache: { key: string; ids: number[]; neighbours: Map<number, number[]> } | null = null;

/** Voisines de chaque province, calculées une fois à partir des points (la carte ne change pas en cours de partie). */
async function geography(c: Db): Promise<{ ids: number[]; neighbours: Map<number, number[]> }> {
  const rows = (await c.query('SELECT id, x, y, weight FROM provinces ORDER BY id')).rows as ProvinceSeed[];
  const key = `${env.mapSize}:${rows.map((r) => `${r.id},${r.x},${r.y},${r.weight}`).join(';')}`;
  if (geoCache?.key === key) return geoCache;
  const grid = provinceGrid(env.mapSize, rows);
  const sets = provinceNeighbours(grid, env.mapSize, rows.length);
  const neighbours = new Map(rows.map((r, i) => [r.id, [...sets[i]].map((j) => rows[j].id).sort((a, b) => a - b)]));
  geoCache = { key, ids: rows.map((r) => r.id), neighbours };
  return geoCache;
}

async function provinceOfBastion(c: Db, villageId: number, forUpdate = false): Promise<ProvinceRow | null> {
  const { rows } = await c.query(`SELECT * FROM provinces WHERE bastion_village_id = $1 ${forUpdate ? 'FOR UPDATE' : ''}`, [villageId]);
  return rows[0] ?? null;
}

const tribeOf = async (c: Db, playerId: number | null): Promise<number | null> =>
  playerId ? ((await c.query('SELECT tribe_id FROM players WHERE id = $1', [playerId])).rows[0]?.tribe_id ?? null) : null;

/** La tribu tient-elle la bannière du bastion (elle-même ou une alliée) ? */
async function holdsBanner(c: Db, p: ProvinceRow, tribeId: number | null): Promise<boolean> {
  if (!p.holder_tribe_id || !tribeId) return false;
  return p.holder_tribe_id === tribeId || (await areAllied(c, p.holder_tribe_id, tribeId));
}

/** Provinces contrôlées par la tribu qui bordent la Terre sainte. */
export async function holyNeighboursHeld(c: Db, tribeId: number | null, at: Date): Promise<number> {
  if (!tribeId) return 0;
  const holy = (await c.query("SELECT id FROM provinces WHERE kind = 'holy' LIMIT 1")).rows[0];
  if (!holy) return 0;
  const around = (await geography(c)).neighbours.get(holy.id) ?? [];
  if (!around.length) return 0;
  const { rows } = await c.query('SELECT holder_tribe_id, holder_since FROM provinces WHERE id = ANY($1::int[]) AND holder_tribe_id = $2', [around, tribeId]);
  return rows.filter((r) => controlled(r, at)).length;
}

const holyAccessError = (have: number) =>
  `Le Sanctuaire n'est accessible qu'aux tribus qui contrôlent ${env.holyAccess} province${env.holyAccess > 1 ? 's' : ''} bordant la Terre sainte (la vôtre : ${have})`;

/**
 * Refuse un mouvement vers un bastion quand les règles des provinces l'interdisent : renfort réservé à la tribu qui tient la
 * bannière et à ses alliées, attaque du Sanctuaire réservée aux tribus qui contrôlent assez de provinces voisines. Les éclaireurs
 * seuls y vont toujours. Sans effet sur un village ordinaire.
 */
export async function assertBastionMove(c: Db, move: { type: 'attack' | 'support'; playerId: number; target: VillageRow; units: UnitCounts; arriveAt: Date }) {
  if (move.target.kind !== 'bastion') return;
  if (!env.provinces) throw new GameError('Les provinces sont désactivées sur ce monde');
  const p = await provinceOfBastion(c, move.target.id);
  if (!p) throw new GameError('Ce bastion n’appartient à aucune province');
  const scoutsOnly = move.units.scout > 0 && move.units.scout === totalUnits(move.units);
  if (scoutsOnly) return;
  const tribeId = await tribeOf(c, move.playerId);
  if (move.type === 'support') {
    if (!(await holdsBanner(c, p, tribeId))) throw new GameError('Seule la tribu qui tient la bannière (et ses alliées) peut renforcer ce bastion');
    return;
  }
  if (p.kind === 'holy' && !(await holdsBanner(c, p, tribeId))) {
    const have = await holyNeighboursHeld(c, tribeId, move.arriveAt);
    if (have < env.holyAccess) throw new GameError(holyAccessError(have));
  }
}

// ---------- Combats ----------

const label = (v: { name: string; x: number; y: number }) => `${v.name} (${v.x}|${v.y})`;

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

async function bounce(c: Db, outbox: Outbox, cmd: any, bastion: VillageRow, p: ProvinceRow | null, units: UnitCounts, reason: string) {
  const at = new Date(cmd.arrive_at);
  await sendHome(c, bastion, cmd.home_village_id, cmd.player_id, units, at);
  await createReport(c, outbox, cmd.player_id, 'province', `${bastion.name} : ${reason}, vos troupes rentrent`, { province: p?.name ?? null, bastion: label(bastion), units, text: reason }, at);
  outbox.push(cmd.player_id, { type: 'village', villageId: cmd.home_village_id });
}

async function tribeLabel(c: Db, tribeId: number | null): Promise<{ tag: string; name: string } | null> {
  if (!tribeId) return null;
  return (await c.query('SELECT tag, name FROM tribes WHERE id = $1', [tribeId])).rows[0] ?? null;
}

/** Prévient tous les membres d'une tribu. */
async function tellTribe(c: Db, outbox: Outbox, tribeId: number | null, title: string, data: unknown, at: Date) {
  if (!tribeId) return;
  const { rows } = await c.query('SELECT id FROM players WHERE tribe_id = $1', [tribeId]);
  for (const r of rows) await createReport(c, outbox, r.id, 'province', title, data, at);
}

/** Un renfort arrive au bastion : il ne s'installe que si son camp tient toujours la bannière. */
export async function handleBastionSupport(c: Db, outbox: Outbox, cmd: any, bastion: VillageRow) {
  const at = new Date(cmd.arrive_at);
  const units = normalizeUnits(cmd.units);
  const p = await provinceOfBastion(c, bastion.id, true);
  if (!p || !env.provinces) return bounce(c, outbox, cmd, bastion, p, units, 'le bastion est fermé');
  if (!(await holdsBanner(c, p, await tribeOf(c, cmd.player_id)))) return bounce(c, outbox, cmd, bastion, p, units, 'la bannière a changé de camp');
  await addTroops(c, bastion.id, cmd.home_village_id, units);
  await createReport(c, outbox, cmd.player_id, 'support', `Vos renforts tiennent ${label(bastion)}`, { units, target: label(bastion) }, at);
  outbox.push(cmd.player_id, { type: 'village', villageId: cmd.home_village_id });
}

/**
 * Une attaque arrive au bastion. Combat ordinaire contre tous ceux qui s'y trouvent (Garde neutre, ou la tribu qui tient la
 * bannière et ses alliés). Si l'attaque vide le bastion et qu'un noble survit, la tribu de l'attaquant plante sa bannière ;
 * sans noble (ou sans tribu), elle abat seulement celle qui flottait.
 */
export async function handleBastionAttack(c: Db, outbox: Outbox, cmd: any, bastion: VillageRow, origin: VillageRow) {
  const at = new Date(cmd.arrive_at);
  const attackers = normalizeUnits(cmd.units);
  const attackerId: number | null = cmd.player_id;
  const p = await provinceOfBastion(c, bastion.id, true);
  if (!p || !env.provinces) return bounce(c, outbox, cmd, bastion, p, attackers, 'le bastion est fermé');
  const tribeId = await tribeOf(c, attackerId);
  // Notre camp tient déjà la bannière : l'attaque devient un renfort.
  if (await holdsBanner(c, p, tribeId)) {
    await addTroops(c, bastion.id, origin.id, attackers);
    await createReport(c, outbox, attackerId, 'support', `Votre tribu tient ${label(bastion)} : vos troupes renforcent la garnison`, { units: attackers, target: label(bastion) }, at);
    outbox.push(attackerId, { type: 'village', villageId: origin.id });
    return;
  }
  // La Terre sainte : l'accès se vérifie aussi à l'arrivée (des provinces ont pu être perdues en chemin).
  if (p.kind === 'holy') {
    const have = await holyNeighboursHeld(c, tribeId, at);
    if (have < env.holyAccess) return bounce(c, outbox, cmd, bastion, p, attackers, `votre tribu ne contrôle plus que ${have} province${have > 1 ? 's' : ''} bordant la Terre sainte`);
  }

  const defenderRows = (await c.query('SELECT home_village_id, units FROM troops WHERE village_id = $1 FOR UPDATE', [bastion.id])).rows;
  const defenders = defenderRows.map((r) => normalizeUnits(r.units));
  const defendersBefore = defenders.reduce((sum, g) => {
    for (const k of Object.keys(g) as (keyof UnitCounts)[]) sum[k] += g[k];
    return sum;
  }, emptyUnits());
  const wallBefore = bastion.buildings.wall;
  const result = resolveCombat({ attackers, defenders, wallLevel: wallDuringCombat(wallBefore, attackers.ram) });
  const defenderLosses = emptyUnits();
  for (let i = 0; i < defenderRows.length; i++) {
    const loss = result.defenderLosses[i];
    for (const k of Object.keys(loss) as (keyof UnitCounts)[]) defenderLosses[k] += loss[k];
    await setTroops(c, bastion.id, defenderRows[i].home_village_id, subtractUnits(defenders[i], loss));
  }
  const survivors = subtractUnits(attackers, result.attackerLosses);

  // Classement de guerre : l'attaquant pour les défenseurs tués, chaque défenseur (hors Garde) pour sa part des attaquants tués.
  await addKills(c, attackerId, 'attack', populationOf(defenderLosses));
  const killedByDefense = populationOf(result.attackerLosses);
  const homeIds = [...new Set(defenderRows.map((r) => r.home_village_id as number).filter((id) => id !== bastion.id))];
  const owners = new Map<number, number>(
    homeIds.length ? (await c.query('SELECT id, owner_id FROM villages WHERE id = ANY($1) AND owner_id IS NOT NULL', [homeIds])).rows.map((r) => [r.id, r.owner_id]) : [],
  );
  const totalWeight = defenders.reduce((s, g) => s + populationOf(g), 0);
  const defenderPlayers = new Set<number>();
  for (const [i, r] of defenderRows.entries()) {
    const owner = owners.get(r.home_village_id);
    if (!owner) continue;
    defenderPlayers.add(owner);
    await addKills(c, owner, 'defense', totalWeight > 0 ? Math.floor((killedByDefense * populationOf(defenders[i])) / totalWeight) : 0);
  }

  let wallDamage: AttackReportData['wallDamage'] = null;
  if (result.attackerWins && survivors.ram > 0) {
    const after = wallAfterRams(wallBefore, survivors.ram);
    if (after < wallBefore) {
      bastion.buildings.wall = after;
      wallDamage = { before: wallBefore, after };
    }
  }

  const who = (await c.query('SELECT p.username, t.tag FROM players p LEFT JOIN tribes t ON t.id = p.tribe_id WHERE p.id = $1', [attackerId])).rows[0];
  const sideName = who?.tag ? `[${who.tag}] ${who.username}` : (who?.username ?? 'Un inconnu');
  const previous = await tribeLabel(c, p.holder_tribe_id);
  const previousId = p.holder_tribe_id;
  let outcome = result.attackerWins ? 'victoire' : 'défaite';
  if (result.attackerWins) {
    if (survivors.noble > 0 && tribeId) {
      // Le porte-étendard plante la bannière de sa tribu : les survivants restent sur place pour la tenir.
      await c.query('UPDATE provinces SET holder_tribe_id = $2, holder_since = $3, control_notified = false WHERE id = $1', [p.id, tribeId, at]);
      await addTroops(c, bastion.id, origin.id, survivors);
      outcome = 'bannière plantée !';
      const mine = await tribeLabel(c, tribeId);
      const until = controlAt(at, p.kind === 'holy' ? env.holyHoldDays * 24 : env.provinceHoldHours);
      await tellTribe(
        c,
        outbox,
        tribeId,
        `${sideName} plante la bannière de [${mine?.tag}] sur ${label(bastion)}`,
        {
          province: p.name,
          bastion: label(bastion),
          text:
            p.kind === 'holy'
              ? `Tenez la Terre sainte jusqu'au ${until.toLocaleString('fr-FR', { timeZone: env.npcTimezone })} pour gagner le monde.`
              : `Tenez le bastion jusqu'au ${until.toLocaleString('fr-FR', { timeZone: env.npcTimezone })} pour contrôler ${p.name}.`,
        },
        at,
      );
    } else {
      if (previousId) {
        await c.query('UPDATE provinces SET holder_tribe_id = NULL, holder_since = NULL, control_notified = false WHERE id = $1', [p.id]);
        outcome = 'bannière abattue';
      }
      await sendHome(c, bastion, origin.id, attackerId, survivors, at);
    }
    if (previousId && previousId !== tribeId) {
      await tellTribe(c, outbox, previousId, `${p.name} : votre bannière est tombée face à ${sideName}`, { province: p.name, bastion: label(bastion), text: `La tribu [${previous?.tag}] perd ${p.name} et son bonus.` }, at);
    }
  }
  await saveVillage(c, bastion);

  const base = {
    attackerWins: result.attackerWins,
    attacker: { playerName: who?.username ?? null, village: { id: origin.id, name: origin.name, x: origin.x, y: origin.y }, units: attackers, losses: result.attackerLosses },
    defender: { playerName: previous ? `[${previous.tag}]` : null, village: { id: bastion.id, name: bastion.name, x: bastion.x, y: bastion.y }, units: defendersBefore, losses: defenderLosses },
    wall: wallBefore,
    loot: null,
    loyalty: null,
    conquered: false,
    wallDamage,
  } satisfies AttackReportData;
  const seen = totalUnits(survivors) > 0;
  const attackerView: AttackReportData = seen ? base : { ...base, defender: { ...base.defender, units: null, losses: null }, wall: null, wallDamage: null };
  const note = result.attackerWins && survivors.noble > 0 && !tribeId ? ' (sans tribu, pas de bannière)' : result.attackerWins && survivors.noble === 0 && !previousId ? ' (aucun noble pour planter la bannière)' : '';
  await createReport(c, outbox, attackerId, 'attack', `Assaut sur ${label(bastion)} : ${outcome}${note}`, attackerView, at);
  for (const pl of defenderPlayers) {
    if (pl === attackerId) continue;
    const title = result.attackerWins ? `${label(bastion)} est tombé face à ${sideName}` : `${label(bastion)} tient bon face à ${sideName}`;
    await createReport(c, outbox, pl, 'defense', title, base, at);
  }
  outbox.push(attackerId, { type: 'village', villageId: origin.id });
}

// ---------- Contrôle et victoire ----------

/** Annonce les provinces dont la tenue vient d'aboutir, et la victoire du monde quand la Terre sainte a été tenue assez longtemps. */
export async function processProvinces(c: Db, outbox: Outbox, now: Date) {
  if (!env.provinces) return;
  const { rows } = await c.query('SELECT * FROM provinces WHERE holder_tribe_id IS NOT NULL AND NOT control_notified FOR UPDATE');
  for (const p of rows as ProvinceRow[]) {
    const hold = p.kind === 'holy' ? env.holyHoldDays * 24 : env.provinceHoldHours;
    const at = controlAt(p.holder_since!, hold);
    if (at.getTime() > now.getTime()) continue;
    await c.query('UPDATE provinces SET control_notified = true WHERE id = $1', [p.id]);
    const tribe = await tribeLabel(c, p.holder_tribe_id);
    if (p.kind === 'holy') {
      if ((await c.query('SELECT 1 FROM world_victories LIMIT 1')).rows.length) continue;
      await c.query('INSERT INTO world_victories (tribe_id, tribe_name, tribe_tag, at) VALUES ($1, $2, $3, $4)', [p.holder_tribe_id, tribe?.name ?? '?', tribe?.tag ?? '?', at]);
      const members = (await c.query('SELECT id FROM players WHERE tribe_id = $1', [p.holder_tribe_id])).rows;
      for (const m of members) await grantTitle(c, m.id, 'master', at, null);
      // Tout le monde l'apprend.
      const everyone = (await c.query('SELECT id FROM players WHERE NOT is_npc')).rows;
      for (const m of everyone)
        await createReport(c, outbox, m.id, 'province', `[${tribe?.tag}] ${tribe?.name} a tenu la Terre sainte et gagne le monde !`, { province: p.name, text: `La tribu ${tribe?.name} est inscrite au tableau d'honneur du monde.` }, at);
    } else {
      const bonus = p.bonus && tierBonus(p.tier) > 0 ? `${PROVINCE_BONUS_LABEL[p.bonus]} +${tierBonus(p.tier)} %` : '';
      // Trésor : une fois par tribu et par province, pour chaque membre (hors PNJ).
      const percent = p.tier ? tierRules(p.tier).treasure : 0;
      let treasure = '';
      if (percent > 0) {
        const fresh = await c.query('INSERT INTO province_rewards (province_id, tribe_id, at) VALUES ($1, $2, $3) ON CONFLICT DO NOTHING', [p.id, p.holder_tribe_id, at]);
        if (fresh.rowCount) {
          const bastion = p.bastion_village_id ? (await c.query('SELECT name FROM villages WHERE id = $1', [p.bastion_village_id])).rows[0]?.name : null;
          const members = (await c.query('SELECT id FROM players WHERE tribe_id = $1 AND NOT is_npc', [p.holder_tribe_id])).rows;
          for (const m of members) await grantItem(c, m.id, 'treasure', percent, `${bastion ?? p.name} · niveau ${p.tier}`, at);
          treasure = ` Chaque membre reçoit dans son inventaire un trésor qui remplit ${percent} % de l'entrepôt d'un village.`;
        }
      }
      await tellTribe(c, outbox, p.holder_tribe_id, `Votre tribu contrôle ${p.name}${bonus ? ` : ${bonus}` : ''}`, { province: p.name, text: `Le bonus s'applique à tous les villages de la tribu tant que sa bannière flotte sur le bastion.${treasure}` }, at);
    }
  }
}

/** Bonus des provinces contrôlées par la tribu du propriétaire d'un village (fractions, qui s'additionnent). */
export async function provinceBonuses(c: Db, ownerId: number | null, at: Date): Promise<Record<ProvinceBonus, number>> {
  const out: Record<ProvinceBonus, number> = { wood: 0, clay: 0, iron: 0, wheat: 0, recruit: 0, speed: 0 };
  if (!ownerId || !env.provinces) return out;
  const { rows } = await c.query(
    `SELECT pr.bonus, pr.tier, pr.holder_tribe_id, pr.holder_since FROM provinces pr JOIN players p ON p.tribe_id = pr.holder_tribe_id
     WHERE p.id = $1 AND pr.bonus IS NOT NULL`,
    [ownerId],
  );
  for (const r of rows) if (controlled(r, at)) out[r.bonus as ProvinceBonus] += tierBonus(r.tier ?? 1) / 100;
  return out;
}

/** Troupes plus rapides grâce aux provinces de vitesse que contrôle la tribu du joueur (0,1 = trajets 10 % plus rapides). */
export const speedBonus = async (c: Db, playerId: number | null, at: Date) => (playerId ? (await provinceBonuses(c, playerId, at)).speed : 0);

// ---------- Vues ----------

export async function worldVictory(c: Db): Promise<WorldVictoryView | null> {
  const r = (await c.query('SELECT * FROM world_victories ORDER BY id LIMIT 1')).rows[0];
  return r ? { tribeId: r.tribe_id, tribeName: r.tribe_name, tribeTag: r.tribe_tag, at: new Date(r.at).toISOString() } : null;
}

export async function provincesState(c: Db, playerId: number, now: Date): Promise<ProvincesState> {
  const { rows } = await c.query(
    `SELECT pr.*, t.tag, t.name AS tribe_name, v.name AS b_name, v.x AS b_x, v.y AS b_y, (v.buildings->>'wall')::int AS b_wall
     FROM provinces pr LEFT JOIN tribes t ON t.id = pr.holder_tribe_id LEFT JOIN villages v ON v.id = pr.bastion_village_id ORDER BY pr.id`,
  );
  const geo = rows.length ? await geography(c) : { neighbours: new Map<number, number[]>() };
  const provinces: ProvinceView[] = rows.map((r) => {
    const hold = r.kind === 'holy' ? env.holyHoldDays * 24 : env.provinceHoldHours;
    const ctrl = r.holder_since ? controlAt(r.holder_since, hold) : null;
    return {
      id: r.id,
      name: r.name,
      kind: r.kind,
      x: r.x,
      y: r.y,
      weight: r.weight,
      bonus: r.bonus,
      tier: r.kind === 'holy' ? 0 : (r.tier ?? 1),
      bonusPercent: r.kind === 'holy' ? 0 : tierBonus(r.tier ?? 1),
      bastion: r.bastion_village_id ? { id: r.bastion_village_id, name: r.b_name, x: r.b_x, y: r.b_y, wall: r.b_wall ?? 0 } : null,
      holder: r.holder_tribe_id ? { tribeId: r.holder_tribe_id, tag: r.tag, name: r.tribe_name } : null,
      holderSince: r.holder_since ? new Date(r.holder_since).toISOString() : null,
      controlAt: ctrl ? ctrl.toISOString() : null,
      controlled: !!ctrl && ctrl.getTime() <= now.getTime(),
      neighbours: geo.neighbours.get(r.id) ?? [],
    };
  });
  const tribeId = await tribeOf(c, playerId);
  const holyNeighbours = await holyNeighboursHeld(c, tribeId, now);
  return {
    enabled: env.provinces === 1,
    mapSize: env.mapSize,
    holdHours: env.provinceHoldHours,
    holyAccess: env.holyAccess,
    holyHoldDays: env.holyHoldDays,
    tiers: ([1, 2, 3] as const).map(tierRules),
    provinces,
    mine: tribeId ? { tribeId, holyNeighbours, canAttackHoly: holyNeighbours >= env.holyAccess } : null,
    victory: await worldVictory(c),
  };
}
