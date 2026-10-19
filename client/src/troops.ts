import { UNIT_KEYS, emptyUnits, type UnitCounts, type VillageState } from '@aldoria/shared';

/** Troupes du village parties en campagne : attaques, renforts et interceptions en route, retours, et renforts stationnés ailleurs. */
export function awayTroops(v: VillageState): UnitCounts {
  const away = emptyUnits();
  const add = (units: UnitCounts | null) => {
    if (units) for (const k of UNIT_KEYS) away[k] += units[k];
  };
  for (const c of v.outgoing) if (c.type === 'attack' || c.type === 'support' || c.type === 'intercept') add(c.units);
  for (const c of v.incoming) if (c.type === 'return') add(c.units);
  for (const g of v.supportAway) add(g.units);
  return away;
}

/** Troupes présentes au village, qui le défendent : les libres et celles réservées par un ordre planifié pas encore parti. */
export function homeTroops(v: VillageState): UnitCounts {
  const home = emptyUnits();
  for (const k of UNIT_KEYS) home[k] = v.troopsHome[k] + v.troopsReserved[k];
  return home;
}
