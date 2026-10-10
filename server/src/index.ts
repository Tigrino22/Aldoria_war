import { buildApp } from './app';
import { pool, tx } from './db';
import { env } from './env';
import { processDueEvents } from './game/commands';
import { assignTriblessNpcs, ensureNpcTribes, ensureNpcs, processNpcs } from './game/npc';
import { ensureWorld } from './game/world';
import { withGameLock } from './lock';
import { migrate } from './migrate';

async function main() {
  await migrate();
  await tx((c) => ensureWorld(c, new Date()));
  await tx((c) => ensureNpcs(c, new Date()));
  await tx((c) => ensureNpcTribes(c, new Date()));
  await tx((c) => assignTriblessNpcs(c));

  const app = await buildApp({ logger: true });
  await app.listen({ port: env.port, host: '0.0.0.0' });
  app.log.info(`Monde Aldoria War lancé : vitesse x${env.worldSpeed}, carte ${env.mapSize}x${env.mapSize}`);

  // Le worker : toutes les 250 ms, il exécute les attaques, renforts et retours arrivés à destination.
  const timer = setInterval(() => {
    withGameLock(() => processDueEvents(new Date())).catch((err) => app.log.error(err));
  }, 250);

  // Le cerveau des PNJ : toutes les 30 secondes, ceux dont l'heure est venue réfléchissent et agissent.
  const npcTimer =
    env.npcCount > 0 || env.npcTribes > 0
      ? setInterval(() => {
          withGameLock(async () => {
            await processDueEvents(new Date());
            await processNpcs(new Date());
          }).catch((err) => app.log.error(err));
        }, 30_000)
      : null;

  const stop = async () => {
    clearInterval(timer);
    if (npcTimer) clearInterval(npcTimer);
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
