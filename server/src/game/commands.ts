import {
  AttackReportData,
  CANCEL_GRACE_SECONDS,
  CommandType,
  LOYALTY_AFTER_CONQUEST,
  NOBLE_LOYALTY_MAX,
  NOBLE_LOYALTY_MIN,
  RESOURCES,
  Resources,
  ScoutReportData,
  TradeReportData,
  UnitCounts,
  UnitKey,
  carryCapacity,
  emptyResources,
  emptyUnits,
  hasUnits,
  hiddenResources,
  merchantCount,
  merchantTravelTime,
  merchantsNeeded,
  normalizeUnits,
  scoutLosses,
  wallAfterRams,
  wallDuringCombat,
  plunder,
  resolveCombat,
  subtractUnits,
  totalUnits,
  travelTime,
  villagePoints,
  warehouseCapacity,
} from '@aldoria/shared';
import { tx, type Db } from '../db';
import { env } from '../env';
import { GameError, forbidden } from '../errors';
import { Outbox } from '../notify';
import { createReport } from './reports';
import { VillageRow, addTroops, busyMerchants, getTroops, loadVillage, resourcesOf, saveVillage, setTroops, syncVillage } from './village';

let rng: () => number = Math.random;
/** Permet aux tests de rendre la baisse de loyauté déterministe. */
export const setRandom = (fn: () => number) => (rng = fn);

const label = (v: { name: string; x: number; y: number }) => `${v.name} (${v.x}|${v.y})`;

async function playerName(c: Db, id: number | null): Promise<string | null> {
  if (!id) return null;
  const { rows } = await c.query('SELECT username FROM players WHERE id = $1', [id]);
  return rows[0]?.username ?? null;
}

async function insertCommand(
  c: Db,
  cmd: {
    type: CommandType;
    originId: number;
    targetId: number;
    homeId: number;
    playerId: number | null;
    units: UnitCounts;
    loot?: Resources | null;
    merchants?: number;
    sentAt: Date;
    arriveAt: Date;
  },
) {
  const { rows } = await c.query(
    `INSERT INTO commands (type, origin_village_id, target_village_id, home_village_id, player_id, units, loot, sent_at, arrive_at, merchants)
     VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10) RETURNING id`,
    [
      cmd.type,
      cmd.originId,
      cmd.targetId,
      cmd.homeId,
      cmd.playerId,
      JSON.stringify(cmd.units),
      cmd.loot ? JSON.stringify(cmd.loot) : null,
      cmd.sentAt,
      cmd.arriveAt,
      cmd.merchants ?? 0,
    ],
  );
  return rows[0].id as number;
}

// ---------- Envoi ----------

export async function sendCommand(
  c: Db,
  outbox: Outbox,
  playerId: number,
  originId: number,
  input: { type: 'attack' | 'support'; targetId: number; units: Partial<UnitCounts> },
  now: Date,
) {
  const origin = await syncVillage(c, originId, now);
  if (origin.owner_id !== playerId) throw forbidden("Ce village n'est pas à vous");
  const target = await loadVillage(c, input.targetId);
  if (target.id === origin.id) throw new GameError('Choisissez un autre village comme cible');

  const units = normalizeUnits(input.units);
  if (totalUnits(units) === 0) throw new GameError('Sélectionnez au moins une unité');
  const available = await getTroops(c, origin.id, origin.id);
  if (!hasUnits(available, units)) throw new GameError("Vous n'avez pas assez de troupes au village");

  if (input.type === 'attack') {
    if (target.owner_id === playerId) throw new GameError('Pour vos propres villages, envoyez plutôt un renfort');
    if (target.owner_id) {
      const { rows } = await c.query('SELECT protection_until FROM players WHERE id = $1', [target.owner_id]);
      if (rows[0]?.protection_until && new Date(rows[0].protection_until) > now) {
        throw new GameError('Ce joueur est encore sous protection débutant');
      }
      // Attaquer un autre joueur met fin à sa propre protection.
      await c.query('UPDATE players SET protection_until = NULL WHERE id = $1 AND protection_until > $2', [playerId, now]);
    }
  }

  await setTroops(c, origin.id, origin.id, subtractUnits(available, units));
  const arriveAt = new Date(now.getTime() + travelTime(units, origin, target, env.worldSpeed) * 1000);
  const id = await insertCommand(c, {
    type: input.type,
    originId: origin.id,
    targetId: target.id,
    homeId: origin.id,
    playerId,
    units,
    sentAt: now,
    arriveAt,
  });
  outbox.push(playerId, { type: 'village', villageId: origin.id });
  if (target.owner_id && target.owner_id !== playerId) {
    if (input.type === 'attack') outbox.push(target.owner_id, { type: 'incoming', villageId: target.id, arriveAt: arriveAt.toISOString() });
    outbox.push(target.owner_id, { type: 'village', villageId: target.id });
  }
  return { id, arriveAt };
}

/**
 * Dissout des unités présentes au village : elles disparaissent sans remboursement et ne coûtent plus de blé.
 * Les troupes en mouvement ou stationnées ailleurs ne sont pas concernées.
 */
export async function disbandTroops(c: Db, outbox: Outbox, playerId: number, villageId: number, unit: UnitKey, count: number, now: Date) {
  // Synchroniser d'abord : le blé consommé jusqu'ici l'est avec l'ancien effectif.
  const village = await syncVillage(c, villageId, now);
  if (village.owner_id !== playerId) throw forbidden("Ce village n'est pas à vous");
  if (!Number.isInteger(count) || count < 1) throw new GameError("Indiquez un nombre d'unités à dissoudre");
  const troops = await getTroops(c, villageId, villageId);
  if (troops[unit] < count) throw new GameError("Vous n'avez pas autant d'unités au village");
  await setTroops(c, villageId, villageId, { ...troops, [unit]: troops[unit] - count });
  outbox.push(playerId, { type: 'village', villageId });
}

/** Rappelle des renforts (par leur propriétaire) ou les renvoie chez eux (par le village qui les héberge). */
export async function recallTroops(c: Db, outbox: Outbox, playerId: number, stationedId: number, homeId: number, now: Date) {
  if (stationedId === homeId) throw new GameError('Ces troupes sont déjà chez elles');
  const home = await loadVillage(c, homeId);
  const stationed = await loadVillage(c, stationedId);
  if (home.owner_id !== playerId && stationed.owner_id !== playerId) throw forbidden();
  const units = await getTroops(c, stationedId, homeId);
  if (totalUnits(units) === 0) throw new GameError('Aucune troupe à renvoyer');
  await setTroops(c, stationedId, homeId, emptyUnits());
  const arriveAt = new Date(now.getTime() + travelTime(units, stationed, home, env.worldSpeed) * 1000);
  await insertCommand(c, {
    type: 'return',
    originId: stationedId,
    targetId: homeId,
    homeId,
    playerId: home.owner_id,
    units,
    sentAt: now,
    arriveAt,
  });
  outbox.push(home.owner_id, { type: 'village', villageId: homeId });
  outbox.push(stationed.owner_id, { type: 'village', villageId: stationedId });
}

/**
 * Annule une attaque ou un renfort juste après son envoi : les troupes font demi-tour et mettent,
 * pour rentrer, le temps déjà parcouru. Impossible passé le délai de grâce.
 */
export async function cancelCommand(c: Db, outbox: Outbox, playerId: number, commandId: number, now: Date) {
  const { rows } = await c.query('SELECT * FROM commands WHERE id = $1 FOR UPDATE', [commandId]);
  const cmd = rows[0];
  if (!cmd || cmd.processed) throw new GameError('Ce mouvement est déjà arrivé ou annulé');
  if (cmd.type !== 'attack' && cmd.type !== 'support') throw new GameError('Ce mouvement ne peut pas être annulé');
  if (cmd.player_id !== playerId) throw forbidden("Ce mouvement n'est pas à vous");
  const elapsed = (now.getTime() - new Date(cmd.sent_at).getTime()) / 1000;
  if (elapsed > CANCEL_GRACE_SECONDS) throw new GameError(`On ne peut annuler un mouvement que dans les ${CANCEL_GRACE_SECONDS} premières secondes`);
  await c.query('UPDATE commands SET processed = true WHERE id = $1', [commandId]);
  await insertCommand(c, {
    type: 'return',
    originId: cmd.target_village_id,
    targetId: cmd.home_village_id,
    homeId: cmd.home_village_id,
    playerId,
    units: normalizeUnits(cmd.units),
    sentAt: now,
    arriveAt: new Date(now.getTime() + Math.max(1, Math.round(elapsed)) * 1000),
  });
  outbox.push(playerId, { type: 'village', villageId: cmd.home_village_id });
  const target = await loadVillage(c, cmd.target_village_id);
  if (target.owner_id && target.owner_id !== playerId) outbox.push(target.owner_id, { type: 'village', villageId: target.id });
}

/** Envoie un convoi de marchands chargé de ressources vers un village de joueur. */
export async function sendTrade(
  c: Db,
  outbox: Outbox,
  playerId: number,
  originId: number,
  input: { targetId: number; resources: Resources },
  now: Date,
) {
  const origin = await syncVillage(c, originId, now);
  if (origin.owner_id !== playerId) throw forbidden("Ce village n'est pas à vous");
  const target = await loadVillage(c, input.targetId);
  if (target.id === origin.id) throw new GameError('Choisissez un autre village');
  if (!target.owner_id) throw new GameError("Les marchands ne commercent pas avec les villages barbares");
  const cargo = emptyResources();
  for (const r of RESOURCES) cargo[r] = Math.max(0, Math.floor(input.resources[r] ?? 0));
  const needed = merchantsNeeded(cargo);
  if (needed === 0) throw new GameError('Indiquez les ressources à envoyer');
  for (const r of RESOURCES) if (cargo[r] > Math.floor(origin[r])) throw new GameError("Vous n'avez pas assez de ressources");
  const available = merchantCount(origin.buildings.market) - (await busyMerchants(c, origin.id));
  if (needed > available) throw new GameError(`Il faut ${needed} marchand${needed > 1 ? 's' : ''}, vous en avez ${Math.max(0, available)} de libre${available > 1 ? 's' : ''}`);

  for (const r of RESOURCES) origin[r] -= cargo[r];
  await saveVillage(c, origin);
  const arriveAt = new Date(now.getTime() + merchantTravelTime(origin, target, env.worldSpeed) * 1000);
  const id = await insertCommand(c, {
    type: 'trade',
    originId: origin.id,
    targetId: target.id,
    homeId: origin.id,
    playerId,
    units: emptyUnits(),
    loot: cargo,
    merchants: needed,
    sentAt: now,
    arriveAt,
  });
  outbox.push(playerId, { type: 'village', villageId: origin.id });
  if (target.owner_id !== playerId) outbox.push(target.owner_id, { type: 'village', villageId: target.id });
  return { id, arriveAt };
}

// ---------- Arrivées ----------

async function handleTrade(c: Db, outbox: Outbox, cmd: any) {
  const at = new Date(cmd.arrive_at);
  const target = await syncVillage(c, cmd.target_village_id, at);
  const origin = await loadVillage(c, cmd.home_village_id);
  const cargo: Resources = { ...emptyResources(), ...cmd.loot };
  const cap = warehouseCapacity(target.buildings.warehouse);
  // Ce qui dépasse la capacité de l'entrepôt est perdu, comme pour la production.
  for (const r of RESOURCES) target[r] = Math.max(target[r], Math.min(cap, target[r] + cargo[r]));
  await saveVillage(c, target);
  await insertCommand(c, {
    type: 'trade_return',
    originId: target.id,
    targetId: origin.id,
    homeId: origin.id,
    playerId: cmd.player_id,
    units: emptyUnits(),
    merchants: cmd.merchants,
    sentAt: at,
    arriveAt: new Date(at.getTime() + merchantTravelTime(target, origin, env.worldSpeed) * 1000),
  });
  const data: TradeReportData = {
    from: { id: origin.id, name: origin.name, x: origin.x, y: origin.y, playerName: await playerName(c, cmd.player_id) },
    to: { id: target.id, name: target.name, x: target.x, y: target.y, playerName: await playerName(c, target.owner_id) },
    resources: cargo,
  };
  await createReport(c, outbox, cmd.player_id, 'trade', `Livraison arrivée à ${label(target)}`, data, at);
  if (target.owner_id && target.owner_id !== cmd.player_id) {
    await createReport(c, outbox, target.owner_id, 'trade', `${data.from.playerName ?? 'Un joueur'} vous livre des ressources à ${label(target)}`, data, at);
  }
  outbox.push(target.owner_id, { type: 'village', villageId: target.id });
  outbox.push(cmd.player_id, { type: 'village', villageId: origin.id });
}

/** Mission d'espionnage : seuls des éclaireurs, pas de combat ni de pillage. */
async function handleScouting(c: Db, outbox: Outbox, cmd: any, target: VillageRow, origin: VillageRow, attackers: UnitCounts) {
  const at = new Date(cmd.arrive_at);
  const attackerId: number | null = cmd.player_id;
  const rows = (await c.query('SELECT units FROM troops WHERE village_id = $1', [target.id])).rows;
  const present = rows.reduce((sum, r) => {
    const u = normalizeUnits(r.units);
    for (const k of Object.keys(u) as (keyof UnitCounts)[]) sum[k] += u[k];
    return sum;
  }, emptyUnits());
  const lost = scoutLosses(attackers.scout, present.scout);
  const survivors = { ...attackers, scout: attackers.scout - lost };
  const attackerLosses = { ...emptyUnits(), scout: lost };
  if (survivors.scout > 0) {
    await insertCommand(c, {
      type: 'return',
      originId: target.id,
      targetId: origin.id,
      homeId: origin.id,
      playerId: attackerId,
      units: survivors,
      sentAt: at,
      arriveAt: new Date(at.getTime() + travelTime(survivors, target, origin, env.worldSpeed) * 1000),
    });
  }
  const side = (v: VillageRow, name: string | null) => ({ playerName: name, village: { id: v.id, name: v.name, x: v.x, y: v.y } });
  const attackerName = await playerName(c, attackerId);
  const defenderName = await playerName(c, target.owner_id);
  const data: ScoutReportData = {
    attacker: { ...side(origin, attackerName), units: attackers, losses: attackerLosses },
    defender: { ...side(target, defenderName), units: null, losses: null },
    intel: survivors.scout > 0 ? { resources: floorResources(resourcesOf(target)), buildings: target.buildings, troops: present } : null,
  };
  const outcome = survivors.scout > 0 ? (lost > 0 ? `${lost} éclaireur${lost > 1 ? 's' : ''} perdu${lost > 1 ? 's' : ''}` : 'réussi') : 'échec, tous les éclaireurs ont été tués';
  await createReport(c, outbox, attackerId, 'scout', `Espionnage de ${label(target)} : ${outcome}`, data, at);
  if (target.owner_id && lost > 0) {
    const defView: ScoutReportData = { ...data, intel: null };
    await createReport(c, outbox, target.owner_id, 'scout', `Des éclaireurs de ${attackerName ?? 'un inconnu'} ont été repérés à ${label(target)}`, defView, at);
  }
  if (attackerId) outbox.push(attackerId, { type: 'village', villageId: origin.id });
}

const floorResources = (r: Resources): Resources => ({ wood: Math.floor(r.wood), clay: Math.floor(r.clay), iron: Math.floor(r.iron), wheat: Math.floor(r.wheat) });

async function handleAttack(c: Db, outbox: Outbox, cmd: any) {
  const at = new Date(cmd.arrive_at);
  const attackers = normalizeUnits(cmd.units);
  const target = await syncVillage(c, cmd.target_village_id, at);
  const origin = await loadVillage(c, cmd.home_village_id);
  const attackerId: number | null = cmd.player_id;

  // Le village a changé de mains entre-temps et appartient désormais à l'attaquant : les troupes s'y installent.
  if (attackerId && target.owner_id === attackerId) {
    await addTroops(c, target.id, cmd.home_village_id, attackers);
    outbox.push(attackerId, { type: 'village', villageId: target.id });
    return;
  }

  // Uniquement des éclaireurs : mission d'espionnage.
  if (attackers.scout > 0 && attackers.scout === totalUnits(attackers)) return handleScouting(c, outbox, cmd, target, origin, attackers);

  const defenderRows = (await c.query('SELECT home_village_id, units FROM troops WHERE village_id = $1 FOR UPDATE', [target.id])).rows;
  const defenders = defenderRows.map((r) => normalizeUnits(r.units));
  const defendersBefore = defenders.reduce((sum, g) => {
    for (const k of Object.keys(g) as (keyof UnitCounts)[]) sum[k] += g[k];
    return sum;
  }, emptyUnits());

  const wallBefore = target.buildings.wall;
  const result = resolveCombat({ attackers, defenders, wallLevel: wallDuringCombat(wallBefore, attackers.ram) });
  const defenderLossesTotal = emptyUnits();
  for (let i = 0; i < defenderRows.length; i++) {
    const loss = result.defenderLosses[i];
    for (const k of Object.keys(loss) as (keyof UnitCounts)[]) defenderLossesTotal[k] += loss[k];
    await setTroops(c, target.id, defenderRows[i].home_village_id, subtractUnits(defenders[i], loss));
  }
  const survivors = subtractUnits(attackers, result.attackerLosses);

  let loot: Resources | null = null;
  let loyalty: AttackReportData['loyalty'] = null;
  let conquered = false;
  const previousOwner = target.owner_id;

  let wallDamage: AttackReportData['wallDamage'] = null;
  if (result.attackerWins && survivors.ram > 0) {
    const after = wallAfterRams(wallBefore, survivors.ram);
    if (after < wallBefore) {
      target.buildings.wall = after;
      target.points = villagePoints(target.buildings);
      wallDamage = { before: wallBefore, after };
    }
  }

  if (result.attackerWins) {
    if (survivors.noble > 0) {
      const before = target.loyalty;
      let drop = 0;
      for (let i = 0; i < survivors.noble; i++) drop += NOBLE_LOYALTY_MIN + Math.floor(rng() * (NOBLE_LOYALTY_MAX - NOBLE_LOYALTY_MIN + 1));
      target.loyalty = Math.max(0, before - drop);
      loyalty = { before: Math.floor(before), after: Math.floor(target.loyalty) };
      conquered = target.loyalty <= 0;
    }
    if (!conquered) {
      const hidden = hiddenResources(target.buildings.warehouse);
      const available = emptyResources();
      for (const r of RESOURCES) available[r] = Math.max(0, Math.floor(target[r]) - hidden);
      loot = plunder(available, carryCapacity(survivors));
      for (const r of RESOURCES) target[r] -= loot[r];
    }
  }

  if (conquered) {
    await conquer(c, outbox, target, attackerId, survivors);
    loyalty = { before: loyalty!.before, after: LOYALTY_AFTER_CONQUEST };
  } else if (totalUnits(survivors) > 0) {
    const arriveAt = new Date(at.getTime() + travelTime(survivors, target, origin, env.worldSpeed) * 1000);
    await insertCommand(c, {
      type: 'return',
      originId: target.id,
      targetId: origin.id,
      homeId: origin.id,
      playerId: attackerId,
      units: survivors,
      loot,
      sentAt: at,
      arriveAt,
    });
  }
  await saveVillage(c, target);

  const attackerName = await playerName(c, attackerId);
  const defenderName = await playerName(c, previousOwner);
  const attackerSees = totalUnits(survivors) > 0;
  const base = {
    attackerWins: result.attackerWins,
    attacker: {
      playerName: attackerName,
      village: { id: origin.id, name: origin.name, x: origin.x, y: origin.y },
      units: attackers,
      losses: result.attackerLosses,
    },
    defender: {
      playerName: defenderName,
      village: { id: target.id, name: target.name, x: target.x, y: target.y },
      units: defendersBefore,
      losses: defenderLossesTotal,
    },
    wall: wallBefore,
    loot,
    loyalty,
    conquered,
    wallDamage,
  } satisfies AttackReportData;

  const outcome = conquered ? 'conquête !' : result.attackerWins ? 'victoire' : 'défaite';
  // Les éclaireurs survivants d'une attaque gagnée rapportent ce qu'il reste dans le village.
  const intel = result.attackerWins && survivors.scout > 0 && !conquered ? { resources: floorResources(resourcesOf(target)), buildings: target.buildings } : null;
  const attackerView: AttackReportData = attackerSees
    ? { ...base, intel }
    : { ...base, defender: { ...base.defender, units: null, losses: null }, wall: null, wallDamage: null };
  await createReport(c, outbox, attackerId, 'attack', `Attaque sur ${label(target)} : ${outcome}`, attackerView, at);
  if (previousOwner) {
    const title = conquered
      ? `${label(target)} a été conquis par ${attackerName ?? 'un inconnu'}`
      : `${label(target)} attaqué par ${attackerName ?? 'un inconnu'} : ${result.attackerWins ? 'défaite' : 'victoire'}`;
    await createReport(c, outbox, previousOwner, 'defense', title, base, at);
    outbox.push(previousOwner, { type: 'village', villageId: target.id });
    if (conquered) outbox.push(previousOwner, { type: 'me' });
  }
  // Les joueurs qui avaient des renforts sur place sont prévenus aussi.
  const supportHomes = defenderRows.map((r) => r.home_village_id).filter((id) => id !== target.id);
  if (supportHomes.length) {
    const owners = (await c.query('SELECT DISTINCT owner_id FROM villages WHERE id = ANY($1) AND owner_id IS NOT NULL', [supportHomes])).rows;
    for (const o of owners) {
      if (o.owner_id === previousOwner || o.owner_id === attackerId) continue;
      await createReport(c, outbox, o.owner_id, 'support', `Vos renforts à ${label(target)} ont été attaqués`, base, at);
    }
  }
  if (attackerId && !conquered) outbox.push(attackerId, { type: 'village', villageId: origin.id });
}

async function conquer(c: Db, outbox: Outbox, target: VillageRow, newOwner: number | null, survivors: UnitCounts) {
  target.owner_id = newOwner;
  target.loyalty = LOYALTY_AFTER_CONQUEST;
  await c.query('DELETE FROM build_queue WHERE village_id = $1', [target.id]);
  await c.query('DELETE FROM recruit_queue WHERE village_id = $1', [target.id]);
  // Les troupes de l'ancien propriétaire qui étaient hors du village sont perdues.
  await c.query('DELETE FROM troops WHERE home_village_id = $1 OR village_id = $1', [target.id]);
  await c.query('UPDATE commands SET processed = true WHERE home_village_id = $1 AND NOT processed', [target.id]);
  // Un noble s'installe pour gouverner ; le reste de l'armée devient la garnison du village.
  const garrison = { ...survivors, noble: Math.max(0, survivors.noble - 1) };
  await setTroops(c, target.id, target.id, garrison);
  outbox.push(newOwner, { type: 'me' });
}

async function handleSupport(c: Db, outbox: Outbox, cmd: any) {
  const at = new Date(cmd.arrive_at);
  const units = normalizeUnits(cmd.units);
  const target = await loadVillage(c, cmd.target_village_id);
  const origin = await loadVillage(c, cmd.home_village_id);
  await addTroops(c, target.id, origin.id, units);
  await createReport(c, outbox, cmd.player_id, 'support', `Vos renforts sont arrivés à ${label(target)}`, { units, target: label(target) }, at);
  if (target.owner_id && target.owner_id !== cmd.player_id) {
    const from = await playerName(c, cmd.player_id);
    await createReport(c, outbox, target.owner_id, 'support', `${from ?? 'Un allié'} envoie des renforts à ${label(target)}`, { units, from: label(origin) }, at);
  }
  outbox.push(target.owner_id, { type: 'village', villageId: target.id });
  outbox.push(cmd.player_id, { type: 'village', villageId: origin.id });
}

async function handleReturn(c: Db, outbox: Outbox, cmd: any) {
  const at = new Date(cmd.arrive_at);
  const home = await syncVillage(c, cmd.target_village_id, at);
  await addTroops(c, home.id, home.id, normalizeUnits(cmd.units));
  if (cmd.loot) {
    const cap = warehouseCapacity(home.buildings.warehouse);
    for (const r of RESOURCES) home[r] = Math.max(home[r], Math.min(cap, home[r] + Number(cmd.loot[r] ?? 0)));
    await saveVillage(c, home);
  }
  outbox.push(home.owner_id, { type: 'village', villageId: home.id });
}

/** Traite, dans l'ordre chronologique exact, tous les mouvements arrivés à destination. */
export async function processDueEvents(now: Date): Promise<number> {
  let processed = 0;
  for (;;) {
    const outbox = new Outbox();
    const handled = await tx(async (c) => {
      const { rows } = await c.query(
        'SELECT * FROM commands WHERE NOT processed AND arrive_at <= $1 ORDER BY arrive_at, id LIMIT 1 FOR UPDATE SKIP LOCKED',
        [now],
      );
      const cmd = rows[0];
      if (!cmd) return false;
      await c.query('UPDATE commands SET processed = true WHERE id = $1', [cmd.id]);
      if (cmd.type === 'attack') await handleAttack(c, outbox, cmd);
      else if (cmd.type === 'support') await handleSupport(c, outbox, cmd);
      else if (cmd.type === 'trade') await handleTrade(c, outbox, cmd);
      else if (cmd.type === 'trade_return') outbox.push(cmd.player_id, { type: 'village', villageId: cmd.target_village_id });
      else await handleReturn(c, outbox, cmd);
      return true;
    });
    if (!handled) return processed;
    outbox.flush();
    processed++;
  }
}
