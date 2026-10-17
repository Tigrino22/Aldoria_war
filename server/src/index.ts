import { buildApp } from './app';
import { pool } from './db';
import { env } from './env';
import { migrate } from './migrate';
import { inWorld } from './world-store';
import { allWorlds, initWorld, loadWorlds, setWorldStarter, startWorldLoops, stopAllLoops } from './worlds';

async function main() {
  await migrate();
  await loadWorlds();
  for (const w of allWorlds()) await initWorld(w);

  const app = await buildApp({ logger: true });
  await app.listen({ port: env.port, host: '0.0.0.0' });
  for (const w of allWorlds()) {
    inWorld(w, () => app.log.info(`Monde ${w.name} lancé : vitesse x${env.worldSpeed}, carte ${env.mapSize}x${env.mapSize}`));
    startWorldLoops(w, app.log);
  }
  // Un monde créé depuis l'administration démarre ses tâches de fond aussitôt.
  setWorldStarter((w) => startWorldLoops(w, app.log));

  const stop = async () => {
    stopAllLoops();
    await app.close();
    await pool.end();
    process.exit(0);
  };
  process.on('SIGINT', stop);
  process.on('SIGTERM', stop);
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
