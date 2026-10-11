import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { STARTING_BUILDINGS, emptyUnits, populationCapacity, populationOf } from '@aldoria/shared';
import { pool, tx } from '../src/db';
import { migrate } from '../src/migrate';
import { Outbox } from '../src/notify';
import { processDueEvents } from '../src/game/commands';
import { createNpc, ensureNpcs, npcThink, processNpcs, setNpcRandom } from '../src/game/npc';
import { FARM_LEAD, armyTarget, villageRoles } from '../src/game/npc-roles';
import { chooseBuilding, isQuiet, nextRecruit, npcCap, pickWinningUnits } from '../src/game/npc-rules';
import { createVillage, getTroops, setTroops } from '../src/game/village';

const MIN = 60_000;
// En janvier, Paris est à UTC+1 : 12 h UTC = 13 h (de jour), 22 h UTC = 23 h (heures calmes).
const NOON = new Date('2030-01-15T12:00:00Z');
const NIGHT = new Date('2030-01-15T22:00:00Z');

describe('noms des PNJ', () => {
  it('la liste est longue, sans doublon, et un nom pris reçoit un surnom puis un numéro', async () => {
    const { NPC_FIRST_NAMES, NPC_EPITHETS, pickNpcName } = await import('../src/game/npc-names');
    expect(NPC_FIRST_NAMES.length).toBeGreaterThanOrEqual(250);
    expect(new Set(NPC_FIRST_NAMES.map((n) => n.toLowerCase())).size).toBe(NPC_FIRST_NAMES.length);
    expect(NPC_EPITHETS.length).toBeGreaterThanOrEqual(40);
    const used = new Set<string>();
    for (let i = 0; i < 200; i++) {
      const name = await pickNpcName(() => 0, async (n) => used.has(n));
      expect(used.has(name)).toBe(false);
      used.add(name);
    }
    expect([...used].some((n) => /\d$/.test(n))).toBe(true);
  });
});

describe('règles des PNJ', () => {
  it('les heures calmes vont de 22 h à 8 h, heure de Paris', () => {
    const quiet = (iso: string) => isQuiet(new Date(iso), 'Europe/Paris', 22, 8);
    expect(quiet('2030-01-15T20:59:00Z')).toBe(false); // 21 h 59
    expect(quiet('2030-01-15T21:00:00Z')).toBe(true); // 22 h
    expect(quiet('2030-01-16T06:59:00Z')).toBe(true); // 7 h 59
    expect(quiet('2030-01-16T07:00:00Z')).toBe(false); // 8 h
    expect(quiet('2030-07-15T20:30:00Z')).toBe(true); // 22 h 30 en heure d'été
  });

  it('le plafond de niveau monte avec l’âge du monde et plus vite en difficulté élevée', () => {
    expect(npcCap(0, 1)).toBe(2);
    expect(npcCap(10, 1)).toBe(12);
    expect(npcCap(10, 1.5)).toBeGreaterThan(npcCap(10, 1));
    expect(npcCap(1000, 1)).toBe(20);
  });

  it('un bâtiment dont les conditions manquent n’est pas choisi avant l’hôtel de ville niveau 3', () => {
    const levels = { ...STARTING_BUILDINGS, townhall: 1 };
    for (let i = 0; i < 40; i++) {
      const next = chooseBuilding('raider', levels, 5);
      if (!next) break;
      if (levels.townhall < 3) expect(['barracks', 'wall', 'market']).not.toContain(next);
      levels[next] += 1;
    }
    expect(levels.townhall).toBeGreaterThanOrEqual(3);
  });

  it('recrute d’abord ce qui manque le plus, parmi les unités disponibles', () => {
    const wanted = nextRecruit('raider', 'offense', { ...STARTING_BUILDINGS, barracks: 1 }, emptyUnits(), 4, 1);
    expect(wanted.map((w) => w.unit)).toEqual(['spearman']);
    const later = nextRecruit('raider', 'offense', { ...STARTING_BUILDINGS, barracks: 5 }, { ...emptyUnits(), spearman: 100 }, 4, 1);
    expect(later.map((w) => w.unit)).not.toContain('spearman');
  });

  it('recrute des hallebardiers dès que la caserne le permet (niveau 4)', () => {
    const avant = nextRecruit('builder', 'defense', { ...STARTING_BUILDINGS, barracks: 3 }, emptyUnits(), 4, 1);
    expect(avant.map((w) => w.unit)).not.toContain('halberdier');
    const apres = nextRecruit('builder', 'defense', { ...STARTING_BUILDINGS, barracks: 4 }, emptyUnits(), 4, 1);
    expect(apres.map((w) => w.unit)).toContain('halberdier');
  });

  it('n’attaque que si la victoire est nette, avec toute l’armée face à des défenseurs et le minimum face à un village vide', () => {
    const defenders = { ...emptyUnits(), spearman: 20 };
    expect(pickWinningUnits({ ...emptyUnits(), swordsman: 10 }, defenders, 0)).toBeNull();
    const units = pickWinningUnits({ ...emptyUnits(), swordsman: 400 }, defenders, 0);
    expect(units).toEqual({ ...emptyUnits(), swordsman: 400 });
    const vide = pickWinningUnits({ ...emptyUnits(), swordsman: 400 }, emptyUnits(), 0);
    expect(vide!.swordsman).toBeLessThan(400);
  });

  it('les Bâtisseurs ne recrutent pas de nobles', () => {
    expect(armyTarget('builder', 'offense', 20, 1).noble).toBe(0);
    expect(armyTarget('raider', 'offense', 20, 1).noble).toBeGreaterThan(0);
    expect(armyTarget('raider', 'defense', 20, 1).noble).toBe(0);
  });

  it('un village offensif recrute de quoi frapper, un village défensif de quoi tenir : jamais d’unités hors rôle', () => {
    const off = armyTarget('conqueror', 'offense', 20, 1);
    const def = armyTarget('conqueror', 'defense', 20, 1);
    expect(off.swordsman).toBeGreaterThan(off.spearman);
    expect(off.cavalry).toBeGreaterThan(0);
    expect(off.halberdier).toBe(0);
    expect(def.spearman + def.halberdier).toBeGreaterThan(5 * def.swordsman);
    expect([def.cavalry, def.ram, def.noble]).toEqual([0, 0, 0]);
  });

  it('l\'armée visée remplit la ferme visée, à tous les niveaux et dans tous les rôles', () => {
    for (const cap of [2, 5, 10, 17, 20]) {
      const room = populationCapacity(Math.min(20, cap + FARM_LEAD));
      for (const profile of ['builder', 'raider', 'conqueror'] as const) {
        for (const role of ['offense', 'defense'] as const) {
          const pop = populationOf(armyTarget(profile, role, cap, 1));
          expect(pop).toBeLessThanOrEqual(room);
          expect(pop).toBeGreaterThan(room - 20);
        }
      }
    }
    // Une difficulté de 0,5 ne remplit que la moitié.
    expect(populationOf(armyTarget('raider', 'defense', 10, 0.5))).toBeLessThan(populationCapacity(13) * 0.55);
  });

  it('le recrutement suit le rôle du village', () => {
    const buildings = { ...STARTING_BUILDINGS, barracks: 10, townhall: 10, wall: 3 };
    const defense = nextRecruit('conqueror', 'defense', buildings, emptyUnits(), 12, 1).map((w) => w.unit);
    const offense = nextRecruit('conqueror', 'offense', buildings, emptyUnits(), 12, 1).map((w) => w.unit);
    expect(defense).toEqual(expect.arrayContaining(['spearman', 'halberdier']));
    for (const u of ['cavalry', 'ram', 'noble']) expect(defense).not.toContain(u);
    expect(offense).toEqual(expect.arrayContaining(['swordsman', 'cavalry', 'ram', 'noble']));
    expect(offense).not.toContain('halberdier');
  });

  it('les villages d’un PNJ se répartissent entre offensifs et défensifs', () => {
    expect(villageRoles('builder', 1)).toEqual(['defense']);
    expect(villageRoles('raider', 1)).toEqual(['offense']);
    expect(villageRoles('conqueror', 1)).toEqual(['offense']);
    for (const profile of ['builder', 'raider', 'conqueror'] as const) {
      for (let n = 2; n <= 8; n++) {
        const roles = villageRoles(profile, n);
        expect(roles).toHaveLength(n);
        expect(roles).toContain('offense');
        expect(roles).toContain('defense');
      }
    }
    expect(villageRoles('builder', 2)).toEqual(['defense', 'offense']);
    expect(villageRoles('raider', 4).filter((r) => r === 'offense')).toHaveLength(3);
    expect(villageRoles('builder', 4).filter((r) => r === 'offense')).toHaveLength(1);
  });
});

describe('PNJ en jeu', () => {
  beforeAll(async () => {
    await migrate(true);
    let seed = 42;
    setNpcRandom(() => ((seed = (seed * 1664525 + 1013904223) % 4294967296) / 4294967296));
  });
  afterAll(async () => {
    await pool.end();
  });

  it('complète la population jusqu’au nombre voulu et ne se connecte pas comme un joueur', async () => {
    await tx((c) => ensureNpcs(c, NOON));
    const { rows } = await pool.query('SELECT username, password_hash, npc_profile FROM players WHERE is_npc');
    expect(rows).toHaveLength(6);
    expect(rows.every((r) => !r.username.includes('PNJ') && r.password_hash === '!')).toBe(true);
    expect(new Set(rows.map((r) => r.username)).size).toBe(6);
    await tx((c) => ensureNpcs(c, NOON));
    expect((await pool.query('SELECT count(*)::int AS n FROM players WHERE is_npc')).rows[0].n).toBe(6);
    expect((await pool.query('SELECT count(*)::int AS n FROM villages v JOIN players p ON p.id = v.owner_id WHERE p.is_npc')).rows[0].n).toBe(6);
  });

  it('un PNJ construit et recrute tout seul avec le temps', async () => {
    const npc = await tx((c) => createNpc(c, NOON, 'builder'));
    const village = (await pool.query('SELECT id FROM villages WHERE owner_id = $1', [npc])).rows[0].id as number;
    await pool.query("UPDATE villages SET buildings = buildings || '{\"townhall\": 3, \"barracks\": 1, \"farm\": 3}'::jsonb, wood = 900, clay = 900, iron = 900, wheat = 900 WHERE id = $1", [village]);
    let t = NOON;
    for (let i = 0; i < 12; i++) {
      await tx((c) => npcThink(c, new Outbox(), npc, t));
      t = new Date(t.getTime() + 20 * MIN);
      await processDueEvents(t);
    }
    const queue = (await pool.query('SELECT count(*)::int AS n FROM build_queue WHERE village_id = $1', [village])).rows[0].n;
    const v = (await pool.query('SELECT buildings, points FROM villages WHERE id = $1', [village])).rows[0];
    expect(queue + v.points).toBeGreaterThan(0);
    expect(Object.values(v.buildings as Record<string, number>).reduce((a, b) => a + b, 0)).toBeGreaterThanOrEqual(9 + 5);
    const recruits = (await pool.query('SELECT count(*)::int AS n FROM recruit_queue WHERE village_id = $1', [village])).rows[0].n;
    const troops = await tx((c) => getTroops(c, village, village));
    expect(recruits + troops.spearman + troops.swordsman).toBeGreaterThan(0);
  });

  it('un pillard espionne puis attaque un joueur le jour, une seule fois par jour, jamais pendant les heures calmes', async () => {
    await pool.query("DELETE FROM villages WHERE owner_id IS NULL");
    const npc = await tx((c) => createNpc(c, NOON, 'raider'));
    const home = (await pool.query('SELECT id, x, y FROM villages WHERE owner_id = $1', [npc])).rows[0];
    await setNpcTroops(home.id, { swordsman: 150, scout: 5 });
    const player = (await pool.query("INSERT INTO players (username, password_hash) VALUES ('Cible', 'x') RETURNING id")).rows[0].id as number;
    const target = await tx((c) =>
      createVillage(c, { ownerId: player, name: 'Ferme', x: home.x + 1, y: home.y + 1, buildings: { ...STARTING_BUILDINGS }, resources: { wood: 100, clay: 100, iron: 100, wheat: 100 }, at: NOON }),
    );
    const sentTo = async () => (await pool.query("SELECT units FROM commands WHERE target_village_id = $1 AND player_id = $2 AND type = 'attack' ORDER BY id", [target, npc])).rows.map((r) => r.units);

    // La nuit : rien, ni espions ni armée.
    await tx((c) => npcThink(c, new Outbox(), npc, NIGHT));
    expect(await sentTo()).toHaveLength(0);

    // Le jour : d'abord des éclaireurs.
    await tx((c) => npcThink(c, new Outbox(), npc, NOON));
    const first = await sentTo();
    expect(first).toHaveLength(1);
    expect(first[0].scout).toBeGreaterThan(0);
    expect(first[0].swordsman ?? 0).toBe(0);
    await processDueEvents(new Date(NOON.getTime() + 30 * MIN));

    // Puis l'attaque, avec le renseignement obtenu.
    const later = new Date(NOON.getTime() + 31 * MIN);
    await tx((c) => npcThink(c, new Outbox(), npc, later));
    const second = await sentTo();
    expect(second).toHaveLength(2);
    expect(second[1].swordsman).toBeGreaterThan(0);

    // Pas de nouvelle attaque armée avant 6 heures, et un seul raid par jour sur le même joueur.
    await processDueEvents(new Date(NOON.getTime() + 3 * 3_600_000));
    await setNpcTroops(home.id, { swordsman: 150, scout: 5 });
    await tx((c) => npcThink(c, new Outbox(), npc, new Date(NOON.getTime() + 4 * 3_600_000)));
    expect((await sentTo()).filter((u) => (u.swordsman ?? 0) > 0)).toHaveLength(1);
    await tx((c) => npcThink(c, new Outbox(), npc, new Date(NOON.getTime() + 7 * 3_600_000)));
    expect((await sentTo()).filter((u) => (u.swordsman ?? 0) > 0)).toHaveLength(1);
  });

  it('processNpcs ne réveille que les PNJ dont l’heure est venue et les reprogramme', async () => {
    await pool.query("UPDATE players SET npc_next_action_at = $1 WHERE is_npc", [new Date(NOON.getTime() + 10 * 3_600_000)]);
    expect(await processNpcs(NOON)).toBe(0);
    const one = (await pool.query('SELECT id FROM players WHERE is_npc LIMIT 1')).rows[0].id;
    await pool.query('UPDATE players SET npc_next_action_at = $2 WHERE id = $1', [one, NOON]);
    expect(await processNpcs(NOON)).toBe(1);
    const next = (await pool.query('SELECT npc_next_action_at FROM players WHERE id = $1', [one])).rows[0].npc_next_action_at;
    expect(new Date(next).getTime()).toBeGreaterThan(NOON.getTime());
  });

  it('un PNJ sans village repart ailleurs après un délai', async () => {
    const npc = await tx((c) => createNpc(c, NOON, 'builder'));
    await pool.query('DELETE FROM villages WHERE owner_id = $1', [npc]);
    await tx((c) => npcThink(c, new Outbox(), npc, NOON));
    expect((await pool.query('SELECT 1 FROM villages WHERE owner_id = $1', [npc])).rowCount).toBe(0);
    await tx((c) => npcThink(c, new Outbox(), npc, new Date(NOON.getTime() + 3 * 3_600_000)));
    expect((await pool.query('SELECT 1 FROM villages WHERE owner_id = $1', [npc])).rowCount).toBe(1);
  });
});

async function setNpcTroops(villageId: number, units: Partial<ReturnType<typeof emptyUnits>>) {
  await tx((c) => setTroops(c, villageId, villageId, { ...emptyUnits(), ...units }));
}
