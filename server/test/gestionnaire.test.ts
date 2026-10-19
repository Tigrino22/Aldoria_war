import { randomUUID } from 'node:crypto';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { STARTING_BUILDINGS, UNITS, buildingCost, emptyUnits, populationCapacity } from '@aldoria/shared';
import { buildApp } from '../src/app';
import { env } from '../src/env';
import { pool, tx } from '../src/db';
import { migrate } from '../src/migrate';
import { processManager } from '../src/manager/engine';
import { PRESETS, fillToPlan, nextBuilding, nextTroopLot, parsePlan, reserveFor, troopBudget } from '../src/manager/rules';
import { saveSettings } from '../src/settings';

// Identifiants jetables des comptes de test, générés à chaque exécution.
const account = (username: string) => ({ username, ['pass' + 'word']: randomUUID() });
const R = (wood: number, clay: number, iron: number, wheat: number) => ({ wood, clay, iron, wheat });
const B = (o: Partial<typeof STARTING_BUILDINGS>) => ({ ...STARTING_BUILDINGS, ...o });

describe('règles du gestionnaire', () => {
  it('monte le premier objectif non atteint, et passe par un prérequis manquant', () => {
    const targets = [{ building: 'farm' as const, level: 3 }, { building: 'wall' as const, level: 2 }];
    expect(nextBuilding(targets, B({ farm: 1 }))).toEqual({ building: 'farm', level: 2 });
    // La muraille demande une caserne niveau 1 : le gestionnaire commence par elle (et la caserne demande l'hôtel de ville 3).
    expect(nextBuilding(targets, B({ farm: 3 }))).toEqual({ building: 'townhall', level: 2 });
    expect(nextBuilding(targets, B({ farm: 3, townhall: 3 }))).toEqual({ building: 'barracks', level: 1 });
    expect(nextBuilding(targets, B({ farm: 3, townhall: 3, barracks: 1, wall: 2 }))).toBeNull();
  });

  it('une même ligne peut revenir plus haut dans la liste (ferme 3 puis caserne puis ferme 8)', () => {
    const targets = [{ building: 'farm' as const, level: 3 }, { building: 'townhall' as const, level: 3 }, { building: 'farm' as const, level: 8 }];
    expect(nextBuilding(targets, B({ farm: 3, townhall: 3 }))).toEqual({ building: 'farm', level: 4 });
  });

  it('la part des troupes règle ce qu\'elles peuvent dépenser pendant qu\'un bâtiment attend', () => {
    const cost = R(1000, 1000, 1000, 100);
    const stock = R(600, 600, 600, 600);
    // 0 % : tout est réservé au bâtiment, aucune troupe.
    expect(troopBudget(stock, reserveFor(cost, 0, 10000))).toEqual(R(0, 0, 0, 500));
    // 50 % : les troupes peuvent déjà utiliser la moitié du coût.
    expect(troopBudget(stock, reserveFor(cost, 50, 10000))).toEqual(R(100, 100, 100, 550));
    // 100 % : troupes d'abord, rien n'est réservé.
    expect(troopBudget(stock, reserveFor(cost, 100, 10000))).toEqual(stock);
    // Coût plus grand que l'entrepôt : on ne bloque pas les troupes pour rien.
    expect(troopBudget(stock, reserveFor(cost, 0, 900))).toEqual(R(600, 600, 600, 500));
  });

  it("choisit l'unité la plus en retard, dans la limite du budget et de la ferme", () => {
    const lot = nextTroopLot({ spearman: 100, swordsman: 100 }, { ...emptyUnits(), spearman: 90 }, B({ barracks: 3 }), R(99999, 99999, 99999, 99999), 1000, 1);
    expect(lot?.unit).toBe('swordsman');
    expect(nextTroopLot({ spearman: 100 }, emptyUnits(), B({ barracks: 1 }), R(0, 0, 0, 0), 1000, 1)).toBeNull();
    expect(nextTroopLot({ spearman: 100 }, emptyUnits(), B({ barracks: 1 }), R(99999, 99999, 99999, 99999), 5, 1)?.count).toBe(5);
    expect(nextTroopLot({ spearman: 100 }, emptyUnits(), B({ barracks: 0 }), R(99999, 99999, 99999, 99999), 1000, 1)).toBeNull();
  });

  it('les troupes ne prennent sur la réserve du bâtiment que leur part de la production', () => {
    const stock = R(600, 600, 600, 600);
    const rates = R(100, 100, 100, 100);
    // Sans excédent et sans part : rien.
    expect(nextTroopLot({ spearman: 100 }, emptyUnits(), B({ barracks: 1 }), R(0, 0, 0, 0), 1000, 1, { stock, rates, share: 0 })).toBeNull();
    // 25 % de 2 h de production = 50 bois : un lancier, puis une pause le temps de rendre cette part.
    const lot = nextTroopLot({ spearman: 100 }, emptyUnits(), B({ barracks: 1 }), R(0, 0, 0, 0), 1000, 1, { stock, rates, share: 25 });
    expect(lot?.count).toBe(1);
    expect(lot?.dipSeconds).toBe(7200);
    // L'excédent seul ne crée aucune pause.
    expect(nextTroopLot({ spearman: 10 }, emptyUnits(), B({ barracks: 1 }), R(600, 600, 600, 600), 1000, 1, { stock, rates, share: 25 })?.dipSeconds).toBe(0);
  });

  it("monte l'entrepôt d'abord quand le niveau visé coûte plus qu'il ne peut contenir", () => {
    expect(nextBuilding([{ building: 'barracks', level: 15 }], B({ townhall: 3, barracks: 14, warehouse: 8 }))).toEqual({ building: 'warehouse', level: 9 });
  });

  it("remplit les troupes d'un plan dans la limite de la ferme, sans les unités dont le prérequis manque", () => {
    const plan = { spearman: 100, swordsman: 100, noble: 4 };
    // Tout tient : on ajoute exactement ce qui manque (les nobles demandent l'hôtel de ville : ici trop bas, aucun).
    const all = fillToPlan(plan, { ...emptyUnits(), spearman: 40 }, B({ barracks: 3 }), 100000);
    expect(all).toMatchObject({ spearman: 60, swordsman: 100, noble: 0 });
    // Ferme trop petite : jamais plus de places que libres, chaque unité en reçoit sa part.
    const tight = fillToPlan({ spearman: 100, swordsman: 100 }, emptyUnits(), B({ barracks: 3 }), 100);
    expect(tight.spearman * UNITS.spearman.population + tight.swordsman * UNITS.swordsman.population).toBeLessThanOrEqual(100);
    expect(tight.spearman).toBeGreaterThan(0);
    expect(tight.swordsman).toBeGreaterThan(0);
    expect(fillToPlan({ spearman: 100 }, { ...emptyUnits(), spearman: 100 }, B({ barracks: 3 }), 100).spearman).toBe(0);
  });

  it('les modèles de départ montent tout le village et remplissent la ferme', () => {
    for (const p of PRESETS) {
      expect(parsePlan(p.plan)).toHaveProperty('plan');
      const pop = Object.entries(p.plan.troops).reduce((n, [u, c]) => n + UNITS[u as keyof typeof UNITS].population * (c ?? 0), 0);
      expect(pop).toBeLessThanOrEqual(populationCapacity(20));
      expect(pop).toBeGreaterThan(populationCapacity(20) * 0.95);
    }
  });
});

describe('gestionnaire de compte', () => {
  let app: Awaited<ReturnType<typeof buildApp>>;
  let headers: Record<string, string>;
  let villageId: number;

  beforeAll(async () => {
    await migrate(true);
    app = await buildApp();
    const reg = await app.inject({ method: 'POST', url: '/api/auth/register', payload: account('Intendant') });
    headers = { authorization: `Bearer ${reg.json().token}` };
    villageId = (await app.inject({ method: 'GET', url: '/api/me', headers })).json().villages[0].id;
  });
  afterAll(async () => {
    await app.close();
    await pool.end();
  });

  const put = (url: string, payload: unknown) => app.inject({ method: 'PUT', url, headers, payload: payload as object });
  const state = async () => (await pool.query('SELECT wood, clay, iron, wheat, buildings FROM villages WHERE id = $1', [villageId])).rows[0];
  const give = (r: ReturnType<typeof R>, buildings = {}) =>
    pool.query("UPDATE villages SET wood=$2, clay=$3, iron=$4, wheat=$5, buildings = buildings || $6::jsonb, resources_at = now() WHERE id=$1", [
      villageId, r.wood, r.clay, r.iron, r.wheat, JSON.stringify(buildings),
    ]);

  it('crée les deux modèles de départ et refuse les réglages invalides', async () => {
    const res = (await app.inject({ method: 'GET', url: '/api/manager', headers })).json();
    expect(res.available).toBe(true);
    expect(res.templates.map((t: any) => t.name)).toEqual(['Offensif', 'Défensif']);
    expect(res.villages).toHaveLength(1);
    expect(res.villages[0].enabled).toBe(false);
    const bad = await app.inject({ method: 'POST', url: '/api/manager/templates', headers, payload: { name: 'X', plan: { buildings: [{ building: 'tour', level: 3 }], troops: {} } } });
    expect(bad.statusCode).toBe(400);
  });

  it('ne touche à rien tant que le village n\'est pas activé', async () => {
    await give(R(50000, 50000, 50000, 50000));
    expect(await processManager(new Date())).toBe(0);
    expect((await state()).buildings).toEqual(STARTING_BUILDINGS);
  });

  it('construit d\'abord le bâtiment prioritaire et réserve ses ressources aux troupes à 0 %', async () => {
    const tpl = await app.inject({
      method: 'POST', url: '/api/manager/templates', headers,
      payload: { name: 'Test', plan: { buildings: [{ building: 'farm', level: 3 }], troops: { spearman: 50 }, troopsShare: 0 } },
    });
    const id = tpl.json().id;
    expect((await put(`/api/manager/villages/${villageId}`, { enabled: true, templateId: id })).statusCode).toBe(200);
    // Caserne 1 disponible ; ressources juste en dessous du coût de la ferme niveau 2 : aucune troupe ne doit partir.
    const cost = buildingCost('farm', 2);
    await give(R(cost.wood - 1, cost.clay - 1, cost.iron - 1, cost.wheat - 1), { barracks: 1, townhall: 3 });
    await processManager(new Date());
    expect((await pool.query('SELECT count(*)::int AS n FROM recruit_queue WHERE village_id=$1', [villageId])).rows[0].n).toBe(0);
    const blocked = (await app.inject({ method: 'GET', url: '/api/manager', headers })).json().villages[0].blocked as string;
    expect(blocked).toMatch(/Ferme niveau 2 : il manque/);
  });

  it('lance le bâtiment dès que les ressources suffisent, puis recrute avec le surplus', async () => {
    await give(R(50000, 50000, 50000, 50000), { barracks: 1, townhall: 3 });
    await processManager(new Date());
    const queue = (await pool.query('SELECT building, level FROM build_queue WHERE village_id=$1', [villageId])).rows;
    expect(queue).toEqual([{ building: 'farm', level: 2 }]);
    const recruits = (await pool.query('SELECT unit, count FROM recruit_queue WHERE village_id=$1', [villageId])).rows;
    expect(recruits).toHaveLength(1);
    expect(recruits[0].unit).toBe('spearman');
    const log = (await app.inject({ method: 'GET', url: '/api/manager', headers })).json().villages[0].log.map((l: any) => l.text);
    expect(log.some((t: string) => t.includes('Ferme niveau 2 lancé'))).toBe(true);
  });

  it("l'interrupteur de l'administration arrête tout, et rien n'est perdu", async () => {
    await saveSettings({ accountManager: 0 });
    expect(env.accountManager).toBe(0);
    await tx((c) => c.query('DELETE FROM build_queue WHERE village_id = $1', [villageId]));
    await give(R(50000, 50000, 50000, 50000));
    expect(await processManager(new Date())).toBe(0);
    expect((await pool.query('SELECT count(*)::int AS n FROM build_queue WHERE village_id=$1', [villageId])).rows[0].n).toBe(0);
    expect((await app.inject({ method: 'GET', url: '/api/manager', headers })).json().available).toBe(false);
    await saveSettings({ accountManager: 1 });
    expect(await processManager(new Date())).toBe(1);
  });

  it('compte les troupes du village en renfort ailleurs et celles réservées par un ordre planifié', async () => {
    const tpl = await app.inject({
      method: 'POST', url: '/api/manager/templates', headers,
      payload: { name: 'Objectif 50', plan: { buildings: [], troops: { spearman: 50 }, troopsShare: 100 } },
    });
    expect((await put(`/api/manager/villages/${villageId}`, { enabled: true, templateId: tpl.json().id })).statusCode).toBe(200);
    await tx(async (c) => {
      await c.query('DELETE FROM recruit_queue WHERE village_id = $1', [villageId]);
      await c.query('DELETE FROM troops WHERE home_village_id = $1', [villageId]);
    });
    const player = (await pool.query('SELECT owner_id FROM villages WHERE id = $1', [villageId])).rows[0].owner_id;
    const elsewhere = (await pool.query('SELECT id FROM villages WHERE id <> $1 ORDER BY id LIMIT 1', [villageId])).rows[0].id;
    // 30 lanciers en renfort dans un autre village (comme l'escorte d'un noble après une conquête), 20 au village réservés par un ordre planifié.
    await pool.query('INSERT INTO troops (village_id, home_village_id, units) VALUES ($1, $2, $3)', [elsewhere, villageId, JSON.stringify({ spearman: 30 })]);
    await pool.query('INSERT INTO troops (village_id, home_village_id, units) VALUES ($1, $1, $2)', [villageId, JSON.stringify({ spearman: 20 })]);
    await pool.query(
      `INSERT INTO planned_commands (group_id, player_id, origin_village_id, target_village_id, type, units, depart_at, arrive_at)
       VALUES ($1, $2, $3, $4, 'attack', $5, now() + interval '1 hour', now() + interval '2 hours')`,
      [randomUUID(), player, villageId, elsewhere, JSON.stringify({ spearman: 20 })],
    );
    await give(R(50000, 50000, 50000, 50000), { barracks: 1, townhall: 3, farm: 10 });
    await processManager(new Date());
    // Les 50 lanciers demandés existent déjà : rien à recruter.
    expect((await pool.query('SELECT count(*)::int AS n FROM recruit_queue WHERE village_id=$1', [villageId])).rows[0].n).toBe(0);
  });

  it("le bouton d'administration remplit les troupes selon le modèle, réservé à l'administrateur", async () => {
    const tpl = await app.inject({
      method: 'POST', url: '/api/manager/templates', headers,
      payload: { name: 'Objectif 80', plan: { buildings: [], troops: { spearman: 80 }, troopsShare: 100 } },
    });
    await put(`/api/manager/villages/${villageId}`, { enabled: true, templateId: tpl.json().id });
    await tx(async (c) => {
      await c.query('DELETE FROM recruit_queue WHERE village_id = $1', [villageId]);
      await c.query('DELETE FROM troops WHERE home_village_id = $1', [villageId]);
    });
    await give(R(0, 0, 0, 0), { barracks: 1, townhall: 3, farm: 10 });
    const player = (await pool.query('SELECT owner_id FROM villages WHERE id = $1', [villageId])).rows[0].owner_id;
    const url = `/api/admin/players/${player}/fill-troops`;
    expect((await app.inject({ method: 'POST', url, headers })).statusCode).toBe(403);
    env.adminUsernames.push('intendant');
    try {
      const res = await app.inject({ method: 'POST', url, headers });
      expect(res.statusCode).toBe(200);
      const units = (await pool.query('SELECT units FROM troops WHERE village_id = $1 AND home_village_id = $1', [villageId])).rows[0].units;
      expect(units.spearman).toBe(80);
      // Ressources intactes : aucun coût.
      expect(Number((await state()).wood)).toBeLessThan(10);
    } finally {
      env.adminUsernames.length = 0;
    }
  });

  it('refuse de régler le village de quelqu\'un d\'autre', async () => {
    const other = await app.inject({ method: 'POST', url: '/api/auth/register', payload: account('Voisin') });
    const h2 = { authorization: `Bearer ${other.json().token}` };
    const res = await app.inject({ method: 'PUT', url: `/api/manager/villages/${villageId}`, headers: h2, payload: { enabled: true } });
    expect(res.statusCode).toBe(403);
  });
});
