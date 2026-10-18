import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { STARTING_BUILDINGS, emptyUnits, type IncomingAttack, type UnitCounts } from '@aldoria/shared';
import { buildApp } from '../src/app';
import { pool, tx } from '../src/db';
import { migrate } from '../src/migrate';
import { sessionForPlayer } from './session-helper';
import { createVillage } from '../src/game/village';

let app: Awaited<ReturnType<typeof buildApp>>;
const units = (u: Partial<UnitCounts>): UnitCounts => ({ ...emptyUnits(), ...u });

describe('attaques entrantes', () => {
  beforeAll(async () => {
    await migrate(true);
    app = await buildApp();
  });
  afterAll(async () => {
    await app.close();
    await pool.end();
  });

  it('liste les attaques qui visent mes villages, avec origine et destination, sans dévoiler une armée pas encore repérée', async () => {
    const tribeId = (await pool.query("INSERT INTO tribes (name, tag) VALUES ('Loups gris', 'LOU') RETURNING id")).rows[0].id;
    const player = async (name: string, tribe: number | null, npc = false) =>
      (await pool.query("INSERT INTO players (username, password_hash, tribe_id, is_npc) VALUES ($1, 'x', $2, $3) RETURNING id", [name, tribe, npc])).rows[0].id as number;
    const village = (owner: number | null, name: string, x: number, y: number) =>
      tx((c) => createVillage(c, { ownerId: owner, name, x, y, buildings: STARTING_BUILDINGS, resources: { wood: 0, clay: 0, iron: 0, wheat: 0 }, at: new Date(), troops: emptyUnits() }));
    const move = async (playerId: number | null, from: number, to: number, type: string, u: Partial<UnitCounts>, inMinutes: number, processed = false) =>
      (
        await pool.query(
          `INSERT INTO commands (type, origin_village_id, target_village_id, home_village_id, player_id, units, sent_at, arrive_at, processed)
           VALUES ($1, $2, $3, $2, $4, $5, now() - interval '10 minutes', now() + make_interval(mins => $6), $7) RETURNING id`,
          [type, from, to, playerId, JSON.stringify(units(u)), inMinutes, processed],
        )
      ).rows[0].id as number;

    const meId = await player('Guetteur', null);
    const homeA = await village(meId, 'Pierrefort', 50, 50);
    const homeB = await village(meId, 'Valclair', 60, 50);
    const headers = { authorization: `Bearer ${await sessionForPlayer(meId)}` };

    const enemy = await player('Brisefer', tribeId);
    const npc = await player('Mordred', null, true);
    const enemyFar = await village(enemy, 'Roc-Noir', 90, 80);
    const enemyNear = await village(enemy, 'Gué-Rouge', 52, 51);
    const npcV = await village(npc, 'Tour de Mordred', 50, 80);
    const barbarian = await village(null, 'Ruines', 45, 46);
    const elsewhere = await village(null, 'Hameau', 10, 10);

    const far = await move(enemy, enemyFar, homeA, 'attack', { swordsman: 500 }, 120);
    const noble = await move(enemy, enemyNear, homeB, 'attack', { cavalry: 30, noble: 1 }, 30);
    const fromNpc = await move(npc, npcV, homeA, 'attack', { spearman: 50 }, 60);
    const scouts = await move(null, barbarian, homeB, 'attack', { scout: 5 }, 5);
    // Ni les soutiens, ni les attaques déjà résolues, ni celles qui visent un autre joueur.
    await move(enemy, enemyFar, homeA, 'support', { spearman: 10 }, 15);
    await move(enemy, enemyFar, homeA, 'attack', { swordsman: 10 }, 15, true);
    await move(enemy, enemyFar, elsewhere, 'attack', { swordsman: 10 }, 15);

    const res = await app.inject({ method: 'GET', url: '/api/incoming', headers });
    expect(res.statusCode).toBe(200);
    const list = res.json() as IncomingAttack[];
    // Triées par heure d'arrivée.
    expect(list.map((a) => a.id)).toEqual([scouts, noble, fromNpc, far]);
    const byId = new Map(list.map((a) => [a.id, a]));

    // Armée lointaine : origine, joueur, tribu, destination et distance connues, contenu caché jusqu'au repérage à 10 cases.
    const f = byId.get(far)!;
    expect(f).toMatchObject({
      origin: { id: enemyFar, name: 'Roc-Noir', x: 90, y: 80, ownerName: 'Brisefer', ownerTag: 'LOU', npc: false },
      target: { id: homeA, name: 'Pierrefort', x: 50, y: 50 },
      distance: 50,
      spotted: false,
      size: null,
      kinds: null,
      scouts: false,
    });
    expect(Date.parse(f.spotFrom!)).toBeGreaterThan(Date.now());
    expect(Date.parse(f.spotFrom!)).toBeLessThan(Date.parse(f.arriveAt));
    expect(JSON.stringify(f)).not.toContain('swordsman');

    // Partie à portée de vue : le noble se voit, c'est une conquête qui s'annonce.
    expect(byId.get(noble)).toMatchObject({ target: { id: homeB, name: 'Valclair' }, spotted: true, spotFrom: null, kinds: expect.arrayContaining(['horse', 'noble']), size: 2 });
    expect(byId.get(noble)!.distance).toBeCloseTo(8.1, 1);
    // Les PNJ sont signalés comme tels, les barbares n'ont pas de propriétaire, des éclaireurs seuls se reconnaissent.
    expect(byId.get(fromNpc)!.origin).toMatchObject({ ownerName: 'Mordred', npc: true });
    expect(byId.get(scouts)).toMatchObject({ origin: { ownerName: null, ownerTag: null, npc: false }, spotted: true, scouts: true });

    // Un autre joueur ne voit pas mes attaques entrantes ; sans session, refus.
    const other = await sessionForPlayer(enemy);
    expect((await app.inject({ method: 'GET', url: '/api/incoming', headers: { authorization: `Bearer ${other}` } })).json()).toEqual([]);
    expect((await app.inject({ method: 'GET', url: '/api/incoming' })).statusCode).toBe(401);
  });
});
