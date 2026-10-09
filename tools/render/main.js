// Moteur de rendu : une caméra orthographique en vue 3/4, lumière du soir venant de la gauche,
// ombres douces projetées sur un sol invisible. Chaque élément est rendu seul, fond transparent.
import * as THREE from 'three';
import { BUILDERS } from './buildings.js';
import { SCENES } from './scenes.js';
import { ICONS } from './icons.js';
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

function cameraDir() {
  return new THREE.Vector3(Math.sin(YAW) * Math.cos(PITCH), Math.sin(PITCH), Math.cos(YAW) * Math.cos(PITCH));
}

function lights(scene, span) {
  scene.add(new THREE.HemisphereLight(0xdfe8ff, 0x5a4a32, 1.1));
  const sun = new THREE.DirectionalLight(0xfff0d8, 2.6);
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
function shoot(obj, { frame = 16, px = 512, aspect = 1, ground = 'shadow', centerY = 2.2, target = [0, 0, 0] }) {
  const scene = new THREE.Scene();
  scene.add(obj);
  lights(scene, frame);
  if (ground === 'shadow') {
    const g = new THREE.Mesh(new THREE.PlaneGeometry(frame * 4, frame * 4), new THREE.ShadowMaterial({ opacity: 0.38 }));
    g.rotation.x = -Math.PI / 2;
    g.receiveShadow = true;
    scene.add(g);
  }
  const w = frame, h = frame / aspect;
  const cam = new THREE.OrthographicCamera(-w / 2, w / 2, h / 2, -h / 2, 0.1, 1000);
  const t = new THREE.Vector3(target[0], target[1] + centerY, target[2]);
  cam.position.copy(t).add(cameraDir().multiplyScalar(200));
  cam.lookAt(t);
  const ss = 2; // suréchantillonnage
  renderer.setPixelRatio(1);
  renderer.setSize(px * ss, Math.round((px * ss) / aspect), false);
  renderer.render(scene, cam);
  const out = document.createElement('canvas');
  out.width = px;
  out.height = Math.round(px / aspect);
  const ctx = out.getContext('2d');
  ctx.imageSmoothingQuality = 'high';
  ctx.drawImage(renderer.domElement, 0, 0, out.width, out.height);
  scene.traverse((o) => o.geometry?.dispose());
  return { png: out.toDataURL('image/png'), cam };
}

window.renderBuilding = (key, stage) => {
  setSeed(key.length * 100 + stage);
  return shoot(BUILDERS[key](stage), { frame: 18, px: 384, centerY: 4.2 }).png;
};

window.renderScene = (name) => {
  setSeed(42);
  const s = SCENES[name]();
  const res = shoot(s.object, s.view);
  // Position à l'écran (en % de l'image) des emplacements nommés, pour placer les bâtiments par-dessus.
  const spots = {};
  for (const [k, p] of Object.entries(s.spots ?? {})) {
    const v = new THREE.Vector3(p[0], p[1] + (s.view.spotY ?? 2.4), p[2]).project(res.cam);
    spots[k] = { x: +(((v.x + 1) / 2) * 100).toFixed(2), y: +(((1 - v.y) / 2) * 100).toFixed(2) };
  }
  return { png: res.png, spots, frame: s.view.frame };
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

window.exportTexture = (name) => {
  const img = texture(name).image;
  return img.toDataURL('image/png');
};
window.textureNames = () => Object.keys(WORLD);
