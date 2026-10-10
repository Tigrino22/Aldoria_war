import { normalizeUnits, subtractUnits, type AttackReportData, type ScoutReportData, type TargetIntel } from '@aldoria/shared';

/**
 * Choisit, parmi des rapports récents du joueur (du plus récent au plus ancien), le dernier qui dit ce qui défend le village :
 * un espionnage réussi, ou une attaque dont l'armée a survécu (troupes présentes moins les pertes).
 */
export function pickIntel(rows: { type: string; data: unknown; created_at: Date | string }[]): TargetIntel | null {
  for (const row of rows) {
    const at = new Date(row.created_at).toISOString();
    if (row.type === 'scout') {
      const d = row.data as ScoutReportData;
      if (d.intel) return { troops: normalizeUnits(d.intel.troops), wall: d.intel.buildings.wall ?? 0, at, source: 'scout' };
    } else if (row.type === 'attack') {
      const d = row.data as AttackReportData;
      if (!d.defender.units || d.wall === null) continue;
      const left = d.defender.losses ? subtractUnits(normalizeUnits(d.defender.units), normalizeUnits(d.defender.losses)) : normalizeUnits(d.defender.units);
      return { troops: left, wall: d.wallDamage?.after ?? d.wall, at, source: 'attack' };
    }
  }
  return null;
}
