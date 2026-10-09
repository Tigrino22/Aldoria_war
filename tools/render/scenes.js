// Décors : la place du village (fond sur lequel on pose les bâtiments) et les éléments de la carte.
import * as THREE from 'three';
import { rand } from './textures.js';
import {
  group, place, patch, rectPatch, well, deciduousTree, pineTree, bush, rock, fence, haystack, barrel, crate, sack,
  logPile, box, cyl, flag, mat,
} from './kit.js';
import { BUILDERS } from './buildings.js';

const YAW = THREE.MathUtils.degToRad(32);
const RIGHT = [Math.cos(YAW), -Math.sin(YAW)];
const DOWN = [Math.sin(YAW), Math.cos(YAW)];
/** Coordonnées « écran » (sx vers la droite, sz vers le bas de l'image) → monde (x, z). */
const W = (sx, sz) => [sx * RIGHT[0] + sz * DOWN[0], sx * RIGHT[1] + sz * DOWN[1]];

// Emplacements des bâtiments dans le village, en coordonnées écran (mètres).
const LAYOUT = {
  townhall: [0, -12],
  barracks: [-15, -3],
  warehouse: [15, -3],
  woodcutter: [-24, 7],
  farm: [-10, 14],
  claypit: [10, 14],
  ironmine: [24, 6],
  wall: [0, 25],
  market: [0, 4],
};
const CENTER = [0, 4];
const WELL = [7, -6];

/** Chemin de terre entre deux points écran : une suite de petites plaques. */
function path(a, b, width = 1.1) {
  const g = new THREE.Group();
  const [ax, az] = W(...a), [bx, bz] = W(...b);
  const len = Math.hypot(bx - ax, bz - az);
  const n = Math.ceil(len / 0.8);
  for (let i = 0; i <= n; i++) {
    const t = i / n;
    const wob = (rand() - 0.5) * 0.5;
    g.add(patch(width * (0.85 + rand() * 0.3), width * (0.85 + rand() * 0.3), 'dirt', ax + (bx - ax) * t + wob, 0.015, az + (bz - az) * t + wob, 0.3));
  }
  return g;
}

function nearSpot(x, z, margin) {
  for (const [sx, sz] of [...Object.values(LAYOUT), CENTER]) {
    const [wx, wz] = W(sx, sz);
    if (Math.hypot(wx - x, wz - z) < margin) return true;
  }
  return false;
}

export const SCENES = {
  village() {
    const g = new THREE.Group();
    const ground = rectPatch(160, 160, 'grass', 0, 0, 0);
    ground.material = mat('grass', { color: 0xb4b498 });
    g.add(ground);
    // Variations de prairie : herbe plus sombre et zones plus sèches.
    for (let i = 0; i < 26; i++) {
      const [x, z] = W((rand() - 0.5) * 70, (rand() - 0.5) * 55);
      const p = patch(3 + rand() * 6, 2 + rand() * 5, 'grass', x, 0.006, z, 0.4);
      p.material = mat('grass', { color: rand() < 0.5 ? 0xd0c890 : 0x8a9878 });
      g.add(p);
    }
    // Place centrale, puits, chemins vers chaque emplacement.
    const [cx, cz] = W(...CENTER);
    g.add(patch(6.5, 5.5, 'dirt', cx, 0.02, cz, 0.25));
    const [wx, wz] = W(...WELL);
    g.add(patch(2.2, 2, 'dirt', wx, 0.025, wz, 0.25));
    g.add(well(wx, 0, wz));
    for (const spot of Object.values(LAYOUT)) g.add(path(CENTER, spot));
    g.add(path(LAYOUT.wall, [0, 40]));
    // Arbres, buissons et rochers autour, sans gêner les emplacements.
    let placed = 0;
    for (let tries = 0; tries < 900 && placed < 120; tries++) {
      const sx = (rand() - 0.5) * 86, sz = -32 + rand() * 72;
      const [x, z] = W(sx, sz);
      const edge = Math.abs(sx) > 30 || sz < -20 || sz > 30;
      if (nearSpot(x, z, edge ? 7 : 9)) continue;
      if (Math.abs(sx) < 5 && sz > 24) continue; // chemin de sortie
      if (!edge && rand() < 0.75) continue;
      const r = rand();
      if (r < 0.45) g.add(pineTree(0.9 + rand() * 0.5, x, 0, z));
      else if (r < 0.8) g.add(deciduousTree(0.8 + rand() * 0.45, x, 0, z));
      else if (r < 0.93) g.add(bush(0.7 + rand() * 0.6, x, 0, z));
      else g.add(rock(0.5 + rand() * 0.7, x, 0, z));
      placed++;
    }
    // Quelques détails de vie près de la place.
    const deco = (sx, sz, obj) => { const [x, z] = W(sx, sz); obj.position.x += x; obj.position.z += z; g.add(obj); };
    deco(9.5, -4.5, group(barrel(0, 0, 0), barrel(0.8, 0, 0.5)));
    deco(-7, -6, group(sack(0, 0, 0), sack(0.6, 0, 0.3, 1), haystack(-1.3, 0, -0.4, 0.8)));
    const target = W(...CENTER);
    const spots = {};
    for (const [k, s] of Object.entries(LAYOUT)) { const [x, z] = W(...s); spots[k] = [x, 0, z]; }
    return {
      object: g,
      spots,
      view: { frame: 64, px: 1400, aspect: 800 / 560, ground: 'none', centerY: 0, target: [target[0], 0, target[1]], spotY: 4.2 },
    };
  },

  // --- Carte : villages selon leur taille, ruines barbares, bosquets, collines -------------------
  mapVillage1: () => mapItem(hamlet(1)),
  mapVillage2: () => mapItem(hamlet(2)),
  mapVillage3: () => mapItem(hamlet(3)),
  mapBarbarian: () => mapItem(barbarian()),
  mapTrees: () => mapItem(group(pineTree(1.1, -1.6, 0, -1), deciduousTree(1, 1.6, 0, -0.6), pineTree(0.9, 0.2, 0, 1.6), bush(0.8, -2, 0, 1.8))),
  mapHill: () => mapItem(hill()),
};

function mapItem(object) {
  return { object, view: { frame: 11, px: 256, aspect: 1, ground: 'shadow', centerY: 1.6 } };
}

/** Petit village vu de loin : quelques maisons autour d'une place, palissade puis remparts. */
function hamlet(size) {
  const g = new THREE.Group();
  g.add(patch(4.2, 3.8, 'dirt', 0, 0.02, 0, 0.25));
  const houses = size === 1 ? 3 : size === 2 ? 5 : 6;
  const scale = 0.42;
  const center = BUILDERS.townhall(size);
  g.add(place(center, 0, 0, -0.4, 0, scale));
  for (let i = 0; i < houses; i++) {
    const a = (i / houses) * Math.PI * 2 + 0.6;
    const pick = ['farm', 'barracks', 'warehouse', 'woodcutter', 'claypit', 'ironmine'][i % 6];
    const b = BUILDERS[pick](Math.max(1, size - (i % 2)));
    g.add(place(b, Math.cos(a) * 2.9, 0, Math.sin(a) * 2.5 + 0.3, -a, scale * 0.62));
  }
  if (size >= 2) {
    const wall = new THREE.Group();
    const n = 26;
    for (let i = 0; i < n; i++) {
      const a = (i / n) * Math.PI * 2;
      if (Math.abs(a - Math.PI * 0.5) < 0.2) continue; // porte
      const tex = size === 3 ? 'stone' : 'logs';
      const h = size === 3 ? 0.9 : 0.75;
      const s = box(0.78, h, 0.32, tex, Math.cos(a) * 4.6, 0, Math.sin(a) * 4.2);
      s.rotation.y = -a + Math.PI / 2;
      wall.add(s);
    }
    g.add(wall);
  }
  return g;
}

function barbarian() {
  const g = new THREE.Group();
  g.add(patch(3.6, 3.2, 'dirt', 0, 0.02, 0, 0.35));
  // Masure abandonnée : la cabane du bûcheron, sans bannière.
  g.add(place(BUILDERS.woodcutter(1), 0.2, 0, -0.3, 0.3, 0.5));
  // Murs écroulés et débris.
  for (let i = 0; i < 9; i++) {
    const a = rand() * Math.PI * 2, d = 2.4 + rand() * 1.4;
    const b = box(0.5 + rand() * 0.6, 0.2 + rand() * 0.5, 0.3, 'stone', Math.cos(a) * d, 0, Math.sin(a) * d);
    b.rotation.y = rand() * 3;
    g.add(b);
  }
  g.add(rock(0.4, -1.8, 0, 1.2), rock(0.3, 2, 0, 1.5));
  g.add(logPile(2, 1.4, -2, 0, -1.6, 0.6));
  return g;
}

function hill() {
  const g = new THREE.Group();
  const geo = new THREE.SphereGeometry(4, 32, 16, 0, Math.PI * 2, 0, Math.PI / 2);
  const pos = geo.attributes.position;
  for (let i = 0; i < pos.count; i++) {
    const x = pos.getX(i), z = pos.getZ(i);
    const n = Math.sin(x * 1.3) * 0.2 + Math.cos(z * 1.7) * 0.2;
    pos.setY(i, pos.getY(i) * 0.45 + n * (pos.getY(i) > 0.1 ? 1 : 0));
  }
  geo.computeVertexNormals();
  const uv = geo.attributes.uv;
  for (let i = 0; i < pos.count; i++) uv.setXY(i, pos.getX(i) / 6, pos.getZ(i) / 6);
  const m = new THREE.Mesh(geo, mat('grass', { bump: 0.05 }));
  m.castShadow = m.receiveShadow = true;
  g.add(m);
  g.add(rock(0.9, -1.2, 1.1, 0.3), rock(0.6, 1, 1.2, -0.6), rock(0.5, 0.3, 1.6, 0));
  g.add(pineTree(0.7, 2.6, 0.4, 1.4), bush(0.6, -2.6, 0.2, 1.6));
  return g;
}
