function num(name: string, fallback: number): number {
  const raw = process.env[name];
  const value = raw === undefined || raw === '' ? fallback : Number(raw);
  if (!Number.isFinite(value) || value <= 0) throw new Error(`Variable d'environnement invalide : ${name}`);
  return value;
}

export const env = {
  databaseUrl: process.env.DATABASE_URL ?? 'postgres://aldoria:aldoria@localhost:5432/aldoria',
  port: num('PORT', 3001),
  worldSpeed: num('WORLD_SPEED', 1),
  mapSize: Math.floor(num('MAP_SIZE', 100)),
  barbarianVillages: Math.floor(num('BARBARIAN_VILLAGES', 250)),
  // Origines autorisées à appeler l'API depuis un autre domaine : par défaut, les applications iOS
  // (capacitor://localhost) et Android (https://localhost). Ajouter d'autres domaines séparés par des virgules.
  corsOrigins: (process.env.CORS_ORIGINS ?? 'capacitor://localhost,ionic://localhost,https://localhost,http://localhost')
    .split(',')
    .map((o) => o.trim())
    .filter(Boolean),
};
