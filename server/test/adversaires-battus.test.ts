import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { emptyUnits, STARTING_BUILDINGS } from '@aldoria/shared';
import { buildApp } from '../src/app';
import { pool, tx } from '../src/db';
import { migrate } from '../src/migrate';
import { Outbox } from '../src/notify';
import { processDueEvents, sendCommand, setRandom } from '../src/game/commands';
import { createVillage } from '../src/game/village';

let app: Awaited<ReturnType<typeof buildApp>>;
const HOUR = 3_600_000;

async function makePlayer(name: string) {
  const { rows } = await pool.query("INSERT INTO players (username, password_hash) VALUES ($1, 'x') RETURNING id", [name]);
  return rows[0].id as number;
}
const mk = (owner: number, x: number, y: number, troops: any, at: Date) =>
  tx((c) =>
    createVillage(c, { ownerId: owner, name: 'V', x, y, buildings: { ...STARTING_BUILDINGS }, resources: { wood: 0, clay: 0, iron: 0, wheat: 0 }, at, troops: { ...emptyUnits(), ...troops } }),
  );
const kills = async (id: number) => (await pool.query('SELECT kills_attack::int AS a, kills_defense::int AS d FROM players WHERE id = $1', [id])).rows[0];

describe('adversaires battus', () => {
  beforeAll(async () => {
    await migrate(true);
    app = await buildApp();
    setRandom(() => 0.999);
  });
  afterAll(async () => {
    await app.close();
    await pool.end();
  });

  it("l'attaquant gagne le blé consommé par les défenseurs tués, le défenseur celui des attaquants tués", async () => {
    const att = await makePlayer('Attaquant');
    const def = await makePlayer('Défenseur');
    const t0 = new Date(Date.now() - 10 * HOUR);
    const home = await mk(att, 10, 70, { swordsman: 100 }, t0);
    // 10 lanciers (1 blé) et 5 cavaliers (4 blé) : 30 adversaires battus en attaque.
    const target = await mk(def, 12, 70, { spearman: 10, cavalry: 5 }, t0);
    const s = await tx((c) => sendCommand(c, new Outbox(), att, home, { type: 'attack', targetId: target, units: { swordsman: 100 } }, t0));
    await processDueEvents(new Date(s.arriveAt.getTime() + 1));
    const report = (await pool.query("SELECT data FROM reports WHERE player_id = $1 AND type = 'attack'", [att])).rows[0].data;
    expect(report.attackerWins).toBe(true);
    const lost = report.attacker.losses.swordsman as number;
    expect(await kills(att)).toEqual({ a: 30, d: 0 });
    expect(await kills(def)).toEqual({ a: 0, d: lost });
  });

  it('les renforts partagent les adversaires battus en défense', async () => {
    const a = await makePlayer('Allié');
    const b = await makePlayer('Protégé');
    const e = await makePlayer('Ennemi');
    const t0 = new Date(Date.now() - 10 * HOUR);
    const va = await mk(a, 30, 80, { spearman: 300 }, t0);
    const vb = await mk(b, 32, 80, {}, t0);
    const ve = await mk(e, 34, 80, { swordsman: 100 }, t0);
    const s = await tx((c) => sendCommand(c, new Outbox(), a, va, { type: 'support', targetId: vb, units: { spearman: 300 } }, t0));
    await processDueEvents(new Date(s.arriveAt.getTime() + 1));
    const atk = await tx((c) => sendCommand(c, new Outbox(), e, ve, { type: 'attack', targetId: vb, units: { swordsman: 100 } }, new Date(s.arriveAt.getTime() + 1000)));
    await processDueEvents(new Date(atk.arriveAt.getTime() + 1));
    const r = (await pool.query("SELECT data FROM reports WHERE player_id = $1 AND type = 'attack'", [e])).rows[0].data;
    expect(r.attackerWins).toBe(false);
    const killed = r.attacker.losses.swordsman as number;
    expect(killed).toBe(100);
    // Tous les défenseurs sont ceux de l'allié : le propriétaire du village n'a aucune troupe sur place.
    expect(await kills(a)).toEqual({ a: 0, d: 100 });
    expect(await kills(b)).toEqual({ a: 0, d: 0 });
    expect(await kills(e)).toMatchObject({ a: expect.any(Number), d: 0 });
  });

  it('les classements et les profils exposent les chiffres, par joueur et par tribu', async () => {
    const reg = async (username: string) => {
      const res = await app.inject({ method: 'POST', url: '/api/auth/register', payload: { username, password: 'secret123' } });
      return { authorization: `Bearer ${res.json().token}` };
    };
    const h = await reg('Lecteur');
    await pool.query('UPDATE players SET kills_attack = 0, kills_defense = 0');
    await pool.query("UPDATE players SET kills_attack = 50, kills_defense = 5 WHERE username = 'Attaquant'");
    await pool.query("UPDATE players SET kills_attack = 1, kills_defense = 90 WHERE username = 'Défenseur'");
    const tribe = (await pool.query("INSERT INTO tribes (name, tag) VALUES ('Les Braves', 'BRV') RETURNING id")).rows[0].id;
    await pool.query("UPDATE players SET tribe_id = $1 WHERE username IN ('Attaquant', 'Défenseur')", [tribe]);

    const get = async (url: string) => (await app.inject({ method: 'GET', url, headers: h })).json();
    const atk = await get('/api/ranking/players?type=attack');
    expect(atk[0]).toMatchObject({ username: 'Attaquant', rank: 1, killsAttack: 50 });
    const def = await get('/api/ranking/players?type=defense');
    expect(def[0]).toMatchObject({ username: 'Défenseur', rank: 1, killsDefense: 90 });
    const tribes = await get('/api/ranking/tribes?type=attack');
    expect(tribes[0]).toMatchObject({ tag: 'BRV', killsAttack: 51, killsDefense: 95 });
    // Le classement par points reste le classement par défaut.
    expect((await get('/api/ranking/players'))[0]).toHaveProperty('points');

    expect(await get('/api/players/Attaquant')).toMatchObject({ killsAttack: 50, killsDefense: 5 });
    expect(await get(`/api/tribes/${tribe}`)).toMatchObject({ killsAttack: 51, killsDefense: 95 });
  });
});
