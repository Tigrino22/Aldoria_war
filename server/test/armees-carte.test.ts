import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { STARTING_BUILDINGS, emptyUnits, type MapArmy, type UnitCounts } from '@aldoria/shared';
import { buildApp } from '../src/app';
import { pool, tx } from '../src/db';
import { migrate } from '../src/migrate';
import { createSession } from '../src/auth';
import { createVillage } from '../src/game/village';

let app: Awaited<ReturnType<typeof buildApp>>;
const units = (u: Partial<UnitCounts>): UnitCounts => ({ ...emptyUnits(), ...u });

describe('armées en marche sur la carte', () => {
  beforeAll(async () => {
    await migrate(true);
    app = await buildApp();
  });
  afterAll(async () => {
    await app.close();
    await pool.end();
  });

  it('montre ses armées, celles de sa tribu, les menaces, et les autres seulement à portée de vue', async () => {
    const tribeId = (await pool.query("INSERT INTO tribes (name, tag) VALUES ('Vigies', 'VIG') RETURNING id")).rows[0].id;
    const player = async (name: string, tribe: number | null) =>
      (await pool.query("INSERT INTO players (username, password_hash, tribe_id) VALUES ($1, 'x', $2) RETURNING id", [name, tribe])).rows[0].id as number;
    const village = (owner: number | null, x: number, y: number) =>
      tx((c) => createVillage(c, { ownerId: owner, name: `V${x}-${y}`, x, y, buildings: STARTING_BUILDINGS, resources: { wood: 0, clay: 0, iron: 0, wheat: 0 }, at: new Date(), troops: emptyUnits() }));
    const move = async (playerId: number, from: number, to: number, type: string, u: Partial<UnitCounts>) =>
      (
        await pool.query(
          `INSERT INTO commands (type, origin_village_id, target_village_id, home_village_id, player_id, units, sent_at, arrive_at)
           VALUES ($1, $2, $3, $2, $4, $5, now() - interval '10 minutes', now() + interval '50 minutes') RETURNING id`,
          [type, from, to, playerId, JSON.stringify(units(u))],
        )
      ).rows[0].id as number;

    // Joueur connecté par une session créée directement (pas de mot de passe dans le test).
    const meId = await player('Vigie', tribeId);
    const homeId = await village(meId, 50, 50);
    const home = { id: homeId, x: 50, y: 50 };
    const headers = { authorization: `Bearer ${await tx((c) => createSession(c, meId))}` };
    const friend = await player('Compagnon', tribeId);
    const stranger = await player('Inconnu', null);
    const far = await village(stranger, home.x + 40, home.y + 40);
    const farB = await village(null, home.x + 40, home.y - 40);
    const friendV = await village(friend, home.x + 30, home.y + 30);
    // Passe devant notre village : de 20 cases à gauche à 20 cases à droite, 2 cases au-dessus.
    const left = await village(stranger, home.x - 20, home.y - 2);
    const right = await village(null, home.x + 20, home.y - 2);

    const own = await move(meId, home.id, farB, 'attack', { swordsman: 3000 });
    const mate = await move(friend, friendV, farB, 'support', { spearman: 50 });
    const threat = await move(stranger, far, home.id, 'attack', { swordsman: 10 });
    const passing = await move(stranger, left, right, 'attack', { cavalry: 200 });
    const hidden = await move(stranger, far, farB, 'attack', { swordsman: 10 });
    const nearV = await village(stranger, home.x + 2, home.y + 1);
    const close = await move(stranger, nearV, home.id, 'attack', { cavalry: 30, noble: 1 });

    const res = await app.inject({ method: 'GET', url: '/api/map/armies', headers });
    expect(res.statusCode).toBe(200);
    const byId = new Map((res.json() as MapArmy[]).map((a) => [a.id, a]));
    expect(byId.get(own)).toMatchObject({ rel: 'own', type: 'attack', size: 3, owner: 'Vigie', kinds: ['foot'] });
    expect(byId.get(mate)).toMatchObject({ rel: 'tribe', type: 'support', size: 1 });
    // Une attaque qui vise notre village : on voit tout son trajet, mais pas ce qu'elle contient tant qu'elle est à plus de 3 cases.
    const t = byId.get(threat)!;
    expect(t).toMatchObject({ rel: 'threat', type: 'attack', size: 2, owner: 'Inconnu', kinds: ['foot'], interceptable: true, from: { x: home.x + 40.5, y: home.y + 40.5 } });
    expect(Date.parse(t.spotFrom!)).toBeGreaterThan(Date.now());
    // Repérée à 3 cases ou moins : sa composition apparaît.
    expect(byId.get(close)).toMatchObject({ rel: 'threat', kinds: ['horse', 'noble'], interceptable: true });
    expect(byId.has(hidden)).toBe(false);
    // Armée aperçue : ni origine, ni destination, ni propriétaire, seulement la portion à portée de vue.
    const seen = byId.get(passing)!;
    expect(seen).toMatchObject({ rel: 'seen', type: 'unknown', owner: null, size: 2, kinds: ['horse'], interceptable: true });
    expect(Math.abs(seen.from.x - (home.x + 0.5))).toBeLessThanOrEqual(3);
    expect(Math.abs(seen.to.x - (home.x + 0.5))).toBeLessThanOrEqual(3);
    expect(Date.parse(seen.fromAt)).toBeGreaterThan(Date.now() - 10 * 60_000);
  });
});
