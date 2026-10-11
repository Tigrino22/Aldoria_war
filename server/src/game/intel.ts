import {
  RESOURCES,
  emptyResources,
  hiddenResources,
  normalizeUnits,
  productionRates,
  subtractUnits,
  populationOf,
  warehouseCapacity,
  type AttackReportData,
  type Intel,
  type LootEstimate,
  type ScoutReportData,
  type TargetIntel,
  type UnitCounts,
} from '@aldoria/shared';

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

/**
 * Estime ce qu'un village pourrait livrer maintenant, à partir des rapports du joueur (du plus récent au plus ancien) :
 * réserves vues par le dernier éclaireur (espionnage ou éclaireur survivant d'une attaque), production depuis,
 * plafond de l'entrepôt, moins le butin des attaques arrivées depuis, moins la cachette.
 */
export function estimateLoot(
  rows: { type: string; data: unknown; created_at: Date | string }[],
  now: Date,
  worldSpeed: number,
  troops: UnitCounts | null,
): LootEstimate | null {
  const base = rows.findIndex((r) => (r.type === 'scout' || r.type === 'attack') && (r.data as { intel?: Intel | null }).intel);
  if (base < 0) return null;
  const seen = (rows[base].data as { intel: Intel }).intel;
  const seenAt = new Date(rows[base].created_at);
  const hours = Math.max(0, (now.getTime() - seenAt.getTime()) / 3_600_000);
  const rates = productionRates(seen.buildings, worldSpeed);
  const cap = warehouseCapacity(seen.buildings.warehouse);
  const hidden = hiddenResources(seen.buildings.warehouse);
  const taken = emptyResources();
  for (const r of rows.slice(0, base)) {
    const loot = r.type === 'attack' ? (r.data as AttackReportData).loot : null;
    if (loot) for (const k of RESOURCES) taken[k] += loot[k] ?? 0;
  }
  const resources = emptyResources();
  for (const k of RESOURCES) {
    const start = seen.resources[k] ?? 0;
    const grown = rates[k] >= 0 ? (start >= cap ? start : Math.min(cap, start + rates[k] * hours)) : Math.max(0, start + rates[k] * hours);
    resources[k] = Math.max(0, Math.floor(grown - taken[k]) - hidden);
  }
  return { total: RESOURCES.reduce((n, k) => n + resources[k], 0), resources, seenAt: seenAt.toISOString() };
}
