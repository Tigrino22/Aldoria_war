import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { emptyUnits, STARTING_BUILDINGS } from '@aldoria/shared';
import { buildApp } from '../src/app';
import { pool, tx } from '../src/db';
import { migrate } from '../src/migrate';
import { Outbox } from '../src/notify';
import { processDueEvents, sendCommand, setRandom } from '../src/game/commands';
import { createVillage, enqueueBuild, enqueueRecruit, getTroops, syncVillage } from '../src/game/village';

let app: Awaited<ReturnType<typeof buildApp>>;
const HOUR = 3_600_000;

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
    const auth = (t: string) => ({ authorization: `Bearer ${t}` });
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
});
