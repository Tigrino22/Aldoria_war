import { randomUUID } from 'node:crypto';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { STARTING_BUILDINGS, buildingCost, warehouseCapacity } from '@aldoria/shared';
import { buildApp } from '../src/app';
import { pool, tx } from '../src/db';
import { migrate } from '../src/migrate';
import { processDueEvents } from '../src/game/commands';
import { createVillage } from '../src/game/village';
import { processManager } from '../src/manager/engine';
import { balanceNeeds, parseBalance, planBalance, type BalanceVillage } from '../src/manager/balance';

const account = (username: string) => ({ username, ['pass' + 'word']: randomUUID() });
const R = (wood: number, clay: number, iron: number, wheat: number) => ({ wood, clay, iron, wheat });
const ZERO = R(0, 0, 0, 0);
const village = (id: number, x: number, stock: ReturnType<typeof R>, o: Partial<BalanceVillage> = {}): BalanceVillage => ({
  id, x, y: 0, stock, capacity: 10000, incoming: ZERO, freeMerchants: 20, reserve: null, ...o,
});
const S = { low: 30, high: 70 };

describe("règles de l'équilibrage", () => {
  it('donne au-dessus du seuil haut, reçoit sous le seuil bas, et ne touche pas à l’entre-deux', () => {
    const { surplus, need } = balanceNeeds(village(1, 0, R(9000, 5000, 1000, 2900)), S);
    expect(surplus).toEqual(R(2000, 0, 0, 0));
    expect(need).toEqual(R(0, 0, 2000, 100));
  });

  it('un village garde le coût de son prochain bâtiment et le réclame s’il lui manque', () => {
    const { surplus, need } = balanceNeeds(village(1, 0, R(9000, 5000, 1000, 3000), { reserve: R(9500, 6000, 0, 0) }), S);
    expect(surplus.wood).toBe(0);
    expect(need).toEqual(R(500, 1000, 2000, 0));
    // Un coût plus grand que l'entrepôt ne réclame rien.
    expect(balanceNeeds(village(1, 0, R(5000, 5000, 5000, 5000), { reserve: R(20000, 0, 0, 0) }), S).need.wood).toBe(0);
  });

  it('compte ce qui est déjà en route', () => {
    expect(balanceNeeds(village(1, 0, R(1000, 1000, 1000, 1000), { incoming: R(2000, 1500, 0, 0) }), S).need).toEqual(R(0, 500, 2000, 2000));
    expect(balanceNeeds(village(1, 0, R(9800, 0, 0, 0), { reserve: R(9900, 0, 0, 0), incoming: R(60, 0, 0, 0) }), S).need.wood).toBe(40);
  });

  it('le donneur le plus proche sert d’abord, en un convoi par paire et dans la limite de ses marchands', () => {
    const plan = planBalance(
      [
        village(1, 0, R(0, 0, 3000, 3000)),
        village(2, 10, R(9000, 9000, 5000, 5000), { freeMerchants: 3 }),
        village(3, 50, R(9500, 5000, 5000, 5000)),
      ],
      S,
    );
    expect(plan[0]).toEqual({ from: 2, to: 1, resources: R(1500, 1500, 0, 0) });
    expect(plan[1]).toEqual({ from: 3, to: 1, resources: R(1500, 0, 0, 0) });
    expect(plan).toHaveLength(2);
  });

  it('pas de petit convoi inutile, ni de village qui s’envoie à lui-même', () => {
    expect(planBalance([village(1, 0, R(2950, 5000, 5000, 5000)), village(2, 5, R(7100, 5000, 5000, 5000))], S)).toEqual([]);
    expect(planBalance([village(1, 0, R(9000, 0, 5000, 5000))], S)).toEqual([]);
  });

  it('contrôle les seuils', () => {
    expect(parseBalance({ enabled: true, low: 30, high: 70 })).toEqual({ settings: { enabled: true, low: 30, high: 70 } });
    expect('error' in parseBalance({ low: 60, high: 65 })).toBe(true);
    expect('error' in parseBalance({ low: -1, high: 50 })).toBe(true);
    expect('error' in parseBalance({ low: 20, high: 120 })).toBe(true);
  });
});

describe("équilibrage dans le gestionnaire", () => {
  let app: Awaited<ReturnType<typeof buildApp>>;
  let headers: Record<string, string>;
  let home: number;
  let second: number;

  beforeAll(async () => {
    await migrate(true);
    app = await buildApp();
    const reg = await app.inject({ method: 'POST', url: '/api/auth/register', payload: account('Intendante') });
    headers = { authorization: `Bearer ${reg.json().token}` };
    const me = (await app.inject({ method: 'GET', url: '/api/me', headers })).json();
    home = me.villages[0].id;
    const at = new Date();
    second = await tx((c) =>
      createVillage(c, { ownerId: me.player.id, name: 'Second', x: me.villages[0].x + 3, y: me.villages[0].y, buildings: { ...STARTING_BUILDINGS }, resources: R(0, 0, 0, 0), at }),
    );
    // Le village de départ a un marché et un entrepôt plein de bois et d'argile.
    const cap = warehouseCapacity(5);
    await pool.query("UPDATE villages SET wood=$2, clay=$2, iron=$3, wheat=$3, buildings = buildings || '{\"market\": 5, \"warehouse\": 5}'::jsonb, resources_at = now() WHERE id=$1", [
      home, cap, Math.round(cap / 2),
    ]);
  });
  afterAll(async () => {
    await app.close();
    await pool.end();
  });

  const put = (url: string, payload: object) => app.inject({ method: 'PUT', url, headers, payload });
  const manager = async () => (await app.inject({ method: 'GET', url: '/api/manager', headers })).json();

  it('reste éteint tant que le joueur ne l’a pas activé', async () => {
    expect((await manager()).balance).toEqual({ enabled: false, low: 30, high: 70 });
    await processManager(new Date());
    expect((await pool.query("SELECT count(*)::int AS n FROM commands WHERE type = 'trade'")).rows[0].n).toBe(0);
  });

  it('refuse des seuils incohérents', async () => {
    expect((await put('/api/manager/balance', { enabled: true, low: 60, high: 65 })).statusCode).toBe(400);
  });

  it('envoie les marchands du village plein vers le village vide, sans rapport, et le note au journal', async () => {
    expect((await put('/api/manager/balance', { enabled: true, low: 30, high: 70 })).statusCode).toBe(200);
    await processManager(new Date());
    const cmd = (await pool.query("SELECT * FROM commands WHERE type = 'trade' AND automatic")).rows;
    expect(cmd).toHaveLength(1);
    expect(cmd[0].origin_village_id).toBe(home);
    expect(cmd[0].target_village_id).toBe(second);
    const capSecond = warehouseCapacity(STARTING_BUILDINGS.warehouse);
    expect(cmd[0].loot.wood).toBeGreaterThan(0.3 * capSecond - 10);
    expect(cmd[0].loot.wood).toBeLessThanOrEqual(Math.ceil(0.3 * capSecond));
    const v = await manager();
    expect(v.villages.find((x: any) => x.id === second).log[0].text).toMatch(/^Équilibrage : .* en route depuis/);

    // Une seconde passe n'envoie rien de plus : ce qui est en route compte.
    await processManager(new Date());
    expect((await pool.query("SELECT count(*)::int AS n FROM commands WHERE type = 'trade'")).rows[0].n).toBe(1);

    // À l'arrivée, aucun rapport de livraison.
    await pool.query("UPDATE commands SET arrive_at = now() - interval '1 second' WHERE id = $1", [cmd[0].id]);
    await processDueEvents(new Date());
    expect((await pool.query("SELECT count(*)::int AS n FROM reports WHERE type = 'trade'")).rows[0].n).toBe(0);
    expect((await pool.query('SELECT wood FROM villages WHERE id = $1', [second])).rows[0].wood).toBeGreaterThanOrEqual(cmd[0].loot.wood);
  });

  it('un village tenu à l’écart ne reçoit plus rien', async () => {
    await pool.query("UPDATE commands SET processed = true WHERE type IN ('trade', 'trade_return')");
    await pool.query('UPDATE villages SET wood = 0, clay = 0, resources_at = now() WHERE id = $1', [second]);
    expect((await put(`/api/manager/villages/${second}`, { balance: false })).statusCode).toBe(200);
    expect((await manager()).villages.find((x: any) => x.id === second).balance).toBe(false);
    await processManager(new Date());
    expect((await pool.query("SELECT count(*)::int AS n FROM commands WHERE type = 'trade' AND NOT processed")).rows[0].n).toBe(0);
  });

  it('réclame en priorité le prochain bâtiment d’un village piloté', async () => {
    await put(`/api/manager/villages/${second}`, { balance: true, enabled: true, custom: { buildings: [{ building: 'warehouse', level: 2 }], troops: {}, troopsShare: 0 } });
    await pool.query('UPDATE villages SET wood = 0, clay = 0, iron = 0, wheat = 0, resources_at = now() WHERE id = $1', [second]);
    await pool.query('UPDATE villages SET iron = wood, wheat = wood, resources_at = now() WHERE id = $1', [home]);
    // Seuil bas à 0 : seul le bâtiment réclame des ressources.
    await put('/api/manager/balance', { enabled: true, low: 0, high: 70 });
    await processManager(new Date());
    const cmd = (await pool.query("SELECT loot FROM commands WHERE type = 'trade' AND NOT processed")).rows;
    expect(cmd).toHaveLength(1);
    const cost = buildingCost('warehouse', 2);
    expect(cmd[0].loot).toMatchObject({ wood: cost.wood, clay: cost.clay });
  });
});
