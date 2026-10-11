import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { STARTING_BUILDINGS, emptyUnits, orderTotal, travelTime, type NobleTrain, type UnitCounts } from '@aldoria/shared';
import { pool, tx } from '../src/db';
import { env } from '../src/env';
import { migrate } from '../src/migrate';
import { Outbox } from '../src/notify';
import { processDueEvents, setRandom } from '../src/game/commands';
import { cancelOrder, launchDueOrders, orderParts, placeOrder, plannedOrders } from '../src/game/orders';
import { createVillage, getTroops } from '../src/game/village';

const HOUR = 3_600_000;
const T0 = new Date('2030-01-15T12:00:00Z');
const units = (u: Partial<UnitCounts>): UnitCounts => ({ ...emptyUnits(), ...u });

async function makePlayer(name: string, protectedUntil: Date | null = null) {
  return (await pool.query("INSERT INTO players (username, password_hash, protection_until) VALUES ($1, 'x', $2) RETURNING id", [name, protectedUntil])).rows[0].id as number;
}
const village = (owner: number, x: number, y: number, troops: Partial<UnitCounts> = {}) =>
  tx((c) => createVillage(c, { ownerId: owner, name: `V${x}-${y}`, x, y, buildings: { ...STARTING_BUILDINGS }, resources: { wood: 500, clay: 500, iron: 500, wheat: 500 }, at: T0, troops: units(troops) }));

describe('règles des ordres du point de ralliement', () => {
  const travel = (u: UnitCounts) => (u.noble > 0 ? 600_000 : 300_000);
  const opts = { now: T0, travelMs: travel };
  const train = (nobles: number, escort = 2): NobleTrain => ({ nobles, escort: units({ swordsman: escort }), gapMs: 1000 });

  it('sans train : un seul mouvement, qui arrive à l’heure voulue', () => {
    const landAt = new Date(T0.getTime() + HOUR);
    const [p, ...rest] = orderParts(units({ swordsman: 10 }), null, { ...opts, landAt });
    expect(rest).toHaveLength(0);
    expect(p.arriveAt).toEqual(landAt);
    expect(p.departAt.getTime()).toBe(landAt.getTime() - 300_000);
  });

  it('train de nobles : l’assaut, puis un noble escorté par mouvement, une seconde après le précédent', () => {
    const landAt = new Date(T0.getTime() + HOUR);
    const parts = orderParts(units({ swordsman: 50 }), train(3), { ...opts, landAt });
    expect(parts.map((p) => p.units.noble)).toEqual([0, 1, 1, 1]);
    expect(parts.map((p) => p.units.swordsman)).toEqual([50, 2, 2, 2]);
    expect(parts.map((p) => p.arriveAt.getTime() - landAt.getTime())).toEqual([0, 1000, 2000, 3000]);
    // Chaque mouvement part à son heure : les nobles, plus lents, partent plus tôt.
    expect(parts[1].departAt.getTime()).toBeLessThan(parts[0].departAt.getTime());
    expect(orderTotal(units({ swordsman: 50 }), train(3))).toEqual(units({ swordsman: 56, noble: 3 }));
  });

  it('un train sans assaut commence par le premier noble', () => {
    const parts = orderParts(emptyUnits(), train(2, 1), { ...opts, landAt: null });
    expect(parts).toHaveLength(2);
    expect(parts[1].arriveAt.getTime() - parts[0].arriveAt.getTime()).toBe(1000);
  });

  it('sans heure imposée, l’arrivée la plus proche est celle où le mouvement le plus lent part tout de suite', () => {
    const parts = orderParts(units({ swordsman: 50 }), train(2), { ...opts, landAt: null });
    expect(Math.min(...parts.map((p) => p.departAt.getTime()))).toBe(T0.getTime());
    expect(parts.every((p) => p.departAt.getTime() >= T0.getTime())).toBe(true);
  });

  it('refuse une heure trop proche, trop lointaine, et un train sans noble', () => {
    expect(() => orderParts(units({ swordsman: 5 }), null, { ...opts, landAt: new Date(T0.getTime() + 1000) })).toThrow(/trop proche/);
    expect(() => orderParts(units({ swordsman: 5 }), null, { ...opts, landAt: new Date(T0.getTime() + 20 * 86_400_000) })).toThrow(/trop lointaine/);
    expect(() => orderParts(units({ swordsman: 5 }), train(0), { ...opts, landAt: null })).toThrow(/noble/);
  });
});

describe('ordres planifiés', () => {
  beforeAll(async () => {
    await migrate(true);
    setRandom(() => 0.999);
  });
  afterAll(async () => {
    await pool.end();
  });

  it('une attaque à heure précise : troupes réservées, départ différé, arrivée à la seconde près', async () => {
    const me = await makePlayer('Stratège');
    const foe = await makePlayer('Cible');
    const home = await village(me, 10, 10, { swordsman: 100 });
    const target = await village(foe, 14, 10);
    const landAt = new Date(T0.getTime() + 2 * HOUR);
    await tx((c) => placeOrder(c, new Outbox(), me, home, { type: 'attack', targetId: target, units: { swordsman: 40 }, arriveAt: landAt }, T0));

    // Les troupes sont réservées, mais rien n'est encore en route : la cible ne voit rien venir.
    expect((await tx((c) => getTroops(c, home, home))).swordsman).toBe(60);
    expect((await pool.query('SELECT count(*)::int AS n FROM commands WHERE player_id = $1', [me])).rows[0].n).toBe(0);
    const orders = await tx((c) => plannedOrders(c, me));
    expect(orders).toHaveLength(1);
    expect(orders[0].parts[0].arriveAt).toBe(landAt.toISOString());

    const departAt = new Date(orders[0].parts[0].departAt);
    expect(await launchDueOrders(new Date(departAt.getTime() - 1000))).toBe(0);
    expect(await launchDueOrders(departAt)).toBe(1);
    const cmd = (await pool.query("SELECT type, arrive_at, units FROM commands WHERE player_id = $1", [me])).rows[0];
    expect(cmd.type).toBe('attack');
    expect(new Date(cmd.arrive_at).getTime()).toBe(landAt.getTime());
    expect((await tx((c) => plannedOrders(c, me)))).toHaveLength(0);
    expect(await processDueEvents(new Date(landAt.getTime() + 1))).toBeGreaterThan(0);
  });

  it('train de nobles : un assaut puis un noble par attaque, arrivant une seconde après l’autre, et le village tombe', async () => {
    const me = await makePlayer('Conquérant');
    const foe = await makePlayer('Victime');
    const home = await village(me, 30, 30, { swordsman: 100, noble: 3 });
    const target = await village(foe, 33, 30);
    const landAt = new Date(T0.getTime() + 4 * HOUR);
    await tx((c) => placeOrder(c, new Outbox(), me, home, { type: 'attack', targetId: target, units: { swordsman: 60 }, arriveAt: landAt, train: { nobles: 3, escort: { swordsman: 2 }, gapSeconds: 1 } }, T0));
    const planned = (await tx((c) => plannedOrders(c, me)))[0];
    expect(planned.parts).toHaveLength(4);
    // Les mouvements partent chacun à leur heure.
    for (const at of planned.parts.map((p) => Date.parse(p.departAt)).sort((a, b) => a - b)) expect(await launchDueOrders(new Date(at))).toBe(1);
    const cmds = (await pool.query("SELECT units, arrive_at FROM commands WHERE player_id = $1 AND type = 'attack' ORDER BY arrive_at", [me])).rows;
    expect(cmds.map((r) => new Date(r.arrive_at).getTime() - landAt.getTime())).toEqual([0, 1000, 2000, 3000]);
    expect(cmds.slice(1).every((r) => r.units.noble === 1 && r.units.swordsman === 2)).toBe(true);

    await processDueEvents(new Date(landAt.getTime() + 10_000));
    // Loyauté 100 : chaque noble escorté fait baisser la loyauté de 35 (tirage fixé au maximum) ; le troisième achève le village.
    expect((await pool.query('SELECT owner_id FROM villages WHERE id = $1', [target])).rows[0].owner_id).toBe(me);
  });

  it('annuler un ordre rend les troupes réservées', async () => {
    const me = await makePlayer('Prudent');
    const foe = await makePlayer('Voisin');
    const home = await village(me, 50, 50, { swordsman: 30 });
    const target = await village(foe, 52, 50);
    await tx((c) => placeOrder(c, new Outbox(), me, home, { type: 'attack', targetId: target, units: { swordsman: 30 }, arriveAt: new Date(T0.getTime() + 3 * HOUR) }, T0));
    expect((await tx((c) => getTroops(c, home, home))).swordsman).toBe(0);
    const [order] = await tx((c) => plannedOrders(c, me));
    await tx((c) => cancelOrder(c, new Outbox(), me, order.groupId));
    expect((await tx((c) => getTroops(c, home, home))).swordsman).toBe(30);
    expect(await tx((c) => plannedOrders(c, me))).toHaveLength(0);
    await expect(tx((c) => cancelOrder(c, new Outbox(), me, order.groupId))).rejects.toThrow(/déjà parti/);
  });

  it('refuse un joueur protégé dès la planification, et rend les troupes si la cible devient inatteignable', async () => {
    const me = await makePlayer('Impatient');
    const newbie = await makePlayer('Débutant', new Date(T0.getTime() + 100 * HOUR));
    const home = await village(me, 70, 70, { swordsman: 20 });
    const target = await village(newbie, 72, 70);
    await expect(tx((c) => placeOrder(c, new Outbox(), me, home, { type: 'attack', targetId: target, units: { swordsman: 20 }, arriveAt: new Date(T0.getTime() + 4 * HOUR) }, T0))).rejects.toThrow(/protection/);
    expect((await tx((c) => getTroops(c, home, home))).swordsman).toBe(20);

    // La protection du débutant se met en place après la planification : l'attaque est annulée au départ, les troupes rentrent.
    const other = await makePlayer('Adversaire');
    const target2 = await village(other, 74, 70);
    await tx((c) => placeOrder(c, new Outbox(), me, home, { type: 'attack', targetId: target2, units: { swordsman: 20 }, arriveAt: new Date(T0.getTime() + 4 * HOUR) }, T0));
    await pool.query('UPDATE players SET protection_until = $2 WHERE id = $1', [other, new Date(T0.getTime() + 50 * HOUR)]);
    await launchDueOrders(new Date(T0.getTime() + 4 * HOUR));
    expect((await tx((c) => getTroops(c, home, home))).swordsman).toBe(20);
    expect((await pool.query('SELECT count(*)::int AS n FROM commands WHERE player_id = $1', [me])).rows[0].n).toBe(0);
  });

  it('un départ immédiat envoie tout de suite, avec un temps de trajet cohérent', async () => {
    const me = await makePlayer('Pressé');
    const foe = await makePlayer('Proche');
    const home = await village(me, 90, 90, { swordsman: 10 });
    const target = await village(foe, 93, 90);
    await tx((c) => placeOrder(c, new Outbox(), me, home, { type: 'support', targetId: target, units: { swordsman: 10 } }, T0));
    const cmd = (await pool.query("SELECT arrive_at FROM commands WHERE player_id = $1 AND type = 'support'", [me])).rows[0];
    const expected = travelTime({ ...emptyUnits(), swordsman: 10 }, { x: 90, y: 90 }, { x: 93, y: 90 }, env.worldSpeed) * 1000;
    expect(new Date(cmd.arrive_at).getTime() - T0.getTime()).toBe(expected);
  });
});
