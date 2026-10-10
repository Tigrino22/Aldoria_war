import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { emptyUnits, STARTING_BUILDINGS } from '@aldoria/shared';
import { buildApp } from '../src/app';
import { pool, tx } from '../src/db';
import { migrate } from '../src/migrate';
import { Outbox } from '../src/notify';
import { processDueEvents, sendCommand, sendTrade, setRandom } from '../src/game/commands';
import { createVillage, enqueueBuild, enqueueRecruit, getTroops, syncVillage } from '../src/game/village';

let app: Awaited<ReturnType<typeof buildApp>>;
const HOUR = 3_600_000;
const auth = (t: string) => ({ authorization: `Bearer ${t}` });

async function register(username: string) {
  const res = await app.inject({ method: 'POST', url: '/api/auth/register', payload: { username, password: 'secret123' } });
  expect(res.statusCode).toBe(200);
  const token = res.json().token as string;
  const me = await app.inject({ method: 'GET', url: '/api/me', headers: { authorization: `Bearer ${token}` } });
  return { token, me: me.json() };
}

async function makePlayer(name: string, protectedPlayer = false) {
  const { rows } = await pool.query(
    "INSERT INTO players (username, password_hash, protection_until) VALUES ($1, 'x', $2) RETURNING id",
    [name, protectedPlayer ? new Date(Date.now() + 100 * HOUR) : null],
  );
  return rows[0].id as number;
}

describe('jeu', () => {
  beforeAll(async () => {
    await migrate(true);
    app = await buildApp();
  });
  afterAll(async () => {
    await app.close();
    await pool.end();
  });

  it("l'inscription crée un village de départ", async () => {
    const { token, me } = await register('Arthur');
    expect(me.player.username).toBe('Arthur');
    expect(me.villages).toHaveLength(1);
    const v = await app.inject({ method: 'GET', url: `/api/villages/${me.villages[0].id}`, headers: { authorization: `Bearer ${token}` } });
    expect(v.statusCode).toBe(200);
    expect(v.json().buildings.townhall).toBe(1);
    expect(Math.round(v.json().resources.wood)).toBe(500);

    const dup = await app.inject({ method: 'POST', url: '/api/auth/register', payload: { username: 'arthur', password: 'secret123' } });
    expect(dup.statusCode).toBe(400);
  });

  it("refuse l'accès au village d'un autre joueur", async () => {
    const a = await register('Lancelot');
    const b = await register('Perceval');
    const res = await app.inject({ method: 'GET', url: `/api/villages/${a.me.villages[0].id}`, headers: { authorization: `Bearer ${b.token}` } });
    expect(res.statusCode).toBe(403);
  });

  it('les ressources s’accumulent et les constructions se terminent avec le temps', async () => {
    const owner = await makePlayer('Bâtisseur');
    const t0 = new Date('2030-01-01T00:00:00Z');
    const id = await tx((c) =>
      createVillage(c, { ownerId: owner, name: 'Test', x: 1, y: 1, buildings: { ...STARTING_BUILDINGS }, resources: { wood: 100, clay: 100, iron: 100, wheat: 100 }, at: t0 }),
    );
    const v1 = await tx((c) => syncVillage(c, id, new Date(t0.getTime() + HOUR)));
    expect(Math.round(v1.wood)).toBe(130);

    await tx((c) => enqueueBuild(c, id, 'woodcutter', new Date(t0.getTime() + HOUR)));
    const mid = await tx((c) => syncVillage(c, id, new Date(t0.getTime() + HOUR + 60_000)));
    expect(mid.buildings.woodcutter).toBe(1);
    const done = await tx((c) => syncVillage(c, id, new Date(t0.getTime() + 2 * HOUR)));
    expect(done.buildings.woodcutter).toBe(2);
  });

  it('le recrutement livre les unités au fil du temps et respecte la ferme', async () => {
    const owner = await makePlayer('Recruteur');
    const t0 = new Date('2030-01-01T00:00:00Z');
    const id = await tx((c) =>
      createVillage(c, { ownerId: owner, name: 'Caserne', x: 2, y: 2, buildings: { ...STARTING_BUILDINGS, barracks: 1 }, resources: { wood: 5000, clay: 5000, iron: 5000, wheat: 5000 }, at: t0 }),
    );
    await expect(tx((c) => enqueueRecruit(c, id, 'spearman', 50, t0))).rejects.toThrow(/blé/);
    await tx((c) => enqueueRecruit(c, id, 'spearman', 10, t0));
    await tx((c) => syncVillage(c, id, new Date(t0.getTime() + 180_000 * 3 + 1000)));
    expect((await tx((c) => getTroops(c, id, id))).spearman).toBe(3);
    await tx((c) => syncVillage(c, id, new Date(t0.getTime() + HOUR)));
    expect((await tx((c) => getTroops(c, id, id))).spearman).toBe(10);
  });

  it('une attaque pille, revient avec le butin, et des nobles conquièrent le village', async () => {
    setRandom(() => 0.999);
    const attacker = await makePlayer('Conquérant');
    const defender = await makePlayer('Victime');
    const t0 = new Date(Date.now() - 10 * HOUR);
    const big = { ...STARTING_BUILDINGS, warehouse: 10 };
    const home = await tx((c) =>
      createVillage(c, { ownerId: attacker, name: 'Base', x: 10, y: 10, buildings: big, resources: { wood: 0, clay: 0, iron: 0, wheat: 0 }, at: t0, troops: { ...emptyUnits(), swordsman: 200, noble: 3 } }),
    );
    const target = await tx((c) =>
      createVillage(c, { ownerId: defender, name: 'Cible', x: 12, y: 10, buildings: { ...STARTING_BUILDINGS }, resources: { wood: 800, clay: 800, iron: 800, wheat: 800 }, at: t0, troops: { ...emptyUnits(), spearman: 10 } }),
    );

    // Premier raid : épéistes seuls.
    const { arriveAt } = await tx((c) => sendCommand(c, new Outbox(), attacker, home, { type: 'attack', targetId: target, units: { swordsman: 100 } }, t0));
    expect(arriveAt.getTime() - t0.getTime()).toBe(2 * 22 * 60 * 1000);
    await processDueEvents(new Date(arriveAt.getTime() + 1));
    const report = (await pool.query("SELECT data FROM reports WHERE player_id = $1 AND type = 'attack'", [attacker])).rows[0].data;
    expect(report.attackerWins).toBe(true);
    expect(report.defender.losses.spearman).toBe(10);
    const lootTotal = report.loot.wood + report.loot.clay + report.loot.iron + report.loot.wheat;
    expect(lootTotal).toBeGreaterThan(0);

    // Le retour ramène les survivants et le butin.
    await processDueEvents(new Date(arriveAt.getTime() + 3 * HOUR));
    const back = await tx((c) => getTroops(c, home, home));
    expect(back.swordsman).toBe(200 - report.attacker.losses.swordsman);

    // Conquête : 3 nobles × 35 de loyauté.
    const t1 = new Date(arriveAt.getTime() + 3 * HOUR);
    const second = await tx((c) =>
      sendCommand(c, new Outbox(), attacker, home, { type: 'attack', targetId: target, units: { swordsman: 50, noble: 3 } }, t1),
    );
    await processDueEvents(new Date(second.arriveAt.getTime() + 1));
    const owner = (await pool.query('SELECT owner_id, loyalty FROM villages WHERE id = $1', [target])).rows[0];
    expect(owner.owner_id).toBe(attacker);
    expect(owner.loyalty).toBe(25);
    const garrison = await tx((c) => getTroops(c, target, target));
    expect(garrison.noble).toBe(2);
    const defenderReport = (await pool.query("SELECT title FROM reports WHERE player_id = $1 ORDER BY id DESC LIMIT 1", [defender])).rows[0];
    expect(defenderReport.title).toMatch(/conquis/);
  });

  it('les renforts défendent un allié', async () => {
    const a = await makePlayer('Allié');
    const b = await makePlayer('Protégé');
    const e = await makePlayer('Ennemi');
    const t0 = new Date(Date.now() - 10 * HOUR);
    const mk = (owner: number, x: number, troops: any) =>
      tx((c) => createVillage(c, { ownerId: owner, name: 'V', x, y: 30, buildings: { ...STARTING_BUILDINGS }, resources: { wood: 0, clay: 0, iron: 0, wheat: 0 }, at: t0, troops: { ...emptyUnits(), ...troops } }));
    const va = await mk(a, 30, { spearman: 300 });
    const vb = await mk(b, 32, {});
    const ve = await mk(e, 34, { swordsman: 100 });
    const s = await tx((c) => sendCommand(c, new Outbox(), a, va, { type: 'support', targetId: vb, units: { spearman: 300 } }, t0));
    await processDueEvents(new Date(s.arriveAt.getTime() + 1));
    const atk = await tx((c) => sendCommand(c, new Outbox(), e, ve, { type: 'attack', targetId: vb, units: { swordsman: 100 } }, new Date(s.arriveAt.getTime() + 1000)));
    await processDueEvents(new Date(atk.arriveAt.getTime() + 1));
    const r = (await pool.query("SELECT data FROM reports WHERE player_id = $1 AND type = 'attack'", [e])).rows[0].data;
    expect(r.attackerWins).toBe(false);
    const supportReports = (await pool.query("SELECT title FROM reports WHERE player_id = $1 AND title LIKE 'Vos renforts à%'", [a])).rows;
    expect(supportReports).toHaveLength(1);
  });

  it('les marchands livrent des ressources puis rentrent', async () => {
    const a = await makePlayer('Marchand');
    const b = await makePlayer('Client');
    const t0 = new Date(Date.now() - 10 * HOUR);
    const va = await tx((c) => createVillage(c, { ownerId: a, name: 'Comptoir', x: 50, y: 60, buildings: { ...STARTING_BUILDINGS, market: 1 }, resources: { wood: 900, clay: 900, iron: 900, wheat: 900 }, at: t0 }));
    const vb = await tx((c) => createVillage(c, { ownerId: b, name: 'Client', x: 53, y: 64, buildings: { ...STARTING_BUILDINGS }, resources: { wood: 0, clay: 0, iron: 0, wheat: 0 }, at: t0 }));
    // Un marché niveau 1 n'a qu'un marchand : 1000 ressources maximum.
    await expect(tx((c) => sendTrade(c, new Outbox(), a, va, { targetId: vb, resources: { wood: 600, clay: 600, iron: 0, wheat: 0 } }, t0))).rejects.toThrow(/marchand/);
    const t = await tx((c) => sendTrade(c, new Outbox(), a, va, { targetId: vb, resources: { wood: 600, clay: 400, iron: 0, wheat: 0 } }, t0));
    // 5 cases × 6 min, vitesse x1 en test.
    expect(t.arriveAt.getTime() - t0.getTime()).toBe(5 * 6 * 60 * 1000);
    await expect(tx((c) => sendTrade(c, new Outbox(), a, va, { targetId: vb, resources: { wood: 10, clay: 0, iron: 0, wheat: 0 } }, t0))).rejects.toThrow(/marchand/);
    await processDueEvents(new Date(t.arriveAt.getTime() + 1));
    const got = (await pool.query('SELECT wood, clay FROM villages WHERE id = $1', [vb])).rows[0];
    expect(Math.floor(got.wood)).toBeGreaterThanOrEqual(600);
    expect(Math.floor(got.clay)).toBeGreaterThanOrEqual(400);
    const reports = (await pool.query("SELECT player_id FROM reports WHERE type = 'trade' AND player_id = ANY($1)", [[a, b]])).rows;
    expect(reports).toHaveLength(2);
    // Le marchand rentre : il est de nouveau disponible.
    await processDueEvents(new Date(t.arriveAt.getTime() + 2 * 30 * 60 * 1000));
    await tx((c) => sendTrade(c, new Outbox(), a, va, { targetId: vb, resources: { wood: 10, clay: 0, iron: 0, wheat: 0 } }, new Date(t.arriveAt.getTime() + 2 * 30 * 60 * 1000)));
  });

  it("les éclaireurs espionnent sans combattre, et la défense en tue s'il y en a", async () => {
    const a = await makePlayer('Espion');
    const d = await makePlayer('Guetteur');
    const t0 = new Date(Date.now() - 10 * HOUR);
    const va = await tx((c) => createVillage(c, { ownerId: a, name: 'Nid', x: 70, y: 70, buildings: { ...STARTING_BUILDINGS }, resources: { wood: 0, clay: 0, iron: 0, wheat: 0 }, at: t0, troops: { ...emptyUnits(), scout: 10 } }));
    const vd = await tx((c) => createVillage(c, { ownerId: d, name: 'Tour', x: 72, y: 70, buildings: { ...STARTING_BUILDINGS, wall: 3 }, resources: { wood: 700, clay: 700, iron: 700, wheat: 700 }, at: t0, troops: { ...emptyUnits(), spearman: 50, scout: 4 } }));
    const s = await tx((c) => sendCommand(c, new Outbox(), a, va, { type: 'attack', targetId: vd, units: { scout: 10 } }, t0));
    await processDueEvents(new Date(s.arriveAt.getTime() + 1));
    const r = (await pool.query("SELECT data FROM reports WHERE player_id = $1 AND type = 'scout'", [a])).rows[0].data;
    // (4/10)^1.5 × 10 ≈ 3 éclaireurs perdus, les lanciers ne bougent pas.
    expect(r.attacker.losses.scout).toBe(3);
    expect(r.intel.troops.spearman).toBe(50);
    expect(r.intel.buildings.wall).toBe(3);
    expect(r.intel.resources.wood).toBeGreaterThanOrEqual(700);
    const defTroops = await tx((c) => getTroops(c, vd, vd));
    expect(defTroops.spearman).toBe(50);
    const warned = (await pool.query("SELECT id FROM reports WHERE player_id = $1 AND type = 'scout'", [d])).rows;
    expect(warned).toHaveLength(1);
  });

  it('les béliers abaissent puis détruisent la muraille', async () => {
    const a = await makePlayer('Assiégeant');
    const t0 = new Date(Date.now() - 10 * HOUR);
    const va = await tx((c) => createVillage(c, { ownerId: a, name: 'Camp', x: 80, y: 20, buildings: { ...STARTING_BUILDINGS }, resources: { wood: 0, clay: 0, iron: 0, wheat: 0 }, at: t0, troops: { ...emptyUnits(), swordsman: 300, ram: 20 } }));
    const vb = await tx((c) => createVillage(c, { ownerId: null, name: 'Fort', x: 81, y: 20, buildings: { ...STARTING_BUILDINGS, wall: 10 }, resources: { wood: 0, clay: 0, iron: 0, wheat: 0 }, at: t0, troops: { ...emptyUnits(), spearman: 20 } }));
    const s = await tx((c) => sendCommand(c, new Outbox(), a, va, { type: 'attack', targetId: vb, units: { swordsman: 300, ram: 20 } }, t0));
    await processDueEvents(new Date(s.arriveAt.getTime() + 1));
    const r = (await pool.query("SELECT data FROM reports WHERE player_id = $1 AND type = 'attack' ORDER BY id DESC LIMIT 1", [a])).rows[0].data;
    expect(r.attackerWins).toBe(true);
    expect(r.wallDamage.before).toBe(10);
    expect(r.wallDamage.after).toBeLessThan(10);
    const wall = (await pool.query('SELECT buildings FROM villages WHERE id = $1', [vb])).rows[0].buildings.wall;
    expect(wall).toBe(r.wallDamage.after);
  });

  it('la protection débutant empêche les attaques', async () => {
    const a = await makePlayer('Agresseur');
    const b = await makePlayer('Nouveau', true);
    const t0 = new Date();
    const va = await tx((c) => createVillage(c, { ownerId: a, name: 'A', x: 40, y: 40, buildings: { ...STARTING_BUILDINGS }, resources: { wood: 0, clay: 0, iron: 0, wheat: 0 }, at: t0, troops: { ...emptyUnits(), swordsman: 5 } }));
    const vb = await tx((c) => createVillage(c, { ownerId: b, name: 'B', x: 41, y: 40, buildings: { ...STARTING_BUILDINGS }, resources: { wood: 0, clay: 0, iron: 0, wheat: 0 }, at: t0 }));
    await expect(tx((c) => sendCommand(c, new Outbox(), a, va, { type: 'attack', targetId: vb, units: { swordsman: 5 } }, t0))).rejects.toThrow(/protection/);
  });

  it('carte, classement, tribus et messages répondent', async () => {
    const a = await register('Gauvain');
    const b = await register('Yvain');
    const map = await app.inject({ method: 'GET', url: '/api/map', headers: auth(a.token) });
    expect(map.json().length).toBeGreaterThan(2);

    const tribe = await app.inject({ method: 'POST', url: '/api/tribes', headers: auth(a.token), payload: { name: 'Table Ronde', tag: 'TR' } });
    expect(tribe.statusCode).toBe(200);
    await app.inject({ method: 'POST', url: '/api/tribes/invite', headers: auth(a.token), payload: { username: 'Yvain' } });
    const meB = (await app.inject({ method: 'GET', url: '/api/me', headers: auth(b.token) })).json();
    expect(meB.invites).toHaveLength(1);
    await app.inject({ method: 'POST', url: `/api/invites/${meB.invites[0].id}/accept`, headers: auth(b.token) });
    const t = (await app.inject({ method: 'GET', url: `/api/tribes/${tribe.json().id}`, headers: auth(a.token) })).json();
    expect(t.members).toHaveLength(2);

    const msg = await app.inject({ method: 'POST', url: '/api/messages', headers: auth(b.token), payload: { to: 'gauvain', subject: 'Salut', body: 'On attaque ce soir ?' } });
    expect(msg.statusCode).toBe(200);
    const inbox = (await app.inject({ method: 'GET', url: '/api/messages', headers: auth(a.token) })).json();
    expect(inbox[0].from).toBe('Yvain');

    const ranking = (await app.inject({ method: 'GET', url: '/api/ranking/tribes', headers: auth(a.token) })).json();
    expect(ranking[0].tag).toBe('TR');
  });

  it("l'application mobile peut appeler l'API (CORS)", async () => {
    const pre = await app.inject({
      method: 'OPTIONS',
      url: '/api/auth/login',
      headers: { origin: 'capacitor://localhost', 'access-control-request-method': 'POST' },
    });
    expect(pre.statusCode).toBe(204);
    expect(pre.headers['access-control-allow-origin']).toBe('capacitor://localhost');
    expect(pre.headers['access-control-allow-headers']).toContain('authorization');
    const world = await app.inject({ method: 'GET', url: '/api/world', headers: { origin: 'https://localhost' } });
    expect(world.headers['access-control-allow-origin']).toBe('https://localhost');
    const evil = await app.inject({ method: 'GET', url: '/api/world', headers: { origin: 'https://evil.example' } });
    expect(evil.headers['access-control-allow-origin']).toBeUndefined();
  });

  it('un joueur peut supprimer son compte, ses villages deviennent barbares', async () => {
    const { token, me } = await register('Partant');
    const vid = me.villages[0].id;
    const wrong = await app.inject({ method: 'DELETE', url: '/api/me', headers: auth(token), payload: { password: 'mauvais' } });
    expect(wrong.statusCode).toBe(403);
    const ok = await app.inject({ method: 'DELETE', url: '/api/me', headers: auth(token), payload: { password: 'secret123' } });
    expect(ok.statusCode).toBe(200);
    const v = (await pool.query('SELECT owner_id FROM villages WHERE id = $1', [vid])).rows[0];
    expect(v.owner_id).toBeNull();
    const after = await app.inject({ method: 'GET', url: '/api/me', headers: auth(token) });
    expect(after.statusCode).toBe(401);
  });

  it('un village barbare pillé retrouve des troupes avec le temps', async () => {
    const t0 = new Date(Date.now() - 200 * HOUR);
    const id = await tx((c) =>
      createVillage(c, { ownerId: null, name: 'Camp', x: 3, y: 97, buildings: { ...STARTING_BUILDINGS }, resources: { wood: 0, clay: 0, iron: 0, wheat: 0 }, at: t0, troops: emptyUnits() }),
    );
    await tx((c) => syncVillage(c, id, new Date(t0.getTime() + 100 * HOUR)));
    const troops = await tx((c) => getTroops(c, id, id));
    expect(troops.spearman + troops.swordsman).toBeGreaterThan(0);
  });

  it('le profil public liste les villages du joueur, sans tenir compte de la casse', async () => {
    const a = await register('Bohort');
    const res = await app.inject({ method: 'GET', url: '/api/players/bOHORT', headers: auth(a.token) });
    expect(res.statusCode).toBe(200);
    const p = res.json();
    expect(p.username).toBe('Bohort');
    expect(p.villages).toHaveLength(1);
    expect(p.rank).toBeGreaterThanOrEqual(1);
    const missing = await app.inject({ method: 'GET', url: '/api/players/Inconnu', headers: auth(a.token) });
    expect(missing.statusCode).toBe(404);
  });
});
