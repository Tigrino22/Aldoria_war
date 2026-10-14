import {
  BASE_VILLAGE_DEFENSE,
  UNITS,
  UNIT_KEYS,
  emptyUnits,
  normalizeUnits,
  totalUnits,
  travelTime,
  wallAfterRams,
  wallBonus,
  type UnitCounts,
} from '@aldoria/shared';
import type { Db } from '../db';
import { env } from '../env';
import { GameError } from '../errors';
import type { Outbox } from '../notify';
import { sendCommand } from './commands';
import { saveTribeState, type TribeInfo } from './npc-tribes';
import type { VillageRole } from './npc-roles';
import { placeOrder } from './orders';
import { areAllied } from './tribe-alliances';
import { getTroops, loadVillage } from './village';

/**
 * Les tribus de PNJ et les Croisades : elles s'y préparent comme une tribu de joueurs, au lieu d'attaquer au hasard.
 * 1. Dès l'annonce, le chef espionne la Citadelle et la tribu décide d'y aller si son armée offensive pèse assez face à la garnison.
 * 2. Dans la demi-heure qui précède le départ, chaque village offensif programme son assaut (épéistes, cavaliers, béliers) au point de ralliement,
 *    les arrivées échelonnées de 20 secondes à partir de l'ouverture ; le village qui a des nobles arrive en dernier avec un train de nobles,
 *    quand les premières vagues ont usé la garnison. Les villages défensifs restent chez eux.
 * 3. Si la tribu (ou une alliée) tient la bannière, ses villages défensifs envoient des renforts qui arrivent avant la fermeture.
 * 4. Si un autre camp la tient, les villages offensifs qui ont encore des troupes contre-attaquent (au plus une fois tous les quarts d'heure).
 * Les règles de choix sont pures (testées) ; `crusadeStep` lit et écrit la base.
 */

/** État d'une tribu de PNJ pour la croisade en cours (dans `tribes.npc_state.crusade`). */
export interface TribeCrusadeState {
  id: number;
  /** null tant que la tribu n'a pas décidé. */
  join: boolean | null;
  /** Villages dont l'assaut est programmé ou parti. */
  sent: number[];
  /** Villages qui ont envoyé leur renfort. */
  supported: number[];
  /** Dernière contre-attaque de chaque village (ISO). */
  countered: Record<string, string>;
}

/** Une tribu part en croisade si son armée offensive atteint au moins 40 % de la défense de la Citadelle (béliers comptés) : à plusieurs vagues, elle l'use. */
export const JOIN_RATIO = 0.4;
/** Un ordre se programme dans la demi-heure qui précède son départ (temps réel). */
export const ORDER_LEAD_MS = 30 * 60_000;
/** Écart entre les arrivées de deux villages de la tribu. */
export const WAVE_GAP_MS = 20_000;
/** Premier assaut juste après l'ouverture ; le train de nobles une dizaine de minutes plus tard. */
export const FIRST_WAVE_MS = 60_000;
export const NOBLE_WAVE_MS = 10 * 60_000;
/** Une contre-attaque au plus tous les quarts d'heure par village. */
export const COUNTER_GAP_MS = 15 * 60_000;

/** Troupes d'assaut d'un village offensif : épéistes, cavaliers et béliers (les éclaireurs et les défenseurs restent). */
export function strikeUnits(home: UnitCounts): UnitCounts {
  return { ...emptyUnits(), swordsman: home.swordsman, cavalry: home.cavalry, ram: home.ram };
}

/** Renfort d'un village défensif : 60 % de ses lanciers et hallebardiers, 30 % de ses épéistes. */
export function supportUnits(home: UnitCounts): UnitCounts {
  return { ...emptyUnits(), spearman: Math.floor(home.spearman * 0.6), halberdier: Math.floor(home.halberdier * 0.6), swordsman: Math.floor(home.swordsman * 0.3) };
}

const attackPower = (u: UnitCounts) => UNIT_KEYS.reduce((s, k) => s + u[k] * UNITS[k].attack, 0);

/** Défense de la Citadelle face à une attaque d'infanterie et de cavalerie mêlées, une fois la muraille abaissée par `rams` béliers. */
export function citadelDefense(garrison: UnitCounts, wall: number, rams: number): number {
  const raw = UNIT_KEYS.reduce((s, k) => s + garrison[k] * (UNITS[k].defenseInfantry + UNITS[k].defenseCavalry) / 2, BASE_VILLAGE_DEFENSE);
  return raw * wallBonus(wallAfterRams(wall, rams));
}

export function shouldJoin(tribeOffense: UnitCounts, garrison: UnitCounts, wall: number): boolean {
  return attackPower(tribeOffense) >= JOIN_RATIO * citadelDefense(garrison, wall, tribeOffense.ram);
}

/** Arrivée visée pour le `rank`-ième village de la tribu (le train de nobles part à part). */
export const plannedArrival = (opensAt: number, rank: number, nobles: boolean) => opensAt + (nobles ? NOBLE_WAVE_MS : FIRST_WAVE_MS) + rank * WAVE_GAP_MS;

/** Heure de départ à programmer : null si c'est trop tôt (au-delà du délai de préparation) ou trop tard (arrivée après la fenêtre). */
export function departure(now: number, arrival: number, travelMs: number, closesAt: number): { arriveAt: number } | null {
  const depart = arrival - travelMs;
  if (depart - now > ORDER_LEAD_MS) return null;
  // Départ déjà passé : on part tout de suite, si l'on arrive encore avant la fermeture (avec deux minutes de marge).
  const arriveAt = depart >= now ? arrival : now + travelMs;
  return arriveAt < closesAt - 2 * 60_000 ? { arriveAt } : null;
}

interface CrusadeLite {
  id: number;
  village_id: number;
  opens_at: Date;
  closes_at: Date;
  garrison: UnitCounts;
  wall: number;
  holder_tribe_id: number | null;
  holder_player_id: number | null;
}

async function tribeOffense(c: Db, tribeId: number): Promise<UnitCounts> {
  const { rows } = await c.query(
    `SELECT t.units FROM troops t JOIN villages v ON v.id = t.home_village_id AND t.village_id = t.home_village_id JOIN players p ON p.id = v.owner_id WHERE p.tribe_id = $1`,
    [tribeId],
  );
  const sum = emptyUnits();
  for (const r of rows) {
    const u = strikeUnits(normalizeUnits(r.units));
    for (const k of UNIT_KEYS) sum[k] += u[k];
  }
  return sum;
}

/** Fenêtre (avant l'ouverture) pendant laquelle les villages offensifs d'une tribu engagée gardent leurs troupes pour l'assaut. */
export const HOLD_BEFORE_MS = 2 * 3_600_000;

/** Vrai si la tribu est engagée dans la croisade et que l'assaut approche ou a lieu : ses villages offensifs ne partent pas piller. */
export async function crusadeHold(c: Db, tribe: TribeInfo | null, now: Date): Promise<boolean> {
  const state = (tribe?.state as { crusade?: TribeCrusadeState } | undefined)?.crusade;
  if (!tribe || !state?.join) return false;
  const cr = (await c.query("SELECT opens_at, closes_at FROM crusades WHERE id = $1 AND status <> 'ended'", [state.id])).rows[0];
  if (!cr) return false;
  return now.getTime() >= new Date(cr.opens_at).getTime() - HOLD_BEFORE_MS && now.getTime() < new Date(cr.closes_at).getTime();
}

/** Une étape de croisade d'un PNJ de tribu, à chaque réflexion. */
export async function crusadeStep(
  c: Db,
  outbox: Outbox,
  npcId: number,
  villages: { id: number; role: VillageRole }[],
  tribe: TribeInfo | null,
  now: Date,
) {
  if (!tribe || !env.crusades) return;
  const cr = (
    await c.query("SELECT id, village_id, opens_at, closes_at, garrison, wall, holder_tribe_id, holder_player_id FROM crusades WHERE status <> 'ended' AND village_id IS NOT NULL ORDER BY id LIMIT 1")
  ).rows[0] as CrusadeLite | undefined;
  if (!cr) return;
  const opens = new Date(cr.opens_at).getTime();
  const closes = new Date(cr.closes_at).getTime();
  if (now.getTime() >= closes) return;
  const citadel = await loadVillage(c, cr.village_id);
  let state = (tribe.state as { crusade?: TribeCrusadeState }).crusade;
  if (!state || state.id !== cr.id) state = { id: cr.id, join: null, sent: [], supported: [], countered: {} };
  const save = async () => {
    (tribe.state as { crusade?: TribeCrusadeState }).crusade = state;
    await saveTribeState(c, tribe);
  };

  // 1. Décision de la tribu, par le chef : il espionne d'abord la Citadelle (une poignée d'éclaireurs), puis décide.
  if (state.join === null) {
    if (tribe.leaderId !== npcId) return;
    const home = villages[0] ? await getTroops(c, villages[0].id, villages[0].id) : emptyUnits();
    if (home.scout >= 5) {
      try {
        await sendCommand(c, outbox, npcId, villages[0].id, { type: 'attack', targetId: citadel.id, units: { ...emptyUnits(), scout: 5 } }, now);
      } catch (err) {
        if (!(err instanceof GameError)) throw err;
      }
    }
    state.join = shouldJoin(await tribeOffense(c, tribe.id), normalizeUnits(cr.garrison), cr.wall);
    await save();
  }
  if (!state.join) return;

  const ours = cr.holder_tribe_id !== null && (cr.holder_tribe_id === tribe.id || (await areAllied(c, cr.holder_tribe_id, tribe.id)));
  const members = (await c.query('SELECT id FROM players WHERE tribe_id = $1 ORDER BY id', [tribe.id])).rows.map((r) => r.id as number);
  const rankBase = members.indexOf(npcId) * 3;

  for (const [i, v] of villages.entries()) {
    const village = await loadVillage(c, v.id);
    const home = await getTroops(c, v.id, v.id);
    try {
      if (v.role === 'offense' && !state.sent.includes(v.id)) {
        // 2. L'assaut programmé de ce village (avec un train de nobles s'il en a).
        const strike = strikeUnits(home);
        const nobles = Math.min(home.noble, 2);
        if (totalUnits(strike) < 20) continue;
        const travel = travelTime(nobles ? { ...strike, noble: 1 } : strike, village, citadel, env.worldSpeed) * 1000;
        const when = departure(now.getTime(), plannedArrival(opens, rankBase + i, nobles > 0), travel, closes);
        if (!when) continue;
        const escort = { ...emptyUnits(), swordsman: Math.min(30, Math.floor(strike.swordsman / 4)) };
        const train = nobles && escort.swordsman * nobles <= strike.swordsman ? { nobles, escort, gapSeconds: 1 } : null;
        const units = train ? { ...strike, swordsman: strike.swordsman - escort.swordsman * nobles } : strike;
        await placeOrder(c, outbox, npcId, v.id, { type: 'attack', targetId: citadel.id, units, arriveAt: new Date(when.arriveAt), train }, now);
        state.sent.push(v.id);
        await save();
      } else if (now.getTime() >= opens && ours && v.role === 'defense' && !state.supported.includes(v.id)) {
        // 3. Notre camp tient la bannière : renfort des villages défensifs, s'il arrive à temps.
        const units = supportUnits(home);
        if (totalUnits(units) < 20) continue;
        if (now.getTime() + travelTime(units, village, citadel, env.worldSpeed) * 1000 >= closes - 60_000) continue;
        await sendCommand(c, outbox, npcId, v.id, { type: 'support', targetId: citadel.id, units }, now);
        state.supported.push(v.id);
        await save();
      } else if (now.getTime() >= opens && !ours && v.role === 'offense' && state.sent.includes(v.id)) {
        // 4. Un autre camp tient la bannière (ou elle est à terre) : contre-attaque avec ce qui est rentré.
        const last = state.countered[v.id] ? Date.parse(state.countered[v.id]) : 0;
        if (now.getTime() - last < COUNTER_GAP_MS) continue;
        const strike = strikeUnits(home);
        if (totalUnits(strike) < 20) continue;
        const nobles = Math.min(home.noble, 1);
        const units = { ...strike, noble: nobles };
        if (now.getTime() + travelTime(units, village, citadel, env.worldSpeed) * 1000 >= closes - 2 * 60_000) continue;
        await sendCommand(c, outbox, npcId, v.id, { type: 'attack', targetId: citadel.id, units }, now);
        state.countered[v.id] = now.toISOString();
        await save();
      }
    } catch (err) {
      if (!(err instanceof GameError)) throw err;
    }
  }
}
