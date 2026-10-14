import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { CRUSADE_GLORY, GUARD_WAVE_SHARE, STARTING_BUILDINGS, citadelGarrison, emptyUnits, populationOf, productionRates, travelTime, type UnitCounts } from '@aldoria/shared';
import { pool, tx } from '../src/db';
import { env } from '../src/env';
import { migrate } from '../src/migrate';
import { Outbox } from '../src/notify';
import { processDueEvents, sendCommand } from '../src/game/commands';
import { announceCrusade, crusadeState, processCrusades } from '../src/game/crusades';
import { housekeeping } from '../src/game/housekeeping';
import { crusadeStep, departure, ORDER_LEAD_MS, plannedArrival, shouldJoin, strikeUnits } from '../src/game/npc-crusade';
import { npcTribeOf } from '../src/game/npc-tribes';
import { placeOrder } from '../src/game/orders';
import { createVillage, getTroops, loadVillage, syncVillage } from '../src/game/village';

const MIN = 60_000;
const T0 = new Date('2030-05-01T10:00:00Z');
const units = (u: Partial<UnitCounts>): UnitCounts => ({ ...emptyUnits(), ...u });
const at = (ms: number) => new Date(T0.getTime() + ms);

async function player(name: string, tribeId: number | null = null, npc = false) {
  return (await pool.query("INSERT INTO players (username, password_hash, tribe_id, is_npc) VALUES ($1, 'x', $2, $3) RETURNING id", [name, tribeId, npc])).rows[0].id as number;
}
async function tribe(name: string, tag: string, npc = false) {
  return (await pool.query('INSERT INTO tribes (name, tag, is_npc) VALUES ($1, $2, $3) RETURNING id', [name, tag, npc])).rows[0].id as number;
}
const village = (owner: number, x: number, y: number, troops: Partial<UnitCounts> = {}) =>
  tx((c) =>
    createVillage(c, { ownerId: owner, name: `V${x}-${y}`, x, y, buildings: { ...STARTING_BUILDINGS, warehouse: 10 }, resources: { wood: 500, clay: 500, iron: 500, wheat: 50_000 }, at: T0, troops: units(troops) }),
  );
const send = (playerId: number, from: number, to: number, type: 'attack' | 'support', u: Partial<UnitCounts>, now: Date, arriveAt?: Date) =>
  tx(async (c) => {
    const o = new Outbox();
    if (arriveAt) return placeOrder(c, o, playerId, from, { type, targetId: to, units: u, arriveAt }, now);
    return sendCommand(c, o, playerId, from, { type, targetId: to, units: u }, now);
  });
/** Fait avancer le monde pas à pas, pour que les ordres programmés partent à l'heure. */
async function runUntil(from: Date, to: Date) {
  for (let t = from.getTime(); t < to.getTime(); t += 1000) await processDueEvents(new Date(t));
  await processDueEvents(to);
}
const tick = (now: Date) => tx((c) => processCrusades(c, new Outbox(), now));

describe('croisades', () => {
  let citadelId: number;
  let crusadeId: number;
  let cx = 0;
  let cy = 0;
  const opens = at(60 * MIN);
  const closes = at(120 * MIN);

  beforeAll(async () => {
    await migrate(true);
    // Les croisades automatiques sont coupées : chaque test annonce la sienne.
    (env as any).crusades = 0;
    (env as any).crusadeGarrison = 60;
    await pool.query("INSERT INTO world_meta (key, value) VALUES ('started_at', $1)", [JSON.stringify(T0.toISOString())]);
    crusadeId = await tx((c) => announceCrusade(c, T0, opens, closes, () => 0.5));
    ({ village_id: citadelId, x: cx, y: cy } = (await pool.query('SELECT village_id, x, y FROM crusades WHERE id = $1', [crusadeId])).rows[0]);
  });
  afterAll(async () => {
    await pool.end();
  });

  it('la Citadelle est annoncée avec sa garnison, sa muraille 20 et un trésor', async () => {
    const v = await tx((c) => loadVillage(c, citadelId));
    expect(v.kind).toBe('citadel');
    expect(v.owner_id).toBeNull();
    expect(v.buildings.wall).toBe(20);
    const garrison = await tx((c) => getTroops(c, citadelId, citadelId));
    // Monde vide : la garnison minimale (4 000 places).
    expect(populationOf(garrison)).toBeGreaterThanOrEqual(3995);
    const state = await tx((c) => crusadeState(c, 0, T0));
    expect(state.current?.phase).toBe('announced');
    expect(state.log[0].kind).toBe('announce');
  });

  it('refuse une attaque qui arriverait avant l’ouverture, accepte les éclaireurs et un ordre programmé dans la fenêtre', async () => {
    const t = await tribe('Les Lions', 'LION');
    const p = await player('Godefroy', t);
    const v = await village(p, cx + 2, cy, { swordsman: 100, scout: 10 });
    await expect(send(p, v, citadelId, 'attack', { swordsman: 10 }, T0)).rejects.toThrow(/portes de la Citadelle/);
    await expect(send(p, v, citadelId, 'support', { swordsman: 10 }, T0, at(70 * MIN))).rejects.toThrow(/bannière/);
    await send(p, v, citadelId, 'attack', { scout: 5 }, T0);
    await send(p, v, citadelId, 'attack', { swordsman: 10 }, T0, at(70 * MIN));
    expect((await pool.query('SELECT count(*)::int AS n FROM planned_commands WHERE target_village_id = $1', [citadelId])).rows[0].n).toBe(1);
  });

  it('assaut complet : brèche, bannière plantée par un noble, renfort, puis victoire, gloire, relique, titres et trésor', async () => {
    // Garnison réduite pour le test, muraille à 3.
    await pool.query("UPDATE troops SET units = $2 WHERE village_id = $1 AND home_village_id = $1", [citadelId, JSON.stringify(units({ spearman: 100 }))]);
    await pool.query(`UPDATE villages SET buildings = jsonb_set(buildings, '{wall}', '3') WHERE id = $1`, [citadelId]);
    const lions = (await pool.query("SELECT id FROM tribes WHERE tag = 'LION'")).rows[0].id;
    const ours = await player('Tancrède', lions);
    const ally = await player('Bohémond', lions);
    const wolves = await tribe('Les Loups', 'LOUP');
    const rival = await player('Saladin', wolves);
    const a = await village(ours, cx + 1, cy, { swordsman: 2000, ram: 10, noble: 1 });
    const b = await village(ally, cx - 1, cy, { spearman: 500 });
    const r = await village(rival, cx, cy + 1, { swordsman: 300 });
    const target = await tx((c) => loadVillage(c, citadelId));
    const slow = travelTime(units({ noble: 1 }), await tx((c) => loadVillage(c, a)), target, env.worldSpeed) * 1000;

    // Assaut avec noble à H+5 min : brèche (6 béliers pour une muraille 3), garnison balayée, bannière plantée.
    const start = at(65 * MIN - slow - MIN);
    await send(ours, a, citadelId, 'attack', { swordsman: 2000, ram: 10, noble: 1 }, start, at(65 * MIN));
    await runUntil(new Date(start.getTime() + MIN - 2000), at(66 * MIN));
    let cr = (await pool.query('SELECT * FROM crusades WHERE id = $1', [crusadeId])).rows[0];
    expect(cr.breached_at).not.toBeNull();
    expect(cr.holder_tribe_id).toBe(lions);
    expect((await tx((c) => getTroops(c, citadelId, a))).noble).toBe(1);
    const score = (await pool.query('SELECT * FROM crusade_scores WHERE crusade_id = $1 AND player_id = $2', [crusadeId, ours])).rows[0];
    expect(score.breaches).toBe(1);
    expect(score.captures).toBe(1);
    expect(score.glory).toBe(Math.floor(100 / CRUSADE_GLORY.killsPerGlory) + CRUSADE_GLORY.breach + CRUSADE_GLORY.capture);

    // Un membre de la tribu renforce ; un adversaire attaque et se brise sur la défense.
    await send(ally, b, citadelId, 'support', { spearman: 500 }, at(66 * MIN));
    await send(rival, r, citadelId, 'attack', { swordsman: 300 }, at(67 * MIN));
    await processDueEvents(at(115 * MIN));
    expect((await tx((c) => getTroops(c, citadelId, b))).spearman).toBeGreaterThan(400);
    cr = (await pool.query('SELECT * FROM crusades WHERE id = $1', [crusadeId])).rows[0];
    expect(cr.holder_tribe_id).toBe(lions);
    // Les défenseurs gagnent de la gloire pour les attaquants tués.
    expect((await pool.query('SELECT glory FROM crusade_scores WHERE crusade_id = $1 AND player_id = $2', [crusadeId, ally])).rows[0].glory).toBeGreaterThan(0);

    // Fermeture des portes : victoire des Lions.
    await tick(closes);
    cr = (await pool.query('SELECT * FROM crusades WHERE id = $1', [crusadeId])).rows[0];
    expect(cr.status).toBe('ended');
    expect(cr.winner_tribe_id).toBe(lions);
    expect((await pool.query('SELECT relic_until FROM tribes WHERE id = $1', [lions])).rows[0].relic_until).not.toBeNull();
    const titles = (await pool.query('SELECT title FROM player_titles WHERE player_id = $1 ORDER BY title', [ours])).rows.map((x) => x.title);
    expect(titles).toEqual(expect.arrayContaining(['bearer', 'breaker', 'champion', 'crusader', 'keeper']));
    expect((await pool.query('SELECT 1 FROM player_titles WHERE player_id = $1 AND title = $2', [rival, 'keeper'])).rowCount).toBe(0);
    const glory = (await pool.query('SELECT player_id, glory FROM crusade_scores WHERE crusade_id = $1', [crusadeId])).rows;
    expect(glory.find((g) => g.player_id === ally).glory).toBeGreaterThanOrEqual(CRUSADE_GLORY.victory);
    // Compte rendu avec le trésor, troupes de la Citadelle en route vers chez elles, ordre programmé non parti annulé.
    expect((await pool.query("SELECT data FROM reports WHERE player_id = $1 AND type = 'crusade'", [ours])).rows[0].data.treasure).toBeGreaterThan(0);
    expect((await pool.query('SELECT count(*)::int AS n FROM troops WHERE village_id = $1', [citadelId])).rows[0].n).toBe(0);
    expect((await pool.query("SELECT count(*)::int AS n FROM commands WHERE type = 'return' AND origin_village_id = $1 AND NOT processed", [citadelId])).rows[0].n).toBe(3);
    expect((await pool.query('SELECT count(*)::int AS n FROM planned_commands WHERE target_village_id = $1', [citadelId])).rows[0].n).toBe(0);

    // La relique augmente la production de 5 % ; elle apparaît dans l'état du village.
    const before = await tx((c) => syncVillage(c, a, closes));
    const later = await tx((c) => syncVillage(c, a, new Date(closes.getTime() + 3_600_000)));
    const base = productionRates(before.buildings, env.worldSpeed).wood;
    expect(later.wood - before.wood).toBeCloseTo(base * 1.05, 3);

    // Une attaque qui arrive après la fermeture fait demi-tour.
    await processDueEvents(new Date(closes.getTime() + 2 * 3_600_000));
    // Une fois toutes les troupes rentrées, la Citadelle disparaît de la carte.
    await tick(new Date(closes.getTime() + 3 * 3_600_000));
    expect((await pool.query('SELECT 1 FROM villages WHERE id = $1', [citadelId])).rowCount).toBe(0);
  });

  it('annonce automatiquement la croisade suivante aux jours et à l’heure prévus', async () => {
    (env as any).crusades = 1;
    (env as any).crusadeDays = '3';
    (env as any).crusadeTime = '20:30';
    (env as any).crusadeNoticeHours = 48;
    // Lundi 6 mai 2030, 21 h : mercredi 20 h 30 est à moins de 48 h.
    const monday = new Date('2030-05-06T19:00:00Z');
    await tick(monday);
    const cr = (await pool.query("SELECT * FROM crusades WHERE status = 'announced' ORDER BY id DESC LIMIT 1")).rows[0];
    expect(new Date(cr.opens_at).toISOString()).toBe('2030-05-08T18:30:00.000Z');
    (env as any).crusades = 0;
  });

  it('PNJ : une tribu engagée programme son assaut au point de ralliement dans la demi-heure qui précède le départ', async () => {
    (env as any).crusades = 1;
    const cr = (await pool.query("SELECT * FROM crusades WHERE status = 'announced' ORDER BY id DESC LIMIT 1")).rows[0];
    expect(shouldJoin(units({ swordsman: 10 }), units({ spearman: 1000 }), 20)).toBe(false);
    expect(shouldJoin(units({ swordsman: 20_000, ram: 210 }), units({ spearman: 1000 }), 20)).toBe(true);
    const opensMs = new Date(cr.opens_at).getTime();
    expect(departure(opensMs - 5 * 3_600_000, opensMs + MIN, 3_600_000, opensMs + 60 * MIN)).toBeNull();
    expect(departure(opensMs - 3_600_000 - ORDER_LEAD_MS / 2, opensMs + MIN, 3_600_000, opensMs + 60 * MIN)).toEqual({ arriveAt: opensMs + MIN });

    const t = await tribe('Compagnie du Nord', 'NORD', true);
    const npc = await player('Elrond', t, true);
    await pool.query('UPDATE tribes SET leader_id = $2 WHERE id = $1', [t, npc]);
    const off = await village(npc, cr.x + 3, cr.y, { swordsman: 30_000, cavalry: 2000, ram: 300, scout: 10 });
    const info = await tx((c) => npcTribeOf(c, npc));
    // Bien avant : décision et espionnage seulement.
    const early = new Date(opensMs - 10 * 3_600_000);
    await tx((c) => crusadeStep(c, new Outbox(), npc, [{ id: off, role: 'offense' }], info, early));
    expect((await tx((c) => npcTribeOf(c, npc)))!.state).toMatchObject({ crusade: { id: cr.id, join: true, sent: [] } });
    expect((await pool.query("SELECT count(*)::int AS n FROM commands WHERE player_id = $1 AND target_village_id = $2", [npc, cr.village_id])).rows[0].n).toBe(1);
    // Peu avant l'ouverture : l'assaut est programmé pour arriver juste après l'ouverture.
    const travel = travelTime(strikeUnits(units({ swordsman: 30_000, cavalry: 2000, ram: 300 })), await tx((c) => loadVillage(c, off)), cr, env.worldSpeed) * 1000;
    const soon = new Date(plannedArrival(opensMs, 0, false) - travel - 10 * MIN);
    await tx(async (c) => crusadeStep(c, new Outbox(), npc, [{ id: off, role: 'offense' }], await npcTribeOf(c, npc), soon));
    const planned = (await pool.query('SELECT units, arrive_at FROM planned_commands WHERE player_id = $1', [npc])).rows;
    const dispatched = (await pool.query("SELECT units, arrive_at FROM commands WHERE player_id = $1 AND target_village_id = $2 AND coalesce((units->>'swordsman')::int, 0) > 0", [npc, cr.village_id])).rows;
    const all = [...planned, ...dispatched];
    expect(all).toHaveLength(1);
    expect(new Date(all[0].arrive_at).getTime()).toBeGreaterThanOrEqual(opensMs);
    expect(all[0].units).toMatchObject(strikeUnits(units({ swordsman: 30_000, cavalry: 2000, ram: 300 })));
    (env as any).crusades = 0;
  });

  it('la Garde regarnit la Citadelle toutes les 15 minutes de l’assaut, sauf quand une bannière flotte', async () => {
    const cr = (await pool.query("SELECT * FROM crusades WHERE status = 'announced' ORDER BY id DESC LIMIT 1")).rows[0];
    const opensMs = new Date(cr.opens_at).getTime();
    const pop = async () => populationOf(await tx((c) => getTroops(c, cr.village_id, cr.village_id)));
    const start = await pop();
    const wave = populationOf(citadelGarrison(populationOf(cr.garrison) * GUARD_WAVE_SHARE));
    await tick(new Date(opensMs + MIN));
    expect(await pop()).toBe(start);
    await tick(new Date(opensMs + 16 * MIN));
    expect(await pop()).toBe(start + wave);
    // Un second passage ne rajoute rien.
    await tick(new Date(opensMs + 17 * MIN));
    expect(await pop()).toBe(start + wave);
    // Bannière plantée : la vague de 30 minutes est perdue.
    const holder = await player('Porte-bannière');
    await pool.query('UPDATE crusades SET holder_player_id = $2, holder_since = $3 WHERE id = $1', [cr.id, holder, new Date(opensMs + 20 * MIN)]);
    await tick(new Date(opensMs + 31 * MIN));
    expect(await pop()).toBe(start + wave);
    // Bannière abattue : la Garde revient à 45 minutes, sans rattraper la vague perdue.
    await pool.query('UPDATE crusades SET holder_player_id = NULL, holder_since = NULL WHERE id = $1', [cr.id]);
    await tick(new Date(opensMs + 46 * MIN));
    expect(await pop()).toBe(start + 2 * wave);
    expect((await pool.query("SELECT count(*)::int AS n FROM crusade_log WHERE crusade_id = $1 AND kind = 'guard'", [cr.id])).rows[0].n).toBe(2);
  });

  it('ménage : les vieux mouvements terminés et les vieux rapports non archivés disparaissent', async () => {
    const p = await player('Archiviste');
    const v = await village(p, 40, 40);
    const old = new Date(Date.now() - 40 * 86_400_000);
    await pool.query(
      "INSERT INTO commands (type, player_id, origin_village_id, home_village_id, target_village_id, units, sent_at, arrive_at, processed) VALUES ('return', $1, $2, $2, $2, '{}', $3, $3, true)",
      [p, v, old],
    );
    await pool.query("INSERT INTO reports (player_id, type, title, data, created_at) VALUES ($1, 'trade', 'vieux', '{}', $2), ($1, 'trade', 'gardé', '{}', $2), ($1, 'trade', 'récent', '{}', now())", [p, old]);
    await pool.query("UPDATE reports SET archived = true WHERE player_id = $1 AND title = 'gardé'", [p]);
    const done = await housekeeping(new Date());
    expect(done.commands).toBeGreaterThanOrEqual(1);
    expect((await pool.query('SELECT title FROM reports WHERE player_id = $1 ORDER BY title', [p])).rows.map((r) => r.title)).toEqual(['gardé', 'récent']);
  });
});
