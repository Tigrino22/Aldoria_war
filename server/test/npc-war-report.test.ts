import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { STARTING_BUILDINGS, emptyUnits } from '@aldoria/shared';
import { pool, tx } from '../src/db';
import { migrate } from '../src/migrate';
import { warOverview } from '../src/game/npc-war-report';
import { refreshWars, warLogEntries, type WarTribe } from '../src/game/npc-wars';
import { createVillage } from '../src/game/village';

const NOW = new Date('2030-03-01T12:00:00Z');
const tribe = (id: number, over: Partial<WarTribe> = {}): WarTribe => ({ id, allies: [], rivals: [], war: null, nextWarAt: null, villages: 2, ...over });

describe('journal des guerres : règles pures', () => {
  it('une entrée par paire de tribus, à la déclaration comme à la fin', () => {
    const until = NOW.toISOString();
    const declared = warLogEntries([tribe(1), tribe(2)], [
      { id: 1, war: { enemyId: 2, until }, nextWarAt: null },
      { id: 2, war: { enemyId: 1, until }, nextWarAt: null },
    ]);
    expect(declared).toEqual([{ kind: 'declared', tribeA: 1, tribeB: 2 }]);
    const ended = warLogEntries([tribe(1, { war: { enemyId: 2, until } }), tribe(2, { war: { enemyId: 1, until } })], [
      { id: 2, war: null, nextWarAt: until },
      { id: 1, war: null, nextWarAt: until },
    ]);
    expect(ended).toEqual([{ kind: 'ended', tribeA: 1, tribeB: 2 }]);
    // Une simple mise à jour de date de guerre future ne produit rien.
    expect(warLogEntries([tribe(1)], [{ id: 1, war: null, nextWarAt: until }])).toEqual([]);
  });
});

describe('suivi des guerres dans l’administration', () => {
  beforeAll(async () => {
    await migrate(true);
  });
  afterAll(async () => {
    await pool.end();
  });

  const tribeRow = async (tag: string, state: object = {}) =>
    (await pool.query('INSERT INTO tribes (name, tag, is_npc, npc_state) VALUES ($1, $2, true, $3) RETURNING id', [`Tribu ${tag}`, tag, JSON.stringify(state)])).rows[0].id as number;
  const npc = async (name: string, tribeId: number) =>
    (await pool.query("INSERT INTO players (username, password_hash, is_npc, tribe_id) VALUES ($1, 'x', true, $2) RETURNING id", [name, tribeId])).rows[0].id as number;
  const village = (owner: number, x: number, y: number) =>
    tx((c) => createVillage(c, { ownerId: owner, name: `V${x}-${y}`, x, y, buildings: { ...STARTING_BUILDINGS }, resources: { wood: 1, clay: 1, iron: 1, wheat: 1 }, at: NOW, troops: emptyUnits() }));
  const report = (playerId: number, at: Date, data: object) =>
    pool.query("INSERT INTO reports (player_id, type, title, data, created_at) VALUES ($1, 'defense', 't', $2, $3)", [playerId, JSON.stringify(data), at]);
  const data = (attacker: string, aVillage: string, defender: string, dVillage: string, aLoss: number, dLoss: number, over: object = {}) => ({
    attackerWins: true,
    conquered: false,
    attacker: { playerName: attacker, village: { name: aVillage }, losses: { ...emptyUnits(), swordsman: aLoss } },
    defender: { playerName: defender, village: { name: dVillage }, losses: { ...emptyUnits(), spearman: dLoss } },
    ...over,
  });

  it('résume les fronts, les batailles, les conquêtes, les pertes et les attaques en route', async () => {
    const until = new Date(NOW.getTime() + 2 * 86_400_000).toISOString();
    const tA = await tribeRow('AAA', { war: { enemyId: 0, until } });
    const tB = await tribeRow('BBB', { war: { enemyId: tA, until } });
    await pool.query("UPDATE tribes SET npc_state = jsonb_build_object('war', jsonb_build_object('enemyId', $2::int, 'until', $3::text)) WHERE id = $1", [tA, tB, until]);
    const tC = await tribeRow('CCC');
    const alpha = await npc('Alpha', tA);
    const beta = await npc('Beta', tB);
    const gamma = await npc('Gamma', tC);
    const va = await village(alpha, 5, 5);
    const vb = await village(beta, 8, 5);
    await village(gamma, 20, 20);

    // A frappe B (victoire, puis conquête), B repousse une attaque de A ; une attaque il y a 30 h sort de la période de 24 h.
    await report(beta, new Date(NOW.getTime() - 3_600_000), data('Alpha', 'V5-5', 'Beta', 'V8-5', 4, 10));
    await report(beta, new Date(NOW.getTime() - 1_800_000), data('Alpha', 'V5-5', 'Beta', 'V8-5', 6, 20, { conquered: true }));
    await report(alpha, new Date(NOW.getTime() - 900_000), data('Beta', 'V8-5', 'Alpha', 'V5-5', 30, 5, { attackerWins: false }));
    await report(beta, new Date(NOW.getTime() - 30 * 3_600_000), data('Alpha', 'V5-5', 'Beta', 'V8-5', 1, 1));
    // Une attaque d'un PNJ sur un joueur d'une même tribu ne compte pas.
    const mate = await npc('Mate', tA);
    await report(mate, new Date(NOW.getTime() - 600_000), data('Alpha', 'V5-5', 'Mate', 'x', 1, 1));
    await pool.query(
      `INSERT INTO commands (type, origin_village_id, target_village_id, home_village_id, player_id, units, sent_at, arrive_at)
       VALUES ('attack', $1, $2, $1, $3, '{"swordsman":10,"noble":1}', $4, $5)`,
      [va, vb, alpha, new Date(NOW.getTime() - 60_000), new Date(NOW.getTime() + 600_000)],
    );

    const o = await warOverview(24, NOW);
    expect(o.battles).toHaveLength(3);
    expect(o.battles.every((b) => b.atWar)).toBe(true);
    const f = o.fronts.find((x) => x.a.id === tA && x.b.id === tB)!;
    expect(f.until).toBe(until);
    expect(f.battles).toBe(3);
    expect(f.conquests).toEqual({ a: 1, b: 0 });
    expect(f.wins).toEqual({ a: 3, b: 0 });
    expect(f.losses).toEqual({ a: 4 + 6 + 5, b: 10 + 20 + 30 });
    expect(f.inFlight).toBe(1);
    expect(o.inFlight[0]).toMatchObject({ units: 11, nobles: 1, attacker: { player: 'Alpha', tag: 'AAA' }, target: { player: 'Beta', tag: 'BBB' } });
    expect(o.truce.map((t) => t.tribe.tag)).toEqual(['CCC']);
    expect(o.hourly.reduce((n, h) => n + h.battles, 0)).toBe(3);
    expect(o.hourly.reduce((n, h) => n + h.conquests, 0)).toBe(1);
  });

  it('suit aussi les guerres entre une tribu de PNJ et une tribu de joueurs', async () => {
    const tN = await tribeRow('NPT');
    const attacker = await npc('Agresseur', tN);
    const vn = await village(attacker, 80, 80);
    const tP = (await pool.query("INSERT INTO tribes (name, tag, is_npc) VALUES ('Tribu joueurs', 'JOU', false) RETURNING id")).rows[0].id as number;
    const human = (await pool.query("INSERT INTO players (username, password_hash, tribe_id) VALUES ('Joueur Z', 'x', $1) RETURNING id", [tP])).rows[0].id as number;
    const vh = await village(human, 84, 80);
    const free = (await pool.query("INSERT INTO tribes (name, tag, is_npc) VALUES ('Autre', 'AUT', false) RETURNING id")).rows[0].id as number;
    await pool.query("UPDATE players SET tribe_id = $1 WHERE username = 'Joueur Z'", [tP]);
    await pool.query("INSERT INTO tribe_wars (declarer_id, target_id, started_at, until) VALUES ($1, $2, $3, $4)", [tN, tP, new Date(NOW.getTime() - 3_600_000), new Date(NOW.getTime() + 86_400_000)]);
    // Le rapport de l'attaquant PNJ ; une attaque sur un joueur d'une tribu sans guerre ne compte pas.
    await pool.query(
      "INSERT INTO reports (player_id, type, title, data, created_at) VALUES ($1, 'attack', 't', $2, $3)",
      [attacker, JSON.stringify(data('Agresseur', 'V80-80', 'Joueur Z', 'V84-80', 7, 12, { conquered: true })), new Date(NOW.getTime() - 600_000)],
    );
    await pool.query(
      `INSERT INTO commands (type, origin_village_id, target_village_id, home_village_id, player_id, units, sent_at, arrive_at)
       VALUES ('attack', $1, $2, $1, $3, '{"cavalry":25}', $4, $5)`,
      [vn, vh, attacker, new Date(NOW.getTime() - 60_000), new Date(NOW.getTime() + 300_000)],
    );
    const o = await warOverview(24, NOW);
    const f = o.fronts.find((x) => [x.a.id, x.b.id].includes(tP))!;
    expect(f.until).not.toBeNull();
    expect([f.a.isNpc, f.b.isNpc].sort()).toEqual([false, true]);
    expect(f.battles).toBe(1);
    expect(f.conquests.a + f.conquests.b).toBe(1);
    expect(f.inFlight).toBe(1);
    expect(o.battles.find((b) => b.defender.player === 'Joueur Z')).toMatchObject({ conquered: true, atWar: true, attackerLosses: 7, defenderLosses: 12 });
    expect(o.inFlight.find((x) => x.target.player === 'Joueur Z')!.units).toBe(25);
    expect(free).toBeGreaterThan(0);
  });

  it('refreshWars écrit les déclarations dans le journal', async () => {
    await pool.query("DELETE FROM tribes WHERE tag IN ('AAA','BBB','CCC','NPT','JOU','AUT')");
    const x = await tribeRow('XXX', { nextWarAt: new Date(NOW.getTime() - 1000).toISOString() });
    const y = await tribeRow('YYY', { nextWarAt: new Date(NOW.getTime() + 1e10).toISOString() });
    await village(await npc('Xavier', x), 40, 40);
    await village(await npc('Yvon', y), 44, 40);
    await refreshWars(NOW, () => 0);
    const { rows } = await pool.query('SELECT kind, tag_a, tag_b FROM npc_war_log ORDER BY id');
    expect(rows).toEqual([{ kind: 'declared', tag_a: 'XXX', tag_b: 'YYY' }]);
    expect((await warOverview(24, NOW)).log).toHaveLength(1);
  });
});
