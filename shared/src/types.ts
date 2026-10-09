import type { BuildingKey, Buildings, Resources, UnitCounts, UnitKey } from './config';

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
  invites: { id: number; tribeId: number; tribeName: string; tribeTag: string }[];
}

export interface BuildQueueItem {
  id: number;
  building: BuildingKey;
  level: number;
  finishAt: string;
}

export interface RecruitQueueItem {
  id: number;
  unit: UnitKey;
  count: number;
  delivered: number;
  startAt: string;
  unitSeconds: number;
}

export interface TroopGroup {
  villageId: number;
  villageName: string;
  x: number;
  y: number;
  ownerName: string | null;
  units: UnitCounts;
}

export type CommandType = 'attack' | 'support' | 'return';

export interface CommandView {
  id: number;
  type: CommandType;
  origin: { id: number; name: string; x: number; y: number; ownerName: string | null };
  target: { id: number; name: string; x: number; y: number; ownerName: string | null };
  /** Absent pour les attaques entrantes ennemies : on ne voit pas ce qui arrive. */
  units: UnitCounts | null;
  loot: Resources | null;
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
}
