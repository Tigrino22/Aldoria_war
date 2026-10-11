import { type UnitCounts, normalizeUnits, totalUnits } from '@aldoria/shared';
import { pool } from '../db';
import { env } from '../env';
import { REAL_ATTACK } from './npc-tribes';
import { WAR_DAYS } from './npc-wars';

/**
 * Suivi des guerres entre tribus de PNJ pour l'administration : état en direct (guerres en cours, attaques en route) et
 * historique des dernières heures (batailles, conquêtes, pertes, déclarations). Lecture seule.
 * Les batailles viennent des rapports de défense des PNJ : ils contiennent les pertes des deux camps.
 */

export interface WarSide {
  id: number;
  tag: string;
  name: string;
  members: number;
  villages: number;
  points: number;
}

export interface WarBattle {
  at: string;
  attacker: { player: string; tribeId: number; tag: string; village: string };
  defender: { player: string; tribeId: number; tag: string; village: string };
  attackerWins: boolean;
  conquered: boolean;
  /** Troupes perdues (attaquant, défenseur). */
  attackerLosses: number;
  defenderLosses: number;
  /** Une guerre est en cours entre ces deux tribus ; sinon il s'agit d'une riposte. */
  atWar: boolean;
}

export interface WarInFlight {
  arriveAt: string;
  sentAt: string;
  attacker: { player: string; tag: string; village: string };
  target: { player: string; tag: string; village: string; x: number; y: number };
  units: number;
  nobles: number;
}

export interface WarFront {
  a: WarSide;
  b: WarSide;
  /** Guerre déclarée en cours (sinon ce front ne compte que des ripostes). */
  until: string | null;
  startedAt: string | null;
  battles: number;
  conquests: { a: number; b: number };
  wins: { a: number; b: number };
  /** Troupes perdues par chaque camp. */
  losses: { a: number; b: number };
  inFlight: number;
}

export interface WarLogLine {
  at: string;
  kind: 'declared' | 'ended';
  a: string;
  b: string;
}

export interface WarOverview {
  enabled: boolean;
  hours: number;
  now: string;
  fronts: WarFront[];
  /** Tribus de PNJ en trêve, avec la date de leur prochaine guerre possible. */
  truce: { tribe: WarSide; nextWarAt: string | null }[];
  battles: WarBattle[];
  inFlight: WarInFlight[];
  /** Batailles et conquêtes par heure, de la plus ancienne à la plus récente. */
  hourly: { hour: string; battles: number; conquests: number }[];
  log: WarLogLine[];
}

const sum = (u: Partial<UnitCounts> | null | undefined) => (u ? totalUnits(normalizeUnits(u)) : 0);
const pairKey = (a: number, b: number) => (a < b ? `${a}:${b}` : `${b}:${a}`);

/** Début de l'heure pleine contenant `d`. */
const hourStart = (d: Date) => new Date(Math.floor(d.getTime() / 3_600_000) * 3_600_000);

export async function warOverview(hours: number, now = new Date()): Promise<WarOverview> {
  const since = new Date(now.getTime() - hours * 3_600_000);
  const tribeRows = (
    await pool.query(
      `SELECT t.id, t.tag, t.name, t.npc_state,
              (SELECT count(*)::int FROM players p WHERE p.tribe_id = t.id) AS members,
              (SELECT count(*)::int FROM villages v JOIN players p ON p.id = v.owner_id WHERE p.tribe_id = t.id) AS villages,
              (SELECT coalesce(sum(v.points), 0)::int FROM villages v JOIN players p ON p.id = v.owner_id WHERE p.tribe_id = t.id) AS points
       FROM tribes t WHERE t.is_npc ORDER BY t.id`,
    )
  ).rows;
  const side = new Map<number, WarSide>(tribeRows.map((r) => [r.id, { id: r.id, tag: r.tag, name: r.name, members: r.members, villages: r.villages, points: r.points }]));
  const state = new Map<number, { war: { enemyId: number; until: string } | null; nextWarAt: string | null }>(
    tribeRows.map((r) => [r.id, { war: r.npc_state?.war ?? null, nextWarAt: r.npc_state?.nextWarAt ?? null }]),
  );
  const atWar = (a: number, b: number) => {
    const w = state.get(a)?.war;
    return !!w && w.enemyId === b && Date.parse(w.until) > now.getTime() && !!env.npcWars;
  };

  // Batailles entre PNJ de tribus différentes : le rapport de défense du PNJ attaqué contient les pertes des deux camps.
  const battleRows = (
    await pool.query(
      `SELECT r.created_at, r.data, d.username AS defender, d.tribe_id AS dt, a.username AS attacker, a.tribe_id AS at_
       FROM reports r
       JOIN players d ON d.id = r.player_id AND d.is_npc
       JOIN players a ON a.username = r.data->'attacker'->>'playerName' AND a.is_npc
       WHERE r.type = 'defense' AND r.created_at >= $1 AND d.tribe_id IS NOT NULL AND a.tribe_id IS NOT NULL AND d.tribe_id <> a.tribe_id
       ORDER BY r.created_at DESC LIMIT 500`,
      [since],
    )
  ).rows;
  const battles: WarBattle[] = battleRows.map((r) => ({
    at: new Date(r.created_at).toISOString(),
    attacker: { player: r.attacker, tribeId: r.at_, tag: side.get(r.at_)?.tag ?? '?', village: r.data.attacker.village.name },
    defender: { player: r.defender, tribeId: r.dt, tag: side.get(r.dt)?.tag ?? '?', village: r.data.defender.village.name },
    attackerWins: !!r.data.attackerWins,
    conquered: !!r.data.conquered,
    attackerLosses: sum(r.data.attacker.losses),
    defenderLosses: sum(r.data.defender.losses),
    atWar: atWar(r.at_, r.dt),
  }));

  // Attaques en route entre tribus de PNJ.
  const flightRows = (
    await pool.query(
      `SELECT cm.sent_at, cm.arrive_at, cm.units, a.username AS attacker, a.tribe_id AS at_, ov.name AS origin,
              d.username AS defender, d.tribe_id AS dt, tv.name AS target, tv.x, tv.y
       FROM commands cm
       JOIN players a ON a.id = cm.player_id AND a.is_npc
       JOIN villages ov ON ov.id = cm.origin_village_id
       JOIN villages tv ON tv.id = cm.target_village_id
       JOIN players d ON d.id = tv.owner_id AND d.is_npc
       WHERE cm.type = 'attack' AND NOT cm.processed AND ${REAL_ATTACK} AND a.tribe_id IS NOT NULL AND d.tribe_id IS NOT NULL AND a.tribe_id <> d.tribe_id
       ORDER BY cm.arrive_at LIMIT 100`,
    )
  ).rows;
  const inFlight: WarInFlight[] = flightRows.map((r) => ({
    arriveAt: new Date(r.arrive_at).toISOString(),
    sentAt: new Date(r.sent_at).toISOString(),
    attacker: { player: r.attacker, tag: side.get(r.at_)?.tag ?? '?', village: r.origin },
    target: { player: r.defender, tag: side.get(r.dt)?.tag ?? '?', village: r.target, x: r.x, y: r.y },
    units: sum(r.units),
    nobles: normalizeUnits(r.units).noble,
  }));

  // Fronts : chaque paire de tribus en guerre, ou qui s'est battue sur la période.
  const fronts = new Map<string, WarFront>();
  const front = (x: number, y: number) => {
    const [a, b] = x < y ? [x, y] : [y, x];
    const key = pairKey(a, b);
    let f = fronts.get(key);
    if (!f && side.has(a) && side.has(b)) {
      f = { a: side.get(a)!, b: side.get(b)!, until: null, startedAt: null, battles: 0, conquests: { a: 0, b: 0 }, wins: { a: 0, b: 0 }, losses: { a: 0, b: 0 }, inFlight: 0 };
      fronts.set(key, f);
    }
    return f;
  };
  if (env.npcWars) {
    for (const [id, st] of state) {
      if (st.war && Date.parse(st.war.until) > now.getTime()) {
        const f = front(id, st.war.enemyId);
        if (f) {
          f.until = st.war.until;
          f.startedAt = new Date(Date.parse(st.war.until) - WAR_DAYS * 86_400_000).toISOString();
        }
      }
    }
  }
  for (const b of battles) {
    const f = front(b.attacker.tribeId, b.defender.tribeId);
    if (!f) continue;
    const attIsA = f.a.id === b.attacker.tribeId;
    const [att, def] = attIsA ? (['a', 'b'] as const) : (['b', 'a'] as const);
    f.battles++;
    f.losses[att] += b.attackerLosses;
    f.losses[def] += b.defenderLosses;
    if (b.attackerWins) f.wins[att]++;
    else f.wins[def]++;
    if (b.conquered) f.conquests[att]++;
  }
  for (const r of flightRows) {
    const f = front(r.at_, r.dt);
    if (f) f.inFlight++;
  }

  const truce = tribeRows
    .filter((r) => !state.get(r.id)!.war || Date.parse(state.get(r.id)!.war!.until) <= now.getTime() || !env.npcWars)
    .map((r) => ({ tribe: side.get(r.id)!, nextWarAt: state.get(r.id)!.nextWarAt }));

  // Courbe horaire : de l'heure la plus ancienne à l'heure en cours.
  const first = hourStart(since).getTime();
  const last = hourStart(now).getTime();
  const hourly: WarOverview['hourly'] = [];
  for (let t = first; t <= last; t += 3_600_000) hourly.push({ hour: new Date(t).toISOString(), battles: 0, conquests: 0 });
  for (const b of battles) {
    const slot = hourly[Math.floor((hourStart(new Date(b.at)).getTime() - first) / 3_600_000)];
    if (!slot) continue;
    slot.battles++;
    if (b.conquered) slot.conquests++;
  }

  const log = (await pool.query('SELECT at, kind, tag_a, tag_b FROM npc_war_log WHERE at >= $1 ORDER BY at DESC LIMIT 100', [since])).rows.map((r) => ({
    at: new Date(r.at).toISOString(),
    kind: r.kind as 'declared' | 'ended',
    a: r.tag_a as string,
    b: r.tag_b as string,
  }));

  return {
    enabled: !!env.npcWars,
    hours,
    now: now.toISOString(),
    fronts: [...fronts.values()].sort((x, y) => Number(!!y.until) - Number(!!x.until) || y.battles - x.battles),
    truce,
    battles: battles.slice(0, 200),
    inFlight,
    hourly,
    log,
  };
}
