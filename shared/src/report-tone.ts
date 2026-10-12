import { UNIT_KEYS } from './config';
import type { UnitCounts } from './config';

/** Couleur de la pastille d'un rapport : bleu espionnage, vert succès sans perte, jaune succès avec pertes, rouge échec. */
export type ReportTone = 'scout' | 'win' | 'mixed' | 'loss' | 'neutral';

const total = (u: Partial<UnitCounts> | null | undefined) => (u ? UNIT_KEYS.reduce((s, k) => s + (u[k] ?? 0), 0) : 0);

/** Calcule la couleur d'un rapport du point de vue du joueur qui le lit. */
export function reportTone(type: string, data: any): ReportTone {
  if (type === 'scout') return 'scout';
  if (type !== 'attack' && type !== 'defense') return 'neutral';
  if (!data || typeof data.attackerWins !== 'boolean') return 'neutral';
  // Le lecteur est l'attaquant dans un rapport « attack », le défenseur dans un rapport « defense ».
  const side = type === 'attack' ? data.attacker : data.defender;
  const success = type === 'attack' ? data.attackerWins : !data.attackerWins && !data.conquered;
  if (!success) return 'loss';
  const sent = total(side?.units);
  const lost = total(side?.losses);
  if (sent > 0 && lost >= sent) return 'loss';
  return lost > 0 ? 'mixed' : 'win';
}
