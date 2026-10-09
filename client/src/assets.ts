import { buildingStage, type BuildingKey, type Resource, type UnitKey } from '@aldoria/shared';

import plot from './assets/buildings/plot.png';
import spearman from './assets/units/spearman.png';
import swordsman from './assets/units/swordsman.png';
import cavalry from './assets/units/cavalry.png';
import noble from './assets/units/noble.png';
import wood from './assets/resources/wood.png';
import clay from './assets/resources/clay.png';
import iron from './assets/resources/iron.png';
import wheat from './assets/resources/wheat.png';
import village1 from './assets/map/village-1.png';
import village2 from './assets/map/village-2.png';
import village3 from './assets/map/village-3.png';
import barbarian from './assets/map/barbarian.png';
import flag from './assets/map/flag.svg';
import trees from './assets/map/trees.png';
import hill from './assets/map/hill.png';
import villageBg from './assets/village-bg.png';
import ground from './assets/map/ground.png';
import spots from './assets/village-spots.json';
import logo from './assets/logo.svg';
import scroll from './assets/ui/scroll.svg';
import letter from './assets/ui/letter.svg';
import shield from './assets/ui/shield.svg';
import trophy from './assets/ui/trophy.svg';
import townhall2 from './assets/buildings/townhall-2.png';

// Chaque bâtiment a trois rendus 3D, un par stade d'évolution (voir tools/render).
const stageFiles = import.meta.glob('./assets/buildings/*-[123].png', { eager: true, query: '?url', import: 'default' }) as Record<string, string>;

export const PLOT_IMG = plot;

/** Image d'un bâtiment à un niveau donné (l'emplacement vide au niveau 0). */
export function buildingImg(key: BuildingKey, level: number): string {
  const stage = buildingStage(level);
  if (stage === 0) return plot;
  return stageFiles[`./assets/buildings/${key}-${stage}.png`];
}
export const UNIT_IMG: Record<UnitKey, string> = { spearman, swordsman, cavalry, noble };
export const RESOURCE_IMG: Record<Resource, string> = { wood, clay, iron, wheat };
export const MAP_IMG = { village1, village2, village3, barbarian, flag, trees, hill, ground };
/** Centre de chaque emplacement sur le décor du village, en % (calculé au rendu du décor). */
export const VILLAGE_SPOTS = spots as Record<BuildingKey, { x: number; y: number }>;
/** Largeur d'un bâtiment par rapport au décor : 18 m sur 64 m de scène. */
export const SPOT_WIDTH = (18 / 64) * 100;
export { villageBg, logo };

export const NAV_IMG = { village: townhall2, caserne: swordsman, troupes: flag, carte: village2, rapports: scroll, messages: letter, tribu: shield, classement: trophy };
