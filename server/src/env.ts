function num(name: string, fallback: number): number {
  const raw = process.env[name];
  const value = raw === undefined || raw === '' ? fallback : Number(raw);
  if (!Number.isFinite(value) || value <= 0) throw new Error(`Variable d'environnement invalide : ${name}`);
  return value;
}

export const env = {
  databaseUrl: process.env.DATABASE_URL ?? 'postgres://fiefs:fiefs@localhost:5432/fiefs',
  port: num('PORT', 3001),
  worldSpeed: num('WORLD_SPEED', 1),
  mapSize: Math.floor(num('MAP_SIZE', 100)),
  barbarianVillages: Math.floor(num('BARBARIAN_VILLAGES', 250)),
};
