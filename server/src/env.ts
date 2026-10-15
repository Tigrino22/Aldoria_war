function num(name: string, fallback: number): number {
  const raw = process.env[name];
  const value = raw === undefined || raw === '' ? fallback : Number(raw);
  if (!Number.isFinite(value) || value <= 0) throw new Error(`Variable d'environnement invalide : ${name}`);
  return value;
}

function count(name: string, fallback: number): number {
  const raw = process.env[name];
  const value = raw === undefined || raw === '' ? fallback : Number(raw);
  if (!Number.isFinite(value) || value < 0) throw new Error(`Variable d'environnement invalide : ${name}`);
  return Math.floor(value);
}

export const env = {
  databaseUrl: process.env.DATABASE_URL ?? 'postgres://aldoria:aldoria@localhost:5432/aldoria',
  port: num('PORT', 3001),
  worldSpeed: num('WORLD_SPEED', 1),
  mapSize: Math.floor(num('MAP_SIZE', 100)),
  barbarianVillages: Math.floor(num('BARBARIAN_VILLAGES', 250)),
  // PNJ : nombre de joueurs PNJ (0 pour les désactiver), difficulté (1 = modérée, 0,5 = facile, 1,5 = difficile),
  // et heures calmes pendant lesquelles ils n'attaquent pas les joueurs.
  npcCount: count('NPC_COUNT', 40),
  npcTribes: count('NPC_TRIBES', 4),
  npcTribeSize: count('NPC_TRIBE_SIZE', 5),
  /** Effectif maximal d'une tribu de PNJ : tout PNJ sans tribu en rejoint une (0 = les PNJ restent solitaires). */
  npcTribeMax: count('NPC_TRIBE_MAX', 7),
  npcDaily: count('NPC_DAILY', 3),
  // Riposte : un PNJ attaqué par un joueur lui en veut pendant 3 jours et contre-attaque (1 = activée, 0 = désactivée).
  npcRevenge: count('NPC_REVENGE', 1) > 0 ? 1 : 0,
  /** Guerres entre tribus de PNJ (1 = activées), modifiables à chaud depuis l'administration. */
  npcWars: count('NPC_WARS', 1) > 0 ? 1 : 0,
  /** Guerres entre tribus de PNJ et tribus de joueurs (1 = activées), indépendantes de la riposte et modifiables à chaud. */
  npcPlayerWars: count('NPC_PLAYER_WARS', 1) > 0 ? 1 : 0,
  /** Offensives occasionnelles des PNJ (1 = activées), part de l'armée offensive engagée (%) et rythme (heures de jeu) ; modifiables à chaud. */
  npcOffensive: count('NPC_OFFENSIVE', 1) > 0 ? 1 : 0,
  npcOffensiveShare: count('NPC_OFFENSIVE_SHARE', 50),
  npcOffensiveHours: count('NPC_OFFENSIVE_HOURS', 24),
  /** Interceptions des armées hostiles repérées par les PNJ (1 = activées), modifiables à chaud. */
  npcIntercept: count('NPC_INTERCEPT', 1) > 0 ? 1 : 0,
  /** Pillage intensif des PNJ (1 = activé) : pillages par village et par réflexion, rayon (cases) ; modifiables à chaud. */
  /** Marge de sécurité des attaques des PNJ, en % de la défense estimée (0 = ils attaquent dès que leur armée bat celle d'en face) ; modifiable à chaud. */
  npcAttackMargin: count('NPC_ATTACK_MARGIN', 0),
  npcRaids: count('NPC_RAIDS', 1) > 0 ? 1 : 0,
  npcRaidsPerThink: count('NPC_RAIDS_PER_THINK', 6),
  npcRaidRadius: count('NPC_RAID_RADIUS', 25),
  /** Recrutement des PNJ : lot maximal par unité, nombre de lots par réflexion, et recrutement avant construction (1 = oui) ; modifiables à chaud. */
  npcRecruitBatch: count('NPC_RECRUIT_BATCH', 150),
  npcRecruitBatches: count('NPC_RECRUIT_BATCHES', 3),
  npcArmyFirst: count('NPC_ARMY_FIRST', 1) > 0 ? 1 : 0,
  /** Délai moyen (minutes réelles à vitesse x1) entre deux réflexions d'un PNJ, divisé par la racine de la vitesse du monde. */
  npcThinkMinutes: count('NPC_THINK_MINUTES', 10),
  /** Gestionnaire de compte (1 = activé sur le monde), modifiable à chaud depuis l'administration. */
  accountManager: count('ACCOUNT_MANAGER', 1) > 0 ? 1 : 0,
  npcMax: count('NPC_MAX', 200),
  /** Croisades (1 = activées) : jours (0 = dimanche … 6 = samedi), heure d'ouverture, durée (minutes), annonce (heures avant),
   *  garnison (% de l'armée offensive de la tribu la plus forte) et bonus de production de la relique (%) ; modifiables à chaud. */
  crusades: count('CRUSADES', 1) > 0 ? 1 : 0,
  crusadeDays: process.env.CRUSADE_DAYS || '3,6',
  crusadeTime: process.env.CRUSADE_TIME || '20:30',
  crusadeMinutes: count('CRUSADE_MINUTES', 60),
  crusadeNoticeHours: count('CRUSADE_NOTICE_HOURS', 48),
  crusadeGarrison: count('CRUSADE_GARRISON', 150),
  crusadeRelicBonus: count('CRUSADE_RELIC_BONUS', 5),
  /** Provinces (1 = activées) : tenue d'un bastion avant contrôle (heures), réglages des trois niveaux, provinces voisines contrôlées
   *  exigées pour attaquer la Terre sainte et tenue de la Terre sainte pour gagner le monde (jours) ; modifiables à chaud. */
  provinces: count('PROVINCES', 1) > 0 ? 1 : 0,
  provinceHoldHours: count('PROVINCE_HOLD_HOURS', 12),
  /** Niveaux des provinces (1 au bord, 3 autour de la Terre sainte) : garde neutre du bastion (population), muraille et bonus (%). */
  provinceGarrison1: count('PROVINCE_GARRISON_1', 1500),
  provinceGarrison2: count('PROVINCE_GARRISON_2', 3000),
  provinceGarrison3: count('PROVINCE_GARRISON_3', 6000),
  provinceWall1: count('PROVINCE_WALL_1', 5),
  provinceWall2: count('PROVINCE_WALL_2', 10),
  provinceWall3: count('PROVINCE_WALL_3', 15),
  provinceBonus1: count('PROVINCE_BONUS_1', 5),
  provinceBonus2: count('PROVINCE_BONUS_2', 10),
  provinceBonus3: count('PROVINCE_BONUS_3', 15),
  /** Trésor reçu par chaque membre de la tribu qui prend le contrôle d'une province : part de l'entrepôt remplie (%), 0 = aucun. */
  provinceTreasure1: count('PROVINCE_TREASURE_1', 10),
  provinceTreasure2: count('PROVINCE_TREASURE_2', 20),
  provinceTreasure3: count('PROVINCE_TREASURE_3', 30),
  holyAccess: count('HOLY_ACCESS', 2),
  holyHoldDays: count('HOLY_HOLD_DAYS', 3),
  /** Ménage : rapports des joueurs gardés (jours, hors archives ; 0 = tous) et mouvements terminés gardés (jours). */
  reportsKeepDays: count('REPORTS_KEEP_DAYS', 30),
  commandsKeepDays: count('COMMANDS_KEEP_DAYS', 4),
  npcDifficulty: num('NPC_DIFFICULTY', 1),
  npcTimezone: process.env.NPC_TIMEZONE || 'Europe/Paris',
  npcQuietStart: count('NPC_QUIET_START', 22),
  npcQuietEnd: count('NPC_QUIET_END', 8),
  // Pseudos (séparés par des virgules) qui accèdent à la page d'administration.
  adminUsernames: (process.env.ADMIN_USERNAMES ?? '')
    .split(',')
    .map((n) => n.trim().toLowerCase())
    .filter(Boolean),
  // Dossier du client compilé (client/dist) à servir avec l'API, pour héberger le jeu sur un seul serveur.
  staticDir: process.env.STATIC_DIR || null,
  // Derrière un proxy (hébergeur, Caddy) : lire la vraie adresse IP des joueurs pour la limitation des requêtes.
  trustProxy: process.env.TRUST_PROXY === '1',
  // Origines autorisées à appeler l'API depuis un autre domaine : par défaut, les applications iOS
  // (capacitor://localhost) et Android (https://localhost). Ajouter d'autres domaines séparés par des virgules.
  corsOrigins: (process.env.CORS_ORIGINS ?? 'capacitor://localhost,ionic://localhost,https://localhost,http://localhost')
    .split(',')
    .map((o) => o.trim())
    .filter(Boolean),
};
