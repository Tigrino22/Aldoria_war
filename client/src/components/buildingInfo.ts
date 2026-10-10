import {
  type BuildingKey,
  type Buildings,
  type VillageState,
  hiddenResources,
  merchantCount,
  MERCHANT_CAPACITY,
  resourceProduction,
  warehouseCapacity,
  WALL_BONUS_PER_LEVEL,
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
    case 'woodcutter':
    case 'claypit':
    case 'ironmine':
    case 'farm':
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
