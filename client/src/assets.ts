import { buildingStage, type BuildingKey, type Resource, type UnitKey } from '@fiefs/shared';

import plot from './assets/buildings/plot.svg';
import spearman from './assets/units/spearman.svg';
import swordsman from './assets/units/swordsman.svg';
import cavalry from './assets/units/cavalry.svg';
import noble from './assets/units/noble.svg';
import wood from './assets/resources/wood.svg';
import clay from './assets/resources/clay.svg';
import iron from './assets/resources/iron.svg';
import wheat from './assets/resources/wheat.svg';
import village from './assets/map/village.svg';
import barbarian from './assets/map/barbarian.svg';
import flag from './assets/map/flag.svg';
import tree from './assets/map/tree.svg';
import hill from './assets/map/hill.svg';
import villageBg from './assets/village-bg.svg';
import logo from './assets/logo.svg';
import scroll from './assets/ui/scroll.svg';
import letter from './assets/ui/letter.svg';
import shield from './assets/ui/shield.svg';
import trophy from './assets/ui/trophy.svg';
import townhall2 from './assets/buildings/townhall-2.svg';

// Chaque bâtiment a trois dessins, un par stade d'évolution (voir tools/generate-buildings.py).
const stageFiles = import.meta.glob('./assets/buildings/*-[123].svg', { eager: true, query: '?url', import: 'default' }) as Record<string, string>;

export const PLOT_IMG = plot;

/** Image d'un bâtiment à un niveau donné (l'emplacement vide au niveau 0). */
export function buildingImg(key: BuildingKey, level: number): string {
  const stage = buildingStage(level);
  if (stage === 0) return plot;
  return stageFiles[`./assets/buildings/${key}-${stage}.svg`];
}
export const UNIT_IMG: Record<UnitKey, string> = { spearman, swordsman, cavalry, noble };
export const RESOURCE_IMG: Record<Resource, string> = { wood, clay, iron, wheat };
export const MAP_IMG = { village, barbarian, flag, tree, hill };
export { villageBg, logo };

export const NAV_IMG = { village: townhall2, caserne: swordsman, troupes: flag, carte: village, rapports: scroll, messages: letter, tribu: shield, classement: trophy };
