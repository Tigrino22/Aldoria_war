import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { STARTING_BUILDINGS, emptyUnits } from '@aldoria/shared';
import { pool, tx } from '../src/db';
import { env } from '../src/env';
import { migrate } from '../src/migrate';
import { Outbox } from '../src/notify';
import { ensureNpcTribes, npcThink, setNpcRandom } from '../src/game/npc';
import { npcTribeOf } from '../src/game/npc-tribes';
import { warEnemiesOf } from '../src/game/npc-wars';
import { MAX_DECLARED_WARS, PLAYER_WAR_DAYS, declareWar, endWar, planPlayerWars, refreshTribeWars, tribeWarsView } from '../src/game/tribe-wars';
import { createVillage, setTroops } from '../src/game/village';

const NOON = new Date('2030-01-15T12:00:00Z');
const NIGHT = new Date('2030-01-15T22:00:00Z');
const DAY = 86_400_000;

describe('guerres de tribu : règles des PNJ', () => {
  const npc = (id: number, over = {}) => ({ id, nextAt: NOON.toISOString(), villages: 3, busy: false, ...over });

  it('une tribu de PNJ prête déclare la guerre à une tribu libre ; une même tribu de joueurs n’a qu’un agresseur', () => {
    const plan = planPlayerWars([npc(1), npc(2)], [10], NOON, () => 0);
    expect(plan.declare).toEqual([{ npcId: 1, targetId: 10 }]);
    // La seconde tribu de PNJ, sans cible libre, réessaie une heure plus tard.
    expect(plan.reschedule.find((r) => r.npcId === 2)!.nextAt).toBe(new Date(NOON.getTime() + 3_600_000).toISOString());
    // Après une guerre, la tribu attend la durée de la guerre plus au moins 3 jours.
    const next = Date.parse(plan.reschedule.find((r) => r.npcId === 1)!.nextAt);
    expect(next - NOON.getTime()).toBeGreaterThanOrEqual((PLAYER_WAR_DAYS + 3) * DAY);
  });

  it('ignore une tribu occupée, sans village ou pas encore prête, et date les tribus neuves dans la journée', () => {
    const plan = planPlayerWars(
      [npc(1, { busy: true }), npc(2, { villages: 0 }), npc(3, { nextAt: new Date(NOON.getTime() + 1e9).toISOString() }), npc(4, { nextAt: null })],
      [10],
      NOON,
      () => 0.5,
    );
    expect(plan.declare).toEqual([]);
    expect(plan.reschedule).toHaveLength(1);
    expect(plan.reschedule[0].npcId).toBe(4);
    expect(Date.parse(plan.reschedule[0].nextAt) - NOON.getTime()).toBeLessThanOrEqual(DAY);
  });
});

describe('guerres de tribu : base de données', () => {
  const human = async (name: string) => (await pool.query("INSERT INTO players (username, password_hash) VALUES ($1, 'x') RETURNING id", [name])).rows[0].id as number;
  const tribeOf = async (leader: number, tag: string) => {
    const id = (await pool.query('INSERT INTO tribes (name, tag, leader_id) VALUES ($1, $2, $3) RETURNING id', [`Tribu ${tag}`, tag, leader])).rows[0].id as number;
    await pool.query('UPDATE players SET tribe_id = $2 WHERE id = $1', [leader, id]);
    return id;
  };
  const member = async (name: string, tribe: number) => {
    const id = await human(name);
    await pool.query('UPDATE players SET tribe_id = $2 WHERE id = $1', [id, tribe]);
    return id;
  };
  const village = (owner: number, x: number, y: number) =>
    tx((c) => createVillage(c, { ownerId: owner, name: `V${x}-${y}`, x, y, buildings: { ...STARTING_BUILDINGS }, resources: { wood: 5000, clay: 5000, iron: 5000, wheat: 5000 }, at: NOON }));
  const declare = (who: number, target: number, now = NOON) => tx((c) => declareWar(c, new Outbox(), who, target, now));

  beforeAll(async () => {
    await migrate(true);
    let seed = 7;
    setNpcRandom(() => ((seed = (seed * 1664525 + 1013904223) % 4294967296) / 4294967296));
  });
  afterAll(async () => {
    await pool.end();
  });

  it('seul le chef déclare, jamais à soi-même ni deux fois à la même tribu ; les membres adverses sont prévenus', async () => {
    const a = await human('Chef A');
    const ta = await tribeOf(a, 'AAA');
    const a2 = await member('Soldat A', ta);
    const b = await human('Chef B');
    const tb = await tribeOf(b, 'BBB');
    const b2 = await member('Soldat B', tb);
    await village(a, 10, 10);
    await village(b, 12, 10);

    await expect(declare(a2, tb)).rejects.toThrow(/chef/);
    await expect(declare(a, ta)).rejects.toThrow(/propre tribu/);
    await declare(a, tb);
    await expect(declare(a, tb)).rejects.toThrow(/déjà en cours/);
    await expect(declare(b, ta)).rejects.toThrow(/déjà en cours/);
    // Les deux membres de la tribu visée ont reçu un message.
    const inbox = (await pool.query("SELECT to_id FROM messages WHERE subject LIKE '[Guerre]%' ORDER BY to_id")).rows.map((r) => r.to_id);
    expect(inbox).toEqual([b, b2].sort((x, y) => x - y));

    const mine = await tx((c) => tribeWarsView(c, a, NOON));
    expect(mine.active).toHaveLength(1);
    expect(mine.active[0]).toMatchObject({ direction: 'declared', other: { tag: 'BBB' } });
    expect(mine.targets.map((t) => t.tag)).not.toContain('BBB');
    const theirs = await tx((c) => tribeWarsView(c, b2, NOON));
    expect(theirs.active[0]).toMatchObject({ direction: 'received', declaredBy: 'Chef A', other: { tag: 'AAA' } });
    expect(theirs.canDeclare).toBe(false);

    // Seule la tribu qui a déclaré y met fin.
    const warId = mine.active[0].id;
    await expect(tx((c) => endWar(c, new Outbox(), b, warId, NOON))).rejects.toThrow(/déclaré/);
    await tx((c) => endWar(c, new Outbox(), a, warId, NOON));
    expect((await tx((c) => tribeWarsView(c, a, NOON))).active).toHaveLength(0);
    expect((await tx((c) => tribeWarsView(c, a, NOON))).recent).toHaveLength(1);
  });

  it('plafonne le nombre de guerres déclarées et termine les guerres échues', async () => {
    const boss = await human('Chef Z');
    const tz = await tribeOf(boss, 'ZZZ');
    await village(boss, 60, 60);
    for (let i = 0; i < MAX_DECLARED_WARS; i++) {
      const o = await human(`Chef Z${i}`);
      const t = await tribeOf(o, `Z${i}X`);
      await village(o, 70 + i * 3, 60);
      await declare(boss, t);
    }
    const extra = await human('Chef trop');
    const tExtra = await tribeOf(extra, 'TRP');
    await village(extra, 90, 60);
    await expect(declare(boss, tExtra)).rejects.toThrow(/plus de 3 guerres/);
    expect((await tx((c) => tribeWarsView(c, boss, NOON))).canDeclare).toBe(false);

    const after = new Date(NOON.getTime() + (PLAYER_WAR_DAYS + 1) * DAY);
    await refreshTribeWars(after, () => 0.5);
    expect((await tx((c) => tribeWarsView(c, boss, after))).active).toHaveLength(0);
    expect((await pool.query('SELECT count(*)::int AS n FROM tribe_wars WHERE ended_at IS NULL AND declarer_id = $1', [tz])).rows[0].n).toBe(0);
    // Un message de fin de guerre a été envoyé aux tribus de joueurs concernées.
    expect((await pool.query("SELECT count(*)::int AS n FROM messages WHERE subject LIKE '[Guerre] Fin%'")).rows[0].n).toBeGreaterThan(0);
  });

  describe('contre une tribu de PNJ', () => {
    let npcMember: number;
    let npcTribe: number;
    let playerTribe: number;
    let boss: number;
    let humanVillage: number;
    let npcVillage: number;

    const hits = async () => (await pool.query("SELECT 1 FROM commands WHERE player_id = $1 AND type = 'attack' AND target_village_id = $2", [npcMember, humanVillage])).rows.length;
    // Des cavaliers seulement : à pied, l'arrivée tomberait en pleine nuit, et un PNJ ne frappe jamais un joueur à ce moment-là.
    const prepare = async () => {
      await pool.query('DELETE FROM commands');
      await tx((c) => setTroops(c, npcVillage, npcVillage, { ...emptyUnits(), cavalry: 300, scout: 5 }));
    };

    it('une guerre déclarée par un joueur à un PNJ fait frapper les membres, hors du champ habituel, jamais de nuit', async () => {
      await tx((c) => ensureNpcTribes(c, NOON, { tribes: 1, size: 2 }));
      npcTribe = (await pool.query('SELECT id FROM tribes WHERE is_npc')).rows[0].id;
      npcMember = (await pool.query('SELECT id FROM players WHERE tribe_id = $1 AND id NOT IN (SELECT leader_id FROM tribes WHERE id = $1)', [npcTribe])).rows[0].id;
      boss = await human('Chef Défi');
      playerTribe = await tribeOf(boss, 'DEF');
      npcVillage = (await pool.query('SELECT id, x, y FROM villages WHERE owner_id = $1', [npcMember])).rows[0].id;
      const at = (await pool.query('SELECT x, y FROM villages WHERE id = $1', [npcVillage])).rows[0];
      await pool.query('UPDATE villages SET x = 0, y = 0 WHERE owner_id IS NULL');
      humanVillage = await village(boss, at.x + 30, at.y);
      await pool.query('UPDATE players SET protection_until = NULL');
      await tx((c) =>
        c.query(
          `INSERT INTO reports (player_id, type, title, data, created_at) VALUES ($1, 'scout', 'Espionnage', $2::jsonb, $3)`,
          [npcMember, JSON.stringify({ attacker: {}, defender: { village: { id: humanVillage } }, intel: { resources: { wood: 5000, clay: 5000, iron: 5000, wheat: 5000 }, buildings: { wall: 0 }, troops: emptyUnits() } }), NOON],
        ),
      );
      await prepare();

      // Sans guerre, le village est trop loin pour un pillage ordinaire.
      await tx((c) => npcThink(c, new Outbox(), npcMember, NOON));
      expect(await hits()).toBe(0);

      await declare(boss, npcTribe, NOON);
      const info = (await tx((c) => npcTribeOf(c, npcMember, NOON)))!;
      expect(warEnemiesOf(info, NOON)).toEqual([playerTribe]);
      // Pas de frappe pendant les heures calmes, même en guerre.
      await tx((c) => npcThink(c, new Outbox(), npcMember, NIGHT));
      expect(await hits()).toBe(0);
      await prepare();
      await tx((c) => npcThink(c, new Outbox(), npcMember, NOON));
      expect(await hits()).toBeGreaterThan(0);
    });

    it('la riposte et les guerres entre PNJ n’y changent rien ; l’interrupteur des guerres contre les joueurs, si', async () => {
      env.npcRevenge = 0;
      const info = (await tx((c) => npcTribeOf(c, npcMember, NOON)))!;
      expect(warEnemiesOf(info, NOON)).toEqual([playerTribe]);
      env.npcRevenge = 1;
      env.npcPlayerWars = 0;
      expect(warEnemiesOf(info, NOON)).toEqual([]);
      await prepare();
      await tx((c) => npcThink(c, new Outbox(), npcMember, NOON));
      expect(await hits()).toBe(0);
      // Désactivées, on ne peut pas non plus déclarer la guerre à un PNJ.
      const other = await human('Chef Autre');
      await tribeOf(other, 'OTH');
      await expect(declare(other, npcTribe, NOON)).rejects.toThrow(/désactivées/);
      env.npcPlayerWars = 1;
    });

    it('une tribu de PNJ déclare d’elle-même la guerre à une tribu de joueurs libre (sans provocation)', async () => {
      await pool.query('DELETE FROM tribe_wars');
      await pool.query("UPDATE tribes SET npc_state = npc_state || jsonb_build_object('nextPlayerWarAt', $1::text) WHERE is_npc", [new Date(NOON.getTime() - 1000).toISOString()]);
      await pool.query('UPDATE players SET protection_until = NULL');
      await pool.query('DELETE FROM messages');
      await refreshTribeWars(NOON, () => 0);
      const wars = (await pool.query('SELECT declarer_id, target_id, declared_by FROM tribe_wars')).rows;
      // Les tribus de joueurs libres sont toutes visées au plus une fois, par une tribu de PNJ.
      expect(wars).toHaveLength(1);
      expect(wars[0]).toMatchObject({ declarer_id: npcTribe, declared_by: null });
      const targeted = wars[0].target_id as number;
      expect((await pool.query("SELECT count(*)::int AS n FROM messages WHERE subject LIKE '%vous déclare la guerre'")).rows[0].n).toBe(
        (await pool.query('SELECT count(*)::int AS n FROM players WHERE tribe_id = $1', [targeted])).rows[0].n,
      );
      const targetLeader = (await pool.query('SELECT leader_id FROM tribes WHERE id = $1', [targeted])).rows[0].leader_id as number;
      const view = await tx((c) => tribeWarsView(c, targetLeader, NOON));
      expect(view.active[0]).toMatchObject({ direction: 'received', declaredBy: null, other: { isNpc: true } });
      // Coupé depuis l'administration, plus aucune nouvelle déclaration.
      await pool.query('DELETE FROM tribe_wars');
      await pool.query("UPDATE tribes SET npc_state = npc_state || jsonb_build_object('nextPlayerWarAt', $1::text) WHERE is_npc", [new Date(NOON.getTime() - 1000).toISOString()]);
      env.npcPlayerWars = 0;
      await refreshTribeWars(NOON, () => 0);
      env.npcPlayerWars = 1;
      expect((await pool.query('SELECT count(*)::int AS n FROM tribe_wars')).rows[0].n).toBe(0);
    });
  });
});
