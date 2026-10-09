// Pièces de construction réutilisables : murs, toits, portes, colombages, tonneaux, arbres…
// Toutes les dimensions sont en mètres. `y` désigne toujours le bas de l'objet (posé au sol à y = 0).
import * as THREE from 'three';
import { mergeVertices } from 'three/addons/utils/BufferGeometryUtils.js';
import { texture, WORLD, rand } from './textures.js';

const matCache = new Map();
/** Matériau texturé ; `repeat` sert aux géométries qui gardent leurs UV d'origine (cylindres, cônes). */
export function mat(name, { repeat = null, color = 0xffffff, rough = 0.92, bump = 0.03, metal = 0 } = {}) {
  const key = `${name}|${repeat}|${color}|${rough}|${metal}`;
  if (matCache.has(key)) return matCache.get(key);
  let map = texture(name);
  if (repeat) {
    map = map.clone();
    map.repeat.set(repeat[0], repeat[1]);
    map.needsUpdate = true;
  }
  const m = new THREE.MeshStandardMaterial({ map, bumpMap: map, bumpScale: bump, roughness: rough, metalness: metal, color });
  matCache.set(key, m);
  return m;
}

export const plain = (color, rough = 0.9) => new THREE.MeshStandardMaterial({ color, roughness: rough });

/** Recalcule les UV en mètres selon l'orientation de chaque face (projection par axe dominant). */
export function worldUV(geo, texName) {
  const s = WORLD[texName] ?? 2;
  const pos = geo.attributes.position, nor = geo.attributes.normal;
  const uv = new Float32Array(pos.count * 2);
  for (let i = 0; i < pos.count; i++) {
    const x = pos.getX(i), y = pos.getY(i), z = pos.getZ(i);
    const nx = Math.abs(nor.getX(i)), ny = Math.abs(nor.getY(i)), nz = Math.abs(nor.getZ(i));
    let u, v;
    if (ny >= nx && ny >= nz) [u, v] = [x, z];
    else if (nx >= nz) [u, v] = [z, y];
    else [u, v] = [x, y];
    uv[i * 2] = u / s;
    uv[i * 2 + 1] = v / s;
  }
  geo.setAttribute('uv', new THREE.BufferAttribute(uv, 2));
  return geo;
}

export function mesh(geo, material) {
  const m = new THREE.Mesh(geo, material);
  m.castShadow = true;
  m.receiveShadow = true;
  return m;
}

export function group(...children) {
  const g = new THREE.Group();
  for (const c of children.flat()) if (c) g.add(c);
  return g;
}

export function place(obj, x = 0, y = 0, z = 0, rotY = 0, scale = 1) {
  obj.position.set(x, y, z);
  obj.rotation.y = rotY;
  obj.scale.setScalar(scale);
  return obj;
}

/** Pavé texturé posé au sol (y = bas). */
export function box(w, h, d, tex, x = 0, y = 0, z = 0, opts = {}) {
  const geo = worldUV(new THREE.BoxGeometry(w, h, d), tex);
  const m = mesh(geo, typeof tex === 'string' ? mat(tex, opts) : tex);
  m.position.set(x, y + h / 2, z);
  return m;
}

export function cyl(rTop, rBot, h, tex, x = 0, y = 0, z = 0, { seg = 16, repeat, rough } = {}) {
  const circ = 2 * Math.PI * Math.max(rTop, rBot);
  const rep = repeat ?? [Math.max(1, Math.round(circ / (WORLD[tex] ?? 2))), h / (WORLD[tex] ?? 2)];
  const m = mesh(new THREE.CylinderGeometry(rTop, rBot, h, seg), mat(tex, { repeat: rep, rough }));
  m.position.set(x, y + h / 2, z);
  return m;
}

export function cone(r, h, tex, x = 0, y = 0, z = 0, { seg = 16, rotY = 0 } = {}) {
  const slant = Math.hypot(r, h);
  const rep = [Math.max(1, Math.round((2 * Math.PI * r) / (WORLD[tex] ?? 2))), slant / (WORLD[tex] ?? 2)];
  const m = mesh(new THREE.ConeGeometry(r, h, seg), mat(tex, { repeat: rep }));
  m.position.set(x, y + h / 2, z);
  m.rotation.y = rotY;
  return m;
}

/** Toit à deux pans : faîtage le long de x, largeur `w`, profondeur `d`, hauteur `h`. */
export function gableRoof(w, d, h, roofTex, gableTex, { overhang = 0.35, thick = 0.18 } = {}) {
  const g = new THREE.Group();
  const half = d / 2;
  const angle = Math.atan2(h, half);
  const run = half + overhang;
  const len = run / Math.cos(angle);
  const drop = Math.tan(angle) * overhang;
  for (const side of [1, -1]) {
    const geo = worldUV(new THREE.BoxGeometry(w + overhang * 2, thick, len), roofTex);
    const m = mesh(geo, mat(roofTex));
    m.rotation.x = side * angle;
    m.position.set(0, h - (h + drop) / 2 + thick / 2, (side * run) / 2);
    g.add(m);
  }
  if (gableTex) {
    const shape = new THREE.Shape();
    shape.moveTo(-half, 0);
    shape.lineTo(half, 0);
    shape.lineTo(0, h);
    shape.closePath();
    const geo = new THREE.ExtrudeGeometry(shape, { depth: w, bevelEnabled: false });
    geo.rotateY(Math.PI / 2);
    geo.translate(-w / 2, 0, 0);
    worldUV(geo, gableTex);
    g.add(mesh(geo, mat(gableTex)));
  }
  // faîtière
  const ridge = mesh(new THREE.CylinderGeometry(0.12, 0.12, w + overhang * 2, 8), mat('timber'));
  ridge.rotation.z = Math.PI / 2;
  ridge.position.y = h + thick * 0.6;
  g.add(ridge);
  return g;
}

/** Toit à quatre pans (pyramide allongée). */
export function hipRoof(w, d, h, tex, overhang = 0.3) {
  const geo = new THREE.ConeGeometry(Math.SQRT1_2, 1, 4, 1);
  geo.rotateY(Math.PI / 4);
  geo.scale(w + overhang * 2, h, d + overhang * 2);
  geo.translate(0, h / 2, 0);
  worldUV(geo, tex);
  return mesh(geo, mat(tex));
}

/** Murs à colombages : enduit + poutres sombres sur les 4 faces. */
export function halfTimbered(w, h, d, x = 0, y = 0, z = 0) {
  const g = new THREE.Group();
  g.add(box(w, h, d, 'plaster'));
  const t = 0.16, o = 0.04;
  const beams = [];
  for (const [fw, axis] of [[w, 'z'], [d, 'x']]) {
    for (const side of [1, -1]) {
      const off = (axis === 'z' ? d : w) / 2 + o;
      const add = (bw, bh, bx, by, rot = 0) => {
        const b = box(axis === 'z' ? bw : t, bh, axis === 'z' ? t : bw, 'timber');
        b.position.y = by + bh / 2;
        if (axis === 'z') b.position.set(bx, by + bh / 2, side * off);
        else b.position.set(side * off, by + bh / 2, bx);
        if (rot) b.rotation[axis === 'z' ? 'z' : 'x'] = rot;
        beams.push(b);
      };
      add(fw + t, t, 0, 0);
      add(fw + t, t, 0, h - t);
      add(fw + t, t, 0, h / 2 - t / 2);
      const n = Math.max(2, Math.round(fw / 1.3));
      for (let i = 0; i <= n; i++) add(t, h, -fw / 2 + (fw * i) / n, 0);
      // croix de Saint-André entre deux poteaux
      for (let i = 0; i < n; i += 2) {
        const cx = -fw / 2 + (fw * (i + 0.5)) / n;
        const diag = Math.hypot(fw / n, h / 2);
        add(t, diag, cx, h * 0.75 - diag / 2, Math.atan2(fw / n, h / 2));
      }
    }
  }
  beams.forEach((b) => g.add(b));
  g.position.set(x, y, z);
  return g;
}

export function door(w = 1.1, h = 2, tex = 'planks') {
  const g = new THREE.Group();
  g.add(box(w + 0.24, h + 0.12, 0.12, 'timber', 0, 0, 0));
  const d = box(w, h, 0.16, tex, 0, 0, 0.02, { color: 0x9a8070 });
  g.add(d);
  return g;
}

export function windowPane(w = 0.7, h = 0.8) {
  const g = new THREE.Group();
  g.add(box(w + 0.2, h + 0.2, 0.1, 'timber'));
  const glass = box(w, h, 0.12, 'timber', 0, 0.1, 0.01);
  glass.material = plain(0x1c1712, 0.4);
  g.add(glass);
  g.add(box(0.06, h, 0.14, 'timber', 0, 0.1, 0.02));
  return g;
}

/** Créneaux sur le dessus d'un rectangle. */
export function crenels(w, d, y, tex = 'stone', size = 0.5) {
  const g = new THREE.Group();
  const nx = Math.max(2, Math.round(w / (size * 2)));
  const nz = Math.max(2, Math.round(d / (size * 2)));
  for (let i = 0; i < nx; i++) {
    const x = -w / 2 + size / 2 + (i * (w - size)) / (nx - 1);
    g.add(box(size, size * 0.9, size * 0.6, tex, x, y, d / 2 - size * 0.3));
    g.add(box(size, size * 0.9, size * 0.6, tex, x, y, -d / 2 + size * 0.3));
  }
  for (let i = 1; i < nz - 1; i++) {
    const z = -d / 2 + size / 2 + (i * (d - size)) / (nz - 1);
    g.add(box(size * 0.6, size * 0.9, size, tex, w / 2 - size * 0.3, y, z));
    g.add(box(size * 0.6, size * 0.9, size, tex, -w / 2 + size * 0.3, y, z));
  }
  return g;
}

export function roundCrenels(r, y, tex = 'stone', n = 10) {
  const g = new THREE.Group();
  for (let i = 0; i < n; i++) {
    const a = (i / n) * Math.PI * 2;
    const b = box(0.45, 0.5, 0.35, tex, Math.cos(a) * (r - 0.15), y, Math.sin(a) * (r - 0.15));
    b.rotation.y = -a;
    g.add(b);
  }
  return g;
}

export function flag(color = 0x2a4fa0, h = 3, x = 0, y = 0, z = 0) {
  const g = new THREE.Group();
  g.add(cyl(0.05, 0.06, h, 'timber', 0, 0, 0, { seg: 6 }));
  const geo = new THREE.PlaneGeometry(1.1, 0.7, 10, 4);
  const p = geo.attributes.position;
  for (let i = 0; i < p.count; i++) p.setZ(i, Math.sin((p.getX(i) + 0.55) * 4) * 0.08 * (p.getX(i) + 0.55));
  geo.computeVertexNormals();
  const cloth = mesh(geo, new THREE.MeshStandardMaterial({ color, roughness: 0.85, side: THREE.DoubleSide }));
  cloth.position.set(0.58, h - 0.4, 0);
  g.add(cloth);
  g.position.set(x, y, z);
  return g;
}

export function barrel(x = 0, y = 0, z = 0) {
  const g = new THREE.Group();
  const geo = new THREE.CylinderGeometry(0.33, 0.33, 0.85, 14, 6);
  const p = geo.attributes.position;
  for (let i = 0; i < p.count; i++) {
    const k = 1 + 0.12 * Math.cos((p.getY(i) / 0.85) * Math.PI);
    p.setX(i, p.getX(i) * k);
    p.setZ(i, p.getZ(i) * k);
  }
  geo.computeVertexNormals();
  g.add(place(mesh(geo, mat('planks', { repeat: [1, 0.4] })), 0, 0.425));
  for (const hy of [0.15, 0.7]) {
    const ring = mesh(new THREE.TorusGeometry(0.35, 0.025, 6, 20), mat('iron'));
    ring.rotation.x = Math.PI / 2;
    ring.position.y = hy;
    g.add(ring);
  }
  g.position.set(x, y, z);
  return g;
}

export function crate(s = 0.8, x = 0, y = 0, z = 0, rot = 0) {
  const g = new THREE.Group();
  g.add(box(s, s, s, 'planks'));
  for (const [w, d] of [[s + 0.04, 0.08], [0.08, s + 0.04]]) {
    g.add(box(w, 0.08, d, 'timber', 0, s - 0.06, 0));
    g.add(box(w, 0.08, d, 'timber', 0, 0, 0));
  }
  g.position.set(x, y, z);
  g.rotation.y = rot;
  return g;
}

export function sack(x = 0, y = 0, z = 0, rot = 0) {
  const geo = new THREE.SphereGeometry(0.35, 12, 8);
  geo.scale(1, 1.25, 0.85);
  const m = mesh(geo, mat('canvasCloth', { repeat: [1, 1] }));
  m.position.set(x, y + 0.4, z);
  m.rotation.y = rot;
  return m;
}

/** Pile de rondins couchés. */
export function logPile(n = 3, len = 2.4, x = 0, y = 0, z = 0, rot = 0) {
  const g = new THREE.Group();
  const r = 0.2;
  let row = 0;
  for (let count = n; count > 0; count--, row++) {
    for (let i = 0; i < count; i++) {
      const log = cyl(r, r, len, 'bark', 0, 0, 0, { seg: 10, repeat: [1, 2] });
      log.rotation.z = Math.PI / 2;
      log.position.set(0, r + row * r * 1.7, (i - (count - 1) / 2) * r * 2.05);
      g.add(log);
      for (const sx of [1, -1]) {
        const end = mesh(new THREE.CircleGeometry(r * 0.98, 10), plain(0xc89a62));
        end.rotation.y = (sx * Math.PI) / 2;
        end.position.set((sx * len) / 2 + sx * 0.005, log.position.y, log.position.z);
        g.add(end);
      }
    }
  }
  g.position.set(x, y, z);
  g.rotation.y = rot;
  return g;
}

export function haystack(x = 0, y = 0, z = 0, s = 1) {
  const g = new THREE.Group();
  const geo = new THREE.SphereGeometry(1, 16, 10, 0, Math.PI * 2, 0, Math.PI / 2);
  geo.scale(1, 1.4, 1);
  g.add(mesh(geo, mat('thatch', { repeat: [3, 1] })));
  g.position.set(x, y, z);
  g.scale.setScalar(s);
  return g;
}

export function fence(len, x = 0, y = 0, z = 0, rot = 0) {
  const g = new THREE.Group();
  const n = Math.max(2, Math.round(len / 1.5));
  for (let i = 0; i <= n; i++) g.add(box(0.12, 0.9, 0.12, 'timber', -len / 2 + (len * i) / n, 0, 0));
  g.add(box(len, 0.08, 0.06, 'planks', 0, 0.35, 0));
  g.add(box(len, 0.08, 0.06, 'planks', 0, 0.7, 0));
  g.position.set(x, y, z);
  g.rotation.y = rot;
  return g;
}

export function palisade(len, h = 2.6, x = 0, y = 0, z = 0, rot = 0) {
  const g = new THREE.Group();
  const r = 0.17;
  const n = Math.round(len / (r * 2));
  for (let i = 0; i < n; i++) {
    const hh = h + (rand() - 0.5) * 0.3;
    const px = -len / 2 + r + i * r * 2;
    g.add(cyl(r, r, hh, 'bark', px, 0, 0, { seg: 7, repeat: [1, 1.5] }));
    g.add(cone(r, 0.35, 'bark', px, hh, 0, { seg: 7 }));
  }
  g.add(box(len, 0.15, 0.1, 'timber', 0, h * 0.7, r + 0.05));
  g.position.set(x, y, z);
  g.rotation.y = rot;
  return g;
}

function displaced(geo, amount, freq = 2.2) {
  // Fusionne les sommets pour que le relief ne déchire pas la surface.
  geo.deleteAttribute('normal');
  geo.deleteAttribute('uv');
  geo = mergeVertices(geo);
  const p = geo.attributes.position;
  const seed = rand() * 10;
  for (let i = 0; i < p.count; i++) {
    const v = new THREE.Vector3(p.getX(i), p.getY(i), p.getZ(i));
    const n = Math.sin(v.x * freq + seed) * Math.cos(v.y * freq * 1.3 + seed) * Math.sin(v.z * freq * 0.7 + seed * 2);
    v.multiplyScalar(1 + n * amount + (rand() - 0.5) * amount * 0.6);
    p.setXYZ(i, v.x, v.y, v.z);
  }
  geo.computeVertexNormals();
  return geo;
}

let rockMat;
export function rock(s = 1, x = 0, y = 0, z = 0) {
  const geo = displaced(new THREE.IcosahedronGeometry(1, 2), 0.22, 2.6);
  geo.scale(1.2, 0.7, 1);
  worldUV(geo, 'rock');
  if (!rockMat) {
    rockMat = mat('rock', { bump: 0.06 }).clone();
    rockMat.flatShading = true; // facettes nettes : roche taillée plutôt que galet
  }
  const m = mesh(geo, rockMat);
  m.position.set(x, y + 0.35 * s, z);
  m.scale.setScalar(s);
  m.rotation.y = rand() * 6;
  return m;
}

export function deciduousTree(s = 1, x = 0, y = 0, z = 0) {
  const g = new THREE.Group();
  g.add(cyl(0.18, 0.28, 2.2, 'bark', 0, 0, 0, { seg: 8, repeat: [1, 2] }));
  const blobs = 5 + Math.floor(rand() * 3);
  for (let i = 0; i < blobs; i++) {
    const r = 0.9 + rand() * 0.6;
    const geo = displaced(new THREE.IcosahedronGeometry(r, 3), 0.18, 3);
    worldUV(geo, 'leaves');
    const b = mesh(geo, mat('leaves', { bump: 0.08 }));
    const a = (i / blobs) * Math.PI * 2;
    const dist = i === 0 ? 0 : 0.8 + rand() * 0.4;
    b.position.set(Math.cos(a) * dist, 2.6 + rand() * 1.1 + (i === 0 ? 0.8 : 0), Math.sin(a) * dist);
    g.add(b);
  }
  g.position.set(x, y, z);
  g.scale.setScalar(s);
  g.rotation.y = rand() * 6;
  return g;
}

export function pineTree(s = 1, x = 0, y = 0, z = 0) {
  const g = new THREE.Group();
  g.add(cyl(0.12, 0.2, 1.4, 'bark', 0, 0, 0, { seg: 8, repeat: [1, 1] }));
  const layers = 4;
  for (let i = 0; i < layers; i++) {
    const r = 1.5 - i * 0.3;
    const geo = displaced(new THREE.ConeGeometry(r, 1.9, 12, 3), 0.08, 4);
    const m = mesh(geo, mat('pine', { repeat: [3, 1], bump: 0.08 }));
    m.position.y = 1.4 + i * 0.95 + 0.95;
    g.add(m);
  }
  g.position.set(x, y, z);
  g.scale.setScalar(s);
  g.rotation.y = rand() * 6;
  return g;
}

export function bush(s = 1, x = 0, y = 0, z = 0) {
  const geo = displaced(new THREE.IcosahedronGeometry(0.8, 2), 0.2, 3);
  geo.scale(1, 0.7, 1);
  worldUV(geo, 'leaves');
  const m = mesh(geo, mat('leaves', { bump: 0.08 }));
  m.position.set(x, y + 0.45 * s, z);
  m.scale.setScalar(s);
  return m;
}

/** Plaque de sol (terre, herbe, champ…) légèrement surélevée, aux bords irréguliers. */
export function patch(rx, rz, tex, x = 0, y = 0.02, z = 0, irregular = 0.15) {
  const shape = new THREE.Shape();
  const n = 28;
  for (let i = 0; i <= n; i++) {
    const a = (i / n) * Math.PI * 2;
    const k = 1 + (rand() - 0.5) * irregular;
    const px = Math.cos(a) * rx * k, pz = Math.sin(a) * rz * k;
    i ? shape.lineTo(px, pz) : shape.moveTo(px, pz);
  }
  const geo = new THREE.ShapeGeometry(shape);
  geo.rotateX(Math.PI / 2);
  geo.scale(1, 1, 1);
  worldUV(geo, tex);
  const m = new THREE.Mesh(geo, mat(tex));
  m.material.side = THREE.DoubleSide;
  m.receiveShadow = true;
  m.position.set(x, y, z);
  return m;
}

export function rectPatch(w, d, tex, x = 0, y = 0.02, z = 0, rot = 0) {
  const geo = new THREE.PlaneGeometry(w, d);
  geo.rotateX(-Math.PI / 2);
  worldUV(geo, tex);
  const m = new THREE.Mesh(geo, mat(tex));
  m.receiveShadow = true;
  m.position.set(x, y, z);
  m.rotation.y = rot;
  return m;
}

export function chimney(x, y, z, h = 1.4) {
  return box(0.6, h, 0.6, 'stone', x, y, z);
}

export function smoke(x, y, z) {
  const g = new THREE.Group();
  for (let i = 0; i < 5; i++) {
    const s = new THREE.Mesh(
      new THREE.IcosahedronGeometry(0.35 + i * 0.12, 2),
      new THREE.MeshStandardMaterial({ color: 0xbfbab2, transparent: true, opacity: 0.5 - i * 0.07, roughness: 1, depthWrite: false }),
    );
    s.position.set(i * 0.25, i * 0.65, -i * 0.1);
    g.add(s);
  }
  g.position.set(x, y, z);
  return g;
}

export function tent(x = 0, y = 0, z = 0, rot = 0, s = 1) {
  const g = new THREE.Group();
  const geo = new THREE.ConeGeometry(1.4, 2.2, 6, 1);
  const m = mesh(geo, mat('canvasCloth', { repeat: [3, 1] }));
  m.position.y = 1.1;
  g.add(m);
  g.add(cyl(0.04, 0.04, 2.6, 'timber', 0, 0, 0, { seg: 5 }));
  g.position.set(x, y, z);
  g.rotation.y = rot;
  g.scale.setScalar(s);
  return g;
}

export function weaponRack(x = 0, y = 0, z = 0, rot = 0) {
  const g = new THREE.Group();
  g.add(box(0.1, 1.2, 0.1, 'timber', -0.8, 0, 0));
  g.add(box(0.1, 1.2, 0.1, 'timber', 0.8, 0, 0));
  g.add(box(1.7, 0.1, 0.1, 'timber', 0, 1.1, 0));
  for (let i = 0; i < 5; i++) {
    const spear = cyl(0.025, 0.025, 2.2, 'timber', -0.6 + i * 0.3, 0, 0.08, { seg: 5 });
    spear.rotation.x = -0.18;
    g.add(spear);
    g.add(cone(0.06, 0.25, 'iron', -0.6 + i * 0.3, 2.15, 0.48, { seg: 5 }));
  }
  g.position.set(x, y, z);
  g.rotation.y = rot;
  return g;
}

export function well(x = 0, y = 0, z = 0) {
  const g = new THREE.Group();
  g.add(cyl(0.9, 0.9, 0.8, 'stone', 0, 0, 0, { seg: 16 }));
  const water = new THREE.Mesh(new THREE.CircleGeometry(0.75, 16), mat('water'));
  water.rotation.x = -Math.PI / 2;
  water.position.y = 0.7;
  g.add(water);
  g.add(box(0.12, 1.8, 0.12, 'timber', -0.85, 0.6, 0));
  g.add(box(0.12, 1.8, 0.12, 'timber', 0.85, 0.6, 0));
  const roof = gableRoof(1.9, 1.4, 0.6, 'shingles', null, { overhang: 0.15, thick: 0.08 });
  roof.position.y = 2.35;
  g.add(roof);
  g.position.set(x, y, z);
  return g;
}
