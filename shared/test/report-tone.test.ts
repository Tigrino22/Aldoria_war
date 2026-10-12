import { describe, expect, it } from 'vitest';
import { emptyUnits, reportTone } from '../src';

const u = (o: object) => ({ ...emptyUnits(), ...o });
const atk = (attackerWins: boolean, units: object, losses: object) => ({ attackerWins, conquered: false, attacker: { units: u(units), losses: u(losses) }, defender: { units: u({}), losses: u({}) } });

describe('reportTone', () => {
  it('espionnage : bleu', () => expect(reportTone('scout', {})).toBe('scout'));
  it('attaque réussie sans perte : vert', () => expect(reportTone('attack', atk(true, { swordsman: 10 }, {}))).toBe('win'));
  it('attaque réussie avec pertes : jaune', () => expect(reportTone('attack', atk(true, { swordsman: 10 }, { swordsman: 2 }))).toBe('mixed'));
  it('défaite : rouge', () => expect(reportTone('attack', atk(false, { swordsman: 10 }, { swordsman: 5 }))).toBe('loss'));
  it('100 % des troupes perdues, même gagnée : rouge', () => expect(reportTone('attack', atk(true, { swordsman: 10 }, { swordsman: 10 }))).toBe('loss'));
  it('défense réussie avec pertes : jaune, sans perte : vert, village pris : rouge', () => {
    const d = (attackerWins: boolean, conquered: boolean, losses: object) => ({ attackerWins, conquered, attacker: { units: u({}), losses: u({}) }, defender: { units: u({ spearman: 10 }), losses: u(losses) } });
    expect(reportTone('defense', d(false, false, { spearman: 3 }))).toBe('mixed');
    expect(reportTone('defense', d(false, false, {}))).toBe('win');
    expect(reportTone('defense', d(true, true, { spearman: 10 }))).toBe('loss');
  });
  it('livraison : neutre', () => expect(reportTone('trade', {})).toBe('neutral'));
});
