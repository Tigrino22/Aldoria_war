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
  npcDifficulty: num('NPC_DIFFICULTY', 1),
  npcTimezone: process.env.NPC_TIMEZONE || 'Europe/Paris',
  npcQuietStart: count('NPC_QUIET_START', 22),
  npcQuietEnd: count('NPC_QUIET_END', 8),
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
