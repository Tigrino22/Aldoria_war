import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { STARTING_BUILDINGS, emptyUnits, type UnitCounts } from '@aldoria/shared';
import { pool, tx } from '../src/db';
import { migrate } from '../src/migrate';
import { Outbox } from '../src/notify';
import { createNpc, npcThink, setNpcRandom } from '../src/game/npc';
import { pickOffensiveUnits } from '../src/game/npc-offensive';
import { env } from '../src/env';
import { createVillage, setTroops } from '../src/game/village';

const HOUR = 3_600_000;
const NOON = new Date('2030-01-15T12:00:00Z');
const troops = (u: Partial<UnitCounts>): UnitCounts => ({ ...emptyUnits(), ...u });

async function makePlayer(name: string): Promise<number> {
  return (await pool.query('INSERT INTO players (username, password_hash) VALUES ($1, $2) RETURNING id', [name, 'x'])).rows[0].id;
}
async function villageOf(owner: number, x: number, y: number, units: Partial<UnitCounts> = {}): Promise<number> {
  const id = await tx((c) => createVillage(c, { ownerId: owner, name: `V${x}-${y}`, x, y, buildings: { ...STARTING_BUILDINGS }, resources: { wood: 100, clay: 100, iron: 100, wheat: 100 }, at: NOON }));
  if (Object.keys(units).length) await tx((c) => setTroops(c, id, id, troops(units)));
  return id;
}
async function scouted(npc: number, target: number, at: Date) {
  await pool.query(`INSERT INTO reports (player_id, type, title, data, created_at) VALUES ($1, 'scout', 'Espionnage', $2::jsonb, $3)`, [
    npc, JSON.stringify({ attacker: {}, defender: { village: { id: target } }, intel: { resources: { wood: 0, clay: 0, iron: 0, wheat: 0 }, buildings: { wall: 0 }, troops: emptyUnits() } }), at,
  ]);
}
const attacksOn = async (npc: number, target: number) =>
  (await pool.query("SELECT units FROM commands WHERE player_id = $1 AND target_village_id = $2 AND type = 'attack' ORDER BY id", [npc, target])).rows.map((r) => r.units as Record<string, number>);
const due = (npc: number, at: Date) => pool.query("UPDATE players SET npc_state = jsonb_build_object('offensive', jsonb_build_object('nextAt', $2::text)) WHERE id = $1", [npc, at.toISOString()]);

describe('Offensives des PNJ', () => {
  beforeAll(async () => {
    await migrate(true);
    let seed = 5;
    setNpcRandom(() => ((seed = (seed * 1664525 + 1013904223) % 4294967296) / 4294967296));
    await pool.query('DELETE FROM villages WHERE owner_id IS NULL');
  });
  afterAll(async () => {
    await pool.end();
  });

  it('pickOffensiveUnits : la moitié de l’armée, sans éclaireurs ni nobles, annulée si trop faible', () => {
    const army = troops({ swordsman: 100, cavalry: 40, ram: 10, scout: 5, noble: 2 });
    const u = pickOffensiveUnits(army, emptyUnits(), 0)!;
    expect(u).toMatchObject({ swordsman: 50, cavalry: 20, ram: 5, scout: 0, noble: 0 });
    expect(pickOffensiveUnits(army, troops({ swordsman: 5000 }), 0)).toBeNull();
  });

  it('à l’heure programmée, le PNJ frappe un joueur de sa taille avec 50 % de son armée, puis reprogramme', async () => {
    const npc = await tx((c) => createNpc(c, NOON, 'raider'));
    const home = (await pool.query('SELECT id, x, y FROM villages WHERE owner_id = $1', [npc])).rows[0];
    await tx((c) => setTroops(c, home.id, home.id, troops({ swordsman: 100, scout: 3 })));
    const player = await makePlayer('Voisin');
    const base = await villageOf(player, home.x + 2, home.y);
    await pool.query('UPDATE players SET protection_until = NULL');
    await pool.query('UPDATE villages SET points = 100 WHERE owner_id IN ($1, $2)', [npc, player]);
    await scouted(npc, base, NOON);
    await due(npc, new Date(NOON.getTime() - HOUR));
    await tx((c) => npcThink(c, new Outbox(), npc, NOON));
    const sent = await attacksOn(npc, base);
    expect(sent).toHaveLength(1);
    expect(sent[0].swordsman).toBe(50);
    const next = (await pool.query('SELECT npc_state FROM players WHERE id = $1', [npc])).rows[0].npc_state.offensive.nextAt;
    expect(Date.parse(next)).toBeGreaterThan(NOON.getTime());
  });

  it('garde-fous : joueur sous protection, heures calmes, interrupteur coupé', async () => {
    const npc = await tx((c) => createNpc(c, NOON, 'raider'));
    const home = (await pool.query('SELECT id, x, y FROM villages WHERE owner_id = $1', [npc])).rows[0];
    await tx((c) => setTroops(c, home.id, home.id, troops({ swordsman: 100, scout: 3 })));
    const player = await makePlayer('Debutant');
    const base = await villageOf(player, home.x + 2, home.y);
    await pool.query('UPDATE villages SET points = 100 WHERE owner_id IN ($1, $2)', [npc, player]);
    await scouted(npc, base, NOON);
    await due(npc, new Date(NOON.getTime() - HOUR));
    await pool.query('UPDATE players SET protection_until = $2 WHERE id = $1', [player, new Date(NOON.getTime() + 24 * HOUR)]);
    await tx((c) => npcThink(c, new Outbox(), npc, NOON));
    expect(await attacksOn(npc, base)).toHaveLength(0);
    await pool.query('UPDATE players SET protection_until = NULL');
    await tx((c) => npcThink(c, new Outbox(), npc, new Date('2030-01-15T23:00:00Z')));
    expect(await attacksOn(npc, base)).toHaveLength(0);
    env.npcOffensive = 0;
    await tx((c) => npcThink(c, new Outbox(), npc, NOON));
    env.npcOffensive = 1;
    const normal = await attacksOn(npc, base);
    expect(normal.every((u) => u.swordsman !== 50)).toBe(true);
  });
});
