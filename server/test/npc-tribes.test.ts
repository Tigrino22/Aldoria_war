import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { emptyUnits, normalizeUnits } from '@aldoria/shared';
import { pool, tx } from '../src/db';
import { migrate } from '../src/migrate';
import { Outbox } from '../src/notify';
import { createNpc, ensureNpcTribes, npcThink, processNpcs, setNpcRandom } from '../src/game/npc';
import { tribeMemberProfiles, tribeRelations } from '../src/game/npc-rules';
import { alertTribes, npcTribeOf, saveTribeState } from '../src/game/npc-tribes';
import { createVillage, getTroops, setTroops } from '../src/game/village';
import { sendCommand } from '../src/game/commands';

const NOON = new Date('2030-01-15T12:00:00Z');
const NIGHT = new Date('2030-01-15T22:00:00Z');

describe('règles des tribus de PNJ', () => {
  it('les tribus s’allient deux par deux et se déclarent rivales de leurs voisines', () => {
    const r = tribeRelations([1, 2, 3, 4]);
    expect(r.get(1)).toEqual({ allies: [2], rivals: [3, 4] });
    expect(r.get(3)!.allies).toEqual([4]);
    expect(r.get(3)!.rivals).toEqual([1, 2]);
    expect(tribeRelations([7]).get(7)).toEqual({ allies: [], rivals: [] });
    expect(tribeRelations([1, 2]).get(1)).toEqual({ allies: [2], rivals: [] });
  });

  it('chaque tribu a un chef pillard et un conquérant', () => {
    const p = tribeMemberProfiles(5);
    expect(p[0]).toBe('raider');
    expect(p).toContain('conqueror');
    expect(p).toHaveLength(5);
  });
});

describe('tribus de PNJ', () => {
  beforeAll(async () => {
    await migrate(true);
    let seed = 7;
    setNpcRandom(() => ((seed = (seed * 1664525 + 1013904223) % 4294967296) / 4294967296));
  });
  afterAll(async () => {
    await pool.end();
  });

  it('crée des tribus complètes, avec un chef et des relations', async () => {
    await tx((c) => ensureNpcTribes(c, NOON, { tribes: 4, size: 3 }));
    const tribes = (await pool.query('SELECT id, leader_id, is_npc, npc_state FROM tribes ORDER BY id')).rows;
    expect(tribes).toHaveLength(4);
    for (const t of tribes) {
      expect(t.is_npc).toBe(true);
      const members = (await pool.query('SELECT id, is_npc FROM players WHERE tribe_id = $1', [t.id])).rows;
      expect(members).toHaveLength(3);
      expect(members.every((m) => m.is_npc)).toBe(true);
      expect(members.map((m) => m.id)).toContain(t.leader_id);
    }
    expect(tribes[0].npc_state.allies).toEqual([tribes[1].id]);
    expect(tribes[0].npc_state.rivals).toEqual([tribes[2].id, tribes[3].id]);
    // Relancer ne duplique rien.
    await tx((c) => ensureNpcTribes(c, NOON, { tribes: 4, size: 3 }));
    expect((await pool.query('SELECT count(*)::int AS n FROM tribes')).rows[0].n).toBe(4);
    expect((await pool.query('SELECT count(*)::int AS n FROM players')).rows[0].n).toBe(12);
  });

  it('un membre envoie du renfort à un village de sa tribu attaqué, avant l’arrivée de l’attaque', async () => {
    const [a, b] = (await pool.query('SELECT p.id FROM players p WHERE tribe_id = (SELECT min(id) FROM tribes) ORDER BY p.id LIMIT 2')).rows;
    const [va] = (await pool.query('SELECT id, x, y FROM villages WHERE owner_id = $1', [a.id])).rows;
    const [vb] = (await pool.query('SELECT id FROM villages WHERE owner_id = $1', [b.id])).rows;
    await tx(async (c) => {
      await setTroops(c, va.id, va.id, { ...emptyUnits(), spearman: 40, swordsman: 10 });
      await c.query('UPDATE villages SET x = $2, y = $3 WHERE id = $1', [vb.id, va.x + 3, va.y]);
    });
    // Un attaquant extérieur, à portée.
    const humanId = (await pool.query("INSERT INTO players (username, password_hash) VALUES ('Brigand', 'x') RETURNING id")).rows[0].id;
    const hv = await tx((c) =>
      createVillage(c, { ownerId: humanId, name: 'Repaire', x: va.x + 3, y: va.y + 4, buildings: {} as never, resources: { wood: 0, clay: 0, iron: 0, wheat: 0 }, at: NOON }),
    );
    await tx(async (c) => {
      await setTroops(c, hv, hv, { ...emptyUnits(), swordsman: 30 });
      await c.query('UPDATE players SET protection_until = NULL');
      await sendCommand(c, new Outbox(), humanId, hv, { type: 'attack', targetId: vb.id, units: { swordsman: 30 } }, NOON);
    });
    await alertTribes(NOON);
    const woken = (await pool.query('SELECT npc_next_action_at FROM players WHERE id = $1', [a.id])).rows[0].npc_next_action_at;
    expect(new Date(woken).getTime()).toBeLessThanOrEqual(NOON.getTime());
    await tx((c) => npcThink(c, new Outbox(), a.id, new Date(NOON.getTime() + 1000)));
    const support = (await pool.query("SELECT units, target_village_id FROM commands WHERE player_id = $1 AND type = 'support'", [a.id])).rows;
    expect(support).toHaveLength(1);
    expect(support[0].target_village_id).toBe(vb.id);
    expect(normalizeUnits(support[0].units).spearman).toBe(24);
    // Une seule fois par menace.
    await tx((c) => npcThink(c, new Outbox(), a.id, new Date(NOON.getTime() + 2000)));
    expect((await pool.query("SELECT count(*)::int AS n FROM commands WHERE player_id = $1 AND type = 'support'", [a.id])).rows[0].n).toBe(1);
    // Et les alertes ne se répètent pas pour la même attaque.
    await pool.query('UPDATE players SET npc_next_action_at = $1', [new Date(NOON.getTime() + 3_600_000)]);
    await alertTribes(NOON);
    const again = (await pool.query('SELECT npc_next_action_at FROM players WHERE id = $1', [a.id])).rows[0].npc_next_action_at;
    expect(new Date(again).getTime()).toBe(NOON.getTime() + 3_600_000);
  });

  it('le chef ouvre une opération contre un joueur, ses compagnons la rejoignent dans la fenêtre, jamais la nuit', async () => {
    await pool.query('TRUNCATE commands, reports RESTART IDENTITY CASCADE');
    const tribe = (await pool.query('SELECT id, leader_id FROM tribes ORDER BY id LIMIT 1')).rows[0];
    const members = (await pool.query('SELECT p.id FROM players p WHERE tribe_id = $1 ORDER BY p.id', [tribe.id])).rows.map((r) => r.id as number);
    const leader = tribe.leader_id as number;
    const others = members.filter((m) => m !== leader);
    const [lv] = (await pool.query('SELECT id, x, y FROM villages WHERE owner_id = $1', [leader])).rows;
    const target = (await pool.query("SELECT id FROM villages WHERE owner_id = (SELECT id FROM players WHERE username = 'Brigand')")).rows[0];
    await pool.query('UPDATE villages SET x = $2, y = $3 WHERE id = $1', [target.id, lv.x + 2, lv.y + 2]);
    for (const m of others) {
      const [v] = (await pool.query('SELECT id FROM villages WHERE owner_id = $1', [m])).rows;
      await pool.query('UPDATE villages SET x = $2, y = $3 WHERE id = $1', [v.id, lv.x, lv.y + 1 + others.indexOf(m)]);
    }
    await tx(async (c) => {
      for (const m of members) {
        const [v] = (await c.query('SELECT id FROM villages WHERE owner_id = $1', [m])).rows;
        await setTroops(c, v.id, v.id, { ...emptyUnits(), swordsman: 200, cavalry: 100, scout: 5, spearman: 5 });
      }
      // Le chef connaît déjà le village visé.
      await c.query(
        `INSERT INTO reports (player_id, type, title, data, created_at) VALUES ($1, 'scout', 'Espionnage', $2::jsonb, $3)`,
        [leader, JSON.stringify({ attacker: {}, defender: { village: { id: target.id } }, intel: { resources: {}, buildings: { wall: 0 }, troops: emptyUnits() } }), NOON],
      );
      for (const m of others) {
        await c.query(
          `INSERT INTO reports (player_id, type, title, data, created_at) VALUES ($1, 'scout', 'Espionnage', $2::jsonb, $3)`,
          [m, JSON.stringify({ attacker: {}, defender: { village: { id: target.id } }, intel: { resources: {}, buildings: { wall: 0 }, troops: emptyUnits() } }), NOON],
        );
      }
    });
    await pool.query('UPDATE villages SET loyalty = loyalty WHERE id = $1', [target.id]);
    await pool.query("UPDATE players SET protection_until = NULL");

    // Le chef attaque un joueur et ouvre l'opération (tirage fixé : il choisit le joueur plutôt qu'un village rival).
    setNpcRandom(() => 0.1);
    const day = new Date(NOON.getTime() + 60_000);
    await tx((c) => npcThink(c, new Outbox(), leader, day));
    const hits = async () => (await pool.query("SELECT player_id FROM commands WHERE type = 'attack' AND target_village_id = $1", [target.id])).rows.map((r) => r.player_id as number);
    expect(await hits()).toEqual([leader]);
    const info = await tx((c) => npcTribeOf(c, leader));
    expect(info!.state.op?.targetId).toBe(target.id);
    expect(info!.state.op!.joined).toEqual([leader]);

    // Un compagnon qui réfléchit dans la fenêtre rejoint l'opération.
    await tx((c) => npcThink(c, new Outbox(), others[0], new Date(day.getTime() + 30_000)));
    expect(new Set(await hits())).toEqual(new Set([leader, others[0]]));

    // Un compagnon qui arrive trop tard (fenêtre dépassée) ne rejoint pas.
    const late = new Date(Date.parse(info!.state.op!.landBy) + 60_000);
    await tx((c) => npcThink(c, new Outbox(), others[1], late));
    expect(await hits()).not.toContain(others[1]);
    // L'opération expirée est effacée.
    expect((await tx((c) => npcTribeOf(c, leader)))!.state.op).toBeNull();
  });

  it('pas d’opération contre un joueur pendant les heures calmes', async () => {
    await pool.query('TRUNCATE commands RESTART IDENTITY CASCADE');
    const tribe = (await pool.query('SELECT id, leader_id FROM tribes ORDER BY id LIMIT 1')).rows[0];
    const info = (await tx((c) => npcTribeOf(c, tribe.leader_id)))!;
    info.state.op = null;
    delete info.state.lastOpAt;
    await tx((c) => saveTribeState(c, info));
    await tx((c) => npcThink(c, new Outbox(), tribe.leader_id, NIGHT));
    const t = (await pool.query("SELECT count(*)::int AS n FROM commands cm JOIN villages v ON v.id = cm.target_village_id WHERE cm.type = 'attack' AND v.owner_id IN (SELECT id FROM players WHERE NOT is_npc)")).rows[0].n;
    expect(t).toBe(0);
  });

  it('les tribus rivales se font la guerre', async () => {
    await pool.query('TRUNCATE commands, reports RESTART IDENTITY CASCADE');
    const [t1, , t3] = (await pool.query('SELECT id FROM tribes ORDER BY id')).rows;
    const a = (await pool.query('SELECT p.id FROM players p WHERE tribe_id = $1 ORDER BY p.id LIMIT 1 OFFSET 1', [t1.id])).rows[0].id;
    const b = (await pool.query('SELECT p.id FROM players p WHERE tribe_id = $1 ORDER BY p.id LIMIT 1', [t3.id])).rows[0].id;
    const [va] = (await pool.query('SELECT id, x, y FROM villages WHERE owner_id = $1', [a])).rows;
    const [vb] = (await pool.query('SELECT id FROM villages WHERE owner_id = $1', [b])).rows;
    // On écarte les barbares de la zone pour que la seule proie soit le village rival.
    await pool.query('UPDATE villages SET x = $2, y = $3 WHERE id = $1', [vb.id, va.x + 4, va.y]);
    await pool.query('UPDATE villages SET x = 0, y = 0 WHERE owner_id IS NULL');
    await tx(async (c) => {
      await setTroops(c, va.id, va.id, { ...emptyUnits(), swordsman: 200, cavalry: 100, scout: 5 });
      await c.query(
        `INSERT INTO reports (player_id, type, title, data, created_at) VALUES ($1, 'scout', 'Espionnage', $2::jsonb, $3)`,
        [a, JSON.stringify({ attacker: {}, defender: { village: { id: vb.id } }, intel: { resources: {}, buildings: { wall: 0 }, troops: emptyUnits() } }), NIGHT],
      );
    });
    setNpcRandom(() => 0.1);
    // Même en pleine nuit : les heures calmes protègent les joueurs, pas les PNJ rivaux.
    await tx((c) => npcThink(c, new Outbox(), a, NIGHT));
    const hit = (await pool.query("SELECT 1 FROM commands WHERE player_id = $1 AND type = 'attack' AND target_village_id = $2", [a, vb.id])).rows;
    expect(hit).toHaveLength(1);
  });

  it('processNpcs réveille et fait réfléchir les PNJ sans erreur', async () => {
    await pool.query('UPDATE players SET npc_next_action_at = $1 WHERE is_npc', [NOON]);
    const n = await processNpcs(new Date(NOON.getTime() + 10 * 60_000), 50);
    expect(n).toBeGreaterThan(0);
    expect(await getTroops(pool as never, 1, 1)).toBeDefined();
  });
});
