// Modelage par champs de distance (SDF) : on décrit des formes organiques (corps, chevaux, vêtements)
// par des primitives fondues entre elles, puis on en extrait une surface lisse avec les marching cubes.
import * as THREE from 'three';
import { MarchingCubes } from 'three/addons/objects/MarchingCubes.js';
import { worldUV } from './kit.js';

// ---------- Vecteurs minimalistes (tableaux [x, y, z]) ----------
const sub = (a, b) => [a[0] - b[0], a[1] - b[1], a[2] - b[2]];
const dot = (a, b) => a[0] * b[0] + a[1] * b[1] + a[2] * b[2];
const len = (a) => Math.sqrt(dot(a, a));
const clamp = (x, a, b) => Math.min(b, Math.max(a, x));

// ---------- Primitives (distance signée au point p) ----------
export const sphere = (c, r) => (p) => len(sub(p, c)) - r;

/** Ellipsoïde (approximation d'Inigo Quilez). */
export const ellipsoid = (c, r) => (p) => {
  const q = sub(p, c);
  const k0 = Math.hypot(q[0] / r[0], q[1] / r[1], q[2] / r[2]);
  const k1 = Math.hypot(q[0] / (r[0] * r[0]), q[1] / (r[1] * r[1]), q[2] / (r[2] * r[2]));
  return k1 === 0 ? -Math.min(...r) : (k0 * (k0 - 1)) / k1;
};

/** Cône arrondi entre a (rayon ra) et b (rayon rb) : membres, cou, museau… */
export const limb = (a, b, ra, rb) => {
  const ba = sub(b, a);
  const l2 = dot(ba, ba);
  return (p) => {
    const pa = sub(p, a);
    const h = clamp(dot(pa, ba) / l2, 0, 1);
    const d = len([pa[0] - ba[0] * h, pa[1] - ba[1] * h, pa[2] - ba[2] * h]);
    return d - (ra + (rb - ra) * h);
  };
};

/** Boîte arrondie centrée en c, demi-tailles h, rayon d'arrondi r, tournée de rotY autour de y. */
export const roundBox = (c, h, r = 0.01, rotY = 0) => {
  const cs = Math.cos(rotY), sn = Math.sin(rotY);
  return (p) => {
    let x = p[0] - c[0], y = p[1] - c[1], z = p[2] - c[2];
    [x, z] = [x * cs - z * sn, x * sn + z * cs];
    const q = [Math.abs(x) - h[0] + r, Math.abs(y) - h[1] + r, Math.abs(z) - h[2] + r];
    return len([Math.max(q[0], 0), Math.max(q[1], 0), Math.max(q[2], 0)]) + Math.min(Math.max(q[0], q[1], q[2]), 0) - r;
  };
};

/** Cylindre vertical (axe y) entre y0 et y1, éventuellement évasé (r0 en bas, r1 en haut). */
export const cylY = (c, y0, y1, r0, r1 = r0) => (p) => {
  const t = clamp((p[1] - y0) / (y1 - y0), 0, 1);
  const r = r0 + (r1 - r0) * t;
  const dr = Math.hypot(p[0] - c[0], p[2] - c[2]) - r;
  const dy = Math.max(y0 - p[1], p[1] - y1);
  return Math.min(Math.max(dr, dy), 0) + len([Math.max(dr, 0), Math.max(dy, 0), 0]);
};

// ---------- Opérations ----------
export const smin = (a, b, k) => {
  const h = Math.max(k - Math.abs(a - b), 0) / k;
  return Math.min(a, b) - h * h * k * 0.25;
};
/** Union lisse de plusieurs formes. */
export const blend = (k, ...fs) => (p) => {
  let d = fs[0](p);
  for (let i = 1; i < fs.length; i++) d = smin(d, fs[i](p), k);
  return d;
};
export const union = (...fs) => (p) => Math.min(...fs.map((f) => f(p)));
export const carve = (f, g, k = 0) => (p) => (k ? -smin(-f(p), g(p), k) : Math.max(f(p), -g(p)));
export const intersect = (f, g) => (p) => Math.max(f(p), g(p));
/** Gonfle (épaisseur positive) ou creuse une forme : sert à « habiller » un corps. */
export const inflate = (f, t) => (p) => f(p) - t;
/** Coque fine (cape, voile) autour de la surface de f. */
export const shell = (f, t) => (p) => Math.abs(f(p)) - t;
/** Ajoute un relief (plis, bosses) : fn(p) renvoie un déplacement en mètres. */
export const displace = (f, fn) => (p) => f(p) - fn(p);
/** Demi-espace : garde ce qui est sous le plan de normale n passant par c. */
export const halfSpace = (c, n) => (p) => dot(sub(p, c), n);

// ---------- Extraction de surface ----------

/**
 * Transforme une forme SDF en maillage lisse.
 * `center` et `size` définissent le cube de travail (en mètres), `res` sa résolution.
 */
export function sdfMesh(f, material, { center = [0, 1, 0], size = 2.4, res = 128, tex = null, ao = null } = {}) {
  const mc = new MarchingCubes(res, material, false, false, 600000);
  mc.isolation = 0;
  const half = size / 2;
  const field = mc.field;
  const p = [0, 0, 0];
  for (let z = 0; z < res; z++) {
    p[2] = center[2] + ((z - res / 2) / (res / 2)) * half;
    for (let y = 0; y < res; y++) {
      p[1] = center[1] + ((y - res / 2) / (res / 2)) * half;
      for (let x = 0; x < res; x++) {
        p[0] = center[0] + ((x - res / 2) / (res / 2)) * half;
        // Intérieur positif, comme les metaballs attendues par MarchingCubes.
        field[x + y * res + z * res * res] = -f(p) * res;
      }
    }
  }
  mc.update();
  const n = mc.count;
  const pos = new Float32Array(n * 3);
  const nor = new Float32Array(n * 3);
  for (let i = 0; i < n * 3; i += 3) {
    pos[i] = center[0] + mc.positionArray[i] * half;
    pos[i + 1] = center[1] + mc.positionArray[i + 1] * half;
    pos[i + 2] = center[2] + mc.positionArray[i + 2] * half;
    const nx = mc.normalArray[i], ny = mc.normalArray[i + 1], nz = mc.normalArray[i + 2];
    const l = Math.hypot(nx, ny, nz) || 1;
    nor[i] = nx / l;
    nor[i + 1] = ny / l;
    nor[i + 2] = nz / l;
  }
  const geo = new THREE.BufferGeometry();
  geo.setAttribute('position', new THREE.BufferAttribute(pos, 3));
  geo.setAttribute('normal', new THREE.BufferAttribute(nor, 3));
  if (tex) worldUV(geo, tex);
  mc.geometry.dispose();
  let mtl = material;
  if (ao) {
    // Occlusion ambiante calculée sur le champ de distance : creux, plis et recoins s'assombrissent.
    const col = new Float32Array(n * 3);
    const q = [0, 0, 0];
    for (let i = 0; i < n * 3; i += 3) {
      let occ = 0, w = 1;
      for (let k = 1; k <= 5; k++) {
        const h = 0.012 * k * k * 0.6 + 0.004;
        q[0] = pos[i] + nor[i] * h;
        q[1] = pos[i + 1] + nor[i + 1] * h;
        q[2] = pos[i + 2] + nor[i + 2] * h;
        occ += w * Math.max(0, h - ao(q));
        w *= 0.6;
      }
      const v = Math.max(0.25, 1 - occ * 9);
      col[i] = col[i + 1] = col[i + 2] = v;
    }
    geo.setAttribute('color', new THREE.BufferAttribute(col, 3));
    mtl = material.clone();
    mtl.vertexColors = true;
  }
  const m = new THREE.Mesh(geo, mtl);
  m.castShadow = m.receiveShadow = true;
  return m;
}

// ---------- Bruit 3D (plis, froissés, irrégularités des tissus) ----------
const PERM = new Uint8Array(512);
{
  let s = 12345;
  const r = () => ((s = (s * 16807) % 2147483647) - 1) / 2147483646;
  const p = [...Array(256).keys()];
  for (let i = 255; i > 0; i--) {
    const j = Math.floor(r() * (i + 1));
    [p[i], p[j]] = [p[j], p[i]];
  }
  for (let i = 0; i < 512; i++) PERM[i] = p[i & 255];
}
const VAL = new Float32Array(256).map((_, i) => ((PERM[i] * 7919) % 256) / 255);
const fd = (t) => t * t * (3 - 2 * t);
/** Bruit de valeur 3D entre 0 et 1. */
export function noise3(x, y, z) {
  const xi = Math.floor(x), yi = Math.floor(y), zi = Math.floor(z);
  const u = fd(x - xi), v = fd(y - yi), w = fd(z - zi);
  const h = (i, j, k) => VAL[PERM[(PERM[(PERM[(xi + i) & 255] + yi + j) & 255] + zi + k) & 255]];
  const l = (a, b, t) => a + (b - a) * t;
  return l(
    l(l(h(0, 0, 0), h(1, 0, 0), u), l(h(0, 1, 0), h(1, 1, 0), u), v),
    l(l(h(0, 0, 1), h(1, 0, 1), u), l(h(0, 1, 1), h(1, 1, 1), u), v),
    w,
  );
}
/** Bruit fractal 3D centré sur 0 (environ entre -0,5 et 0,5). */
export function fbm3(p, freq = 10, octaves = 3) {
  let sum = 0, amp = 0.5, f = freq;
  for (let o = 0; o < octaves; o++) {
    sum += amp * (noise3(p[0] * f + o * 17.3, p[1] * f, p[2] * f) - 0.5);
    amp *= 0.5;
    f *= 2.03;
  }
  return sum * 1.6;
}
/**
 * Tissu froissé : plis irréguliers étirés verticalement (l'étoffe tombe) et petites bosses.
 * `amp` en mètres.
 */
export const wrinkle = (f, amp = 0.006, freq = 9) => (p) => {
  const d = f(p);
  if (d > amp * 4) return d; // loin de la surface : inutile de calculer le bruit
  const folds = fbm3([p[0] * 1.6, p[1] * 0.45, p[2] * 1.6], freq, 2);
  const crumple = fbm3(p, freq * 3, 2);
  return d - amp * (Math.abs(folds) * -2 + 0.5 + crumple * 0.6);
};
