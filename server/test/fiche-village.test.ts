import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { emptyUnits } from '@aldoria/shared';
import { buildApp } from '../src/app';
import { pool } from '../src/db';
import { migrate } from '../src/migrate';

let app: Awaited<ReturnType<typeof buildApp>>;

async function register(username: string) {
  const res = await app.inject({ method: 'POST', url: '/api/auth/register', payload: { username, password: 'secret123' } });
  expect(res.statusCode).toBe(200);
  const headers = { authorization: `Bearer ${res.json().token as string}` };
  const me = (await app.inject({ method: 'GET', url: '/api/me', headers })).json();
  return { headers, village: me.villages[0] as { id: number; x: number; y: number; name: string } };
}

describe("fiche d'un village", () => {
  it('montre les informations publiques et seulement les rapports du joueur qui regarde', async () => {
    const espion = await register('Espion');
    const cible = await register('Cible');
    const autre = await register('Curieux');
    const sheet = (who: { headers: Record<string, string> }, v: { x: number; y: number }) =>
      app.inject({ method: 'GET', url: `/api/village-sheet/${v.x}/${v.y}`, headers: who.headers });

    // Un espionnage réussi de l'espion sur la cible, et une conquête passée de ce village.
    const scout = {
      attacker: { playerName: 'Espion', village: { id: espion.village.id, name: espion.village.name, x: espion.village.x, y: espion.village.y }, units: { ...emptyUnits(), scout: 5 }, losses: emptyUnits() },
      defender: { playerName: 'Cible', village: { id: cible.village.id, name: cible.village.name, x: cible.village.x, y: cible.village.y }, units: null, losses: null },
      intel: { troops: { ...emptyUnits(), spearman: 12 }, resources: { wood: 500, clay: 400, iron: 300, wheat: 200 }, buildings: { wall: 3, warehouse: 1, woodcutter: 1, claypit: 1, ironmine: 1, farm: 1 } },
    };
    const espionId = (await pool.query('SELECT id FROM players WHERE username = $1', ['Espion'])).rows[0].id;
    await pool.query("INSERT INTO reports (player_id, type, title, data, created_at) VALUES ($1, 'scout', 'Espionnage de Cible', $2, now())", [espionId, JSON.stringify(scout)]);
    await pool.query("INSERT INTO conquest_log (at, conqueror_name, loser_name, village_name, x, y) VALUES (now() - interval '1 day', 'Ancien', 'Perdant', 'Vieux nom', $1, $2)", [cible.village.x, cible.village.y]);

    const seen = (await sheet(espion, cible.village)).json();
    expect(seen).toMatchObject({ id: cible.village.id, kind: 'village', owner: { name: 'Cible' }, relation: 'other', protected: true, loyalty: null });
    expect(seen.reports).toHaveLength(1);
    expect(seen.reports[0]).toMatchObject({ type: 'scout', title: 'Espionnage de Cible' });
    expect(seen.intel).toMatchObject({ wall: 3, source: 'scout' });
    expect(seen.intel.troops.spearman).toBe(12);
    expect(seen.lootable.total).toBeGreaterThan(0);
    expect(seen.conquests).toEqual([{ at: expect.any(String), conqueror: 'Ancien', loser: 'Perdant' }]);

    // Un autre joueur ne voit pas les rapports de l'espion.
    const other = (await sheet(autre, cible.village)).json();
    expect(other.reports).toEqual([]);
    expect(other.intel).toBeNull();
    expect(other.conquests).toHaveLength(1);

    // Son propre village : loyauté, aucun renseignement.
    const own = (await sheet(cible, cible.village)).json();
    expect(own).toMatchObject({ relation: 'mine', loyalty: 100, intel: null, lootable: null });

    // Un village barbare, puis une case vide.
    const barb = (await pool.query("SELECT x, y FROM villages WHERE owner_id IS NULL AND kind = 'village' LIMIT 1")).rows[0];
    if (barb) expect((await sheet(autre, barb)).json()).toMatchObject({ relation: 'barbarian', owner: null });
    expect((await app.inject({ method: 'GET', url: '/api/village-sheet/9999/9999', headers: autre.headers })).statusCode).toBe(404);
  });

  beforeAll(async () => {
    await migrate(true);
    app = await buildApp();
  });
  afterAll(async () => {
    await app.close();
    await pool.end();
  });
});
