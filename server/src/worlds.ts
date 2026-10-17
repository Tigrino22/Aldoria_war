import { corePool, trackPool, tx, worldPool } from './db';
import { env, envDefaults, worldEnvDefaults } from './env';
import { GameError } from './errors';
import { processAchievements } from './game/achievements';
import { processDueEvents } from './game/commands';
import { processCrusades } from './game/crusades';
import { housekeeping } from './game/housekeeping';
import { assignTriblessNpcs, ensureNpcTribes, ensureNpcs, processNpcs } from './game/npc';
import { ensureProvinces, processProvinces } from './game/provinces';
import { recomputeVillagePoints } from './game/village';
import { ensureWorld } from './game/world';
import { skipIfBusy, withGameLock } from './lock';
import { processManager } from './manager/engine';
import { migrateWorldSchema } from './migrate';
import { Outbox } from './notify';
import { loadSettings } from './settings';
import { allWorlds, defaultWorld, inWorld, registerWorld, worldById, type WorldCtx } from './world-store';

/**
 * Réglages fixés à la création d'un monde : les changer en cours de partie fausserait les files de construction,
 * les trajets en cours, les coordonnées ou le peuplement. Les autres réglages se changent à chaud (voir settings.ts).
 */
export const WORLD_CONFIG = [
  { key: 'worldSpeed', label: 'Vitesse du monde', help: 'Multiplie la production, les constructions, le recrutement et les trajets (1 = normal, 10 = monde de test très rapide)', min: 0.1, max: 1000, integer: false },
  { key: 'mapSize', label: 'Taille de la carte (cases de côté)', help: 'La carte est un carré de ce nombre de cases de côté', min: 30, max: 500, integer: true },
  { key: 'barbarianVillages', label: 'Villages barbares au départ', help: 'Villages sans maître placés sur la carte à la création du monde, à piller ou conquérir', min: 0, max: 20000, integer: true },
  { key: 'npcCount', label: 'PNJ solitaires au départ', help: 'Joueurs pilotés par le serveur présents dès l’ouverture (0 = aucun)', min: 0, max: 1000, integer: true },
  { key: 'npcTribes', label: 'Tribus de PNJ au départ', help: 'Tribus pilotées par le serveur créées à l’ouverture (0 = aucune)', min: 0, max: 50, integer: true },
  { key: 'npcTribeSize', label: 'Membres d’une tribu de PNJ au départ', help: 'Nombre de PNJ dans chaque tribu de PNJ créée à l’ouverture', min: 1, max: 50, integer: true },
] as const;

export type WorldConfigKey = (typeof WORLD_CONFIG)[number]['key'];
export type WorldConfig = Partial<Record<WorldConfigKey, number>>;

export interface WorldRow {
  id: number;
  name: string;
  schema_name: string;
  config: WorldConfig;
  open: boolean;
  created_at: Date;
}

const meta = new Map<number, { open: boolean; createdAt: Date }>();
const stops = new Map<number, () => void>();

export { allWorlds, worldById };
export const worldMeta = (id: number) => meta.get(id) ?? { open: true, createdAt: new Date(0) };

/** Valeur d'un réglage de création dans un monde (celle de l'environnement pour le monde n° 1). */
export const configValue = (w: WorldCtx, key: WorldConfigKey) => w.env[key] as number;

/** Contrôle les réglages de création reçus ; renvoie un message d'erreur en français sinon. */
export function parseWorldConfig(raw: Record<string, unknown>): { config: WorldConfig } | { error: string } {
  const config: WorldConfig = {};
  for (const def of WORLD_CONFIG) {
    const v = raw[def.key];
    if (v === undefined || v === null || v === '') continue;
    const n = typeof v === 'number' ? v : Number(String(v).replace(',', '.'));
    if (!Number.isFinite(n)) return { error: `${def.label} : nombre attendu` };
    if (def.integer && !Number.isInteger(n)) return { error: `${def.label} : nombre entier attendu` };
    if (n < def.min || n > def.max) return { error: `${def.label} : entre ${def.min} et ${def.max}` };
    config[def.key] = n;
  }
  return { config };
}

function contextOf(row: WorldRow): WorldCtx {
  if (row.schema_name === 'public') {
    const w = defaultWorld();
    w.name = row.name;
    return w;
  }
  const pool = worldPool(row.schema_name);
  trackPool(pool);
  return { id: row.id, name: row.name, schema: row.schema_name, pool, env: { ...worldEnvDefaults(), ...row.config }, tail: Promise.resolve() };
}

/** Charge la liste des mondes et leurs réglages enregistrés (au démarrage, après les migrations). */
export async function loadWorlds() {
  const { rows } = await corePool.query<WorldRow>('SELECT * FROM core.worlds ORDER BY id');
  for (const row of rows) {
    if (allWorlds().some((w) => w.id === row.id)) continue;
    const w = contextOf(row);
    registerWorld(w);
    meta.set(row.id, { open: row.open, createdAt: row.created_at });
    await inWorld(w, loadSettings);
  }
}

/** Prépare un monde au démarrage ou à sa création : carte, barbares, provinces, PNJ et points. */
export async function initWorld(w: WorldCtx, now = new Date()) {
  await inWorld(w, async () => {
    await tx((c) => ensureWorld(c, now));
    await tx((c) => ensureProvinces(c, now));
    await tx((c) => ensureNpcs(c, now));
    await tx((c) => ensureNpcTribes(c, now));
    await tx((c) => assignTriblessNpcs(c));
    await tx((c) => recomputeVillagePoints(c));
  });
}

export const NAME_RULE = /^[\p{L}0-9 '’_-]{2,30}$/u;

let starter: ((w: WorldCtx) => void) | null = null;
/** Le serveur indique comment lancer les tâches de fond d'un monde créé en cours de route (rien dans les tests). */
export const setWorldStarter = (fn: (w: WorldCtx) => void) => {
  starter = fn;
};

/** Crée un nouveau monde : son schéma, ses tables, sa carte et ses PNJ, puis lance ses tâches de fond. */
export async function createWorld(input: { name: string; config: WorldConfig; open?: boolean }) {
  const name = input.name.trim();
  if (!NAME_RULE.test(name)) throw new GameError('Le nom du monde doit faire 2 à 30 caractères (lettres, chiffres, espaces, - et _)');
  const taken = await corePool.query('SELECT 1 FROM core.worlds WHERE lower(name) = lower($1)', [name]);
  if (taken.rowCount) throw new GameError('Un monde porte déjà ce nom');
  const id = Number((await corePool.query("SELECT nextval(pg_get_serial_sequence('core.worlds', 'id')) AS id")).rows[0].id);
  const { rows } = await corePool.query<WorldRow>(
    'INSERT INTO core.worlds (id, name, schema_name, config, open) VALUES ($1, $2, $3, $4, $5) RETURNING *',
    [id, name, `monde_${id}`, JSON.stringify(input.config), input.open ?? true],
  );
  const row = rows[0];
  try {
    await migrateWorldSchema(row.schema_name);
  } catch (err) {
    await corePool.query(`DROP SCHEMA IF EXISTS ${row.schema_name} CASCADE`).catch(() => undefined);
    await corePool.query('DELETE FROM core.worlds WHERE id = $1', [row.id]);
    throw err;
  }
  const w = contextOf(row);
  registerWorld(w);
  meta.set(row.id, { open: row.open, createdAt: row.created_at });
  await initWorld(w);
  starter?.(w);
  return w;
}

/** Renomme un monde ou ouvre / ferme ses inscriptions. */
export async function updateWorld(id: number, patch: { name?: string; open?: boolean }) {
  const w = worldById(id);
  if (!w) throw new GameError('Monde introuvable', 404);
  if (patch.name !== undefined) {
    const name = patch.name.trim();
    if (!NAME_RULE.test(name)) throw new GameError('Le nom du monde doit faire 2 à 30 caractères (lettres, chiffres, espaces, - et _)');
    const taken = await corePool.query('SELECT 1 FROM core.worlds WHERE lower(name) = lower($1) AND id <> $2', [name, id]);
    if (taken.rowCount) throw new GameError('Un monde porte déjà ce nom');
    await corePool.query('UPDATE core.worlds SET name = $2 WHERE id = $1', [id, name]);
    w.name = name;
  }
  if (patch.open !== undefined) {
    await corePool.query('UPDATE core.worlds SET open = $2 WHERE id = $1', [id, patch.open]);
    meta.set(id, { ...worldMeta(id), open: patch.open });
  }
}

/** Valeur d'origine d'un réglage de création, pour l'afficher dans le formulaire d'un nouveau monde. */
export const configDefault = (key: WorldConfigKey) => envDefaults[key] as number;

type Log = { error: (err: unknown) => void };

/**
 * Tâches de fond d'un monde, chacune dans son monde et sous son verrou. Les erreurs vont dans le journal sans arrêter le minuteur.
 * Renvoie la fonction qui les arrête.
 */
export function startWorldLoops(w: WorldCtx, log: Log): () => void {
  const report = (fn: () => Promise<unknown>) => () => inWorld(w, fn).catch((err) => log.error(err));
  const timers: ReturnType<typeof setInterval>[] = [];
  const every = (ms: number, fn: () => Promise<unknown>) => timers.push(setInterval(report(skipIfBusy(fn)), ms));

  // Le worker : toutes les 250 ms, il exécute les attaques, renforts et retours arrivés à destination,
  // par lots de 20 pour que les actions des joueurs passent entre deux lots.
  every(250, async () => {
    while ((await withGameLock(() => processDueEvents(new Date(), 20))) >= 20);
  });

  // Le cerveau des PNJ : toutes les 30 secondes, ceux dont l'heure est venue réfléchissent et agissent, un par un sous le verrou.
  if (inWorld(w, () => env.npcCount > 0 || env.npcTribes > 0)) {
    every(30_000, async () => {
      await withGameLock(() => processDueEvents(new Date()));
      await processNpcs(new Date(), 25, { lock: withGameLock, clock: () => new Date() });
    });
  }

  // Le gestionnaire de compte : une fois par minute, il fait avancer les villages que les joueurs lui ont confiés, un par un sous le verrou.
  every(60_000, () => processManager(new Date(), { lock: withGameLock, clock: () => new Date() }));

  // Croisades : toutes les 10 secondes, ouverture et fermeture des portes à l'heure, annonce de la suivante.
  // Provinces : contrôle des bastions tenus assez longtemps, victoire du monde.
  every(10_000, () =>
    withGameLock(async () => {
      await processDueEvents(new Date());
      const outbox = new Outbox();
      await tx((c) => processCrusades(c, outbox, new Date()));
      await tx((c) => processProvinces(c, outbox, new Date()));
      outbox.flush();
    }),
  );

  // Succès : toutes les 5 minutes, les joueurs reçoivent les paliers atteints (badge, coffre et rapport).
  every(300_000, () =>
    withGameLock(async () => {
      const outbox = new Outbox();
      await tx((c) => processAchievements(c, outbox, new Date()));
      outbox.flush();
    }),
  );

  // Ménage : une fois par heure, les vieux mouvements terminés et les vieux rapports sont effacés, par petits lots.
  every(3_600_000, () => housekeeping(new Date()));
  const first = setTimeout(report(() => housekeeping(new Date())), 60_000);

  const stop = () => {
    timers.forEach(clearInterval);
    clearTimeout(first);
  };
  stops.set(w.id, stop);
  return stop;
}

export const stopAllLoops = () => {
  for (const stop of stops.values()) stop();
  stops.clear();
};
