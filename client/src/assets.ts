import { buildingStage, type BuildingKey, type Resource, type UnitKey } from '@aldoria/shared';

import plot from './assets/buildings/plot.png';
import spearman from './assets/units/spearman.png';
import halberdier from './assets/units/halberdier.png';
import swordsman from './assets/units/swordsman.png';
import cavalry from './assets/units/cavalry.png';
import noble from './assets/units/noble.png';
import scout from './assets/units/scout.png';
import ram from './assets/units/ram.png';
import wood from './assets/resources/wood.png';
import clay from './assets/resources/clay.png';
import iron from './assets/resources/iron.png';
import wheat from './assets/resources/wheat.png';
import village1 from './assets/map/village-1.png';
import village2 from './assets/map/village-2.png';
import village3 from './assets/map/village-3.png';
import barbarian from './assets/map/barbarian.png';
import citadelMap from './assets/map/citadel.png';
import bastionMap from './assets/map/bastion.png';
import sanctuaryMap from './assets/map/sanctuary.png';
import citadel from './assets/citadel.png';
import flag from './assets/map/flag.svg';
import trees from './assets/map/trees.png';
import hill from './assets/map/hill.png';
import villageBg from './assets/village-bg.png';
import ground from './assets/map/ground.jpg';
import marchFoot from './assets/map/march-foot.png';
import marchHorse from './assets/map/march-horse.png';
import marchScout from './assets/map/march-scout.png';
import marchNoble from './assets/map/march-noble.png';
import marchRam from './assets/map/march-ram.png';
import marchMeta from './assets/map/march.json';
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

// Enceinte complète du village : un calque derrière les bâtiments, un devant, par stade de muraille.
const ringFiles = import.meta.glob('./assets/wall-ring-*.png', { eager: true, query: '?url', import: 'default' }) as Record<string, string>;
export function wallRingImg(level: number, part: 'back' | 'front'): string | null {
  const stage = buildingStage(level);
  return stage === 0 ? null : ringFiles[`./assets/wall-ring-${stage}-${part}.png`];
}

/** Image d'un bâtiment à un niveau donné (l'emplacement vide au niveau 0). */
export function buildingImg(key: BuildingKey, level: number): string {
  const stage = buildingStage(level);
  if (stage === 0) return plot;
  return stageFiles[`./assets/buildings/${key}-${stage}.png`];
}
export const UNIT_IMG: Record<UnitKey, string> = { spearman, halberdier, swordsman, scout, cavalry, ram, noble };
export const RESOURCE_IMG: Record<Resource, string> = { wood, clay, iron, wheat };
export const MAP_IMG = { village1, village2, village3, barbarian, citadel: citadelMap, bastion: bastionMap, sanctuary: sanctuaryMap, flag, trees, hill, ground, marchFoot, marchHorse, marchScout, marchNoble, marchRam };
/** Images de marche des armées sur la carte : une bande de `frames` images de `w` × `h` pixels par genre d'unité. */
export const MARCH_SHEETS = marchMeta as Record<'foot' | 'horse' | 'scout' | 'noble' | 'ram', { frames: number; w: number; h: number }>;
/** La Citadelle des Croisades, grand rendu pour sa page. */
export const CITADEL_IMG = citadel;
/** Centre de chaque emplacement sur le décor du village, en % (calculé au rendu du décor). */
export const VILLAGE_SPOTS = spots as Record<BuildingKey, { x: number; y: number }>;
/** Largeur d'un bâtiment par rapport au décor : 18 m sur 64 m de scène. */
export const SPOT_WIDTH = (18 / 64) * 100;
export { villageBg, logo };

export const NAV_IMG = { village: townhall2, caserne: swordsman, troupes: flag, carte: village2, rapports: scroll, messages: letter, tribu: shield, classement: trophy };
