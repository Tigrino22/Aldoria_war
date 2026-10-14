// La Citadelle des Croisades : forteresse sur un éperon rocheux, enceinte à tours rondes, châtelet d'entrée et donjon.
// L'entrée fait face à la caméra (+z), comme les bâtiments du village.
import * as THREE from 'three';
import { box, cone, crenels, cyl, door, gableRoof, group, mat, mesh, patch, pineTree, plain, rock, roundCrenels, windowPane, bush } from './kit.js';
import { rand } from './textures.js';

const CRIMSON = 0x7d1d1a, GOLD = 0xd4a531;

function at(obj, x, y, z, rotY = 0) {
  obj.position.set(x, y, z);
  if (rotY) obj.rotation.y = rotY;
  return obj;
}

/** Oriflamme pourpre à liseré et médaillon d'or, suspendue à un mur (face +z). */
function banner(x, y, z, w = 0.9, h = 2, rotY = 0) {
  const g = new THREE.Group();
  const geo = new THREE.PlaneGeometry(w, h, 4, 8);
  const p = geo.attributes.position;
  // Pointe en bas, comme une oriflamme.
  for (let i = 0; i < p.count; i++) if (p.getY(i) < -h / 2 + 0.01) p.setY(i, p.getY(i) - (1 - Math.abs(p.getX(i)) / (w / 2)) * 0.45);
  geo.computeVertexNormals();
  g.add(at(mesh(geo, new THREE.MeshStandardMaterial({ color: CRIMSON, roughness: 0.85, side: THREE.DoubleSide })), 0, -h / 2, 0));
  const gold = plain(GOLD, 0.4);
  g.add(at(mesh(new THREE.BoxGeometry(w + 0.12, 0.1, 0.06), gold), 0, 0, 0.02));
  const disc = mesh(new THREE.CylinderGeometry(w * 0.26, w * 0.26, 0.04, 20), gold);
  disc.rotation.x = Math.PI / 2;
  g.add(at(disc, 0, -h * 0.42, 0.03));
  // Croix de la croisade sur le médaillon.
  const ink = plain(CRIMSON, 0.7);
  g.add(at(mesh(new THREE.BoxGeometry(w * 0.08, w * 0.34, 0.05), ink), 0, -h * 0.42, 0.05));
  g.add(at(mesh(new THREE.BoxGeometry(w * 0.3, w * 0.08, 0.05), ink), 0, -h * 0.4, 0.05));
  return at(g, x, y, z, rotY);
}

/** Grand étendard au sommet du donjon : mât, traverse et long drapeau ondulé. */
function standard(h, x, y, z) {
  const g = new THREE.Group();
  g.add(cyl(0.07, 0.09, h, 'timber', 0, 0, 0, { seg: 8 }));
  g.add(at(mesh(new THREE.SphereGeometry(0.16, 12, 8), plain(GOLD, 0.35)), 0, h + 0.1, 0));
  const geo = new THREE.PlaneGeometry(2.6, 1.3, 16, 6);
  const p = geo.attributes.position;
  for (let i = 0; i < p.count; i++) {
    const u = p.getX(i) + 1.3;
    p.setZ(i, Math.sin(u * 2.6) * 0.16 * u);
    // Queue fendue en deux pointes.
    if (u > 2.1 && Math.abs(p.getY(i)) < 0.2) p.setX(i, p.getX(i) - (2.6 - u) * 0.6);
  }
  geo.computeVertexNormals();
  g.add(at(mesh(geo, new THREE.MeshStandardMaterial({ color: CRIMSON, roughness: 0.8, side: THREE.DoubleSide })), 1.35, h - 0.75, 0));
  const trim = new THREE.PlaneGeometry(2.6, 0.12, 16, 1);
  const t = trim.attributes.position;
  for (let i = 0; i < t.count; i++) t.setZ(i, Math.sin((t.getX(i) + 1.3) * 2.6) * 0.16 * (t.getX(i) + 1.3));
  g.add(at(mesh(trim, new THREE.MeshStandardMaterial({ color: GOLD, roughness: 0.45, side: THREE.DoubleSide })), 1.35, h - 0.12, 0.01));
  return at(g, x, y, z);
}

/** Tour ronde de l'enceinte, toit conique d'ardoise et fanion. */
function roundTower(r, h, x, y, z, { roof = true, pennant = true } = {}) {
  const g = group(
    cyl(r * 1.08, r * 1.2, 0.8, 'stone', 0, 0, 0, { seg: 18 }), // empattement
    cyl(r, r * 1.06, h, 'stone', 0, 0, 0, { seg: 18 }),
    cyl(r + 0.18, r + 0.18, 0.3, 'stone', 0, h - 0.25, 0, { seg: 18 }), // mâchicoulis
    roundCrenels(r + 0.15, h + 0.05, 'stone', Math.round(r * 9)),
  );
  if (roof) g.add(cone(r + 0.35, r * 2.1, 'slate', 0, h + 0.45, 0, { seg: 18 }));
  if (pennant && roof) g.add(standardSmall(0, h + 0.45 + r * 2.1 - 0.1, 0));
  // Archères tournées vers l'extérieur.
  for (const a of [0.4, 1.6, 2.8]) {
    const w = windowPane(0.18, 0.7, { flowers: false, shutters: false });
    g.add(at(w, Math.sin(a) * (r + 0.02), h * 0.55, Math.cos(a) * (r + 0.02), a));
  }
  return at(g, x, y, z);
}

function standardSmall(x, y, z) {
  const g = new THREE.Group();
  g.add(cyl(0.035, 0.04, 1.3, 'timber', 0, 0, 0, { seg: 6 }));
  const geo = new THREE.PlaneGeometry(0.9, 0.42, 8, 2);
  const p = geo.attributes.position;
  for (let i = 0; i < p.count; i++) {
    const u = p.getX(i) + 0.45;
    p.setY(i, p.getY(i) * (1 - u * 0.75));
    p.setZ(i, Math.sin(u * 5) * 0.06 * u);
  }
  geo.computeVertexNormals();
  g.add(at(mesh(geo, new THREE.MeshStandardMaterial({ color: CRIMSON, roughness: 0.85, side: THREE.DoubleSide })), 0.47, 1.05, 0));
  return at(g, x, y, z);
}

/** Courtine crénelée entre deux points (x, z), avec chemin de ronde. */
function curtain(a, b, h, y, thick = 1.1) {
  const len = Math.hypot(b[0] - a[0], b[1] - a[1]);
  const g = group(box(len, h, thick, 'stone', 0, 0, 0), crenels(len, thick, h, 'stone', 0.42), box(len, 0.5, thick + 0.3, 'stone', 0, 0, 0));
  g.position.set((a[0] + b[0]) / 2, y, (a[1] + b[1]) / 2);
  g.rotation.y = -Math.atan2(b[1] - a[1], b[0] - a[0]);
  return g;
}

/** Éperon rocheux qui porte la citadelle : un plateau aux flancs de roche. */
function crag(rx, rz, h) {
  const g = new THREE.Group();
  const geo = new THREE.CylinderGeometry(1, 1.25, h, 40, 4);
  const p = geo.attributes.position;
  for (let i = 0; i < p.count; i++) {
    const x = p.getX(i), z = p.getZ(i), y = p.getY(i);
    const a = Math.atan2(z, x);
    const n = 1 + Math.sin(a * 7) * 0.035 + Math.cos(a * 13 + 1) * 0.025 + (y < h / 2 - 0.01 ? (rand() - 0.5) * 0.05 : 0);
    p.setX(i, x * rx * n);
    p.setZ(i, z * rz * n);
  }
  geo.computeVertexNormals();
  const sides = mat('rock', { bump: 0.08 }).clone();
  sides.flatShading = true;
  const m = mesh(geo, sides);
  m.position.y = h / 2;
  g.add(m);
  g.add(patch(rx * 0.98, rz * 0.98, 'dirt', 0, h + 0.02, 0, 0.05));
  // Éboulis au pied.
  for (let i = 0; i < 16; i++) {
    const a = rand() * Math.PI * 2;
    if (Math.abs(Math.sin(a) - 1) < 0.25) continue; // pas sur la rampe d'accès
    g.add(rock(0.5 + rand() * 0.7, Math.cos(a) * (rx + 0.8), 0, Math.sin(a) * (rz + 0.6)));
  }
  return g;
}

/** Rampe d'accès en pente douce jusqu'au châtelet. */
function ramp(w, len, h, z0) {
  const geo = new THREE.BoxGeometry(w, h, len);
  const p = geo.attributes.position;
  for (let i = 0; i < p.count; i++) {
    // Le haut descend de h (contre l'éperon) à 0 (en bas).
    if (p.getY(i) > 0) p.setY(i, p.getZ(i) < 0 ? h / 2 : -h / 2 + 0.05);
  }
  geo.computeVertexNormals();
  const m = mesh(geo, mat('dirt', { bump: 0.05 }));
  m.position.set(0, h / 2, z0 + len / 2);
  return m;
}

/**
 * La citadelle complète, centrée sur l'origine.
 * Plateau de 18 × 14 m à 1,6 m de haut, enceinte hexagonale à six tours, châtelet face à la caméra, donjon au fond.
 */
export function citadel() {
  const H = 1.6;
  const g = new THREE.Group();
  g.add(crag(9.6, 7.6, H));
  g.add(ramp(3.2, 5.5, H, 7.2));
  g.add(patch(3, 3, 'dirt', 0, 0.02, 13.2, 0.3));

  // Enceinte : six tours sur un hexagone aplati, la porte entre les deux tours avant.
  const towers = [
    [-3.4, 6.6], [-8.4, 2.2], [-7.4, -4.6], [0, -6.8], [7.4, -4.6], [8.4, 2.2], [3.4, 6.6],
  ];
  for (let i = 0; i < towers.length - 1; i++) g.add(curtain(towers[i], towers[i + 1], 3.4, H));
  for (const [i, [x, z]] of towers.entries()) {
    const front = i === 0 || i === towers.length - 1;
    g.add(roundTower(front ? 1.55 : 1.25, front ? 5.6 : 4.6, x, H, z));
  }
  // Châtelet : bloc de porte entre les deux tours avant, voûte, herse et oriflammes.
  g.add(box(5.4, 4.4, 2.2, 'stone', 0, H, 6.6));
  g.add(at(crenels(5.4, 2.2, H + 4.4, 'stone', 0.42), 0, 0, 6.6));
  const arch = door(1.9, 2.8, 'planks');
  g.add(at(arch, 0, H, 7.72));
  // Herse relevée à mi-hauteur.
  const iron = plain(0x2a2622, 0.55);
  for (let i = -3; i <= 3; i++) g.add(at(mesh(new THREE.BoxGeometry(0.06, 1.3, 0.06), iron), i * 0.28, H + 2.75, 7.82));
  for (const y of [2.3, 2.75, 3.2]) g.add(at(mesh(new THREE.BoxGeometry(1.9, 0.06, 0.06), iron), 0, H + y, 7.82));
  g.add(banner(-1.85, H + 4.1, 7.74, 0.8, 2.1));
  g.add(banner(1.85, H + 4.1, 7.74, 0.8, 2.1));
  // Torchères dorées de part et d'autre de la porte.
  const brazier = (x) =>
    group(cyl(0.08, 0.1, 1.1, 'iron', 0, 0, 0, { seg: 8 }), at(mesh(new THREE.CylinderGeometry(0.28, 0.16, 0.25, 12), plain(GOLD, 0.4)), 0, 1.15, 0), at(mesh(new THREE.ConeGeometry(0.22, 0.6, 10), new THREE.MeshStandardMaterial({ color: 0xffc050, emissive: 0xff7a10, emissiveIntensity: 2.2 })), 0, 1.55, 0));
  g.add(at(brazier(-1.6), -1.6, 0.1, 10.6));
  g.add(at(brazier(1.6), 1.6, 0.1, 10.6));

  // Cour : grande salle et chapelle.
  const hall = group(box(6.4, 3.2, 3.4, 'stone', 0, 0, 0));
  hall.add(at(gableRoof(6.4, 3.4, 1.6, 'slate', 'stone', { overhang: 0.25 }), 0, 3.2, 0));
  for (const x of [-2.2, 0, 2.2]) hall.add(at(windowPane(0.42, 1, { flowers: false }), x, 1.4, 1.72));
  g.add(at(hall, 4, H, 0.4, -0.25));
  const chapel = group(box(2.6, 2.8, 3.6, 'stone'), cone(1.9, 2.6, 'slate', 0, 2.8, 0, { seg: 4, rotY: Math.PI / 4 }), cyl(0.5, 0.55, 5.2, 'stone', 0, 0, -1.4, { seg: 10 }), cone(0.75, 1.8, 'slate', 0, 5.2, -1.4, { seg: 10 }));
  chapel.add(at(mesh(new THREE.BoxGeometry(0.08, 0.7, 0.08), plain(GOLD, 0.35)), 0, 7.2, -1.4));
  chapel.add(at(mesh(new THREE.BoxGeometry(0.4, 0.08, 0.08), plain(GOLD, 0.35)), 0, 7.35, -1.4));
  g.add(at(chapel, -4.6, H, 0.6, 0.35));

  // Donjon : tour carrée massive, échauguettes aux angles, tourelle de guet coiffée d'ardoise et grand étendard.
  const keep = new THREE.Group();
  keep.add(box(5.4, 9.6, 5.4, 'stone', 0, 0, 0));
  keep.add(box(5.9, 0.4, 5.9, 'stone', 0, 9.3, 0));
  keep.add(at(crenels(5.9, 5.9, 9.7, 'stone', 0.46), 0, 0, 0));
  for (const [x, z] of [[-2.8, -2.8], [2.8, -2.8], [-2.8, 2.8], [2.8, 2.8]]) {
    keep.add(cyl(0.62, 0.3, 1.2, 'stone', x, 8.2, z, { seg: 12 }));
    keep.add(cyl(0.62, 0.62, 1.5, 'stone', x, 9.4, z, { seg: 12 }));
    keep.add(cone(0.85, 1.6, 'slate', x, 10.9, z, { seg: 12 }));
  }
  keep.add(cyl(1.5, 1.6, 4.2, 'stone', 0.6, 9.6, -0.6, { seg: 16 }));
  keep.add(at(roundCrenels(1.6, 13.8, 'stone', 12), 0.6, 0, -0.6));
  keep.add(cone(1.9, 3.4, 'slate', 0.6, 14.2, -0.6, { seg: 16 }));
  keep.add(standard(4.4, 0.6, 17.3, -0.6));
  for (const y of [3.2, 6.2]) for (const x of [-1.4, 1.4]) keep.add(at(windowPane(0.4, 1, { flowers: false, shutters: false }), x, y, 2.72));
  keep.add(banner(0, 8.6, 2.74, 1.3, 3.4));
  g.add(at(keep, 0, H, -2.6));

  // Quelques arbres et buissons au pied de l'éperon.
  g.add(pineTree(1.2, -11.6, 0, 3.2), pineTree(1, -10.6, 0, -5), pineTree(1.3, 11.4, 0, -3.4), bush(0.8, 10.4, 0, 5.4), bush(0.7, -9.6, 0, 7.4));
  return g;
}
