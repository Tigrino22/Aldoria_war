import { BUILDING_KEYS, Buildings, emptyUnits, STARTING_BUILDINGS } from '@aldoria/shared';
import type { Db } from '../db';
import { env } from '../env';
import { createVillage } from './village';

const BARBARIAN_NAMES = ['Ruines', 'Hameau abandonné', 'Vieux moulin', 'Camp barbare', 'Bourg en friche', 'Tour isolée'];

const randInt = (min: number, max: number) => min + Math.floor(Math.random() * (max - min + 1));

async function isFree(c: Db, x: number, y: number) {
  const { rows } = await c.query('SELECT 1 FROM villages WHERE x = $1 AND y = $2', [x, y]);
  return rows.length === 0;
}

/** Cherche une case libre autour d'un point, en élargissant le rayon si besoin. */
export async function findFreeSpot(c: Db, cx: number, cy: number, radius: number): Promise<{ x: number; y: number }> {
  const size = env.mapSize;
  for (let attempt = 0; attempt < 500; attempt++) {
    const r = radius + attempt / 20;
    const angle = Math.random() * Math.PI * 2;
    const x = Math.round(cx + Math.cos(angle) * r * Math.random());
    const y = Math.round(cy + Math.sin(angle) * r * Math.random());
    if (x < 0 || y < 0 || x >= size || y >= size) continue;
    if (await isFree(c, x, y)) return { x, y };
  }
  for (let x = 0; x < size; x++) for (let y = 0; y < size; y++) if (await isFree(c, x, y)) return { x, y };
  throw new Error('La carte est pleine');
}

/** Les nouveaux joueurs apparaissent sur un anneau qui s'élargit avec le nombre de joueurs. */
export async function spawnLocation(c: Db) {
  const { rows } = await c.query('SELECT count(*)::int AS n FROM players');
  const center = Math.floor(env.mapSize / 2);
  const ring = Math.min(center - 2, 4 + Math.sqrt(rows[0].n) * 3);
  return findFreeSpot(c, center, center, ring);
}

/** À la première exécution, peuple la carte de villages barbares à piller ou conquérir. */
export async function ensureWorld(c: Db, now: Date) {
  const { rows } = await c.query("SELECT value FROM world_meta WHERE key = 'started_at'");
  if (rows[0]) return;
  await c.query("INSERT INTO world_meta (key, value) VALUES ('started_at', $1)", [JSON.stringify(now.toISOString())]);
  const size = env.mapSize;
  for (let i = 0; i < env.barbarianVillages; i++) {
    const x = randInt(0, size - 1);
    const y = randInt(0, size - 1);
    if (!(await isFree(c, x, y))) continue;
    // Plus on s'éloigne du centre, plus les villages barbares sont développés.
    const dist = Math.hypot(x - size / 2, y - size / 2) / (size / 2);
    const top = Math.max(1, Math.round(2 + dist * 6));
    const buildings: Buildings = { ...STARTING_BUILDINGS };
    for (const k of BUILDING_KEYS) buildings[k] = randInt(k === 'barracks' || k === 'wall' ? 0 : 1, top);
    const stock = randInt(200, 400 + top * 150);
    await createVillage(c, {
      ownerId: null,
      name: BARBARIAN_NAMES[i % BARBARIAN_NAMES.length],
      x,
      y,
      buildings,
      resources: { wood: stock, clay: stock, iron: stock, wheat: stock },
      at: now,
      troops: { ...emptyUnits(), spearman: randInt(0, top * 8), swordsman: randInt(0, top * 3) },
    });
  }
}
