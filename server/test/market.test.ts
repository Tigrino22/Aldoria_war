import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { STARTING_BUILDINGS, emptyUnits } from '@aldoria/shared';
import { pool, tx } from '../src/db';
import { migrate } from '../src/migrate';
import { Outbox } from '../src/notify';
import { processDueEvents } from '../src/game/commands';
import { acceptOffer, cancelOffer, createOffer, expireOffers, listOffers } from '../src/game/market';
import { marketNeeds, npcAccepts, planOffer, rateOk } from '../src/game/market-rules';
import { createNpc, npcThink, setNpcRandom } from '../src/game/npc';
import { createVillage } from '../src/game/village';

const HOUR = 3_600_000;
const T0 = new Date('2030-01-15T12:00:00Z');
const R = (wood: number, clay: number, iron: number, wheat: number) => ({ wood, clay, iron, wheat });

async function player(name: string) {
  return (await pool.query("INSERT INTO players (username, password_hash) VALUES ($1, 'x') RETURNING id", [name])).rows[0].id as number;
}
async function village(owner: number, name: string, x: number, y: number, res = R(5000, 5000, 5000, 5000), market = 5) {
  return tx((c) =>
    createVillage(c, { ownerId: owner, name, x, y, buildings: { ...STARTING_BUILDINGS, market, warehouse: 10 }, resources: res, at: T0, troops: emptyUnits() }),
  );
}
const stock = async (id: number) => (await pool.query('SELECT wood, clay, iron, wheat FROM villages WHERE id = $1', [id])).rows[0] as Record<string, number>;

describe('règles du marché', () => {
  it('le taux doit rester entre 0,5 et 2', () => {
    expect(rateOk(100, 100)).toBe(true);
    expect(rateOk(100, 50)).toBe(true);
    expect(rateOk(100, 200)).toBe(true);
    expect(rateOk(100, 49)).toBe(false);
    expect(rateOk(100, 201)).toBe(false);
    expect(rateOk(0, 10)).toBe(false);
  });

  it('un PNJ voit ses excédents et ses manques, publie une offre cohérente et n\'accepte que ce qui l\'arrange', () => {
    const npc = { stock: R(9000, 1000, 5000, 5000), capacity: 10000 };
    expect(marketNeeds(npc)).toEqual({ surplus: ['wood'], shortage: ['clay'] });
    const plan = planOffer(npc, 'builder');
    expect(plan).toEqual({ give: 'wood', giveAmount: 1000, want: 'clay', wantAmount: 900 });
    expect(planOffer({ stock: R(5000, 5000, 5000, 5000), capacity: 10000 }, 'builder')).toBeNull();
    // Il reçoit de l'argile (qui lui manque) et paie en bois (excédent) : accepté.
    expect(npcAccepts(npc, { give: 'clay', giveAmount: 800, want: 'wood', wantAmount: 800 })).toBe(true);
    // Mauvais taux, ou ressource qui ne lui manque pas, ou paiement en ressource qui n'est pas en excédent : refusé.
    expect(npcAccepts(npc, { give: 'clay', giveAmount: 500, want: 'wood', wantAmount: 800 })).toBe(false);
    expect(npcAccepts(npc, { give: 'iron', giveAmount: 800, want: 'wood', wantAmount: 800 })).toBe(false);
    expect(npcAccepts(npc, { give: 'clay', giveAmount: 800, want: 'iron', wantAmount: 800 })).toBe(false);
  });
});

describe('offres de marché', () => {
  beforeAll(async () => {
    await migrate(true);
  });
  afterAll(async () => {
    await pool.end();
  });

  it('une offre met les ressources de côté, peut être annulée (remboursée) et expire (remboursée)', async () => {
    const a = await player('Marchande');
    const v = await village(a, 'Étal', 300, 300);
    const out = new Outbox();
    await expect(tx((c) => createOffer(c, out, a, v, { give: 'wood', giveAmount: 600, want: 'wood', wantAmount: 600 }, T0))).rejects.toThrow(/différentes/);
    await expect(tx((c) => createOffer(c, out, a, v, { give: 'wood', giveAmount: 600, want: 'clay', wantAmount: 100 }, T0))).rejects.toThrow(/Taux/);
    await expect(tx((c) => createOffer(c, out, a, v, { give: 'wood', giveAmount: 9000, want: 'clay', wantAmount: 9000 }, T0))).rejects.toThrow(/pas assez/);

    const id = await tx((c) => createOffer(c, out, a, v, { give: 'wood', giveAmount: 600, want: 'clay', wantAmount: 600 }, T0));
    expect(Math.round((await stock(v)).wood)).toBe(4400);

    await tx((c) => cancelOffer(c, out, a, id, T0));
    expect(Math.round((await stock(v)).wood)).toBe(5000);
    await expect(tx((c) => cancelOffer(c, out, a, id, T0))).rejects.toThrow(/plus disponible/);

    await tx((c) => createOffer(c, out, a, v, { give: 'iron', giveAmount: 500, want: 'wheat', wantAmount: 500 }, T0));
    expect(await tx((c) => expireOffers(c, out, new Date(T0.getTime() + 23 * HOUR)))).toBe(0);
    expect(await tx((c) => expireOffers(c, out, new Date(T0.getTime() + 25 * HOUR)))).toBe(1);
    expect((await pool.query("SELECT count(*)::int AS n FROM market_offers WHERE status = 'open'")).rows[0].n).toBe(0);
  });

  it("accepter une offre fait partir deux convois, un dans chaque sens, et livre chacun ce qu'il attend", async () => {
    const a = await player('Vendeuse');
    const b = await player('Acheteur');
    const va = await village(a, 'Vendeuse', 310, 300);
    const vb = await village(b, 'Acheteur', 313, 300);
    const out = new Outbox();
    const id = await tx((c) => createOffer(c, out, a, va, { give: 'wood', giveAmount: 800, want: 'iron', wantAmount: 700 }, T0));

    const seen = await tx((c) => listOffers(c, b, vb, T0));
    expect(seen).toHaveLength(1);
    expect(seen[0]).toMatchObject({ id, ownerName: 'Vendeuse', isNpc: false, distance: 3, give: { resource: 'wood', amount: 800 }, want: { resource: 'iron', amount: 700 } });
    expect(await tx((c) => listOffers(c, a, va, T0))).toHaveLength(0);

    await expect(tx((c) => acceptOffer(c, out, a, va, id, T0))).rejects.toThrow(/propre offre/);
    await expect(tx((c) => acceptOffer(c, out, b, va, id, T0))).rejects.toThrow(/pas à vous/);
    await tx((c) => acceptOffer(c, out, b, vb, id, T0));
    await expect(tx((c) => acceptOffer(c, out, b, vb, id, T0))).rejects.toThrow(/plus disponible/);

    // L'acceptant a payé tout de suite, rien n'est encore arrivé.
    expect(Math.round((await stock(vb)).iron)).toBe(4300);
    expect(Math.round((await stock(vb)).wood)).toBe(5000);
    const arrival = new Date(T0.getTime() + 4 * HOUR);
    await processDueEvents(arrival);
    const after = await stock(vb);
    // 5 000 + 800 reçus, plus un peu de production pendant le trajet.
    expect(Math.round(after.wood)).toBeGreaterThanOrEqual(5800);
    const sellerAfter = await stock(va);
    expect(Math.round(sellerAfter.iron)).toBeGreaterThanOrEqual(5700);
  });

  it("un PNJ publie une offre quand une ressource déborde et qu'une autre manque, puis accepte l'offre d'un joueur qui l'arrange", async () => {
    setNpcRandom(() => 0.5);
    const npc = await tx((c) => createNpc(c, T0, 'builder'));
    const home = (await pool.query('SELECT id, x, y FROM villages WHERE owner_id = $1', [npc])).rows[0];
    await pool.query(
      "UPDATE villages SET buildings = buildings || '{\"market\": 5, \"warehouse\": 10}'::jsonb, wood = 9000, clay = 500, iron = 5000, wheat = 5000, resources_at = $2 WHERE id = $1",
      [home.id, T0],
    );
    await tx((c) => npcThink(c, new Outbox(), npc, T0));
    const offers = (await pool.query("SELECT give_resource, give_amount, want_resource, want_amount FROM market_offers WHERE player_id = $1 AND status = 'open'", [npc])).rows;
    // Plus de plafond d'offres : il en publie plusieurs tant qu'il a des marchands libres et un excédent.
    expect(offers[0].give_resource).toBe('wood');
    expect(offers.length).toBeGreaterThan(2);
    for (const o of offers) {
      expect(o.want_resource).toBe('clay');
      expect(o.give_amount).toBeGreaterThanOrEqual(100);
    }

    // Un joueur proche offre de l'argile contre du bois, à parité : le PNJ, qui manque d'argile, accepte.
    const p = await player('Voisin');
    const pv = await village(p, 'Voisin', home.x + 2, home.y + 1, R(5000, 5000, 5000, 5000));
    await tx((c) => createOffer(c, new Outbox(), p, pv, { give: 'clay', giveAmount: 700, want: 'wood', wantAmount: 700 }, T0));
    await pool.query("DELETE FROM market_offers WHERE player_id = $1", [npc]);
    await pool.query('UPDATE villages SET wood = 9000, clay = 500 WHERE id = $1', [home.id]);
    await tx((c) => npcThink(c, new Outbox(), npc, new Date(T0.getTime() + 20 * 60_000)));
    expect((await pool.query("SELECT status FROM market_offers WHERE player_id = $1", [p])).rows[0].status).toBe('accepted');
    expect((await pool.query("SELECT count(*)::int AS n FROM commands WHERE type = 'trade' AND home_village_id = ANY($1)", [[home.id, pv]])).rows[0].n).toBe(2);
  });
});
