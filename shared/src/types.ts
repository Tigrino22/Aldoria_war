import type { BuildingKey, Buildings, Resource, Resources, UnitCounts, UnitKey } from './config';

/** Types échangés entre l'API et le client. */

export interface WorldInfo {
  speed: number;
  mapSize: number;
  serverTime: string;
}

export interface PlayerSummary {
  id: number;
  username: string;
  tribe: { id: number; name: string; tag: string } | null;
  protectionUntil: string | null;
  points: number;
}

export interface VillageListItem {
  id: number;
  name: string;
  x: number;
  y: number;
  points: number;
}

export interface MeResponse {
  player: PlayerSummary;
  villages: VillageListItem[];
  unreadReports: number;
  unreadMessages: number;
  /** Accès à la page d'administration (variable ADMIN_USERNAMES du serveur). */
  isAdmin: boolean;
  invites: { id: number; tribeId: number; tribeName: string; tribeTag: string }[];
}

export interface BuildQueueItem {
  id: number;
  building: BuildingKey;
  level: number;
  finishAt: string;
  queuedAt: string;
}

export interface RecruitQueueItem {
  id: number;
  unit: UnitKey;
  count: number;
  delivered: number;
  startAt: string;
  unitSeconds: number;
  queuedAt: string;
}

export interface TroopGroup {
  villageId: number;
  villageName: string;
  x: number;
  y: number;
  ownerName: string | null;
  units: UnitCounts;
}

export type CommandType = 'attack' | 'support' | 'return' | 'trade' | 'trade_return';

export interface CommandView {
  id: number;
  type: CommandType;
  origin: { id: number; name: string; x: number; y: number; ownerName: string | null };
  target: { id: number; name: string; x: number; y: number; ownerName: string | null };
  /** Absent pour les attaques entrantes ennemies : on ne voit pas ce qui arrive. */
  units: UnitCounts | null;
  /** Butin au retour d'une attaque, ou cargaison d'un convoi de marchands. */
  loot: Resources | null;
  merchants: number;
  sentAt: string;
  arriveAt: string;
}

export interface VillageState {
  id: number;
  name: string;
  x: number;
  y: number;
  points: number;
  loyalty: number;
  resources: Resources;
  rates: Resources;
  capacity: number;
  syncedAt: string;
  buildings: Buildings;
  buildQueue: BuildQueueItem[];
  recruitQueue: RecruitQueueItem[];
  upkeep: number;
  /** Troupes du village présentes chez lui. */
  troopsHome: UnitCounts;
  /** Renforts d'autres villages stationnés ici. */
  supportHere: TroopGroup[];
  /** Troupes de ce village stationnées en renfort ailleurs. */
  supportAway: TroopGroup[];
  incoming: CommandView[];
  outgoing: CommandView[];
  market: { merchants: number; available: number };
}

export interface MapVillage {
  id: number;
  name: string;
  x: number;
  y: number;
  points: number;
  ownerId: number | null;
  ownerName: string | null;
  tribeId: number | null;
  tribeTag: string | null;
}

/** Résultat de la dernière attaque ou du dernier espionnage d'un village barbare (pastille de l'assistant de pillage). */
export type RaidStatus = 'never' | 'scouted' | 'lost' | 'losses' | 'clean';

export interface RaidTarget {
  id: number;
  name: string;
  x: number;
  y: number;
  points: number;
  distance: number;
  status: RaidStatus;
  /** Date du dernier rapport (attaque ou espionnage), s'il y en a un. */
  lastAt: string | null;
  /** Ressources rapportées par la dernière attaque victorieuse. */
  lastLoot: number;
  /** Des troupes du village de départ sont déjà en route vers cette cible. */
  underAttack: boolean;
}

export interface ReportSummary {
  id: number;
  type: string;
  title: string;
  createdAt: string;
  read: boolean;
}

export interface CombatSide {
  playerName: string | null;
  village: { id: number; name: string; x: number; y: number };
  units: UnitCounts | null;
  losses: UnitCounts | null;
}

export interface AttackReportData {
  attackerWins: boolean;
  attacker: CombatSide;
  defender: CombatSide;
  wall: number | null;
  loot: Resources | null;
  loyalty: { before: number; after: number } | null;
  conquered: boolean;
  /** Muraille avant/après le passage des béliers, quand elle a été abîmée. */
  wallDamage?: { before: number; after: number } | null;
  /** Ce que les éclaireurs survivants ont vu. */
  intel?: Intel | null;
}

export interface Intel {
  resources: Resources;
  buildings: Buildings;
}

export interface ScoutReportData {
  attacker: CombatSide;
  defender: CombatSide;
  /** Absent quand aucun éclaireur n'a survécu. */
  intel: (Intel & { troops: UnitCounts }) | null;
}

export interface TradeReportData {
  from: { id: number; name: string; x: number; y: number; playerName: string | null };
  to: { id: number; name: string; x: number; y: number; playerName: string | null };
  resources: Resources;
}

export interface QuestView {
  key: string;
  title: string;
  description: string;
  reward: Resources;
  done: boolean;
  claimed: boolean;
}

/** Ce que le joueur sait d'un village cible, d'après son dernier espionnage ou sa dernière attaque. */
export interface TargetIntel {
  /** Troupes qui étaient (ou restaient) sur place. */
  troops: UnitCounts;
  wall: number;
  at: string;
  source: 'scout' | 'attack';
}

/** Profil public d'un joueur. */
export interface PlayerProfile {
  id: number;
  username: string;
  createdAt: string;
  protected: boolean;
  points: number;
  rank: number;
  tribe: { id: number; tag: string; name: string } | null;
  /** « can » : le chef de tribu qui consulte peut inviter ce joueur ; « pending » : invitation déjà envoyée ; sinon « none ». */
  invite: 'none' | 'can' | 'pending';
  villages: { id: number; name: string; x: number; y: number; points: number }[];
}

/** Offre publique du marché : « je donne X contre Y ». */
export interface MarketOfferView {
  id: number;
  villageId: number;
  villageName: string;
  x: number;
  y: number;
  ownerName: string;
  isNpc: boolean;
  give: { resource: Resource; amount: number };
  want: { resource: Resource; amount: number };
  expiresAt: string;
  /** Distance en cases depuis le village qui consulte les offres. */
  distance: number;
}
