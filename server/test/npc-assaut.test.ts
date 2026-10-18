import { describe, expect, it } from 'vitest';
import { emptyUnits, resolveCombat, wallDuringCombat, type UnitCounts } from '@aldoria/shared';
import { pickRaidUnits, planStrike, ramsFor } from '../src/game/npc-rules';

const troops = (u: Partial<UnitCounts>): UnitCounts => ({ ...emptyUnits(), ...u });
const army = troops({ swordsman: 1000, cavalry: 300, ram: 40 });

describe('assaut des PNJ taillé sur les statistiques des troupes', () => {
  it('face aux lanciers (redoutables contre la cavalerie), les épéistes partent sans les cavaliers', () => {
    const units = planStrike(army, troops({ spearman: 800 }), 0)!;
    expect(units.swordsman).toBe(1000);
    expect(units.cavalry).toBe(0);
  });

  it('face aux hallebardiers (le rempart contre l’infanterie), les cavaliers font le gros de l’assaut', () => {
    const units = planStrike(army, troops({ halberdier: 800 }), 0)!;
    expect(units.cavalry).toBe(300);
    expect(units.swordsman).toBeLessThan(1000);
    // Moins de pertes qu'avec toute l'armée.
    const lost = (u: UnitCounts) => {
      const r = resolveCombat({ attackers: u, defenders: [troops({ halberdier: 800 })], wallLevel: 0 });
      return r.attackerLosses.swordsman * 150 + r.attackerLosses.cavalry * 515;
    };
    expect(lost(units)).toBeLessThanOrEqual(lost(troops({ swordsman: 1000, cavalry: 300 })));
  });

  it('les béliers partent juste assez nombreux pour abattre la muraille, aucun sans muraille', () => {
    expect(ramsFor(40, 0)).toBe(0);
    expect(ramsFor(40, 3)).toBe(6);
    expect(ramsFor(4, 10)).toBe(4);
    expect(planStrike(army, troops({ spearman: 100 }), 3)!.ram).toBe(6);
    expect(planStrike(army, troops({ spearman: 100 }), 0)!.ram).toBe(0);
  });

  it('sans mélange gagnant, le PNJ renonce ; avec une marge, il lui faut nettement plus que la défense', () => {
    expect(planStrike(troops({ swordsman: 10 }), troops({ halberdier: 500 }), 5)).toBeNull();
    const defenders = troops({ spearman: 100 });
    const just = troops({ swordsman: 42 });
    const r = resolveCombat({ attackers: just, defenders: [defenders], wallLevel: wallDuringCombat(0, 0) });
    expect(r.attackerWins).toBe(true);
    expect(planStrike(just, defenders, 0, { marginPct: 20 })).toBeNull();
  });

  it('le butin attendu d’un pillage est celui que les survivants peuvent rapporter', () => {
    const raid = pickRaidUnits(troops({ swordsman: 100 }), troops({ spearman: 150 }), 0, { wood: 9000, clay: 9000, iron: 9000, wheat: 9000 })!;
    expect(raid.units.swordsman).toBe(100);
    expect(raid.loot).toBeLessThan(100 * 15);
    expect(raid.loot).toBeGreaterThan(0);
  });
});

describe('assauts groupés des PNJ', () => {
  it('deux vagues trop faibles chacune nettoient ensemble : la première use la défense, la seconde gagne', async () => {
    const { planSiege } = await import('../src/game/npc-siege');
    const defenders = troops({ spearman: 1000 });
    const wave = troops({ swordsman: 330 });
    // Seule, une vague perd (13 200 contre 15 020).
    expect(resolveCombat({ attackers: wave, defenders: [defenders], wallLevel: 0 }).attackerWins).toBe(false);
    const plan = planSiege([wave, wave], defenders, 0);
    expect(plan.cleared).toBe(true);
    expect(plan.order).toHaveLength(2);
  });

  it('même sans victoire, l’assaut d’usure vaut le coup s’il tue plus qu’il ne perd', async () => {
    const { planSiege } = await import('../src/game/npc-siege');
    const plan = planSiege([troops({ cavalry: 100 })], troops({ halberdier: 1000 }), 0);
    expect(plan.cleared).toBe(false);
    expect(plan.killed).toBeGreaterThan(0);
    // Les vagues partent de la plus faible à la plus forte.
    expect(planSiege([troops({ swordsman: 900 }), troops({ swordsman: 100 })], troops({ spearman: 5000 }), 0).order).toEqual([1, 0]);
  });
});
