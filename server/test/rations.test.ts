import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { attackWheatCost, emptyUnits, normalizeUnits, STARTING_BUILDINGS } from '@aldoria/shared';
import { buildApp } from '../src/app';
import { pool, tx } from '../src/db';
import { migrate } from '../src/migrate';
import { Outbox } from '../src/notify';
import { cancelCommand, sendCommand } from '../src/game/commands';
import { cancelOrder, placeOrder } from '../src/game/orders';
import { createVillage } from '../src/game/village';

let app: Awaited<ReturnType<typeof buildApp>>;
const HOUR = 3_600_000;

async function makePlayer(name: string, npc = false) {
  const { rows } = await pool.query("INSERT INTO players (username, password_hash, is_npc) VALUES ($1, 'x', $2) RETURNING id", [name, npc]);
  return rows[0].id as number;
}
const mk = (owner: number | null, x: number, wheat: number, troops: any, at: Date) =>
  tx((c) =>
    createVillage(c, { ownerId: owner, name: 'V', x, y: 140, buildings: { ...STARTING_BUILDINGS }, resources: { wood: 0, clay: 0, iron: 0, wheat }, at, troops: { ...emptyUnits(), ...troops } }),
  );
const wheatOf = async (id: number) => Math.floor((await pool.query('SELECT wheat FROM villages WHERE id = $1', [id])).rows[0].wheat);

describe('rations des attaques', () => {
  beforeAll(async () => {
    await migrate(true);
    app = await buildApp();
  });
  afterAll(async () => {
    await app.close();
    await pool.end();
  });

  it('une ration de blé par place de population', () => {
    // 10 lanciers (1 place) + 2 cavaliers (4 places) + 1 noble (100 places).
    expect(attackWheatCost(normalizeUnits({ spearman: 10, cavalry: 2, noble: 1 }))).toBe(118);
  });

  it('une attaque paie son blé, un renfort non, et une attaque annulée à temps le rend', async () => {
    const a = await makePlayer('Rationneur');
    const now = new Date();
    const home = await mk(a, 10, 300, { spearman: 200 }, now);
    const target = await mk(null, 12, 0, {}, now);
    const ally = await mk(a, 14, 0, {}, now);

    const sent = await tx((c) => sendCommand(c, new Outbox(), a, home, { type: 'attack', targetId: target, units: { spearman: 100 } }, now));
    expect(await wheatOf(home)).toBe(200);
    await tx((c) => sendCommand(c, new Outbox(), a, home, { type: 'support', targetId: ally, units: { spearman: 50 } }, now));
    expect(await wheatOf(home)).toBe(200);
    await tx((c) => cancelCommand(c, new Outbox(), a, sent.id, now));
    expect(await wheatOf(home)).toBe(300);
  });

  it('sans assez de blé, l’attaque ne part pas', async () => {
    const a = await makePlayer('Affamé');
    const now = new Date();
    const home = await mk(a, 20, 30, { spearman: 100 }, now);
    const target = await mk(null, 22, 0, {}, now);
    await expect(tx((c) => sendCommand(c, new Outbox(), a, home, { type: 'attack', targetId: target, units: { spearman: 31 } }, now))).rejects.toThrow(/blé/);
    await tx((c) => sendCommand(c, new Outbox(), a, home, { type: 'attack', targetId: target, units: { spearman: 30 } }, now));
    expect(await wheatOf(home)).toBe(0);
  });

  it('un ordre planifié paie à la commande et rend le blé s’il est annulé', async () => {
    const a = await makePlayer('Stratège');
    const now = new Date();
    const home = await mk(a, 30, 500, { swordsman: 100 }, now);
    const target = await mk(null, 34, 0, {}, now);
    const group = await tx((c) => placeOrder(c, new Outbox(), a, home, { type: 'attack', targetId: target, units: { swordsman: 80 }, arriveAt: new Date(now.getTime() + 5 * HOUR) }, now));
    expect(await wheatOf(home)).toBe(420);
    await tx((c) => cancelOrder(c, new Outbox(), a, group));
    // L'annulation se fait un peu plus tard : le village a produit quelques unités de blé entre-temps.
    expect(await wheatOf(home)).toBeGreaterThanOrEqual(500);
  });

  it('les PNJ ne paient pas leurs attaques', async () => {
    const npc = await makePlayer('Seigneur PNJ', true);
    const now = new Date();
    const home = await mk(npc, 40, 0, { spearman: 50 }, now);
    const target = await mk(null, 42, 0, {}, now);
    await tx((c) => sendCommand(c, new Outbox(), npc, home, { type: 'attack', targetId: target, units: { spearman: 50 } }, now));
    expect(await wheatOf(home)).toBe(0);
  });
});
