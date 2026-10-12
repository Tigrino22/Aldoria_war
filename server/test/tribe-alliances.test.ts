import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { STARTING_BUILDINGS } from '@aldoria/shared';
import { pool, tx } from '../src/db';
import { migrate } from '../src/migrate';
import { Outbox } from '../src/notify';
import { MAX_ALLIES, allianceRelation, allyTribeIdsOf, answerAlliance, breakAlliance, cancelAllianceInvite, proposeAlliance, tribeAlliancesView } from '../src/game/tribe-alliances';
import { declareWar, tribeWarsView } from '../src/game/tribe-wars';
import { createVillage } from '../src/game/village';

const NOON = new Date('2030-01-15T12:00:00Z');

describe('alliances entre tribus', () => {
  const human = async (name: string) => (await pool.query("INSERT INTO players (username, password_hash) VALUES ($1, 'x') RETURNING id", [name])).rows[0].id as number;
  const tribeOf = async (leader: number, tag: string, isNpc = false) => {
    const id = (await pool.query('INSERT INTO tribes (name, tag, leader_id, is_npc) VALUES ($1, $2, $3, $4) RETURNING id', [`Tribu ${tag}`, tag, leader, isNpc])).rows[0].id as number;
    await pool.query('UPDATE players SET tribe_id = $2 WHERE id = $1', [leader, id]);
    return id;
  };
  const member = async (name: string, tribe: number) => {
    const id = await human(name);
    await pool.query('UPDATE players SET tribe_id = $2 WHERE id = $1', [id, tribe]);
    return id;
  };
  const village = (owner: number, x: number, y: number) =>
    tx((c) => createVillage(c, { ownerId: owner, name: `V${x}-${y}`, x, y, buildings: { ...STARTING_BUILDINGS }, resources: { wood: 0, clay: 0, iron: 0, wheat: 0 }, at: NOON }));
  const propose = (who: number, target: number) => tx((c) => proposeAlliance(c, new Outbox(), who, target, NOON));
  const answer = (who: number, invite: number, accept: boolean) => tx((c) => answerAlliance(c, new Outbox(), who, invite, accept, NOON));
  const view = (who: number) => tx((c) => tribeAlliancesView(c, who, NOON));

  beforeAll(async () => {
    await migrate(true);
  });
  afterAll(async () => {
    await pool.end();
  });

  it('seul le chef propose ; le chef d’en face accepte ; l’alliance est symétrique et visible sur la carte', async () => {
    const a = await human('Chef A');
    const ta = await tribeOf(a, 'AAA');
    const a2 = await member('Soldat A', ta);
    const b = await human('Chef B');
    const tb = await tribeOf(b, 'BBB');
    const b2 = await member('Soldat B', tb);

    await expect(propose(a2, tb)).rejects.toThrow(/chef/);
    await expect(propose(a, ta)).rejects.toThrow(/elle-même/);
    const invite = await propose(a, tb);
    await expect(propose(a, tb)).rejects.toThrow(/déjà en attente/);
    await expect(propose(b, ta)).rejects.toThrow(/acceptez-la/);
    // Seul le chef de la tribu invitée reçoit la proposition.
    const inbox = (await pool.query("SELECT to_id FROM messages WHERE subject LIKE '[Alliance]%'")).rows.map((r) => r.to_id);
    expect(inbox).toEqual([b]);

    expect((await view(a)).sent.map((l) => l.tribe.tag)).toEqual(['BBB']);
    expect((await view(b2)).received.map((l) => l.tribe.tag)).toEqual(['AAA']);
    expect((await view(a)).candidates.map((t) => t.tag)).not.toContain('BBB');
    await expect(answer(b2, invite, true)).rejects.toThrow(/chef/);
    await expect(answer(a, invite, true)).rejects.toThrow(/introuvable/);
    await answer(b, invite, true);

    expect(await tx((c) => allyTribeIdsOf(c, ta))).toEqual([tb]);
    expect(await tx((c) => allyTribeIdsOf(c, tb))).toEqual([ta]);
    expect((await view(a2)).allies[0]).toMatchObject({ by: 'Chef A', tribe: { tag: 'BBB', members: 2 } });
    expect((await view(b)).received).toHaveLength(0);
    expect(await tx((c) => allianceRelation(c, a, tb, NOON))).toMatchObject({ relation: 'ally', canPropose: false });
    // Tous les membres des deux tribus sont prévenus.
    const told = (await pool.query("SELECT DISTINCT to_id FROM messages WHERE subject LIKE '[Alliance] Alliance conclue%' ORDER BY to_id")).rows.map((r) => r.to_id);
    expect(told).toEqual([a, a2, b, b2].sort((x, y) => x - y));

    // Pas de guerre contre une alliée : il faut d'abord rompre.
    await village(b, 30, 30);
    await expect(tx((c) => declareWar(c, new Outbox(), a, tb, NOON))).rejects.toThrow(/alliée/);
    expect((await tx((c) => tribeWarsView(c, a, NOON))).targets.map((t) => t.tag)).not.toContain('BBB');

    await expect(tx((c) => breakAlliance(c, new Outbox(), a2, tb))).rejects.toThrow(/chef/);
    await tx((c) => breakAlliance(c, new Outbox(), b, ta));
    expect(await tx((c) => allyTribeIdsOf(c, ta))).toEqual([]);
    await expect(tx((c) => breakAlliance(c, new Outbox(), a, tb))).rejects.toThrow(/pas alliées/);
  });

  it('refus, retrait, guerre en cours, tribus de PNJ et plafond d’alliées', async () => {
    const c1 = await human('Chef C');
    const tc = await tribeOf(c1, 'CCC');
    const d1 = await human('Chef D');
    const td = await tribeOf(d1, 'DDD');

    // Refus : le chef qui proposait est prévenu, la proposition disparaît.
    const inv = await propose(c1, td);
    await answer(d1, inv, false);
    expect((await view(c1)).sent).toHaveLength(0);
    expect((await pool.query("SELECT 1 FROM messages WHERE to_id = $1 AND subject LIKE '%refuse%'", [c1])).rows).toHaveLength(1);

    // Retrait par la tribu qui proposait, pas par l'autre.
    const inv2 = await propose(c1, td);
    await expect(tx((c) => cancelAllianceInvite(c, d1, inv2))).rejects.toThrow(/introuvable/);
    await tx((c) => cancelAllianceInvite(c, c1, inv2));
    expect((await view(d1)).received).toHaveLength(0);

    // Une déclaration de guerre efface la proposition en attente et bloque les suivantes.
    await village(c1, 40, 40);
    await propose(c1, td);
    await tx((c) => declareWar(c, new Outbox(), d1, tc, NOON));
    expect((await view(c1)).sent).toHaveLength(0);
    await expect(propose(c1, td)).rejects.toThrow(/en guerre/);
    expect((await view(c1)).candidates.map((t) => t.tag)).not.toContain('DDD');

    // Pas d'alliance avec une tribu de PNJ.
    const npc = await human('Chef PNJ');
    await pool.query('UPDATE players SET is_npc = true WHERE id = $1', [npc]);
    const tn = await tribeOf(npc, 'NPC', true);
    await expect(propose(c1, tn)).rejects.toThrow(/PNJ/);
    expect((await view(c1)).candidates.map((t) => t.tag)).not.toContain('NPC');

    // Plafond : une tribu ne dépasse pas MAX_ALLIES alliées.
    for (let i = 0; i < MAX_ALLIES; i++) {
      const o = await human(`Chef E${i}`);
      const t = await tribeOf(o, `E${i}X`);
      await answer(o, await propose(c1, t), true);
    }
    const last = await human('Chef F');
    const tf = await tribeOf(last, 'FFF');
    await expect(propose(c1, tf)).rejects.toThrow(/plus de/);
    // Proposer à une tribu pleine est possible, mais elle ne peut pas accepter.
    const late = await propose(last, tc);
    await expect(answer(c1, late, true)).rejects.toThrow(/plus de/);
  });
});
