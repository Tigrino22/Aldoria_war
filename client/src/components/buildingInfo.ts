import {
  type BuildingKey,
  type Buildings,
  type VillageState,
  hiddenResources,
  merchantCount,
  MERCHANT_CAPACITY,
  populationCapacity,
  resourceProduction,
  wheatProduction,
  warehouseCapacity,
  WALL_BONUS_PER_LEVEL,
  buildingTime,
} from '@aldoria/shared';
import { fmt } from '../format';

export function effectiveLevels(v: VillageState): Buildings {
  const out = { ...v.buildings };
  for (const q of v.buildQueue) out[q.building] = Math.max(out[q.building], q.level);
  return out;
}

export function effect(key: BuildingKey, level: number, speed: number): string {
  switch (key) {
    case 'townhall':
      return `Constructions ${Math.round((1 - Math.pow(0.95, Math.max(0, level - 1))) * 100)} % plus rapides`;
    case 'farm':
      return `${fmt(wheatProduction(level) * speed)} blé par heure, ${fmt(populationCapacity(level))} places de population`;
    case 'woodcutter':
    case 'claypit':
    case 'ironmine':
      return `${fmt(resourceProduction(level) * speed)} par heure`;
    case 'warehouse':
      return `Stocke ${fmt(warehouseCapacity(level))}, cache ${fmt(hiddenResources(level))}`;
    case 'barracks':
      return level ? `Recrutement ${Math.round((1 - Math.pow(0.94, level - 1)) * 100)} % plus rapide` : 'Pas encore construite';
    case 'market':
      return level ? `${merchantCount(level)} marchands, ${fmt(merchantCount(level) * MERCHANT_CAPACITY)} ressources par envoi` : 'Pas encore construit';
    case 'wall':
      return `+${Math.round(level * WALL_BONUS_PER_LEVEL * 100)} % de défense`;
  }
}

/** Avancement (0 à 1) de chaque construction de la file : la première a commencé à son arrivée en tête, les suivantes à la fin de la précédente. */
export function queueProgress(v: VillageState, now: number, speed: number): number[] {
  let prevEnd = 0;
  return v.buildQueue.map((q, i) => {
    const end = Date.parse(q.finishAt);
    const start =
      i === 0 ? Math.max(Date.parse(q.queuedAt), end - buildingTime(q.building, q.level, v.buildings.townhall, speed) * 1000) : Math.max(prevEnd, Date.parse(q.queuedAt));
    prevEnd = end;
    if (now <= start) return 0;
    return Math.min(1, (now - start) / Math.max(1, end - start));
  });
}
