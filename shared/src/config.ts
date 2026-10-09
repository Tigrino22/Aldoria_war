// Toutes les valeurs d'équilibrage du jeu sont ici, partagées par le serveur et le client.
// Modifier une valeur ici suffit à rééquilibrer le jeu des deux côtés.

export const RESOURCES = ['wood', 'clay', 'iron', 'wheat'] as const;
export type Resource = (typeof RESOURCES)[number];
export type Resources = Record<Resource, number>;

export const RESOURCE_NAMES: Record<Resource, string> = {
  wood: 'Bois',
  clay: 'Argile',
  iron: 'Fer',
  wheat: 'Blé',
};

export const BUILDING_KEYS = [
  'townhall',
  'woodcutter',
  'claypit',
  'ironmine',
  'farm',
  'warehouse',
  'market',
  'barracks',
  'wall',
] as const;
export type BuildingKey = (typeof BUILDING_KEYS)[number];
export type Buildings = Record<BuildingKey, number>;

export interface BuildingDef {
  name: string;
  description: string;
  maxLevel: number;
  baseCost: Resources;
  costFactor: number;
  /** Durée de construction du niveau 1, en secondes à vitesse x1. */
  baseTime: number;
  timeFactor: number;
  requires: Partial<Buildings>;
}

export const BUILDINGS: Record<BuildingKey, BuildingDef> = {
  townhall: {
    name: 'Hôtel de ville',
    description: 'Accélère toutes les constructions et débloque de nouveaux bâtiments.',
    maxLevel: 20,
    baseCost: { wood: 90, clay: 80, iron: 70, wheat: 40 },
    costFactor: 1.26,
    baseTime: 600,
    timeFactor: 1.2,
    requires: {},
  },
  woodcutter: {
    name: 'Bûcheron',
    description: 'Produit du bois.',
    maxLevel: 20,
    baseCost: { wood: 50, clay: 60, iron: 40, wheat: 20 },
    costFactor: 1.25,
    baseTime: 300,
    timeFactor: 1.2,
    requires: {},
  },
  claypit: {
    name: 'Argilière',
    description: "Produit de l'argile.",
    maxLevel: 20,
    baseCost: { wood: 65, clay: 50, iron: 40, wheat: 20 },
    costFactor: 1.25,
    baseTime: 300,
    timeFactor: 1.2,
    requires: {},
  },
  ironmine: {
    name: 'Mine de fer',
    description: 'Produit du fer.',
    maxLevel: 20,
    baseCost: { wood: 75, clay: 65, iron: 70, wheat: 25 },
    costFactor: 1.25,
    baseTime: 360,
    timeFactor: 1.2,
    requires: {},
  },
  farm: {
    name: 'Ferme',
    description: 'Produit du blé, qui nourrit aussi vos troupes.',
    maxLevel: 20,
    baseCost: { wood: 45, clay: 40, iron: 30, wheat: 0 },
    costFactor: 1.26,
    baseTime: 300,
    timeFactor: 1.2,
    requires: {},
  },
  warehouse: {
    name: 'Entrepôt',
    description: 'Augmente le stockage et cache une partie des ressources aux pillards.',
    maxLevel: 20,
    baseCost: { wood: 60, clay: 50, iron: 40, wheat: 20 },
    costFactor: 1.26,
    baseTime: 400,
    timeFactor: 1.2,
    requires: {},
  },
  market: {
    name: 'Marché',
    description: 'Ses marchands transportent vos ressources vers vos autres villages ou ceux de vos alliés.',
    maxLevel: 20,
    baseCost: { wood: 100, clay: 100, iron: 100, wheat: 30 },
    costFactor: 1.26,
    baseTime: 800,
    timeFactor: 1.2,
    requires: { townhall: 3, warehouse: 2 },
  },
  barracks: {
    name: 'Caserne',
    description: 'Recrute les unités. Plus elle est haute, plus le recrutement est rapide.',
    maxLevel: 20,
    baseCost: { wood: 200, clay: 170, iron: 90, wheat: 60 },
    costFactor: 1.26,
    baseTime: 900,
    timeFactor: 1.2,
    requires: { townhall: 3 },
  },
  wall: {
    name: 'Muraille',
    description: 'Renforce la défense de toutes les troupes présentes dans le village.',
    maxLevel: 20,
    baseCost: { wood: 50, clay: 100, iron: 20, wheat: 30 },
    costFactor: 1.26,
    baseTime: 1000,
    timeFactor: 1.2,
    requires: { barracks: 1 },
  },
};

export const STARTING_BUILDINGS: Buildings = {
  townhall: 1,
  woodcutter: 1,
  claypit: 1,
  ironmine: 1,
  farm: 1,
  warehouse: 1,
  market: 0,
  barracks: 0,
  wall: 0,
};

export const STARTING_RESOURCES: Resources = { wood: 500, clay: 500, iron: 500, wheat: 500 };

/** Nombre maximum de constructions en file d'attente par village. */
export const BUILD_QUEUE_LIMIT = 2;

export const UNIT_KEYS = ['spearman', 'swordsman', 'scout', 'cavalry', 'ram', 'noble'] as const;
export type UnitKey = (typeof UNIT_KEYS)[number];
export type UnitCounts = Record<UnitKey, number>;

export interface UnitDef {
  name: string;
  description: string;
  kind: 'infantry' | 'cavalry';
  cost: Resources;
  /** Blé consommé par heure et par unité. */
  upkeep: number;
  attack: number;
  defenseInfantry: number;
  defenseCavalry: number;
  /** Minutes pour parcourir une case à vitesse x1. */
  speed: number;
  /** Ressources transportées par unité lors d'un pillage. */
  carry: number;
  /** Secondes de recrutement par unité à vitesse x1, caserne niveau 1. */
  time: number;
  requires: Partial<Buildings>;
}

export const UNITS: Record<UnitKey, UnitDef> = {
  spearman: {
    name: 'Lancier',
    description: 'Défenseur bon marché, redoutable contre la cavalerie.',
    kind: 'infantry',
    cost: { wood: 50, clay: 30, iron: 10, wheat: 20 },
    upkeep: 1,
    attack: 10,
    defenseInfantry: 15,
    defenseCavalry: 45,
    speed: 18,
    carry: 25,
    time: 180,
    requires: { barracks: 1 },
  },
  swordsman: {
    name: 'Épéiste',
    description: "L'attaquant polyvalent.",
    kind: 'infantry',
    cost: { wood: 30, clay: 30, iron: 70, wheat: 20 },
    upkeep: 1,
    attack: 40,
    defenseInfantry: 20,
    defenseCavalry: 10,
    speed: 22,
    carry: 15,
    time: 260,
    requires: { barracks: 3 },
  },
  scout: {
    name: 'Éclaireur',
    description: "Espionne un village : ressources, bâtiments et troupes. Envoyé seul, il ne combat pas.",
    kind: 'cavalry',
    cost: { wood: 50, clay: 50, iron: 20, wheat: 10 },
    upkeep: 2,
    attack: 0,
    defenseInfantry: 2,
    defenseCavalry: 1,
    speed: 9,
    carry: 0,
    time: 300,
    requires: { barracks: 2 },
  },
  cavalry: {
    name: 'Cavalier',
    description: 'Rapide et capable de rapporter un gros butin.',
    kind: 'cavalry',
    cost: { wood: 125, clay: 100, iron: 250, wheat: 40 },
    upkeep: 4,
    attack: 120,
    defenseInfantry: 30,
    defenseCavalry: 40,
    speed: 10,
    carry: 80,
    time: 600,
    requires: { barracks: 5 },
  },
  ram: {
    name: 'Bélier',
    description: 'Abaisse la muraille pendant le combat et la détruit en partie après une victoire.',
    kind: 'infantry',
    cost: { wood: 300, clay: 200, iron: 200, wheat: 40 },
    upkeep: 5,
    attack: 2,
    defenseInfantry: 20,
    defenseCavalry: 50,
    speed: 30,
    carry: 0,
    time: 900,
    requires: { barracks: 5, wall: 1 },
  },
  noble: {
    name: 'Noble',
    description: "Fait baisser la loyauté d'un village ennemi. À 0, le village est à vous.",
    kind: 'infantry',
    cost: { wood: 4000, clay: 5000, iron: 5000, wheat: 2000 },
    upkeep: 100,
    attack: 30,
    defenseInfantry: 100,
    defenseCavalry: 50,
    speed: 35,
    carry: 0,
    time: 3600,
    requires: { barracks: 10, townhall: 10 },
  },
};

/** Défense de base d'un village, même vide. */
export const BASE_VILLAGE_DEFENSE = 20;
/** Bonus de défense par niveau de muraille. */
export const WALL_BONUS_PER_LEVEL = 0.05;
/** Part de la capacité de l'entrepôt cachée aux pillards. */
export const HIDDEN_SHARE = 0.1;
/** Baisse de loyauté par noble ayant survécu à une attaque victorieuse. */
export const NOBLE_LOYALTY_MIN = 20;
export const NOBLE_LOYALTY_MAX = 35;
/** Loyauté regagnée par heure à vitesse x1. */
export const LOYALTY_REGEN_PER_HOUR = 1;
/** Loyauté d'un village juste après sa conquête. */
export const LOYALTY_AFTER_CONQUEST = 25;
/** Durée de la protection débutant en heures à vitesse x1. */
export const BEGINNER_PROTECTION_HOURS = 120;

/** Ressources transportées par un marchand. */
export const MERCHANT_CAPACITY = 1000;
/** Minutes pour parcourir une case à vitesse x1 (marchands). */
export const MERCHANT_SPEED = 6;
/** Pendant le combat, la muraille perd un niveau pour ce nombre de béliers. */
export const RAMS_PER_WALL_LEVEL_IN_COMBAT = 8;
/** Après une victoire, chaque groupe de ce nombre de béliers survivants détruit un niveau de muraille. */
export const RAMS_PER_WALL_LEVEL_DESTROYED = 4;
