// Les 8 bâtiments du village, chacun en 3 stades (niveaux 1-6, 7-13, 14-20), plus le chantier vide.
// L'entrée de chaque bâtiment fait face à la caméra (+z).
import * as THREE from 'three';
import {
  barrel, box, chimney, cone, crate, crenels, cyl, deciduousTree, door, fence, flag, gableRoof, group, halfTimbered,
  haystack, hipRoof, logPile, mat, mesh, palisade, patch, pineTree, place, plain, rectPatch, rock, roundCrenels, sack,
  smoke, tent, weaponRack, windowPane,
} from './kit.js';
import { rand } from './textures.js';

const BLUE = 0x24418c, RED = 0x8c2a22, GOLD = 0xb8902a;

function at(obj, x, y, z, rotY = 0) {
  obj.position.set(x, y, z);
  if (rotY) obj.rotation.y = rotY;
  return obj;
}

/** Bâtiment simple : murs + toit à deux pans + porte en façade. */
function house({ w, h, d, wall = 'planks', roof = 'thatch', rise, doorX = 0, windows = [], roofOver = 0.45 }) {
  const g = group();
  if (wall === 'timbered') g.add(halfTimbered(w, h, d));
  else g.add(box(w, h, d, wall));
  g.add(at(gableRoof(w, d, rise ?? d * 0.45, roof, wall === 'timbered' ? 'plaster' : wall, { overhang: roofOver, thick: roof === 'thatch' ? 0.32 : 0.16 }), 0, h, 0));
  g.add(at(door(1.1, Math.min(2.1, h - 0.3)), doorX, 0, d / 2 + 0.02));
  for (const [x, y] of windows) g.add(at(windowPane(), x, y, d / 2 + 0.03));
  return g;
}

function hangingBanner(color, x, y, z, w = 0.8, h = 1.6) {
  const geo = new THREE.PlaneGeometry(w, h, 4, 6);
  const m = mesh(geo, new THREE.MeshStandardMaterial({ color, roughness: 0.85, side: THREE.DoubleSide }));
  m.position.set(x, y - h / 2, z);
  const g = group(m, box(w + 0.2, 0.08, 0.08, 'timber', x, y, z));
  return g;
}

function trainingDummy(x, z) {
  return group(
    box(0.14, 1.7, 0.14, 'timber', x, 0, z),
    box(1.0, 0.12, 0.12, 'timber', x, 1.3, z),
    place(mesh(new THREE.SphereGeometry(0.28, 10, 8), mat('canvasCloth', { repeat: [1, 1] })), x, 1.85, z),
    place(mesh(new THREE.CylinderGeometry(0.3, 0.25, 0.7, 10), mat('canvasCloth', { repeat: [1, 1] })), x, 1.2, z),
  );
}

function waterWheel(x, y, z) {
  const g = group();
  const r = 1.7;
  for (const side of [-0.35, 0.35]) {
    const rim = mesh(new THREE.TorusGeometry(r, 0.08, 6, 24), mat('timber'));
    rim.position.z = side;
    g.add(rim);
  }
  for (let i = 0; i < 12; i++) {
    const a = (i / 12) * Math.PI * 2;
    const spoke = box(0.08, r, 0.08, 'timber');
    spoke.position.set(Math.cos(a) * r * 0.5, Math.sin(a) * r * 0.5, 0);
    spoke.rotation.z = a - Math.PI / 2;
    g.add(spoke);
    const paddle = box(0.06, 0.5, 0.8, 'planks');
    paddle.position.set(Math.cos(a) * r, Math.sin(a) * r - 0.25, 0);
    paddle.rotation.z = a;
    g.add(paddle);
  }
  g.add(place(mesh(new THREE.CylinderGeometry(0.2, 0.2, 1.2, 10), mat('timber')), 0, 0, 0));
  g.children.at(-1).rotation.x = Math.PI / 2;
  g.rotation.y = Math.PI / 2;
  g.position.set(x, y, z);
  return g;
}

function mineCart(x, z, rot = 0) {
  const g = group(box(1.2, 0.6, 0.8, 'planks', 0, 0.3, 0));
  for (const [wx, wz] of [[-0.4, 0.42], [0.4, 0.42], [-0.4, -0.42], [0.4, -0.42]]) {
    const w = mesh(new THREE.CylinderGeometry(0.2, 0.2, 0.08, 12), mat('iron'));
    w.rotation.x = Math.PI / 2;
    w.position.set(wx, 0.2, wz);
    g.add(w);
  }
  const ore = mesh(new THREE.IcosahedronGeometry(0.5, 1), mat('ore', { repeat: [1, 1] }));
  ore.scale.set(1.1, 0.45, 0.7);
  ore.position.y = 0.95;
  g.add(ore);
  return at(g, x, 0, z, rot);
}

function rails(len, x, z, rot = 0) {
  const g = group();
  for (const s of [-0.42, 0.42]) g.add(box(len, 0.08, 0.07, 'iron', 0, 0.06, s));
  for (let i = 0; i < len / 0.6; i++) g.add(box(0.18, 0.08, 1.2, 'timber', -len / 2 + 0.3 + i * 0.6, 0, 0));
  return at(g, x, 0, z, rot);
}

function brickStack(x, z, rot = 0, rows = 3) {
  const g = group(box(1.2, 0.12, 1.0, 'planks'));
  for (let r = 0; r < rows; r++) g.add(box(1.1, 0.22, 0.9, 'brick', 0, 0.12 + r * 0.23, 0));
  return at(g, x, 0, z, rot);
}

function openShed(w, d, h, roof = 'shingles') {
  const g = group();
  for (const [x, z] of [[-w / 2, -d / 2], [w / 2, -d / 2], [-w / 2, d / 2], [w / 2, d / 2]]) g.add(box(0.18, h, 0.18, 'timber', x, 0, z));
  g.add(at(gableRoof(w, d, d * 0.35, roof, null, { overhang: 0.3, thick: 0.12 }), 0, h, 0));
  return g;
}

function windmill(x, z) {
  const g = group(cyl(1.15, 1.6, 5.2, 'stone', 0, 0, 0, { seg: 14 }));
  g.add(cone(1.5, 1.9, 'thatch', 0, 5.1, 0, { seg: 14 }));
  g.add(at(door(0.9, 1.8), 0, 0, 1.55));
  const hub = group();
  for (let i = 0; i < 4; i++) {
    const arm = group();
    arm.add(box(0.12, 3.6, 0.1, 'timber', 0, 0, 0));
    const sail = mesh(new THREE.PlaneGeometry(0.9, 2.8), new THREE.MeshStandardMaterial({ map: mat('canvasCloth').map, color: 0xd8ccb0, roughness: 0.9, side: THREE.DoubleSide }));
    sail.position.set(0.5, 2.2, 0.02);
    arm.add(sail);
    for (let k = 0; k < 5; k++) arm.add(box(1.0, 0.04, 0.05, 'timber', 0.45, 0.9 + k * 0.6, 0.03));
    arm.rotation.z = (i * Math.PI) / 2 + 0.4;
    hub.add(arm);
  }
  hub.position.set(0, 4.6, 1.75);
  g.add(hub);
  return at(g, x, 0, z);
}

function fieldPlot(w, d, x, z, rot = 0) {
  return group(rectPatch(w, d, 'field', x, 0.04, z, rot));
}

function stoneHall(w, h, d, roof = 'slate') {
  return group(box(w, h, d, 'stone'), at(gableRoof(w, d, d * 0.5, roof, 'stone', { overhang: 0.35 }), 0, h, 0));
}

/** Étal de marché : comptoir, quatre poteaux et toile tendue en pente. */
function stall(color, x, z, rot = 0) {
  const cloth = new THREE.MeshStandardMaterial({ color, roughness: 0.85, side: THREE.DoubleSide });
  const g = group(box(2.2, 0.9, 1.0, 'planks', 0, 0, 0.3));
  for (const [px, pz, h] of [[-1.1, -0.5, 2.3], [1.1, -0.5, 2.3], [-1.1, 0.9, 1.9], [1.1, 0.9, 1.9]]) g.add(box(0.1, h, 0.1, 'timber', px, 0, pz));
  const roof = mesh(new THREE.PlaneGeometry(2.6, 1.8, 6, 2), cloth);
  roof.rotation.x = -Math.PI / 2 + 0.25;
  roof.position.set(0, 2.15, 0.2);
  g.add(roof);
  // Rayures claires sur la toile.
  for (const sx of [-0.65, 0.65]) {
    const band = mesh(new THREE.PlaneGeometry(0.4, 1.8), new THREE.MeshStandardMaterial({ color: 0xe8dcc0, roughness: 0.85, side: THREE.DoubleSide }));
    band.rotation.x = -Math.PI / 2 + 0.25;
    band.position.set(sx, 2.16, 0.2);
    g.add(band);
  }
  // Marchandises sur le comptoir.
  g.add(place(mesh(new THREE.SphereGeometry(0.16, 8, 6), plain(0xc0392b, 0.6)), -0.6, 1.02, 0.4));
  g.add(place(mesh(new THREE.SphereGeometry(0.16, 8, 6), plain(0xd4a020, 0.6)), -0.3, 1.02, 0.5));
  g.add(box(0.5, 0.25, 0.4, 'planks', 0.5, 0.9, 0.35));
  g.add(sack(1.5, 0, 0.7, 0.4));
  return at(g, x, 0, z, rot);
}

/** Charrette à bras de marchand. */
function cart(x, z, rot = 0) {
  const g = group(box(1.6, 0.5, 1.0, 'planks', 0, 0.55, 0), box(1.7, 0.08, 0.08, 'timber', 1.4, 0.7, 0.35), box(1.7, 0.08, 0.08, 'timber', 1.4, 0.7, -0.35));
  for (const sz of [-0.58, 0.58]) {
    const wheel = mesh(new THREE.CylinderGeometry(0.45, 0.45, 0.08, 14), mat('planks', { repeat: [1, 1] }));
    wheel.rotation.x = Math.PI / 2;
    wheel.position.set(0, 0.45, sz);
    g.add(wheel);
  }
  g.add(sack(-0.3, 0.75, 0, 0.3), sack(0.35, 0.75, 0.1, 1.2), crate(0.5, 0.2, 1.05, -0.2, 0.3));
  return at(g, x, 0, z, rot);
}

// ---------------------------------------------------------------------------

function marketAt(stage) {
    if (stage === 1)
      return group(
        patch(5.5, 4.5, 'dirt'),
        stall(RED, -1.8, -0.8, 0.15),
        stall(BLUE, 2.0, 0.2, -0.25),
        barrel(-3.6, 0, 1.6),
        crate(0.8, 0.2, 0, 2.6, 0.4),
        sack(-0.8, 0, 2.4),
      );
    if (stage === 2)
      return group(
        patch(6.5, 5.5, 'dirt'),
        at(house({ w: 4.4, h: 2.6, d: 3.4, wall: 'timbered', roof: 'tiles', rise: 1.8, windows: [[1.4, 1.1]] }), 0, 0, -2.4),
        stall(RED, -3.6, 0.6, 0.35),
        stall(GOLD, 3.6, 0.8, -0.35),
        stall(BLUE, 0.2, 2.2, 0),
        cart(-3.4, 3.2, 0.5),
        barrel(4.6, 0, -1.2),
        barrel(5.1, 0, -0.6),
      );
    // Halle couverte en pierre et charpente, entourée d'étals.
    const hall = group();
    for (const px of [-3.3, -1.1, 1.1, 3.3]) for (const pz of [-1.6, 1.6]) hall.add(box(0.5, 2.8, 0.5, 'stone', px, 0, pz));
    hall.add(box(7.4, 0.35, 3.8, 'timber', 0, 2.8, 0));
    hall.add(at(gableRoof(7.6, 4.2, 2.2, 'tiles', 'timber', { overhang: 0.4 }), 0, 3.15, 0));
    hall.add(rectPatch(7, 3.4, 'stone', 0, 0.04, 0));
    hall.add(stall(GOLD, -1.6, -0.3, 0), stall(RED, 1.6, -0.3, 0));
    return group(
      patch(7.5, 6, 'dirt'),
      at(hall, 0, 0, -1.4),
      stall(BLUE, -4.6, 2.6, 0.4),
      stall(RED, 4.4, 2.8, -0.4),
      cart(0.4, 3.6, 0.2),
      hangingBanner(BLUE, -3.3, 2.6, 0.5, 0.6, 1.2),
      hangingBanner(BLUE, 3.3, 2.6, 0.5, 0.6, 1.2),
      barrel(-5.6, 0, -0.4),
      barrel(-6, 0, 0.4),
      crate(0.8, 5.8, 0, -0.6, 0.3),
    );
  }

export const BUILDERS = {
  market(stage) {
    // Les étals sont petits : on agrandit un peu l'ensemble pour qu'il pèse autant que ses voisins.
    return place(marketAt(stage), 0, 0, 0, 0, stage === 3 ? 1.05 : 1.25);
  },
  townhall(stage) {
    if (stage === 1)
      return group(
        patch(5.5, 4.5, 'dirt'),
        house({ w: 7, h: 3, d: 5, wall: 'logs', roof: 'thatch', rise: 2.6, windows: [[-2.3, 1.2], [2.3, 1.2]] }),
        chimney(2.2, 4.4, -0.8, 1.6),
        flag(BLUE, 3.6, 3.9, 0, 3.1),
        barrel(-4, 0, 2.4),
        barrel(-3.3, 0, 2.9),
      );
    if (stage === 2)
      return group(
        patch(6, 5, 'dirt'),
        box(8.4, 2.4, 6.2, 'stone'),
        halfTimbered(8, 2.4, 6, 0, 2.4, 0),
        at(gableRoof(8, 6, 3, 'tiles', 'plaster', { overhang: 0.5 }), 0, 4.8, 0),
        at(door(1.4, 2.2), 0, 0, 3.12),
        at(windowPane(), -2.6, 1, 3.12),
        at(windowPane(), 2.6, 1, 3.12),
        at(windowPane(), -2, 3.2, 3.06),
        at(windowPane(), 2, 3.2, 3.06),
        chimney(2.6, 6.2, -1, 1.5),
        smoke(2.6, 8, -1),
        flag(BLUE, 4, 4.9, 0, 3.2),
        box(2.4, 0.25, 1, 'stone', 0, 0, 3.6),
      );
    return group(
      patch(7, 6, 'dirt'),
      box(8.5, 5, 6, 'stone'),
      at(gableRoof(8.5, 6, 3, 'slate', 'stone', { overhang: 0.35 }), 0, 5, 0),
      box(3.8, 9.5, 3.8, 'stone', -4.6, 0, -0.6),
      at(crenels(3.8, 3.8, 9.5), -4.6, 0, -0.6),
      at(hipRoof(3, 3, 3.2, 'slate', 0), -4.6, 9.6, -0.6),
      flag(GOLD, 2.4, -4.6, 12.6, -0.6),
      at(halfTimbered(3.6, 3.2, 4), 5.6, 0, 0.4),
      at(gableRoof(3.6, 4, 1.8, 'tiles', 'plaster'), 5.6, 3.2, 0.4),
      at(door(1.8, 2.6), 0.5, 0, 3.02),
      ...[-2.8, 3].map((x) => at(windowPane(0.8, 1.2), x, 1.2, 3.03)),
      ...[-2.8, 0.5, 3].map((x) => at(windowPane(0.8, 1.2), x, 3.3, 3.03)),
      at(windowPane(0.6, 1), -4.6, 6, 1.33),
      hangingBanner(BLUE, -1.4, 4.4, 3.08),
      hangingBanner(BLUE, 2.4, 4.4, 3.08),
      box(3, 0.3, 1.2, 'stone', 0.5, 0, 3.6),
    );
  },

  woodcutter(stage) {
    const axeStump = group(
      cyl(0.45, 0.5, 0.6, 'bark', 0, 0, 0, { seg: 12 }),
      at(box(0.06, 0.9, 0.06, 'timber'), 0.1, 0.5, 0),
      at(box(0.3, 0.2, 0.06, 'iron'), 0.18, 0.55, 0),
    );
    if (stage === 1)
      return group(
        patch(5, 4, 'dirt'),
        house({ w: 4, h: 2.4, d: 3.4, wall: 'logs', roof: 'shingles', rise: 1.6, windows: [[1.2, 1.1]] }),
        logPile(3, 2.6, 3.6, 0, 0.6, 0.2),
        at(axeStump, -3.2, 0, 2.2),
        pineTree(1.1, -3.8, 0, -2.5),
      );
    if (stage === 2)
      return group(
        patch(6, 4.5, 'dirt'),
        house({ w: 5, h: 2.6, d: 3.8, wall: 'logs', roof: 'shingles', rise: 1.8, doorX: -0.8, windows: [[1.4, 1.1]] }),
        at(openShed(3.4, 3, 2.4), 4.6, 0, 0),
        logPile(4, 2.8, 4.6, 0, 0, 0),
        logPile(3, 2.4, -4.2, 0, 1.8, 1.4),
        at(axeStump, -2.2, 0, 3.2),
        pineTree(1.2, -4.4, 0, -2.6),
      );
    return group(
      patch(7, 5.5, 'dirt'),
      patch(2.4, 5.6, 'grass', -4.9, 0.03, 0, 0.2),
      patch(1.5, 5.2, 'water', -4.9, 0.05, 0, 0.12),
      house({ w: 6.4, h: 3.4, d: 4.4, wall: 'planks', roof: 'tiles', rise: 2.2, doorX: 1, windows: [[-1.6, 1.4]] }),
      waterWheel(-3.6, 1.6, 0),
      logPile(4, 3, 4.8, 0, 2.6, 0.3),
      logPile(3, 2.6, 4.8, 0, -1.6, -0.2),
      ...[0, 1, 2].map((i) => box(2.6, 0.18, 1, 'planks', 1.2, i * 0.19, 3.6)),
      pineTree(1.2, 3.8, 0, -3.8),
    );
  },

  claypit(stage) {
    const pit = group(
      patch(4.2, 3.2, 'clay', -0.5, 0.03, 0.4, 0.25),
      patch(2.6, 1.8, 'clay', -0.5, -0.25, 0.4, 0.2),
    );
    pit.children[1].material = pit.children[1].material.clone();
    pit.children[1].material.color = new THREE.Color(0x7a6050);
    const mounds = group();
    for (let i = 0; i < 7; i++) {
      const a = (i / 7) * Math.PI * 2;
      const m = mesh(new THREE.SphereGeometry(1, 16, 10), mat('clay', { repeat: [1, 1], color: 0xb89c88 }));
      m.scale.set(0.75 + rand() * 0.3, 0.5 + rand() * 0.25, 0.6 + rand() * 0.2);
      m.position.set(-0.5 + Math.cos(a) * 3.6, 0, 0.4 + Math.sin(a) * 2.6);
      mounds.add(m);
    }
    const shovel = group(at(box(0.05, 1.4, 0.05, 'timber'), 0, 0.3, 0), at(box(0.3, 0.4, 0.04, 'iron'), 0, 0, 0));
    shovel.rotation.z = 0.25;
    const base = [pit, mounds, at(shovel, 2.6, 0, 2.8), cyl(0.3, 0.25, 0.45, 'planks', 1.6, 0, 3.3, { seg: 10 })];
    if (stage === 1) return group(...base);
    const rack = group(at(openShed(3.6, 2.4, 2), 0, 0, 0), brickStack(-0.9, 0, 0, 2), brickStack(0.9, 0, 0, 2));
    if (stage === 2) return group(...base, at(rack, 4.4, 0, -1.6, -0.3), brickStack(3.6, 2.2, 0.2), brickStack(-4.4, 2.6, -0.3, 2));
    const kiln = group(
      cyl(1.7, 1.9, 2.2, 'brick', 0, 0, 0, { seg: 16 }),
      place(mesh(new THREE.SphereGeometry(1.7, 16, 8, 0, Math.PI * 2, 0, Math.PI / 2), mat('brick', { repeat: [4, 1] })), 0, 2.2, 0),
      cyl(0.35, 0.4, 2.4, 'brick', 0.6, 2.8, -0.4, { seg: 10 }),
      smoke(0.6, 5.4, -0.4),
      at(group(box(1, 1, 0.3, 'brick'), place(mesh(new THREE.BoxGeometry(0.7, 0.7, 0.32), plain(0xd96a1e, 0.6)), 0, 0.5, 0.02)), 0, 0, 1.8),
    );
    return group(...base, at(rack, 4.6, 0, -2.2, -0.3), at(kiln, -4.4, 0, -2.2), brickStack(3.6, 2, 0.2), brickStack(4.6, 3.4, 0), logPile(3, 2, -5.2, 0, 1.6, 1.4));
  },

  ironmine(stage) {
    const hill = group(
      rock(3.4, -0.4, -0.6, -2.8),
      rock(2.5, -3.8, -0.4, -1.4),
      rock(2.4, 3.2, -0.4, -1.8),
      rock(1.1, 4.4, 0, 0.8),
      rock(0.9, -4.6, 0, 1.4),
    );
    hill.children[0].scale.y *= 1.3;
    const tunnel = group(
      place(mesh(new THREE.BoxGeometry(1.8, 2.2, 1.6), plain(0x0b0806, 1)), 0, 1.1, 0),
      box(0.25, 2.5, 0.25, 'timber', -1.05, 0, 0.7),
      box(0.25, 2.5, 0.25, 'timber', 1.05, 0, 0.7),
      box(2.6, 0.3, 0.35, 'timber', 0, 2.4, 0.7),
    );
    const base = [patch(6, 4.5, 'dirt', 0, 0.02, 1.4), hill, at(tunnel, -0.3, 0, 0.6)];
    if (stage === 1) return group(...base, rock(0.5, 1.6, 0, 2.6), rock(0.4, 2.1, 0, 3.1));
    const extra = [rails(6, 2, 2.4, -0.5), mineCart(2.6, 2.7, -0.5), rock(0.9, -2.8, 0, 3).clone(), place(mesh(new THREE.IcosahedronGeometry(0.9, 1), mat('ore', { repeat: [1, 1] })), -2.2, 0.3, 3)];
    extra[3].scale.set(1.3, 0.55, 1);
    if (stage === 2) return group(...base, ...extra, at(house({ w: 2.6, h: 2, d: 2.2, wall: 'planks', roof: 'shingles', rise: 1 }), 4.6, 0, 3.2, -0.4));
    const smelter = group(
      cyl(1.2, 1.6, 3.4, 'stone', 0, 0, 0, { seg: 12 }),
      cyl(0.45, 0.55, 2.6, 'brick', 0, 3.4, 0, { seg: 10 }),
      smoke(0, 6.4, 0),
      at(group(box(0.9, 0.8, 0.3, 'stone'), place(mesh(new THREE.BoxGeometry(0.6, 0.5, 0.32), plain(0xe0761e, 0.5)), 0, 0.35, 0.02)), 0, 0, 1.45),
      at(openShed(2.4, 2, 2), 2.2, 0, 0),
    );
    return group(...base, ...extra, at(smelter, -5, 0, 2.2), ...[0, 1, 2].map((i) => box(0.8, 0.18, 0.3, 'iron', -2.6 + i * 0.05, i * 0.19, 4.4, { metal: 0.4 })));
  },

  farm(stage) {
    const farmhouse = house({ w: 4.2, h: 2.4, d: 3.2, wall: 'timbered', roof: 'thatch', rise: 2, windows: [[1.3, 1]] });
    if (stage === 1)
      return group(
        patch(6, 5, 'grass'),
        at(farmhouse, 1.8, 0, -1.4),
        fieldPlot(5, 3.6, -2.4, 2.2),
        fence(5.2, -2.4, 0, 4.2),
        haystack(-3.6, 0, -1.6, 0.9),
      );
    const barn = house({ w: 6, h: 3.2, d: 4.2, wall: 'planks', roof: 'thatch', rise: 2.6 });
    if (stage === 2)
      return group(
        patch(7, 5.5, 'grass'),
        at(barn, -2, 0, -1.8),
        at(farmhouse, 3.6, 0, -0.6),
        fieldPlot(5, 3, -2.6, 3.4),
        fieldPlot(3.6, 3, 3.4, 4),
        fence(5.2, -2.6, 0, 5.1),
        haystack(-5.6, 0, 0.8, 0.8),
        haystack(1.2, 0, 2.2, 0.7),
      );
    return group(
      patch(7.5, 6, 'grass'),
      at(barn, -1.2, 0, -2.4),
      windmill(-5.4, 0.4),
      at(farmhouse, 4.4, 0, -1),
      fieldPlot(4.4, 3, -2.2, 3.6),
      fieldPlot(4.2, 3, 2.6, 3.8),
      fence(9, 0.2, 0, 5.4),
      haystack(1.6, 0, 1.2, 0.8),
      haystack(6.2, 0, 2, 0.7),
    );
  },

  warehouse(stage) {
    if (stage === 1)
      return group(
        patch(5, 4, 'dirt'),
        house({ w: 4.2, h: 2.4, d: 3.2, wall: 'planks', roof: 'shingles', rise: 1.4 }),
        barrel(2.8, 0, 1.6),
        barrel(3.4, 0, 2.3),
        sack(-2.8, 0, 1.8),
        sack(-2.2, 0, 2.3, 1),
        crate(0.8, -3, 0, 0.5, 0.3),
      );
    if (stage === 2)
      return group(
        patch(6, 5, 'dirt'),
        house({ w: 7, h: 3.4, d: 5, wall: 'planks', roof: 'tiles', rise: 2.4, windows: [[-2.4, 1.6], [2.4, 1.6]] }),
        at(door(2.2, 2.6), 0, 0, 2.53),
        crate(0.9, 4.4, 0, 1.6, 0.2),
        crate(0.8, 4.2, 0.9, 1.7, 0.5),
        crate(0.9, 4.6, 0, 2.8, -0.2),
        barrel(-4.2, 0, 2),
        barrel(-4.8, 0, 2.6),
        sack(-3.4, 0, 3),
      );
    return group(
      patch(7, 5.5, 'dirt'),
      box(8.6, 3, 5.6, 'stone'),
      halfTimbered(8.4, 2.6, 5.4, 0, 3, 0),
      at(gableRoof(8.4, 5.4, 2.8, 'tiles', 'plaster', { overhang: 0.45 }), 0, 5.6, 0),
      at(door(2.4, 2.6), -1.2, 0, 2.83),
      at(door(1.2, 1.6, 'planks'), 2.2, 3.4, 2.73),
      box(0.25, 0.25, 1.8, 'timber', 2.2, 5.2, 3.3),
      box(0.03, 1.6, 0.03, 'timber', 2.2, 3.6, 4.1),
      crate(0.7, 2.2, 2.9, 4.1),
      ...[[4.6, 1.8], [5.4, 2.6], [4.8, 3.2]].map(([x, z], i) => crate(0.9, x, 0, z, i * 0.4)),
      crate(0.8, 4.7, 0.9, 1.9, 0.2),
      barrel(-4.6, 0, 2.2),
      barrel(-5.2, 0, 2.9),
      barrel(-4.4, 0, 3.4),
      sack(-3.2, 0, 3.6),
      sack(-2.6, 0, 3.9, 1),
    );
  },

  barracks(stage) {
    if (stage === 1) {
      const pal = group(palisade(8, 2.2, 0, 0, -3.2), palisade(6.6, 2.2, -4, 0, 0, Math.PI / 2), palisade(6.6, 2.2, 4, 0, 0, Math.PI / 2), palisade(3, 2.2, -2.6, 0, 3.2), palisade(3, 2.2, 2.6, 0, 3.2));
      return group(
        patch(5.5, 4.5, 'dirt'),
        pal,
        tent(-1.8, 0, -1.2, 0.3),
        tent(1.6, 0, -1.4, 0.1, 0.9),
        weaponRack(1.6, 0, 1.6, -0.2),
        trainingDummy(-1.4, 1.8),
        flag(RED, 4.2, 3.6, 0, -2.8),
      );
    }
    if (stage === 2)
      return group(
        patch(6.5, 5.5, 'dirt'),
        at(stoneHall(8, 3, 4.4, 'tiles'), 0, 0, -1.8),
        at(door(1.4, 2.2), 0, 0, 0.42),
        ...[-2.6, 2.6].map((x) => at(windowPane(0.6, 0.7), x, 1.3, 0.43)),
        fence(8, 0, 0, 4.6),
        fence(4, -4, 0, 2.6, Math.PI / 2),
        fence(4, 4, 0, 2.6, Math.PI / 2),
        trainingDummy(-2, 2.6),
        trainingDummy(0, 2.8),
        weaponRack(2.6, 0, 2.4, -0.3),
        flag(RED, 4.2, -4.6, 0, -0.6),
      );
    return group(
      patch(7, 6, 'dirt'),
      box(8, 4.2, 5, 'stone', 0, 0, -1.4),
      at(crenels(8, 5, 4.2), 0, 0, -1.4),
      cyl(1.7, 1.8, 7.2, 'stone', -4.6, 0, -1.4, { seg: 16 }),
      at(roundCrenels(1.7, 7.2, 'stone', 12), -4.6, 0, -1.4),
      cone(2, 2.6, 'slate', -4.6, 7.4, -1.4, { seg: 16 }),
      flag(RED, 2.2, -4.6, 9.8, -1.4),
      at(door(1.8, 2.6), 0.6, 0, 1.12),
      ...[-2, 3].map((x) => at(windowPane(0.5, 0.9), x, 2.2, 1.13)),
      hangingBanner(RED, -0.9, 3.9, 1.16, 0.8, 1.8),
      hangingBanner(RED, 2.1, 3.9, 1.16, 0.8, 1.8),
      fence(8.6, 0.4, 0, 5.2),
      trainingDummy(-1.6, 3.4),
      trainingDummy(0.6, 3.6),
      weaponRack(3.4, 0, 3, -0.3),
      weaponRack(-4, 0, 3.4, 0.3),
    );
  },

  wall(stage) {
    if (stage === 1)
      return group(
        patch(6.5, 2.6, 'dirt', 0, 0.02, 1.2),
        palisade(4.6, 2.8, -3.8, 0, 0),
        palisade(4.6, 2.8, 3.8, 0, 0),
        box(0.35, 3.4, 0.35, 'bark', -1.4, 0, 0),
        box(0.35, 3.4, 0.35, 'bark', 1.4, 0, 0),
        box(3.2, 0.35, 0.4, 'timber', 0, 3.1, 0),
        box(1.2, 2.6, 0.15, 'planks', -0.62, 0, 0.1),
        box(1.2, 2.6, 0.15, 'planks', 0.62, 0, 0.1),
      );
    if (stage === 2)
      return group(
        patch(6.5, 2.6, 'dirt', 0, 0.02, 1.4),
        box(4.4, 3, 1, 'stone', -3.8, 0, 0),
        box(4.4, 3, 1, 'stone', 3.8, 0, 0),
        at(crenels(4.4, 1, 3, 'stone', 0.45), -3.8, 0, 0),
        at(crenels(4.4, 1, 3, 'stone', 0.45), 3.8, 0, 0),
        box(3.4, 1, 1.2, 'stone', 0, 3, 0),
        box(0.6, 3, 1.2, 'stone', -1.4, 0, 0),
        box(0.6, 3, 1.2, 'stone', 1.4, 0, 0),
        box(1.1, 2.8, 0.15, 'planks', -0.56, 0, 0.2),
        box(1.1, 2.8, 0.15, 'planks', 0.56, 0, 0.2),
      );
    const tower = (x) =>
      group(
        cyl(1.4, 1.5, 5.6, 'stone', x, 0, 0.2, { seg: 16 }),
        at(roundCrenels(1.4, 5.6, 'stone', 10), x, 0, 0.2),
        cone(1.7, 2, 'slate', x, 5.9, 0.2, { seg: 16 }),
        flag(BLUE, 1.6, x, 7.6, 0.2),
        at(windowPane(0.35, 0.7), x, 3, 1.62),
      );
    return group(
      patch(7, 2.8, 'dirt', 0, 0.02, 1.6),
      box(3.6, 3.8, 1.4, 'stone', -5.4, 0, -0.2),
      box(3.6, 3.8, 1.4, 'stone', 5.4, 0, -0.2),
      at(crenels(3.6, 1.4, 3.8, 'stone', 0.45), -5.4, 0, -0.2),
      at(crenels(3.6, 1.4, 3.8, 'stone', 0.45), 5.4, 0, -0.2),
      tower(-2.4),
      tower(2.4),
      box(2.2, 1.6, 1.6, 'stone', 0, 3.6, 0.2),
      at(crenels(2.2, 1.6, 5.2, 'stone', 0.4), 0, 0, 0.2),
      box(1, 3.4, 0.15, 'planks', -0.5, 0, 0.6),
      box(1, 3.4, 0.15, 'planks', 0.5, 0, 0.6),
      box(2.2, 0.25, 0.3, 'iron', 0, 2.2, 0.75),
    );
  },

  plot() {
    const g = group(patch(4.2, 3.2, 'dirt', 0, 0.03, 0, 0.2));
    const corners = [[-3, -2.2], [3, -2.2], [3, 2.2], [-3, 2.2]];
    for (const [x, z] of corners) g.add(box(0.14, 1, 0.14, 'timber', x, 0, z));
    for (let i = 0; i < 4; i++) {
      const [x1, z1] = corners[i], [x2, z2] = corners[(i + 1) % 4];
      const len = Math.hypot(x2 - x1, z2 - z1);
      const r = box(len, 0.03, 0.03, 'canvasCloth', (x1 + x2) / 2, 0.8, (z1 + z2) / 2);
      r.rotation.y = -Math.atan2(z2 - z1, x2 - x1);
      g.add(r);
    }
    g.add(...[0, 1, 2].map((i) => box(2.4, 0.12, 0.3, 'planks', 0.8, i * 0.13, 0.6 + i * 0.05)));
    g.add(rock(0.35, -1.2, 0, -0.6), rock(0.3, -0.6, 0, -1));
    return g;
  },
};

export { deciduousTree, pineTree };
