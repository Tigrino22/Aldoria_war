import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { STARTING_BUILDINGS, UNITS, emptyUnits, meetsRequirements } from '@aldoria/shared';
import { pool, tx } from '../src/db';
import { env } from '../src/env';
import { migrate } from '../src/migrate';
import { Outbox } from '../src/notify';
import { processDueEvents } from '../src/game/commands';
import { createNpc, ensureNpcs, npcThink, processNpcs, setNpcRandom } from '../src/game/npc';
import { NOBLE_AFTER, NOBLE_BUILDINGS, ROLE_PRESET, npcPlan, villageRoles } from '../src/game/npc-roles';
import { isQuiet, npcType, pickWinningUnits } from '../src/game/npc-rules';
import { PRESETS, nextBuilding } from '../src/manager/rules';
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

  it('un village de PNJ suit à la lettre le modèle du gestionnaire de son rôle, avec la caserne de pillage et les bâtiments du noble en plus', () => {
    for (const role of ['offense', 'defense'] as const) {
      const preset = PRESETS.find((p) => p.name === ROLE_PRESET[role])!.plan;
      const plan = npcPlan(role);
      const extra = plan.buildings.length - preset.buildings.length;
      expect(extra).toBe(NOBLE_BUILDINGS.length + 1);
      // Hors lignes ajoutées, l'ordre est celui du modèle.
      const added = [2, ...NOBLE_BUILDINGS.map((_, i) => NOBLE_AFTER[role] + 1 + i)];
      expect(plan.buildings.filter((_, i) => !added.includes(i))).toEqual(preset.buildings);
      expect(plan.troopsShare).toBe(30);
      for (const [unit, n] of Object.entries(preset.troops)) expect(plan.troops[unit as keyof typeof plan.troops]).toBeGreaterThanOrEqual(n);
    }
    expect(npcPlan('offense').buildings[2]).toEqual({ building: 'barracks', level: 3 });
    expect(npcPlan('defense').buildings[2]).toEqual({ building: 'barracks', level: 1 });
    expect(npcPlan('offense').troops.noble).toBe(4);
    expect(npcPlan('defense').troops.noble).toBe(0);
    // Le village unique d'un PNJ défensif forme son propre train, avec les épéistes qui l'escortent.
    expect(npcPlan('defense', true).troops).toEqual(expect.objectContaining({ noble: 4, swordsman: 300 }));
    expect(nextBuilding(npcPlan('defense').buildings, { ...STARTING_BUILDINGS })?.building).toBe('claypit');
  });

  it('un PNJ suivant son plan construit hôtel de ville et caserne 10 (le noble) bien avant la fin du modèle', () => {
    for (const role of ['offense', 'defense'] as const) {
      const levels = { ...STARTING_BUILDINGS };
      let steps = 0;
      while (!meetsRequirements(levels, UNITS.noble.requires)) {
        const next = nextBuilding(npcPlan(role).buildings, levels)!;
        levels[next.building] = next.level;
        steps++;
      }
      // Mines encore loin du niveau 20 : le noble arrive tôt.
      expect(Math.max(levels.woodcutter, levels.claypit, levels.ironmine)).toBeLessThan(20);
      expect(steps).toBeLessThan(150);
    }
  });

  it('attaque dès que son armée bat celle d’en face (sans marge par défaut), avec toute l’armée face à des défenseurs et le minimum face à un village vide', () => {
    const defenders = { ...emptyUnits(), spearman: 20 };
    // 8 épéistes (320) font match nul face à 20 lanciers (20 + 300) : pas de victoire, donc pas d'attaque ; 9 suffisent, sans marge.
    expect(pickWinningUnits({ ...emptyUnits(), swordsman: 8 }, defenders, 0)).toBeNull();
    expect(pickWinningUnits({ ...emptyUnits(), swordsman: 9 }, defenders, 0)).toEqual({ ...emptyUnits(), swordsman: 9 });
    // Avec une marge de 30 % réglée par l'administration, 9 épéistes (360) ne suffisent plus (416 demandés).
    env.npcAttackMargin = 30;
    expect(pickWinningUnits({ ...emptyUnits(), swordsman: 9 }, defenders, 0)).toBeNull();
    env.npcAttackMargin = 0;
    const units = pickWinningUnits({ ...emptyUnits(), swordsman: 400 }, defenders, 0);
    expect(units).toEqual({ ...emptyUnits(), swordsman: 400 });
    const vide = pickWinningUnits({ ...emptyUnits(), swordsman: 400 }, emptyUnits(), 0);
    expect(vide!.swordsman).toBeLessThan(400);
  });

  it('un seul village suit le type du PNJ ; dès le deuxième, moitié offensifs, moitié défensifs', () => {
    expect(villageRoles('defense', 1)).toEqual(['defense']);
    expect(villageRoles('offense', 1)).toEqual(['offense']);
    expect(villageRoles('defense', 2)).toEqual(['defense', 'offense']);
    expect(villageRoles('offense', 2)).toEqual(['offense', 'defense']);
    for (const type of ['offense', 'defense'] as const) {
      for (let n = 2; n <= 8; n++) {
        const roles = villageRoles(type, n);
        expect(roles).toHaveLength(n);
        expect(roles.filter((r) => r === 'offense').length).toBe(type === 'offense' ? Math.ceil(n / 2) : Math.floor(n / 2));
      }
    }
  });

  it('les anciens types deviennent défensifs ou offensifs', () => {
    expect(['builder', 'raider', 'conqueror', 'defense', 'offense', null].map(npcType)).toEqual(['defense', 'offense', 'offense', 'defense', 'offense', 'defense']);
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
    const npc = await tx((c) => createNpc(c, NOON, 'defense'));
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
    expect(Object.values(v.buildings as Record<string, number>).reduce((a, b) => a + b, 0)).toBeGreaterThanOrEqual(9 + 3); // l'armée visée remplit la ferme de 20 000 places : le recrutement prend sa part des ressources, et le modèle commence par les mines, plus chères
    const recruits = (await pool.query('SELECT count(*)::int AS n FROM recruit_queue WHERE village_id = $1', [village])).rows[0].n;
    const troops = await tx((c) => getTroops(c, village, village));
    expect(recruits + troops.spearman + troops.swordsman).toBeGreaterThan(0);
  });

  it('un PNJ met plusieurs lots en file d’un coup, gros lots compris, et recrute avant de construire', async () => {
    const npc = await tx((c) => createNpc(c, NOON, 'offense'));
    const village = (await pool.query('SELECT id FROM villages WHERE owner_id = $1', [npc])).rows[0].id as number;
    await pool.query("UPDATE villages SET buildings = buildings || '{\"townhall\": 9, \"barracks\": 9, \"farm\": 12, \"wall\": 3, \"warehouse\": 12}'::jsonb, wood = 90000, clay = 90000, iron = 90000, wheat = 90000 WHERE id = $1", [village]);
    await tx((c) => npcThink(c, new Outbox(), npc, NOON));
    const rows = (await pool.query('SELECT unit, count FROM recruit_queue WHERE village_id = $1', [village])).rows;
    expect(rows.length).toBeGreaterThanOrEqual(2);
    expect(Math.max(...rows.map((r) => r.count as number))).toBeGreaterThan(40);
    // La file est pleine : une réflexion de plus ne la rallonge pas tant qu'il lui reste du travail.
    await tx((c) => npcThink(c, new Outbox(), npc, new Date(NOON.getTime() + MIN)));
    const again = (await pool.query('SELECT count(*)::int AS n FROM recruit_queue WHERE village_id = $1', [village])).rows[0].n;
    expect(again).toBe(rows.length);
  });

  it('un pillard espionne puis attaque un joueur le jour, une seule fois par jour, jamais pendant les heures calmes', async () => {
    await pool.query("DELETE FROM villages WHERE owner_id IS NULL");
    const npc = await tx((c) => createNpc(c, NOON, 'offense'));
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

  it('processNpcs prend le verrou PNJ par PNJ pour laisser passer les joueurs', async () => {
    await pool.query('UPDATE players SET npc_next_action_at = $1 WHERE is_npc', [new Date(NOON.getTime() + 10 * 3_600_000)]);
    const ids = (await pool.query('SELECT id FROM players WHERE is_npc ORDER BY id LIMIT 2')).rows.map((r) => r.id);
    await pool.query('UPDATE players SET npc_next_action_at = $2 WHERE id = ANY($1)', [ids, NOON]);
    let held = 0;
    let max = 0;
    let calls = 0;
    const lock = async <T,>(fn: () => Promise<T>) => {
      calls++;
      held++;
      max = Math.max(max, held);
      try {
        return await fn();
      } finally {
        held--;
      }
    };
    expect(await processNpcs(NOON, 25, { lock, clock: () => NOON })).toBe(2);
    // Six étapes communes (alertes, guerres, nouveau PNJ, offres expirées), puis une par PNJ, jamais imbriquées.
    expect(calls).toBe(8);
    expect(max).toBe(1);
  });

  it('un PNJ sans village repart ailleurs après un délai', async () => {
    const npc = await tx((c) => createNpc(c, NOON, 'defense'));
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
