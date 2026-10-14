// Bastion d'une province et Sanctuaire de la Terre sainte, en vignette pour la carte.
// Plus modeste que la Citadelle : un donjon carré sur une butte, une courte enceinte à tours rondes et l'étendard.
import * as THREE from 'three';
import { box, cone, crenels, cyl, door, group, mesh, pineTree, plain, roundCrenels, windowPane, bush } from './kit.js';
import { at, banner, crag, curtain, roundTower, standard } from './citadel.js';

const GOLD = 0xd4a531;

/** Bastion : butte rocheuse, quatre tours rondes reliées par des courtines, porte face à la caméra et donjon carré. */
export function bastion() {
  const H = 1.1;
  const g = new THREE.Group();
  g.add(crag(6.4, 5.4, H));
  const towers = [
    [-2.4, 4.4], [-5.2, 0.6], [-3.8, -3.8], [3.8, -3.8], [5.2, 0.6], [2.4, 4.4],
  ];
  for (let i = 0; i < towers.length - 1; i++) g.add(curtain(towers[i], towers[i + 1], 2.6, H, 0.9));
  for (const [i, [x, z]] of towers.entries()) {
    const front = i === 0 || i === towers.length - 1;
    g.add(roundTower(front ? 1.15 : 0.95, front ? 4.2 : 3.6, x, H, z, { pennant: front }));
  }
  // Porte entre les deux tours avant.
  g.add(box(3.6, 3.2, 1.6, 'stone', 0, H, 4.4));
  g.add(at(crenels(3.6, 1.6, H + 3.2, 'stone', 0.38), 0, 0, 4.4));
  g.add(at(door(1.4, 2.1, 'planks'), 0, H, 5.22));
  g.add(banner(0, H + 3.05, 5.24, 0.7, 1.6));

  // Donjon carré, échauguettes et grand étendard.
  const keep = new THREE.Group();
  keep.add(box(3.8, 7.2, 3.8, 'stone', 0, 0, 0));
  keep.add(box(4.2, 0.35, 4.2, 'stone', 0, 6.95, 0));
  keep.add(at(crenels(4.2, 4.2, 7.3, 'stone', 0.42), 0, 0, 0));
  for (const [x, z] of [[-2, -2], [2, -2], [-2, 2], [2, 2]]) {
    keep.add(cyl(0.45, 0.22, 0.9, 'stone', x, 6.1, z, { seg: 10 }));
    keep.add(cyl(0.45, 0.45, 1.1, 'stone', x, 7, z, { seg: 10 }));
    keep.add(cone(0.62, 1.2, 'slate', x, 8.1, z, { seg: 10 }));
  }
  for (const y of [2.6, 4.8]) keep.add(at(windowPane(0.34, 0.85, { flowers: false, shutters: false }), 0, y, 1.92));
  keep.add(standard(3.4, 0, 7.3, 0));
  g.add(at(keep, 0, H, -1));

  g.add(pineTree(1, -7.8, 0, 2.6), pineTree(0.9, 7.6, 0, -2.2), bush(0.7, 7, 0, 3.8), bush(0.6, -6.8, 0, -3.6));
  return g;
}

/** Sanctuaire de la Terre sainte : enceinte à tours dorées autour d'une chapelle à coupole d'or et d'un haut clocher. */
export function sanctuary() {
  const H = 1.4;
  const g = new THREE.Group();
  g.add(crag(7.6, 6.4, H));
  const gold = plain(GOLD, 0.35);
  const towers = [
    [-2.6, 5.4], [-6.4, 1.2], [-4.8, -4.6], [0, -5.8], [4.8, -4.6], [6.4, 1.2], [2.6, 5.4],
  ];
  for (let i = 0; i < towers.length - 1; i++) g.add(curtain(towers[i], towers[i + 1], 2.8, H, 0.9));
  for (const [i, [x, z]] of towers.entries()) {
    const front = i === 0 || i === towers.length - 1;
    const t = roundTower(front ? 1.2 : 1, front ? 4.4 : 3.8, x, H, z, { pennant: false });
    g.add(t);
    // Flèche dorée au sommet de chaque tour.
    g.add(at(mesh(new THREE.ConeGeometry(0.12, 0.9, 8), gold), x, H + (front ? 4.4 : 3.8) + (front ? 1.2 : 1) * 2.1 + 0.85, z));
  }
  g.add(box(4, 3.4, 1.6, 'stone', 0, H, 5.4));
  g.add(at(crenels(4, 1.6, H + 3.4, 'stone', 0.38), 0, 0, 5.4));
  g.add(at(door(1.5, 2.3, 'planks'), 0, H, 6.22));
  g.add(banner(-1.2, H + 3.25, 6.24, 0.6, 1.6));
  g.add(banner(1.2, H + 3.25, 6.24, 0.6, 1.6));

  // Chapelle octogonale à coupole d'or, clocher carré et croix.
  const chapel = new THREE.Group();
  chapel.add(cyl(3, 3.1, 4.2, 'stone', 0, 0, 0, { seg: 8 }));
  chapel.add(at(roundCrenels(3.05, 4.25, 'stone', 16), 0, 0, 0));
  const dome = mesh(new THREE.SphereGeometry(2.6, 24, 12, 0, Math.PI * 2, 0, Math.PI / 2), gold);
  chapel.add(at(dome, 0, 4.2, 0));
  chapel.add(at(mesh(new THREE.BoxGeometry(0.14, 1.3, 0.14), gold), 0, 7.3, 0));
  chapel.add(at(mesh(new THREE.BoxGeometry(0.7, 0.14, 0.14), gold), 0, 7.6, 0));
  for (const a of [0, Math.PI / 4, -Math.PI / 4]) chapel.add(at(windowPane(0.42, 1.2, { flowers: false, shutters: false }), Math.sin(a) * 3.08, 1.6, Math.cos(a) * 3.08, a));
  g.add(at(chapel, -0.8, H, -0.6));
  const bell = group(box(1.9, 9.4, 1.9, 'stone', 0, 0, 0), box(2.2, 0.3, 2.2, 'stone', 0, 9.2, 0), cone(1.5, 3, 'slate', 0, 9.5, 0, { seg: 4, rotY: Math.PI / 4 }));
  bell.add(at(mesh(new THREE.SphereGeometry(0.2, 10, 8), gold), 0, 12.6, 0));
  bell.add(standard(3.2, 0, 12.4, 0));
  g.add(at(bell, 3.2, H, -2.4));

  g.add(pineTree(1.1, -9.2, 0, 2.6), pineTree(1, 9, 0, -3), bush(0.8, 8.4, 0, 4.4), bush(0.7, -8.2, 0, -4.2));
  return g;
}
