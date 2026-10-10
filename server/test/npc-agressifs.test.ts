import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { STARTING_BUILDINGS, emptyUnits, type UnitCounts } from '@aldoria/shared';
import { pool, tx } from '../src/db';
import { migrate } from '../src/migrate';
import { Outbox } from '../src/notify';
import { sendCommand } from '../src/game/commands';
import { createNpc, ensureDailyNpc, npcThink, processNpcs, setNpcRandom } from '../src/game/npc';
import { alertAttackedNpcs } from '../src/game/npc-tribes';
import { createVillage, setTroops } from '../src/game/village';

const HOUR = 3_600_000;
const NOON = new Date('2030-01-15T12:00:00Z');
const NIGHT = new Date('2030-01-15T22:00:00Z');

const troops = (u: Partial<UnitCounts>): UnitCounts => ({ ...emptyUnits(), ...u });

async function makePlayer(name: string): Promise<number> {
  return (await pool.query('INSERT INTO players (username, password_hash) VALUES ($1, $2) RETURNING id', [name, 'x'])).rows[0].id;
}

async function villageOf(owner: number, x: number, y: number, units: Partial<UnitCounts> = {}): Promise<number> {
  const id = await tx((c) =>
    createVillage(c, { ownerId: owner, name: `V${x}-${y}`, x, y, buildings: { ...STARTING_BUILDINGS }, resources: { wood: 100, clay: 100, iron: 100, wheat: 100 }, at: NOON }),
  );
  if (Object.keys(units).length) await tx((c) => setTroops(c, id, id, troops(units)));
  return id;
}

/** Donne au PNJ un renseignement frais : la cible est sans défense. */
async function scouted(npc: number, target: number, at: Date) {
  await pool.query(`INSERT INTO reports (player_id, type, title, data, created_at) VALUES ($1, 'scout', 'Espionnage', $2::jsonb, $3)`, [
    npc,
    JSON.stringify({ attacker: {}, defender: { village: { id: target } }, intel: { resources: {}, buildings: { wall: 0 }, troops: emptyUnits() } }),
    at,
  ]);
}

const attacksOn = async (npc: number, target: number) =>
  (await pool.query("SELECT units FROM commands WHERE player_id = $1 AND target_village_id = $2 AND type = 'attack' ORDER BY id", [npc, target])).rows.map((r) => r.units as Record<string, number>);

describe('PNJ agressifs', () => {
  beforeAll(async () => {
    await migrate(true);
    let seed = 11;
    setNpcRandom(() => ((seed = (seed * 1664525 + 1013904223) % 4294967296) / 4294967296));
    await pool.query('DELETE FROM villages WHERE owner_id IS NULL');
  });
  afterAll(async () => {
    await pool.end();
  });

  it('un bâtisseur riposte contre un joueur qui l’a attaqué, sans attendre le délai entre deux attaques', async () => {
    const npc = await tx((c) => createNpc(c, NOON, 'builder'));
    const home = (await pool.query('SELECT id, x, y FROM villages WHERE owner_id = $1', [npc])).rows[0];
    await tx((c) => setTroops(c, home.id, home.id, troops({ swordsman: 80, scout: 3 })));
    const player = await makePlayer('Agresseur');
    const base = await villageOf(player, home.x + 2, home.y, { swordsman: 20 });
    await villageOf(player, home.x + 3, home.y + 1);
    await scouted(npc, base, NOON);
    await pool.query('UPDATE players SET protection_until = NULL');

    await tx((c) => sendCommand(c, new Outbox(), player, base, { type: 'attack', targetId: home.id, units: { swordsman: 20 } }, NOON));
    await alertAttackedNpcs(NOON);
    const woken = (await pool.query('SELECT npc_next_action_at FROM players WHERE id = $1', [npc])).rows[0].npc_next_action_at;
    expect(new Date(woken).getTime()).toBeLessThanOrEqual(NOON.getTime());
    await tx((c) => npcThink(c, new Outbox(), npc, new Date(NOON.getTime() + 1000)));
    const revenge = await attacksOn(npc, base);
    expect(revenge).toHaveLength(1);
    expect(revenge[0].swordsman).toBeGreaterThan(0);
  });

  it('un PNJ attaqué ne riposte pas pendant les heures calmes', async () => {
    const npc = await tx((c) => createNpc(c, NOON, 'raider'));
    const home = (await pool.query('SELECT id, x, y FROM villages WHERE owner_id = $1', [npc])).rows[0];
    await tx((c) => setTroops(c, home.id, home.id, troops({ swordsman: 80, scout: 3 })));
    const player = await makePlayer('Nocturne');
    const base = await villageOf(player, home.x + 2, home.y + 2, { swordsman: 20 });
    await scouted(npc, base, NIGHT);
    await pool.query('UPDATE players SET protection_until = NULL');
    await tx((c) => sendCommand(c, new Outbox(), player, base, { type: 'attack', targetId: home.id, units: { swordsman: 20 } }, NIGHT));
    await tx((c) => npcThink(c, new Outbox(), npc, new Date(NIGHT.getTime() + 1000)));
    expect(await attacksOn(npc, base)).toHaveLength(0);
  });

  it('un pillard attaque un joueur sans provocation le jour', async () => {
    const npc = await tx((c) => createNpc(c, NOON, 'raider'));
    const home = (await pool.query('SELECT id, x, y FROM villages WHERE owner_id = $1', [npc])).rows[0];
    await tx((c) => setTroops(c, home.id, home.id, troops({ swordsman: 80, scout: 3 })));
    const player = await makePlayer('Paisible');
    const farm = await villageOf(player, home.x - 2, home.y);
    await pool.query('UPDATE players SET protection_until = NULL');
    const t = new Date(NOON.getTime() + 25 * HOUR);
    await scouted(npc, farm, t);
    await tx((c) => npcThink(c, new Outbox(), npc, t));
    expect((await attacksOn(npc, farm)).filter((u) => (u.swordsman ?? 0) > 0)).toHaveLength(1);
  });

  it('tout PNJ avec des nobles tente de conquérir un joueur, même son dernier village, une fois par jour au plus', async () => {
    const npc = await tx((c) => createNpc(c, NOON, 'builder'));
    const home = (await pool.query('SELECT id, x, y FROM villages WHERE owner_id = $1', [npc])).rows[0];
    const army = { swordsman: 120, ram: 5, noble: 6 };
    await tx((c) => setTroops(c, home.id, home.id, troops(army)));
    const lone = await makePlayer('Isolé');
    const only = await villageOf(lone, home.x + 2, home.y - 2);
    const rich = await makePlayer('Étendu');
    const first = await villageOf(rich, home.x - 2, home.y - 3);
    await villageOf(rich, home.x - 30, home.y - 30);
    await pool.query('UPDATE players SET protection_until = NULL');
    const day = new Date(NOON.getTime() + 50 * HOUR);
    for (let i = 0; i < 6; i++) {
      const t = new Date(day.getTime() + i * 7 * HOUR);
      await scouted(npc, only, t);
      await scouted(npc, first, t);
      await tx((c) => npcThink(c, new Outbox(), npc, t));
      await tx((c) => setTroops(c, home.id, home.id, troops(army)));
      await pool.query('UPDATE commands SET processed = true WHERE player_id = $1', [npc]);
    }
    const onOnly = await attacksOn(npc, only);
    const onFirst = await attacksOn(npc, first);
    expect(onOnly.length + onFirst.length).toBeGreaterThan(0);
    expect(onOnly.some((u) => u.noble === 4)).toBe(true);
    // Au plus une tentative de conquête par jour sur un même joueur : 6 tours espacés de 7 h font au plus 2 tentatives par joueur.
    expect(onOnly.filter((u) => (u.noble ?? 0) > 0).length).toBeLessThanOrEqual(2);
    expect(onFirst.filter((u) => (u.noble ?? 0) > 0).length).toBeLessThanOrEqual(2);
  });

  it('trois nouveaux PNJ par jour, un toutes les 8 heures, jusqu’au plafond', async () => {
    await pool.query('DELETE FROM players WHERE is_npc');
    await tx((c) => createNpc(c, new Date()));
    const base = new Date();
    const at = (hours: number) => new Date(base.getTime() + hours * HOUR);
    // Le dernier PNJ date d'à l'instant : il faut attendre 8 heures.
    expect(await tx((c) => ensureDailyNpc(c, at(0), { perDay: 3, max: 10 }))).toBeNull();
    expect(await tx((c) => ensureDailyNpc(c, at(7), { perDay: 3, max: 10 }))).toBeNull();
    const first = await tx((c) => ensureDailyNpc(c, at(9), { perDay: 3, max: 10 }));
    expect(first).not.toBeNull();
    const created = (await pool.query('SELECT username, npc_profile, tribe_id FROM players WHERE id = $1', [first])).rows[0];
    expect(created.username).not.toMatch(/PNJ/);
    expect(created.tribe_id).toBeNull();
    // Plafond atteint, ou arrivées désactivées : personne.
    const count = (await pool.query('SELECT count(*)::int AS n FROM players WHERE is_npc')).rows[0].n as number;
    expect(await tx((c) => ensureDailyNpc(c, at(100), { perDay: 3, max: count }))).toBeNull();
    expect(await tx((c) => ensureDailyNpc(c, at(100), { perDay: 0, max: 10 }))).toBeNull();
  });

  it('processNpcs ne plante pas avec les nouvelles règles', async () => {
    await pool.query('UPDATE players SET npc_next_action_at = $1 WHERE is_npc', [NOON]);
    await expect(processNpcs(new Date(NOON.getTime() + 10 * 60_000), 50)).resolves.toBeGreaterThanOrEqual(0);
  });
});
