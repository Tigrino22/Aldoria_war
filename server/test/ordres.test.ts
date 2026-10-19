import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { STARTING_BUILDINGS, emptyUnits, orderTotal, travelTime, type NobleTrain, type UnitCounts } from '@aldoria/shared';
import { pool, tx } from '../src/db';
import { env } from '../src/env';
import { migrate } from '../src/migrate';
import { Outbox } from '../src/notify';
import { processDueEvents, sendCommand, setRandom } from '../src/game/commands';
import { cancelOrder, launchDueOrders, orderParts, placeOrder, plannedOrders } from '../src/game/orders';
import { createVillage, freeTroops, getTroops } from '../src/game/village';

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

    // Les troupes sont réservées mais restent au village, et rien n'est encore en route : la cible ne voit rien venir.
    expect((await tx((c) => getTroops(c, home, home))).swordsman).toBe(100);
    expect((await tx((c) => freeTroops(c, home))).swordsman).toBe(60);
    expect((await pool.query('SELECT count(*)::int AS n FROM commands WHERE player_id = $1', [me])).rows[0].n).toBe(0);
    const orders = await tx((c) => plannedOrders(c, me));
    expect(orders).toHaveLength(1);
    expect(orders[0].parts[0].arriveAt).toBe(landAt.toISOString());

    const departAt = new Date(orders[0].parts[0].departAt);
    expect(await launchDueOrders(new Date(departAt.getTime() - 1000))).toBe(0);
    expect(await launchDueOrders(departAt)).toBe(1);
    const cmd = (await pool.query("SELECT type, arrive_at, units FROM commands WHERE player_id = $1", [me])).rows[0];
    expect(cmd.type).toBe('attack');
    expect(cmd.units.swordsman).toBe(40);
    expect(new Date(cmd.arrive_at).getTime()).toBe(landAt.getTime());
    expect((await tx((c) => getTroops(c, home, home))).swordsman).toBe(60);
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

  it('escorte au choix : avec de quoi escorter 3 nobles sur 4, seules 3 attaques partent', async () => {
    const me = await makePlayer('Limité');
    const foe = await makePlayer('Cible limitée');
    const home = await village(me, 110, 110, { cavalry: 10, spearman: 7, noble: 4 });
    const target = await village(foe, 113, 110);
    const landAt = new Date(T0.getTime() + 3 * HOUR);
    // Escorte de 2 lanciers par noble : 7 lanciers n'en couvrent que 3. L'assaut part à cheval, plus vite que les nobles.
    await tx((c) => placeOrder(c, new Outbox(), me, home, { type: 'attack', targetId: target, units: { cavalry: 10 }, arriveAt: landAt, train: { nobles: 4, escort: { spearman: 2 }, gapSeconds: 1 } }, T0));
    const planned = (await tx((c) => plannedOrders(c, me)))[0];
    expect(planned.parts).toHaveLength(4); // l'assaut + 3 nobles
    expect(planned.parts.filter((p) => p.units.noble === 1)).toHaveLength(3);
    const left = await tx((c) => freeTroops(c, home));
    expect(left.noble).toBe(1);
    expect(left.spearman).toBe(1);
    // Les unités plus rapides partent plus tard : toutes les arrivées tombent à l'heure choisie (à la seconde d'écart près).
    const arrivals = planned.parts.map((p) => Date.parse(p.arriveAt) - landAt.getTime()).sort((a, b) => a - b);
    expect(arrivals).toEqual([0, 1000, 2000, 3000]);
    const assault = planned.parts.find((p) => p.units.cavalry === 10)!;
    const noble = planned.parts.find((p) => p.units.noble === 1)!;
    expect(Date.parse(assault.departAt)).toBeGreaterThan(Date.parse(noble.departAt));
  });

  it('refuse un train quand aucun noble ne peut partir avec son escorte', async () => {
    const me = await makePlayer('Sans escorte');
    const foe = await makePlayer('Cible 3');
    const home = await village(me, 130, 130, { spearman: 1, noble: 2 });
    const target = await village(foe, 132, 130);
    await expect(
      tx((c) => placeOrder(c, new Outbox(), me, home, { type: 'attack', targetId: target, units: {}, arriveAt: null, train: { nobles: 2, escort: { spearman: 2 }, gapSeconds: 1 } }, T0)),
    ).rejects.toThrow(/escorte/);
  });

  it('annuler un ordre libère les troupes réservées', async () => {
    const me = await makePlayer('Prudent');
    const foe = await makePlayer('Voisin');
    const home = await village(me, 50, 50, { swordsman: 30 });
    const target = await village(foe, 52, 50);
    await tx((c) => placeOrder(c, new Outbox(), me, home, { type: 'attack', targetId: target, units: { swordsman: 30 }, arriveAt: new Date(T0.getTime() + 3 * HOUR) }, T0));
    expect((await tx((c) => getTroops(c, home, home))).swordsman).toBe(30);
    expect((await tx((c) => freeTroops(c, home))).swordsman).toBe(0);
    const [order] = await tx((c) => plannedOrders(c, me));
    await tx((c) => cancelOrder(c, new Outbox(), me, order.groupId));
    expect((await tx((c) => freeTroops(c, home))).swordsman).toBe(30);
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

  it('les troupes réservées défendent le village jusqu’à leur départ, puis l’assaut part avec ce qui reste', async () => {
    const me = await makePlayer('Défenseur patient');
    const foe = await makePlayer('Pillard');
    const home = await village(me, 150, 150, { spearman: 100 });
    const target = await village(foe, 153, 150);
    const raider = await village(foe, 152, 150, { swordsman: 30 });
    const landAt = new Date(T0.getTime() + 6 * HOUR);
    await tx((c) => placeOrder(c, new Outbox(), me, home, { type: 'attack', targetId: target, units: { spearman: 100 }, arriveAt: landAt }, T0));
    // Les troupes réservées ne peuvent pas partir ailleurs.
    await expect(tx((c) => sendCommand(c, new Outbox(), me, home, { type: 'support', targetId: target, units: { spearman: 1 } }, T0))).rejects.toThrow(/libres/);

    // Une attaque tombe sur le village avant le départ : les lanciers réservés le défendent.
    const strike = await tx((c) => sendCommand(c, new Outbox(), foe, raider, { type: 'attack', targetId: home, units: { swordsman: 30 } }, T0));
    await processDueEvents(new Date(strike.arriveAt.getTime() + 1));
    expect((await pool.query('SELECT owner_id FROM villages WHERE id = $1', [home])).rows[0].owner_id).toBe(me);
    const survivors = (await tx((c) => getTroops(c, home, home))).spearman;
    expect(survivors).toBeGreaterThan(0);
    expect(survivors).toBeLessThan(100);

    const wheatBefore = Number((await pool.query('SELECT wheat FROM villages WHERE id = $1', [home])).rows[0].wheat);
    const departAt = new Date((await tx((c) => plannedOrders(c, me)))[0].parts[0].departAt);
    expect(await launchDueOrders(departAt)).toBe(1);
    const cmd = (await pool.query("SELECT units FROM commands WHERE player_id = $1 AND type = 'attack'", [me])).rows[0];
    expect(cmd.units.spearman).toBe(survivors);
    expect((await tx((c) => getTroops(c, home, home))).spearman).toBe(0);
    // Le blé des lanciers tombés est rendu.
    expect(Number((await pool.query('SELECT wheat FROM villages WHERE id = $1', [home])).rows[0].wheat)).toBeGreaterThan(wheatBefore);
  });

  it('un train dont l’escorte n’est plus complète ne part pas ; l’assaut part avec le reste', async () => {
    const me = await makePlayer('Train amputé');
    const foe = await makePlayer('Cible du train');
    const home = await village(me, 170, 170, { swordsman: 40, noble: 2 });
    const target = await village(foe, 173, 170);
    const landAt = new Date(T0.getTime() + 6 * HOUR);
    await tx((c) => placeOrder(c, new Outbox(), me, home, { type: 'attack', targetId: target, units: { swordsman: 20 }, arriveAt: landAt, train: { nobles: 2, escort: { swordsman: 10 }, gapSeconds: 1 } }, T0));
    // Des pertes avant le départ : 15 épéistes au lieu de 40, il en faut 20 pour l’escorte complète des 2 nobles.
    await pool.query("UPDATE troops SET units = units || '{\"swordsman\": 15}'::jsonb WHERE village_id = $1 AND home_village_id = $1", [home]);
    const parts = (await tx((c) => plannedOrders(c, me)))[0].parts;
    for (const at of parts.map((p) => Date.parse(p.departAt)).sort((a, b) => a - b)) await launchDueOrders(new Date(at));
    const cmds = (await pool.query("SELECT units FROM commands WHERE player_id = $1 AND type = 'attack'", [me])).rows;
    // Aucun noble ne part : l'assaut seul, avec tout ce qui reste.
    expect(cmds).toHaveLength(1);
    expect(cmds[0].units).toMatchObject({ swordsman: 15, noble: 0 });
    expect(await tx((c) => getTroops(c, home, home))).toMatchObject({ swordsman: 0, noble: 2 });
    expect(await tx((c) => plannedOrders(c, me))).toHaveLength(0);
  });

  it('l’assaut laisse au village l’escorte d’un train qui peut encore partir au complet', async () => {
    const me = await makePlayer('Train prioritaire');
    const foe = await makePlayer('Cible prioritaire');
    const home = await village(me, 190, 190, { cavalry: 30, swordsman: 20, noble: 2 });
    const target = await village(foe, 193, 190);
    const landAt = new Date(T0.getTime() + 6 * HOUR);
    // L'assaut emporte des épéistes et des cavaliers ; chaque noble est escorté de 5 épéistes.
    await tx((c) => placeOrder(c, new Outbox(), me, home, { type: 'attack', targetId: target, units: { cavalry: 30, swordsman: 10 }, arriveAt: landAt, train: { nobles: 2, escort: { swordsman: 5 }, gapSeconds: 1 } }, T0));
    // 6 épéistes perdus : il en reste 14, assez pour les 10 de l'escorte, pas pour tout l'assaut.
    await pool.query("UPDATE troops SET units = units || '{\"swordsman\": 14}'::jsonb WHERE village_id = $1 AND home_village_id = $1", [home]);
    const parts = (await tx((c) => plannedOrders(c, me)))[0].parts;
    for (const at of parts.map((p) => Date.parse(p.departAt)).sort((a, b) => a - b)) await launchDueOrders(new Date(at));
    const cmds = (await pool.query("SELECT units FROM commands WHERE player_id = $1 AND type = 'attack' ORDER BY arrive_at", [me])).rows;
    expect(cmds).toHaveLength(3);
    expect(cmds[0].units).toMatchObject({ cavalry: 30, swordsman: 4 });
    expect(cmds.slice(1).every((r) => r.units.noble === 1 && r.units.swordsman === 5)).toBe(true);
  });
});
