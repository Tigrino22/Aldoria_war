// Icônes : ressources (bois, argile, fer, blé) et unités (figurines), même lumière et même caméra que le reste.
import * as THREE from 'three';
import { group, place, box, cyl, cone, mesh, mat, plain, logPile, sack, rock } from './kit.js';

const YAW = THREE.MathUtils.degToRad(32);
const BLUE = 0x24418c, RED = 0x8c2a22, GOLD = 0xc9a03a;
const SKIN = 0xd9a882;

const metal = (color = 0x8a8d92, rough = 0.38) => new THREE.MeshStandardMaterial({ color, roughness: rough, metalness: 0.25 });
const cloth = (color, rough = 0.9) => new THREE.MeshStandardMaterial({ color, roughness: rough });
const part = (geo, material, x = 0, y = 0, z = 0) => place(mesh(geo, material), x, y, z);

// --- Ressources -------------------------------------------------------------------------------

function wood() {
  const g = group(logPile(3, 1.8, 0, 0, 0, 0.2));
  return g;
}

function clayRes() {
  const g = group();
  const rows = [[-0.6, 0], [0.6, 0], [0, 0]];
  for (let r = 0; r < 3; r++)
    for (let i = 0; i < 3 - r; i++) {
      const b = box(0.9, 0.32, 0.45, 'brick', (i - (2 - r) / 2) * 0.95, r * 0.33, r % 2 ? 0.05 : 0);
      b.rotation.y = (rows[i][0] * 0.05);
      g.add(b);
    }
  const lump = part(new THREE.SphereGeometry(0.45, 16, 10), mat('clay', { repeat: [1, 1] }), 1.1, 0.18, 0.6);
  lump.scale.set(1, 0.55, 0.9);
  g.add(lump);
  return g;
}

function iron() {
  const g = group();
  const ingot = () => {
    const geo = new THREE.CylinderGeometry(0.5, 0.62, 0.26, 4, 1);
    geo.rotateY(Math.PI / 4);
    geo.scale(1.6, 1, 0.55);
    return mesh(geo, metal(0x7d8086, 0.32));
  };
  const spots = [[-0.5, 0, 0], [0.5, 0, 0], [0, 0.27, 0]];
  for (const [x, y, z] of spots) g.add(place(ingot(), x, y + 0.13, z));
  const ore = rock(0.4, 1.2, 0, 0.7);
  ore.material = mat('ore', { bump: 0.08 });
  g.add(ore);
  return g;
}

function wheat() {
  const g = group(sack(-0.45, 0, -0.1), sack(0.25, 0, 0.25, 1));
  for (const s of g.children) s.material = mat('canvasCloth', { repeat: [1, 1], color: 0xc09a68 });
  // Gerbe de blé attachée.
  const sheaf = group();
  for (let i = 0; i < 26; i++) {
    const a = (i / 26) * Math.PI * 2, r = 0.08 + (i % 3) * 0.05;
    const stalk = cyl(0.012, 0.012, 1.2, 'thatch', Math.cos(a) * r, 0, Math.sin(a) * r, { seg: 4 });
    stalk.rotation.z = Math.cos(a) * 0.12;
    stalk.rotation.x = Math.sin(a) * 0.12;
    sheaf.add(stalk);
    const ear = part(new THREE.SphereGeometry(0.05, 6, 4), cloth(0xd8b05a), Math.cos(a) * r * 2.2, 1.25, Math.sin(a) * r * 2.2);
    ear.scale.set(0.7, 1.8, 0.7);
    sheaf.add(ear);
  }
  sheaf.add(place(mesh(new THREE.TorusGeometry(0.17, 0.03, 6, 14), cloth(0x8a5a2a)), 0, 0.5, 0));
  sheaf.children.at(-1).rotation.x = Math.PI / 2;
  g.add(place(sheaf, 0.85, 0, -0.35));
  return g;
}

// --- Unités -----------------------------------------------------------------------------------

/** Silhouette de base : jambes, torse vêtu, bras, tête. Regarde vers +z. */
function figure({ tunic, legs = 0x4a3a2a, torso = null, tabard = null }) {
  const g = group();
  for (const sx of [-0.12, 0.12]) {
    g.add(part(new THREE.CylinderGeometry(0.075, 0.065, 0.8, 8), cloth(legs), sx, 0.4, 0));
    g.add(part(new THREE.BoxGeometry(0.14, 0.1, 0.26), cloth(0x2e2218), sx, 0.05, 0.04));
  }
  const body = part(new THREE.CylinderGeometry(0.2, 0.26, 0.75, 12), torso ?? cloth(tunic), 0, 1.17, 0);
  g.add(body);
  // Pan de tunique sur les hanches.
  g.add(part(new THREE.CylinderGeometry(0.26, 0.3, 0.3, 12, 1, true), cloth(tunic), 0, 0.72, 0));
  if (tabard) g.add(part(new THREE.BoxGeometry(0.3, 0.8, 0.04), cloth(tabard), 0, 1.0, 0.24));
  g.add(part(new THREE.SphereGeometry(0.15, 14, 10), cloth(SKIN, 0.7), 0, 1.7, 0));
  g.add(part(new THREE.CylinderGeometry(0.06, 0.07, 0.1, 8), cloth(SKIN, 0.7), 0, 1.55, 0));
  return g;
}

function arm(color, x, rotX = 0, rotZ = 0) {
  const a = group(part(new THREE.CylinderGeometry(0.06, 0.055, 0.62, 8), cloth(color), 0, -0.31, 0), part(new THREE.SphereGeometry(0.06, 8, 6), cloth(SKIN, 0.7), 0, -0.64, 0));
  a.position.set(x, 1.5, 0);
  a.rotation.set(rotX, 0, rotZ);
  return a;
}

function roundShield(color, r = 0.36) {
  const s = group(
    part(new THREE.CylinderGeometry(r, r, 0.05, 20), mat('planks', { color })),
    part(new THREE.TorusGeometry(r, 0.025, 6, 24), metal(0x5a5048)),
    part(new THREE.SphereGeometry(0.08, 10, 6), metal(0x9a9aa0), 0, 0.03, 0),
  );
  s.children[1].rotation.x = Math.PI / 2;
  s.rotation.x = Math.PI / 2;
  return s;
}

function heaterShield(color) {
  const shape = new THREE.Shape();
  shape.moveTo(-0.3, 0.32);
  shape.lineTo(0.3, 0.32);
  shape.quadraticCurveTo(0.3, -0.2, 0, -0.45);
  shape.quadraticCurveTo(-0.3, -0.2, -0.3, 0.32);
  const geo = new THREE.ExtrudeGeometry(shape, { depth: 0.05, bevelEnabled: true, bevelSize: 0.02, bevelThickness: 0.02, bevelSegments: 1 });
  const s = group(mesh(geo, cloth(color, 0.6)));
  // Bande dorée.
  s.add(part(new THREE.BoxGeometry(0.08, 0.7, 0.02), metal(GOLD, 0.4), 0, -0.05, 0.075));
  return s;
}

function spear(len = 2.6) {
  return group(cyl(0.025, 0.025, len, 'timber', 0, 0, 0, { seg: 6 }), part(new THREE.ConeGeometry(0.055, 0.28, 4), metal(0xb0b2b6, 0.3), 0, len + 0.14, 0));
}

function sword() {
  return group(
    part(new THREE.BoxGeometry(0.06, 0.85, 0.015), metal(0xc8cacd, 0.25), 0, 0.55, 0),
    part(new THREE.BoxGeometry(0.26, 0.04, 0.05), metal(GOLD, 0.4), 0, 0.12, 0),
    part(new THREE.CylinderGeometry(0.025, 0.025, 0.18, 6), cloth(0x3a2a1a), 0, 0.02, 0),
  );
}

function spearman() {
  const g = figure({ tunic: 0x7a5a34, legs: 0x5a4a38 });
  g.add(part(new THREE.SphereGeometry(0.17, 14, 8, 0, Math.PI * 2, 0, Math.PI / 2), metal(0x80838a), 0, 1.74, 0)); // casque
  g.add(part(new THREE.CylinderGeometry(0.25, 0.25, 0.02, 16), metal(0x80838a), 0, 1.76, 0)); // bord
  g.add(arm(0x7a5a34, -0.27, 0, 0.25), arm(0x7a5a34, 0.27, -0.5, -0.1));
  g.add(place(spear(2.7), 0.36, 0, 0.32));
  g.add(place(roundShield(BLUE), -0.36, 1.05, 0.2));
  g.children.at(-1).rotation.y = -0.4;
  return g;
}

function swordsman() {
  const mail = mat('iron', { color: 0xb8bcc4, metal: 0.5, rough: 0.55 });
  const g = figure({ tunic: 0x6a6e76, legs: 0x4a4e56, torso: mail, tabard: BLUE });
  g.add(part(new THREE.CylinderGeometry(0.16, 0.16, 0.3, 14), metal(0x8e9198), 0, 1.72, 0)); // heaume
  g.add(part(new THREE.SphereGeometry(0.16, 14, 6, 0, Math.PI * 2, 0, Math.PI / 2), metal(0x8e9198), 0, 1.87, 0));
  g.add(part(new THREE.BoxGeometry(0.22, 0.03, 0.02), cloth(0x111111), 0, 1.74, 0.16)); // fente
  g.add(arm(0x6a6e76, -0.28, 0, 0.2), arm(0x6a6e76, 0.28, -0.9, -0.05));
  const sw = sword();
  sw.position.set(0.3, 1.0, 0.55);
  sw.rotation.x = 0.7;
  g.add(sw);
  g.add(place(heaterShield(BLUE), -0.36, 1.12, 0.24));
  g.children.at(-1).rotation.y = -0.35;
  return g;
}

function horse() {
  const coat = cloth(0x5a3a22, 0.75);
  const g = group();
  const body = part(new THREE.CapsuleGeometry(0.36, 1.1, 6, 12), coat, 0, 1.3, 0);
  body.rotation.x = Math.PI / 2;
  g.add(body);
  for (const [x, z] of [[-0.2, 0.55], [0.2, 0.55], [-0.2, -0.55], [0.2, -0.55]]) {
    g.add(part(new THREE.CylinderGeometry(0.07, 0.06, 1.0, 8), coat, x, 0.5, z));
    g.add(part(new THREE.CylinderGeometry(0.08, 0.08, 0.1, 8), cloth(0x222222), x, 0.05, z));
  }
  const neck = part(new THREE.CylinderGeometry(0.16, 0.24, 0.8, 10), coat, 0, 1.75, 0.8);
  neck.rotation.x = 0.6;
  g.add(neck);
  const head = part(new THREE.BoxGeometry(0.22, 0.24, 0.56), coat, 0, 2.08, 1.15);
  head.rotation.x = 0.5;
  g.add(head);
  g.add(part(new THREE.BoxGeometry(0.06, 0.4, 0.5), cloth(0x1e140c), 0, 2.0, 0.78)); // crinière
  const tail = part(new THREE.CylinderGeometry(0.05, 0.1, 0.7, 6), cloth(0x1e140c), 0, 1.15, -0.9);
  tail.rotation.x = -0.4;
  g.add(tail);
  // Caparaçon aux couleurs du fief.
  g.add(part(new THREE.CylinderGeometry(0.42, 0.42, 1.0, 14, 1, true, Math.PI / 2 - 1.3, 2.6), cloth(BLUE), 0, 1.25, 0));
  g.children.at(-1).rotation.x = Math.PI / 2;
  g.children.at(-1).rotation.z = Math.PI / 2;
  return g;
}

function cavalry() {
  const g = horse();
  const rider = figure({ tunic: 0x6a6e76, legs: 0x4a4e56, tabard: BLUE });
  rider.scale.setScalar(0.85);
  rider.position.set(0, 1.05, -0.05);
  rider.add(part(new THREE.CylinderGeometry(0.16, 0.16, 0.3, 14), metal(0x8e9198), 0, 1.72, 0));
  rider.add(part(new THREE.ConeGeometry(0.17, 0.2, 14), metal(0x8e9198), 0, 1.97, 0));
  rider.add(arm(0x6a6e76, 0.28, -1.2, 0));
  const lance = spear(3.2);
  lance.rotation.x = 1.2;
  lance.position.set(0.3, 1.45, -0.6);
  rider.add(lance);
  rider.add(place(heaterShield(BLUE), -0.36, 1.15, 0.1));
  rider.children.at(-1).rotation.y = -0.9;
  g.add(rider);
  return g;
}

function scout() {
  const g = horse();
  // Monture plus claire et sans caparaçon : l'éclaireur voyage léger.
  g.traverse((o) => {
    if (o.material?.color?.getHex() === 0x5a3a22) o.material = cloth(0x9a7a52, 0.75);
  });
  g.remove(g.children.at(-1));
  const rider = figure({ tunic: 0x3e5a34, legs: 0x4a3a2a });
  rider.scale.setScalar(0.85);
  rider.position.set(0, 1.05, -0.05);
  // Capuche et cape vertes.
  rider.add(part(new THREE.ConeGeometry(0.2, 0.32, 12), cloth(0x3e5a34), 0, 1.86, -0.02));
  const cape = part(new THREE.CylinderGeometry(0.22, 0.42, 0.9, 12, 1, true, Math.PI * 0.6, Math.PI * 0.8), cloth(0x334a2c), 0, 1.15, 0);
  cape.material.side = THREE.DoubleSide;
  rider.add(cape);
  rider.add(arm(0x3e5a34, -0.27, -0.6, 0.1), arm(0x3e5a34, 0.27, -0.3, -0.1));
  // Cor de chasse en bandoulière.
  const horn = part(new THREE.TorusGeometry(0.14, 0.035, 6, 12, Math.PI), cloth(0xd8c8a0, 0.5), 0.22, 1.05, 0.18);
  horn.rotation.y = 0.6;
  rider.add(horn);
  g.add(rider);
  return g;
}

function ram() {
  const g = group();
  // Châssis à quatre roues.
  g.add(box(1.0, 0.18, 2.6, 'planks', 0, 0.4, 0));
  for (const sx of [-0.58, 0.58])
    for (const sz of [-0.85, 0.85]) {
      const wheel = mesh(new THREE.CylinderGeometry(0.36, 0.36, 0.12, 14), mat('planks', { repeat: [1, 1] }));
      wheel.rotation.z = Math.PI / 2;
      wheel.position.set(sx, 0.36, sz);
      g.add(wheel);
      g.add(place(mesh(new THREE.CylinderGeometry(0.07, 0.07, 0.14, 8), metal(0x55585e)), sx * 1.05, 0.36, sz));
      g.children.at(-1).rotation.z = Math.PI / 2;
    }
  // Abri en A recouvert de peaux.
  for (const sz of [-1.1, 0, 1.1]) {
    for (const sx of [-1, 1]) {
      const post = box(0.1, 1.5, 0.1, 'timber', sx * 0.42, 0.5, sz);
      post.rotation.z = sx * 0.3;
      g.add(post);
    }
  }
  const hide = cloth(0x7a5a3a, 0.9);
  for (const sx of [-1, 1]) {
    const panel = part(new THREE.BoxGeometry(0.05, 1.5, 2.5), hide, sx * 0.34, 1.2, 0);
    panel.rotation.z = sx * 0.33;
    g.add(panel);
  }
  // Tronc suspendu, tête de fer vers l'avant.
  const log = cyl(0.17, 0.17, 3.1, 'bark', 0, 0, 0, { seg: 12, repeat: [1, 2] });
  log.rotation.x = Math.PI / 2;
  log.position.set(0, 1.0, 0.4);
  g.add(log);
  const head = part(new THREE.CylinderGeometry(0.22, 0.2, 0.36, 12), metal(0x66696f, 0.4), 0, 1.0, 2.05);
  head.rotation.x = Math.PI / 2;
  g.add(head);
  for (const sz of [-0.5, 0.9]) g.add(box(0.03, 0.6, 0.03, 'timber', 0, 1.15, sz));
  return g;
}

function noble() {
  const g = figure({ tunic: 0x6a1f3a, legs: 0x2a1a22 });
  // Grande cape.
  g.add(part(new THREE.CylinderGeometry(0.24, 0.5, 1.4, 16, 1, true, Math.PI * 0.75, Math.PI * 1.5), cloth(RED), 0, 0.82, 0));
  g.children.at(-1).material.side = THREE.DoubleSide;
  g.add(part(new THREE.TorusGeometry(0.2, 0.05, 6, 16), cloth(0xece4d4), 0, 1.5, 0)); // col d'hermine
  g.children.at(-1).rotation.x = Math.PI / 2;
  const crown = group(part(new THREE.CylinderGeometry(0.15, 0.15, 0.08, 14, 1, true), metal(GOLD, 0.3)));
  for (let i = 0; i < 6; i++) {
    const a = (i / 6) * Math.PI * 2;
    crown.add(part(new THREE.ConeGeometry(0.03, 0.09, 4), metal(GOLD, 0.3), Math.cos(a) * 0.15, 0.08, Math.sin(a) * 0.15));
  }
  crown.children[0].material.side = THREE.DoubleSide;
  g.add(place(crown, 0, 1.82, 0));
  g.add(arm(0x6a1f3a, -0.27, 0, 0.2), arm(0x6a1f3a, 0.27, -0.3, -0.15));
  // Étendard.
  const pole = cyl(0.03, 0.03, 2.8, 'timber', 0.36, 0, 0.18, { seg: 6 });
  const banner = part(new THREE.PlaneGeometry(0.6, 0.9), new THREE.MeshStandardMaterial({ color: BLUE, roughness: 0.85, side: THREE.DoubleSide }), 0.36 + 0.32, 2.3, 0.18);
  g.add(pole, banner, part(new THREE.BoxGeometry(0.18, 0.18, 0.02), metal(GOLD, 0.4), 0.68, 2.35, 0.19));
  return g;
}

const face = (obj) => {
  obj.rotation.y = YAW; // face à la caméra
  return obj;
};

export const ICONS = {
  wood: () => ({ object: wood(), view: { frame: 3.2, centerY: 0.35 } }),
  clay: () => ({ object: clayRes(), view: { frame: 3.2, centerY: 0.35 } }),
  iron: () => ({ object: iron(), view: { frame: 3.2, centerY: 0.3 } }),
  wheat: () => ({ object: wheat(), view: { frame: 3, centerY: 0.6 } }),
  spearman: () => ({ object: face(spearman()), view: { frame: 3.4, centerY: 1.35 } }),
  swordsman: () => ({ object: face(swordsman()), view: { frame: 2.9, centerY: 1.1 } }),
  cavalry: () => ({ object: place(cavalry(), 0, 0, 0, YAW - 1.1), view: { frame: 4.4, centerY: 1.5 } }),
  noble: () => ({ object: face(noble()), view: { frame: 3.4, centerY: 1.35 } }),
  scout: () => ({ object: place(scout(), 0, 0, 0, YAW - 1.1), view: { frame: 4.0, centerY: 1.35 } }),
  ram: () => ({ object: place(ram(), 0, 0, 0, YAW - 1.1), view: { frame: 4.8, centerY: 0.9 } }),
};
