import { BASE_VILLAGE_DEFENSE, UNITS, UNIT_KEYS, UnitCounts } from './config';
import { emptyUnits, totalUnits, wallBonus } from './formulas';

export interface CombatInput {
  attackers: UnitCounts;
  /** Chaque groupe de défenseurs présent (troupes du village et renforts alliés). */
  defenders: UnitCounts[];
  wallLevel: number;
}

export interface CombatResult {
  attackerWins: boolean;
  attackPower: number;
  defensePower: number;
  attackerLosses: UnitCounts;
  defenderLosses: UnitCounts[];
}

function losses(units: UnitCounts, ratio: number): UnitCounts {
  const out = emptyUnits();
  for (const k of UNIT_KEYS) out[k] = Math.min(units[k], Math.round(units[k] * ratio));
  return out;
}

/**
 * Combat simplifié inspiré de Guerre Tribale :
 * la défense de chaque unité est pondérée par la part d'infanterie et de cavalerie dans l'attaque,
 * le camp le plus fort gagne et perd une part de ses troupes égale à (force adverse / sa force)^1.5.
 */
export function resolveCombat({ attackers, defenders, wallLevel }: CombatInput): CombatResult {
  let attackInfantry = 0;
  let attackCavalry = 0;
  for (const k of UNIT_KEYS) {
    const power = attackers[k] * UNITS[k].attack;
    if (UNITS[k].kind === 'cavalry') attackCavalry += power;
    else attackInfantry += power;
  }
  const attackPower = attackInfantry + attackCavalry;
  const infantryShare = attackPower > 0 ? attackInfantry / attackPower : 1;

  let rawDefense = BASE_VILLAGE_DEFENSE;
  for (const group of defenders) {
    for (const k of UNIT_KEYS) {
      const def = UNITS[k];
      rawDefense += group[k] * (def.defenseInfantry * infantryShare + def.defenseCavalry * (1 - infantryShare));
    }
  }
  const defensePower = rawDefense * wallBonus(wallLevel);

  const attackerWins = attackPower > defensePower;
  if (attackerWins) {
    const ratio = Math.pow(defensePower / attackPower, 1.5);
    return {
      attackerWins,
      attackPower,
      defensePower,
      attackerLosses: losses(attackers, ratio),
      defenderLosses: defenders.map((g) => ({ ...g })),
    };
  }
  const ratio = defensePower > 0 ? Math.pow(attackPower / defensePower, 1.5) : 0;
  return {
    attackerWins,
    attackPower,
    defensePower,
    attackerLosses: { ...attackers },
    defenderLosses: defenders.map((g) => (totalUnits(g) > 0 ? losses(g, ratio) : emptyUnits())),
  };
}
