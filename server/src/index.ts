import { buildApp } from './app';
import { pool, tx } from './db';
import { env } from './env';
import { processDueEvents } from './game/commands';
import { processCrusades } from './game/crusades';
import { ensureProvinces, processProvinces } from './game/provinces';
import { housekeeping } from './game/housekeeping';
import { Outbox } from './notify';
import { assignTriblessNpcs, ensureNpcTribes, ensureNpcs, processNpcs } from './game/npc';
import { ensureWorld } from './game/world';
import { skipIfBusy, withGameLock } from './lock';
import { processManager } from './manager/engine';
import { migrate } from './migrate';
import { loadSettings } from './settings';
import { recomputeVillagePoints } from './game/village';

async function main() {
  await migrate();
  await loadSettings();
  await tx((c) => ensureWorld(c, new Date()));
  await tx((c) => ensureProvinces(c, new Date()));
  await tx((c) => ensureNpcs(c, new Date()));
  await tx((c) => ensureNpcTribes(c, new Date()));
  await tx((c) => assignTriblessNpcs(c));
  await tx((c) => recomputeVillagePoints(c));

  const app = await buildApp({ logger: true });
  await app.listen({ port: env.port, host: '0.0.0.0' });
  app.log.info(`Monde Aldoria War lancé : vitesse x${env.worldSpeed}, carte ${env.mapSize}x${env.mapSize}`);

  // Les tâches de fond signalent leurs erreurs dans le journal sans s'arrêter.
  // Le worker : toutes les 250 ms, il exécute les attaques, renforts et retours arrivés à destination,
  // par lots de 20 pour que les actions des joueurs passent entre deux lots.
  const report = (fn: () => Promise<unknown>) => () => fn().catch((err) => app.log.error(err));
  const timer = setInterval(
    report(
      skipIfBusy(async () => {
        while ((await withGameLock(() => processDueEvents(new Date(), 20))) >= 20);
      }),
    ),
    250,
  );

  // Le cerveau des PNJ : toutes les 30 secondes, ceux dont l'heure est venue réfléchissent et agissent, un par un sous le verrou.
  const npcTimer =
    env.npcCount > 0 || env.npcTribes > 0
      ? setInterval(
          report(
            skipIfBusy(async () => {
              await withGameLock(() => processDueEvents(new Date()));
              await processNpcs(new Date(), 25, { lock: withGameLock, clock: () => new Date() });
            }),
          ),
          30_000,
        )
      : null;

  // Le gestionnaire de compte : une fois par minute, il fait avancer les villages que les joueurs lui ont confiés, un par un sous le verrou.
  const managerTimer = setInterval(
    report(skipIfBusy(() => processManager(new Date(), { lock: withGameLock, clock: () => new Date() }))),
    60_000,
  );

  // Croisades : toutes les 10 secondes, ouverture et fermeture des portes à l'heure, annonce de la suivante.
  // Provinces : contrôle des bastions tenus assez longtemps, victoire du monde.
  const crusadeTimer = setInterval(
    report(
      skipIfBusy(() =>
        withGameLock(async () => {
          await processDueEvents(new Date());
          const outbox = new Outbox();
          await tx((c) => processCrusades(c, outbox, new Date()));
          await tx((c) => processProvinces(c, outbox, new Date()));
          outbox.flush();
        }),
      ),
    ),
    10_000,
  );

  // Ménage : une fois par heure, les vieux mouvements terminés et les vieux rapports sont effacés, par petits lots.
  const houseTimer = setInterval(report(skipIfBusy(() => housekeeping(new Date()))), 3_600_000);
  setTimeout(report(() => housekeeping(new Date())), 60_000);

  const stop = async () => {
    clearInterval(timer);
    clearInterval(crusadeTimer);
    clearInterval(houseTimer);
    clearInterval(managerTimer);
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
