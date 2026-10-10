import type { BuildingKey, Buildings, Resources, UnitCounts } from './config';

/** Ce que la vérification d'une quête a besoin de savoir sur le joueur, tous villages confondus. */
export interface QuestContext {
  /** Plus haut niveau de chaque bâtiment parmi les villages du joueur. */
  buildings: Buildings;
  /** Troupes au village ou en cours de recrutement. */
  units: UnitCounts;
  villages: number;
  hasTribe: boolean;
}

export interface QuestDef {
  key: string;
  title: string;
  description: string;
  reward: Resources;
  check: (ctx: QuestContext) => boolean;
}

const level = (key: BuildingKey, n: number) => (ctx: QuestContext) => ctx.buildings[key] >= n;
const soldiers = (u: UnitCounts) => u.spearman + u.swordsman + u.cavalry + u.ram + u.noble;
const gift = (n: number): Resources => ({ wood: n, clay: n, iron: n, wheat: n });

/** Quêtes de départ, dans l'ordre conseillé : elles guident un nouveau joueur et donnent un petit coup de pouce. */
export const QUESTS: QuestDef[] = [
  { key: 'woodcutter3', title: 'Bûcherons au travail', description: 'Amenez le bûcheron au niveau 3.', reward: gift(100), check: level('woodcutter', 3) },
  { key: 'farm3', title: 'De quoi nourrir tout le monde', description: 'Amenez la ferme au niveau 3 : elle nourrit vos troupes.', reward: gift(100), check: level('farm', 3) },
  { key: 'townhall3', title: 'Un hôtel de ville respectable', description: "Hôtel de ville niveau 3 : il débloque la caserne et le marché.", reward: gift(150), check: level('townhall', 3) },
  { key: 'barracks1', title: 'Les premières recrues', description: 'Construisez la caserne.', reward: gift(150), check: level('barracks', 1) },
  { key: 'spearmen10', title: 'Une garde de lanciers', description: 'Ayez 10 lanciers (ou en cours de recrutement).', reward: gift(200), check: (ctx) => ctx.units.spearman >= 10 },
  { key: 'wall1', title: 'À l’abri derrière une palissade', description: 'Construisez la muraille.', reward: gift(200), check: level('wall', 1) },
  { key: 'scout1', title: 'Les yeux du village', description: 'Ayez un éclaireur pour espionner vos cibles avant de les attaquer.', reward: gift(200), check: (ctx) => ctx.units.scout >= 1 },
  { key: 'army30', title: 'Une vraie armée', description: 'Ayez 30 soldats.', reward: gift(300), check: (ctx) => soldiers(ctx.units) >= 30 },
  { key: 'market1', title: 'Ouvrir un marché', description: 'Construisez le marché pour commercer avec vos alliés.', reward: gift(300), check: level('market', 1) },
  { key: 'tribe', title: 'Plus forts ensemble', description: 'Rejoignez ou fondez une tribu.', reward: gift(300), check: (ctx) => ctx.hasTribe },
];
