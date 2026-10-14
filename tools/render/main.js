// Moteur de rendu : une caméra orthographique en vue 3/4, lumière du soir venant de la gauche,
// ombres douces projetées sur un sol invisible. Chaque élément est rendu seul, fond transparent.
import * as THREE from 'three';
import { RoomEnvironment } from 'three/addons/environments/RoomEnvironment.js';
import { BUILDERS } from './buildings.js';
import { SCENES } from './scenes.js';
import { ICONS, MODELS } from './icons.js';
import { FIGURES, setGait } from './figures.js';
import { setSeed, texture, WORLD } from './textures.js';

export const YAW = THREE.MathUtils.degToRad(32);
export const PITCH = THREE.MathUtils.degToRad(38);

const renderer = new THREE.WebGLRenderer({ antialias: true, alpha: true, preserveDrawingBuffer: true });
renderer.shadowMap.enabled = true;
renderer.shadowMap.type = THREE.PCFSoftShadowMap;
renderer.toneMapping = THREE.ACESFilmicToneMapping;
renderer.toneMappingExposure = 1.05;
renderer.outputColorSpace = THREE.SRGBColorSpace;
renderer.setClearColor(0x000000, 0);
document.body.appendChild(renderer.domElement);

function cameraDir(pitch = PITCH) {
  return new THREE.Vector3(Math.sin(YAW) * Math.cos(pitch), Math.sin(pitch), Math.cos(YAW) * Math.cos(pitch));
}

function lights(scene, span, { hemi = 1.1, sunPower = 2.6, golden = false } = {}) {
  // Heure dorée : soleil chaud et ciel plus froid, pour des volumes qui se lisent mieux (chaud au soleil, frais à l'ombre).
  scene.add(golden ? new THREE.HemisphereLight(0xc4d2f2, 0x4a3a26, 0.8) : new THREE.HemisphereLight(0xdfe8ff, 0x5a4a32, hemi));
  const sun = new THREE.DirectionalLight(golden ? 0xffe0b0 : 0xfff0d8, golden ? 3.4 : sunPower);
  // Soleil en haut à gauche de l'image, légèrement face à la caméra.
  const right = new THREE.Vector3(Math.cos(YAW), 0, -Math.sin(YAW));
  const toCam = cameraDir().setY(0).normalize();
  sun.position.copy(right.multiplyScalar(-0.9).add(toCam.multiplyScalar(0.35)).setY(1.25).normalize().multiplyScalar(span * 3));
  sun.castShadow = true;
  sun.shadow.mapSize.set(4096, 4096);
  const c = sun.shadow.camera;
  c.left = c.bottom = -span;
  c.right = c.top = span;
  c.near = 0.1;
  c.far = span * 8;
  sun.shadow.bias = -0.0004;
  sun.shadow.normalBias = 0.02;
  sun.shadow.radius = 4;
  scene.add(sun);
}

/**
 * Rend `obj` avec une caméra 3/4.
 * `frame` = largeur visible en mètres (fixe pour garder la même échelle entre tous les bâtiments),
 * `px` = taille de l'image, `ground` = 'shadow' (sol transparent qui reçoit l'ombre) ou rien.
 */
let envMap = null;
function shoot(obj, { frame = 16, px = 512, aspect = 1, ground = 'shadow', centerY = 2.2, target = [0, 0, 0], env = false, pitch = PITCH, golden = false }) {
  const scene = new THREE.Scene();
  scene.add(obj);
  // Personnages : lumière plus contrastée (ombres franches, modelé marqué), comme un portrait peint.
  lights(scene, frame, env ? { hemi: 0.45, sunPower: 3.2 } : { golden: golden && window.FX?.light !== false });
  if (golden) {
    // Lumière d'ambiance douce : les faces à l'ombre gardent du modelé au lieu d'être plates.
    envMap ??= new THREE.PMREMGenerator(renderer).fromScene(new RoomEnvironment(), 0.04).texture;
    scene.environment = envMap;
    scene.environmentIntensity = 0.15;
  }
  if (env) {
    // Éclairage d'ambiance réaliste : reflets sur les métaux, ombres douces dans les creux.
    envMap ??= new THREE.PMREMGenerator(renderer).fromScene(new RoomEnvironment(), 0.04).texture;
    scene.environment = envMap;
    scene.environmentIntensity = 0.55;
  }
  let shadowPlane = null;
  if (ground === 'shadow') {
    const g = shadowPlane = new THREE.Mesh(new THREE.PlaneGeometry(frame * 4, frame * 4), new THREE.ShadowMaterial({ opacity: 0.38 }));
    g.rotation.x = -Math.PI / 2;
    g.receiveShadow = true;
    scene.add(g);
  }
  const w = frame, h = frame / aspect;
  const cam = new THREE.OrthographicCamera(-w / 2, w / 2, h / 2, -h / 2, 0.1, 1000);
  const t = new THREE.Vector3(target[0], target[1] + centerY, target[2]);
  cam.position.copy(t).add(cameraDir(pitch).multiplyScalar(200));
  cam.lookAt(t);
  const ss = 2; // suréchantillonnage
  renderer.setPixelRatio(1);
  renderer.setSize(px * ss, Math.round((px * ss) / aspect), false);
  renderer.render(scene, cam);
  const src = golden && window.FX?.post !== false ? inkLines(scene, cam, shadowPlane, frame / (px * ss)) : renderer.domElement;
  const out = document.createElement('canvas');
  out.width = px;
  out.height = Math.round(px / aspect);
  const ctx = out.getContext('2d');
  ctx.imageSmoothingQuality = 'high';
  ctx.drawImage(src, 0, 0, out.width, out.height);
  scene.traverse((o) => o.geometry?.dispose());
  return { png: out.toDataURL('image/png'), cam };
}

/** Copie du rendu courant dans un canevas 2D. */
function grab() {
  const c = document.createElement('canvas');
  c.width = renderer.domElement.width;
  c.height = renderer.domElement.height;
  c.getContext('2d').drawImage(renderer.domElement, 0, 0);
  return c.getContext('2d').getImageData(0, 0, c.width, c.height);
}

/**
 * Trait d'encre façon illustration : on rend aussi les normales et la profondeur, et on fonce
 * les arêtes (changement d'orientation ou de profondeur) et le contour de chaque objet.
 */
function inkLines(scene, cam, shadowPlane, metersPerPx) {
  const color = grab();
  const hidden = [];
  scene.traverse((o) => {
    if (o.isMesh && o !== shadowPlane && (o.material?.transparent || o.material?.opacity < 1)) (o.visible = false), hidden.push(o);
  });
  // Profondeur en mètres (codée sur 3 octets), sol compris : sert aux arêtes et à l'occlusion ambiante.
  const [near, far] = [cam.near, cam.far];
  cam.near = 120;
  cam.far = 280;
  cam.updateProjectionMatrix();
  scene.overrideMaterial = new THREE.MeshDepthMaterial({ depthPacking: THREE.RGBDepthPacking });
  renderer.setClearColor(0xffffff, 1);
  renderer.render(scene, cam);
  const depthImg = grab();
  renderer.setClearColor(0x000000, 0);
  if (shadowPlane) shadowPlane.visible = false;
  scene.overrideMaterial = new THREE.MeshNormalMaterial();
  renderer.render(scene, cam);
  const normal = grab();
  if (shadowPlane) shadowPlane.visible = true;
  scene.overrideMaterial = null;
  for (const o of hidden) o.visible = true;

  const W = color.width, H = color.height, c = color.data, n = normal.data, dp = depthImg.data;
  const span = cam.far - cam.near;
  const depth = new Float32Array(W * H);
  for (let k = 0; k < W * H; k++) {
    const i = k * 4;
    const v = dp[i] / 256 + dp[i + 1] / 65536 + dp[i + 2] / (255 * 65536);
    depth[k] = dp[i] === 255 && dp[i + 1] === 255 ? Infinity : cam.near + v * span;
  }
  cam.near = near;
  cam.far = far;
  cam.updateProjectionMatrix();

  const out = new ImageData(new Uint8ClampedArray(c), W, H);
  const o = out.data;
  const INK = [38, 24, 14];
  // Occlusion ambiante : un point entouré de surfaces plus proches de la caméra (creux, pied de mur, sous un toit) reçoit moins de lumière.
  const R = Math.round(0.45 / metersPerPx);
  const DIRS = [];
  // Paires de points opposés : sur une surface plane (même inclinée), leur moyenne retombe sur le point, pas d'ombre.
  for (let a = 0; a < 6; a++) for (const r of [0.35, 0.7, 1]) DIRS.push([Math.round(Math.cos((a / 6) * Math.PI) * R * r), Math.round(Math.sin((a / 6) * Math.PI) * R * r)]);
  for (let y = 2; y < H - 2; y++)
    for (let x = 2; x < W - 2; x++) {
      const k = y * W + x, i = k * 4;
      const z = depth[k];
      if (z !== Infinity) {
        let occ = 0;
        for (const [dx, dy] of DIRS) {
          const xa = x + dx, ya = y + dy, xb = x - dx, yb = y - dy;
          if (xa < 0 || ya < 0 || xa >= W || ya >= H || xb < 0 || yb < 0 || xb >= W || yb >= H) continue;
          const za = depth[ya * W + xa], zb = depth[yb * W + xb];
          if (za === Infinity || zb === Infinity) continue;
          const dz = z - (za + zb) / 2;
          if (dz > 0.08 && dz < 3) occ += Math.min(1, dz / 0.6) * (1 - dz / 3);
        }
        const ao = Math.min(0.45, (occ / DIRS.length) * 1.4);
        if (ao > 0.01 && window.FX?.ao !== false) {
          if (n[i + 3] > 128) for (let q = 0; q < 3; q++) o[i + q] *= 1 - ao;
          else o[i + 3] = Math.min(255, o[i + 3] + ao * 160); // ombre de contact sur le sol transparent
        }
      }
      let edge = 0, sil = 0;
      for (const [dx, dy] of [[1, 0], [0, 1], [2, 0], [0, 2], [-1, 0], [0, -1]]) {
        const j = ((y + dy) * W + x + dx) * 4;
        if ((n[i + 3] > 128) !== (n[j + 3] > 128)) {
          sil = 1;
          continue;
        }
        if (n[i + 3] < 128) continue;
        const dn = (Math.abs(n[i] - n[j]) + Math.abs(n[i + 1] - n[j + 1]) + Math.abs(n[i + 2] - n[j + 2])) / 765;
        const dd = Math.abs(depth[k] - depth[(y + dy) * W + x + dx]);
        edge = Math.max(edge, Math.min(1, Math.max((dn - 0.12) * 3, (dd - 0.6) * 0.8)));
      }
      if (window.FX?.ink === false) continue;
      if (sil) {
        // Contour extérieur : l'encre se pose aussi sur le fond transparent.
        const a = 0.75;
        if (o[i + 3] < 255 * a) {
          o[i] = INK[0];
          o[i + 1] = INK[1];
          o[i + 2] = INK[2];
          o[i + 3] = 255 * a;
        } else for (let q = 0; q < 3; q++) o[i + q] = o[i + q] * (1 - a) + INK[q] * a;
      } else if (edge > 0) {
        const a = 0.7 * edge;
        for (let q = 0; q < 3; q++) o[i + q] = o[i + q] * (1 - a) + INK[q] * a;
      }
    }
  const cv = document.createElement('canvas');
  cv.width = W;
  cv.height = H;
  cv.getContext('2d').putImageData(out, 0, 0);
  return cv;
}

window.renderBuilding = (key, stage) => {
  setSeed(key.length * 100 + stage);
  return shoot(BUILDERS[key](stage), { frame: 18, px: 384, centerY: 4.2, golden: true }).png;
};

window.renderScene = (name, ...args) => {
  setSeed(42);
  const s = SCENES[name](...args);
  // Le décor du village et son enceinte prennent le même rendu que les bâtiments posés dessus.
  const res = shoot(s.object, { ...s.view, golden: name === 'village' || name === 'wallRing' || name === 'citadel' || name === 'mapCitadel' });
  // Position à l'écran (en % de l'image) des emplacements nommés, pour placer les bâtiments par-dessus.
  const spots = {};
  for (const [k, p] of Object.entries(s.spots ?? {})) {
    const v = new THREE.Vector3(p[0], p[1] + (s.view.spotY ?? 2.4), p[2]).project(res.cam);
    spots[k] = { x: +(((v.x + 1) / 2) * 100).toFixed(2), y: +(((1 - v.y) / 2) * 100).toFixed(2) };
  }
  return { png: res.png, spots, frame: s.view.frame };
};

window.renderIconLarge = (name, frame, centerY) => {
  setSeed(7);
  const s = ICONS[name]();
  if (frame) return shoot(s.object, { ...s.view, px: 512, frame, centerY }).png;
  return trim(shoot(s.object, { ...s.view, px: 768 }).png, 512);
};

/**
 * Images de marche pour la carte : l'unité de profil (tournée vers la droite de l'écran, un peu vers nous), vue d'en haut
 * comme les villages, en `frames` temps de foulée côte à côte sur une même bande. Toutes les images partagent le même cadrage.
 */
const MARCH = {
  foot: { build: () => FIGURES.spearman(), frame: 3.2, centerY: 1.0 },
  noble: { build: () => FIGURES.noble(), frame: 3.2, centerY: 1.0 },
  horse: { build: () => FIGURES.cavalry(), frame: 4.4, centerY: 1.2 },
  scout: { build: () => FIGURES.scout(), frame: 4.2, centerY: 1.1 },
  ram: { build: () => MODELS.ram(), frame: 4.6, centerY: 0.8 },
};
window.renderMarch = async (kind, frames, px = 160) => {
  const m = MARCH[kind];
  const shots = [];
  for (let i = 0; i < frames; i++) {
    setSeed(7);
    setGait(frames > 1 ? (i / frames) * Math.PI * 2 : null, 0.55);
    const obj = m.build();
    obj.rotation.y = YAW + Math.PI / 2 - 0.35;
    const img = new Image();
    img.src = shoot(obj, { frame: m.frame, centerY: m.centerY, px, golden: true, ground: 'none' }).png;
    await img.decode();
    shots.push(img);
  }
  setGait(null, 1);
  // Cadre commun : la zone dessinée sur l'ensemble des images, pour que l'animation ne saute pas.
  const c = document.createElement('canvas');
  c.width = c.height = px;
  const ctx = c.getContext('2d', { willReadFrequently: true });
  let x0 = px, y0 = px, x1 = 0, y1 = 0;
  for (const img of shots) {
    ctx.clearRect(0, 0, px, px);
    ctx.drawImage(img, 0, 0);
    const { data } = ctx.getImageData(0, 0, px, px);
    for (let y = 0; y < px; y++)
      for (let x = 0; x < px; x++)
        if (data[(y * px + x) * 4 + 3] > 24) {
          x0 = Math.min(x0, x);
          x1 = Math.max(x1, x);
          y0 = Math.min(y0, y);
          y1 = Math.max(y1, y);
        }
  }
  const w = x1 - x0 + 3, h = y1 - y0 + 3;
  const sheet = document.createElement('canvas');
  sheet.width = w * frames;
  sheet.height = h;
  const o = sheet.getContext('2d');
  shots.forEach((img, i) => o.drawImage(img, x0 - 1, y0 - 1, w, h, i * w, 0, w, h));
  return { png: sheet.toDataURL('image/png'), w, h };
};

window.renderIcon = (name) => {
  setSeed(7);
  const s = ICONS[name]();
  return trim(shoot(s.object, { px: 256, ...s.view }).png, 128);
};

/** Recadre une icône au plus près de ce qui est dessiné, en carré, pour qu'elle reste lisible en petit. */
async function trimAsync(dataUrl, size) {
  const img = new Image();
  img.src = dataUrl;
  await img.decode();
  const c = document.createElement('canvas');
  c.width = img.width;
  c.height = img.height;
  const ctx = c.getContext('2d');
  ctx.drawImage(img, 0, 0);
  const { data } = ctx.getImageData(0, 0, c.width, c.height);
  let x0 = c.width, y0 = c.height, x1 = 0, y1 = 0;
  for (let y = 0; y < c.height; y++)
    for (let x = 0; x < c.width; x++)
      if (data[(y * c.width + x) * 4 + 3] > 40) {
        if (x < x0) x0 = x;
        if (x > x1) x1 = x;
        if (y < y0) y0 = y;
        if (y > y1) y1 = y;
      }
  const side = Math.max(x1 - x0, y1 - y0) * 1.08;
  const cx = (x0 + x1) / 2, cy = (y0 + y1) / 2;
  const out = document.createElement('canvas');
  out.width = out.height = size;
  const o = out.getContext('2d');
  o.imageSmoothingQuality = 'high';
  o.drawImage(c, cx - side / 2, cy - side / 2, side, side, 0, 0, size, size);
  return out.toDataURL('image/png');
}
const trim = (url, size) => trimAsync(url, size);

window.ready = true;

window.exportTexture = (name, type = 'image/png', quality) => {
  const img = texture(name).image;
  return img.toDataURL(type, quality);
};
window.textureNames = () => Object.keys(WORLD);
