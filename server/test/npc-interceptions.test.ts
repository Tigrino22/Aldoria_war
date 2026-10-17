import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { STARTING_BUILDINGS, emptyUnits, type UnitCounts } from '@aldoria/shared';
import { pool, tx } from '../src/db';
import { migrate } from '../src/migrate';
import { Outbox } from '../src/notify';
import { createNpc } from '../src/game/npc';
import { interceptStep, winsInField, type InterceptHostiles } from '../src/game/npc-intercept';
import { createVillage, setTroops } from '../src/game/village';

const troops = (u: Partial<UnitCounts>): UnitCounts => ({ ...emptyUnits(), ...u });
const player = async (name: string) => (await pool.query("INSERT INTO players (username, password_hash) VALUES ($1, 'x') RETURNING id", [name])).rows[0].id as number;
const village = (owner: number | null, x: number, y: number) =>
  tx((c) => createVillage(c, { ownerId: owner, name: `V${x}-${y}`, x, y, buildings: STARTING_BUILDINGS, resources: { wood: 0, clay: 0, iron: 0, wheat: 5000 }, at: new Date(), troops: emptyUnits() }));
/** Mouvement parti il y a 10 minutes, qui arrive dans 10 heures. */
const move = async (playerId: number, from: number, to: number, u: Partial<UnitCounts>, type = 'attack') =>
  (
    await pool.query(
      `INSERT INTO commands (type, origin_village_id, target_village_id, home_village_id, player_id, units, sent_at, arrive_at)
       VALUES ($1, $2, $3, $2, $4, $5, now() - interval '10 minutes', now() + interval '600 minutes') RETURNING id`,
      [type, from, to, playerId, JSON.stringify(troops(u))],
    )
  ).rows[0].id as number;
const interceptionsOf = async (npc: number) => (await pool.query("SELECT target_command_id FROM commands WHERE player_id = $1 AND type = 'intercept'", [npc])).rows.map((r) => r.target_command_id as number);

let n = 0;
async function npcAt(units: Partial<UnitCounts>) {
  const npc = await tx((c) => createNpc(c, new Date(), 'offense'));
  const home = (await pool.query('SELECT id FROM villages WHERE owner_id = $1', [npc])).rows[0].id as number;
  n++;
  const x = 400 + n * 60;
  await pool.query('UPDATE villages SET x = $2, y = 400 WHERE id = $1', [home, x]);
  await tx((c) => setTroops(c, home, home, troops(units)));
  return { npc, home, x, y: 400 };
}
const none: InterceptHostiles = { friends: [], tribes: [], players: [], quiet: false };

describe('interceptions des PNJ', () => {
  beforeAll(async () => {
    await migrate(true);
    await pool.query('UPDATE players SET protection_until = NULL');
  });
  afterAll(async () => {
    await pool.end();
  });

  it('winsInField : ne part que pour une victoire nette en rase campagne', () => {
    expect(winsInField(troops({ swordsman: 500 }), troops({ spearman: 50 }), 0)).toBe(true);
    expect(winsInField(troops({ swordsman: 50 }), troops({ spearman: 2000 }), 0)).toBe(false);
    expect(winsInField(troops({}), troops({ spearman: 1 }), 0)).toBe(false);
  });

  it('intercepte une attaque qui vise son village, pas une armée de passage sans querelle', async () => {
    const s = await npcAt({ swordsman: 600, cavalry: 100 });
    const raider = await player('Assaillant');
    await pool.query('UPDATE players SET protection_until = NULL WHERE id = $1', [raider]);
    const far = await village(raider, s.x - 40, s.y);
    const onUs = await move(raider, far, s.home, { spearman: 60 });
    const left = await village(raider, s.x - 20, s.y - 2);
    const right = await village(null, s.x + 20, s.y - 2);
    const passing = await move(raider, left, right, { spearman: 60 });
    const sent = await tx((c) => interceptStep(c, new Outbox(), s.npc, s.home, none, new Date()));
    expect(sent).toBe(true);
    expect(await interceptionsOf(s.npc)).toEqual([onUs]);
    // Déjà interceptée : il ne repart pas une deuxième fois, et l'armée de passage ne le regarde pas.
    expect(await tx((c) => interceptStep(c, new Outbox(), s.npc, s.home, none, new Date()))).toBe(false);
    expect(await interceptionsOf(s.npc)).not.toContain(passing);
  });

  it('intercepte au passage les armées de ses ennemis, sauf si elles sont trop fortes ou pendant les heures calmes', async () => {
    const s = await npcAt({ swordsman: 600 });
    const foe = await player('Ennemi');
    await pool.query('UPDATE players SET protection_until = NULL WHERE id = $1', [foe]);
    const left = await village(foe, s.x - 20, s.y - 2);
    const right = await village(null, s.x + 20, s.y - 2);
    const strong = await move(foe, left, right, { spearman: 5000 }, 'support');
    const hostiles = { ...none, players: [foe] };
    expect(await tx((c) => interceptStep(c, new Outbox(), s.npc, s.home, { ...hostiles, quiet: true }, new Date()))).toBe(false);
    expect(await tx((c) => interceptStep(c, new Outbox(), s.npc, s.home, hostiles, new Date()))).toBe(false);
    const weak = await move(foe, left, right, { spearman: 40 }, 'support');
    expect(await tx((c) => interceptStep(c, new Outbox(), s.npc, s.home, hostiles, new Date()))).toBe(true);
    expect(await interceptionsOf(s.npc)).toEqual([weak]);
    expect(await interceptionsOf(s.npc)).not.toContain(strong);
  });

  it("n'intercepte jamais un joueur sous protection débutant ni sa propre tribu", async () => {
    const s = await npcAt({ swordsman: 600 });
    const newbie = await player('Novice');
    await pool.query("UPDATE players SET protection_until = now() + interval '1 day' WHERE id = $1", [newbie]);
    const far = await village(newbie, s.x - 40, s.y);
    await move(newbie, far, s.home, { spearman: 10 });
    expect(await tx((c) => interceptStep(c, new Outbox(), s.npc, s.home, none, new Date()))).toBe(false);
  });
});
