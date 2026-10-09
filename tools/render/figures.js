// Personnages et chevaux réalistes, sculptés en SDF : anatomie, vêtements superposés, armures.
// Repère : le personnage regarde vers +z, pieds à y = 0, environ 1,78 m.
import * as THREE from 'three';
import { mat, mesh, place, group } from './kit.js';
import { rand } from './textures.js';
import {
  blend, carve, cylY, displace, ellipsoid, fbm3, halfSpace, inflate, intersect, limb, roundBox, sdfMesh, shell, smin, sphere, union, wrinkle,
} from './sdf.js';

export const BLUE = 0x34507e, RED = 0x7a2a22, GOLD = 0xb8923a;

// ---------- Matériaux ----------
const M = {
  skin: () => mat('skin', { rough: 0.6, bump: 0.01 }),
  cloth: (color) => mat('cloth', { color, rough: 0.92, bump: 0.015 }),
  wool: (color) => mat('wool', { color, rough: 0.95, bump: 0.02 }),
  quilt: () => mat('quilt', { rough: 0.9, bump: 0.04 }),
  leather: (color = 0xffffff) => mat('leather', { color, rough: 0.7, bump: 0.02 }),
  mail: () => mat('mail', { rough: 0.5, metal: 0.6, bump: 0.06 }),
  steel: (color = 0xffffff) => mat('steel', { color, rough: 0.35, metal: 0.75, bump: 0.005 }),
  hair: (color = 0xffffff) => mat('hair', { color, rough: 0.8, bump: 0.03 }),
  wood: () => mat('planks', { rough: 0.8, bump: 0.02 }),
  coat: (color = 0xffffff) => mat('coat', { color, rough: 0.65, bump: 0.01 }),
  gold: () => mat('steel', { color: 0xe0b040, rough: 0.25, metal: 1 }),
};

// ---------- Squelette ----------

/**
 * Pose d'un personnage debout. Les mains sont libres : `hands.l` / `hands.r` (positions),
 * `elbows` optionnels. `seated` plie les jambes pour un cavalier.
 */
function skeleton({ hands, elbows = {}, seated = false } = {}) {
  const s = {
    pelvis: [0, 0.98, 0],
    chest: [0, 1.3, 0],
    neck: [0, 1.5, 0],
    head: [0, 1.64, 0.01],
    shoulder: { l: [-0.172, 1.42, -0.01], r: [0.172, 1.42, -0.01] },
    hip: { l: [-0.095, 0.94, 0], r: [0.095, 0.94, 0] },
    knee: { l: [-0.11, 0.52, 0.035], r: [0.12, 0.52, 0.0] },
    ankle: { l: [-0.12, 0.085, 0.0], r: [0.14, 0.085, -0.02] },
    toe: { l: [-0.135, 0.04, 0.16], r: [0.16, 0.04, 0.14] },
    hand: { l: hands?.l ?? [-0.24, 0.92, 0.04], r: hands?.r ?? [0.24, 0.92, 0.04] },
  };
  if (seated) {
    // Cuisses vers l'avant et écartées autour du dos du cheval, jambes pendantes.
    s.knee = { l: [-0.3, 0.78, 0.28], r: [0.3, 0.78, 0.28] };
    s.ankle = { l: [-0.31, 0.36, 0.16], r: [0.31, 0.36, 0.16] };
    s.toe = { l: [-0.32, 0.31, 0.3], r: [0.32, 0.31, 0.3] };
    s.hip = { l: [-0.11, 0.96, 0.02], r: [0.11, 0.96, 0.02] };
  }
  // Coude : à mi-chemin, poussé vers l'extérieur et l'arrière, sauf s'il est imposé.
  s.elbow = {};
  for (const side of ['l', 'r']) {
    const sh = s.shoulder[side], h = s.hand[side];
    const out = side === 'l' ? -1 : 1;
    s.elbow[side] = elbows[side] ?? [(sh[0] + h[0]) / 2 + out * 0.06, (sh[1] + h[1]) / 2 - 0.02, (sh[2] + h[2]) / 2 - 0.06];
  }
  return s;
}

// ---------- Formes du corps ----------
function torsoShape(s) {
  return blend(
    0.09,
    ellipsoid([0, 1.31, 0], [0.155, 0.15, 0.105]),
    ellipsoid([0, 1.13, 0.005], [0.14, 0.13, 0.095]),
    ellipsoid([0, 0.97, 0], [0.16, 0.1, 0.11]),
    // Épaules (deltoïdes) et trapèzes qui descendent du cou en pente.
    sphere(s.shoulder.l, 0.05),
    sphere(s.shoulder.r, 0.05),
    limb([-0.04, 1.47, -0.015], s.shoulder.l, 0.035, 0.03),
    limb([0.04, 1.47, -0.015], s.shoulder.r, 0.035, 0.03),
  );
}
const armShape = (s, side) =>
  blend(
    0.03,
    limb(s.shoulder[side], s.elbow[side], 0.055, 0.042),
    limb(s.elbow[side], s.hand[side], 0.042, 0.03),
  );
const upperArm = (s, side) => limb(s.shoulder[side], s.elbow[side], 0.056, 0.044);
const handShape = (s, side) => ellipsoid(s.hand[side], [0.034, 0.045, 0.034]);
const legShape = (s, side) =>
  blend(0.03, limb(s.hip[side], s.knee[side], 0.085, 0.052), limb(s.knee[side], s.ankle[side], 0.052, 0.034));
const footShape = (s, side) => limb(s.ankle[side], s.toe[side], 0.042, 0.036);

function headShape(s) {
  const h = s.head;
  const at = (dx, dy, dz) => [h[0] + dx, h[1] + dy, h[2] + dz];
  const skull = blend(
    0.03,
    ellipsoid(at(0, 0.01, -0.005), [0.085, 0.105, 0.1]),
    ellipsoid(at(0, -0.06, 0.03), [0.066, 0.055, 0.068]), // mâchoire
    limb(at(0, 0.005, 0.088), at(0, -0.03, 0.112), 0.011, 0.017), // nez
    ellipsoid(at(0, 0.03, 0.07), [0.07, 0.018, 0.035]), // arcades
    ellipsoid(at(-0.085, -0.0, 0.0), [0.012, 0.026, 0.016]), // oreilles
    ellipsoid(at(0.085, -0.0, 0.0), [0.012, 0.026, 0.016]),
  );
  const cheeks = blend(0.02, skull, ellipsoid(at(-0.045, -0.02, 0.065), [0.025, 0.02, 0.02]), ellipsoid(at(0.045, -0.02, 0.065), [0.025, 0.02, 0.02]));
  // Orbites creusées et bouche marquée.
  const sockets = carve(carve(cheeks, sphere(at(-0.032, 0.008, 0.096), 0.016), 0.014), sphere(at(0.032, 0.008, 0.096), 0.016), 0.014);
  return carve(sockets, roundBox(at(0, -0.06, 0.1), [0.022, 0.003, 0.02], 0.002), 0.006);
}

/** Barbe courte : fine couche sur la mâchoire et le menton, bouche dégagée. */
function beard(s, t = 0.007) {
  const h = s.head;
  const jaw = intersect(inflate(headShape(s), t), (p) => Math.max(p[1] - (h[1] - 0.035), h[2] - 0.0 - p[2]));
  const mouth = roundBox([h[0], h[1] - 0.06, h[2] + 0.1], [0.024, 0.008, 0.04], 0.006);
  return displace(carve(jaw, mouth), (p) => fbm3(p, 120, 1) * 0.004);
}

/** Yeux : petites sphères sombres au fond des orbites. */
function eyesShape(s) {
  const h = s.head;
  return union(sphere([h[0] - 0.032, h[1] + 0.007, h[2] + 0.071], 0.0105), sphere([h[0] + 0.032, h[1] + 0.007, h[2] + 0.071], 0.0105));
}

function bodyShape(s) {
  return blend(
    0.035,
    torsoShape(s),
    limb(s.neck, [s.head[0], s.head[1] - 0.07, s.head[2]], 0.056, 0.05),
    headShape(s),
    armShape(s, 'l'),
    armShape(s, 'r'),
    handShape(s, 'l'),
    handShape(s, 'r'),
    legShape(s, 'l'),
    legShape(s, 'r'),
    footShape(s, 'l'),
    footShape(s, 'r'),
  );
}

/** Pan de tunique autour des hanches, avec des plis verticaux. */
function skirt(s, bottom, rTop = 0.17, rBottom = 0.24, folds = 0.008) {
  const base = cylY(s.pelvis, bottom, s.pelvis[1] + 0.05, rBottom, rTop);
  return displace(base, (p) => {
    const a = Math.atan2(p[2] - s.pelvis[2], p[0] - s.pelvis[0]);
    const t = Math.max(0, (s.pelvis[1] - p[1]) / (s.pelvis[1] - bottom));
    return Math.sin(a * 11) * folds * t;
  });
}

// ---------- Assemblage ----------

/** Rend un ensemble de couches { shape, material, tex } en maillages. */
function layers(list, opts) {
  const all = union(...list.map((l) => l.shape));
  return group(...list.map((l) => sdfMesh(l.shape, l.material, { ...opts, ...(l.box ?? {}), tex: l.tex, ao: all })));
}

/** Découpe une couche en deux : la tête, maillée bien plus finement (visage), et le reste. */
function splitHead(layer, s, cut = 1.515) {
  const h = s.head;
  return [
    { ...layer, shape: intersect(layer.shape, halfSpace([0, cut, 0], [0, 1, 0])) },
    { ...layer, shape: intersect(layer.shape, halfSpace([0, cut, 0], [0, -1, 0])), box: { center: [h[0], h[1] + 0.03, h[2] + 0.02], size: 0.42, res: 120 } },
  ];
}

/** Silhouette habillée commune : corps, chausses, bottes, tunique. Retourne les couches et le squelette. */
/** Matelassage du gambison : tubes verticaux gonflés, coutures creusées, et une couture à la taille. */
function quilted(f, s, amp = 0.011, n = 11) {
  return (p) => {
    const d = f(p);
    if (d > 0.03) return d;
    const a = Math.atan2(p[2] - s.pelvis[2], p[0] - s.pelvis[0]);
    const tube = Math.sqrt(Math.abs(Math.sin(a * n + fbm3(p, 6, 1) * 0.6)));
    const waist = Math.min(1, Math.abs(p[1] - 1.0) / 0.02);
    return d - amp * (tube * waist - 0.5);
  };
}

function dressedBase(s, { tunic, hose = 0x4a3c2c, skirtBottom = 0.6, boots = true }) {
  const body = bodyShape(s);
  const legs = union(legShape(s, 'l'), legShape(s, 'r'));
  const h = s.head;
  const headBox = { center: [h[0], h[1] + 0.03, h[2] + 0.02], size: 0.42, res: 120 };
  const out = [
    ...splitHead({ shape: body, material: M.skin(), tex: 'skin' }, s),
    { shape: eyesShape(s), material: M.leather(0x6a5a4a), tex: 'leather', box: headBox },
    // Sourcils.
    { shape: union(limb([h[0] - 0.05, h[1] + 0.03, h[2] + 0.085], [h[0] - 0.015, h[1] + 0.032, h[2] + 0.097], 0.006, 0.006), limb([h[0] + 0.05, h[1] + 0.03, h[2] + 0.085], [h[0] + 0.015, h[1] + 0.032, h[2] + 0.097], 0.006, 0.006)), material: M.hair(0xb08860), tex: 'hair', box: headBox },
    {
      shape: wrinkle(intersect(inflate(legs, 0.008), halfSpace([0, 0.95, 0], [0, 1, 0])), 0.003, 12),
      material: M.wool(hose),
      tex: 'wool',
    },
  ];
  if (boots) {
    const feet = union(footShape(s, 'l'), footShape(s, 'r'), intersect(legs, halfSpace([0, 0.3, 0], [0, 1, 0])));
    out.push({ shape: inflate(feet, 0.014), material: M.leather(0x9a8070), tex: 'leather' });
  }
  const tunicShape = intersect(
    blend(0.05, torsoShape(s), limb(s.neck, [0, 1.56, 0.005], 0.058, 0.054), upperArm(s, 'l'), upperArm(s, 'r'), limb(s.elbow.l, s.hand.l, 0.044, 0.034), limb(s.elbow.r, s.hand.r, 0.044, 0.034), skirt(s, skirtBottom)),
    // Manches arrêtées avant les poignets.
    (p) => Math.max(-(Math.hypot(p[0] - s.hand.l[0], p[1] - s.hand.l[1], p[2] - s.hand.l[2]) - 0.07), -(Math.hypot(p[0] - s.hand.r[0], p[1] - s.hand.r[1], p[2] - s.hand.r[2]) - 0.07)),
  );
  let cloth = inflate(tunicShape, 0.018);
  if (tunic.quilted) cloth = quilted(cloth, s);
  cloth = wrinkle(cloth, tunic.wrinkle ?? 0.009, 7);
  // Maillage plus fin que le reste du corps, pour que plis et coutures se voient.
  const top = 1.56, bot = Math.max(0.05, skirtBottom - 0.05), size = Math.max(0.8, top - bot);
  out.push({
    shape: intersect(cloth, halfSpace([0, 1.53, 0], [0, 1, 0])), material: tunic.material, tex: tunic.tex,
    box: { center: [0, (top + bot) / 2, 0.04], size, res: Math.min(240, Math.round(size * 190)) },
  });
  return { out, body, tunicShape };
}

const bbox = { center: [0, 0.95, 0.05], size: 2.1, res: 150 };

// ---------- Unités ----------

function spearmanFig() {
  const s = skeleton({ hands: { r: [0.26, 1.02, 0.14], l: [-0.22, 1.08, 0.2] }, elbows: { l: [-0.27, 1.16, -0.02], r: [0.3, 1.12, -0.02] } });
  const { out, tunicShape } = dressedBase(s, { tunic: { material: M.quilt(), tex: 'quilt', quilted: true }, hose: 0x5a4a36, skirtBottom: 0.56 });
  // Ceinture de cuir.
  out.push({ shape: intersect(inflate(torsoShape(s), 0.03), (p) => Math.abs(p[1] - 1.02) - 0.025), material: M.leather(0x6a4a30), tex: 'leather' });
  // Barbe courte et cheveux.
  const h = s.head;
  out.push({
    shape: intersect(inflate(headShape(s), 0.01), (p) => Math.max(-(p[1] - (h[1] + 0.0)), p[2] - h[2] - 0.05)),
    material: M.hair(0xc89870),
    tex: 'hair',
    box: { center: [h[0], h[1], h[2] + 0.02], size: 0.42, res: 120 },
  });
  out.push({ shape: beard(s), material: M.hair(0xd8a878), tex: 'hair', box: { center: [h[0], h[1], h[2] + 0.02], size: 0.42, res: 120 } });
  // Chapel de fer : calotte et large bord.
  const hat = union(
    intersect(shell(sphere([h[0], h[1] + 0.03, h[2]], 0.112), 0.006), halfSpace([0, h[1] + 0.04, 0], [0, -1, 0])),
    cylY([h[0], 0, h[2]], h[1] + 0.04, h[1] + 0.05, 0.17, 0.15),
  );
  const g = layers([...out, { shape: hat, material: M.steel(0xb8bcc4), tex: 'steel', box: { center: [h[0], h[1] + 0.06, h[2]], size: 0.42, res: 120 } }], bbox);
  // Lance tenue droite, bouclier rond au bras gauche.
  g.add(spear(s.hand.r, 2.3));
  g.add(roundShield([-0.27, 1.06, 0.24], 0.32, BLUE, -0.25));
  return g;
}

function swordsmanFig() {
  const s = skeleton({ hands: { r: [0.24, 1.12, 0.26], l: [-0.2, 1.1, 0.22] }, elbows: { r: [0.3, 1.14, 0.0], l: [-0.28, 1.14, -0.0] } });
  const { out } = dressedBase(s, { tunic: { material: M.quilt(), tex: 'quilt', quilted: true }, hose: 0x3e3a36, skirtBottom: 0.5 });
  // Haubert de mailles par-dessus le gambison, puis surcot aux couleurs du fief.
  const mailShape = intersect(
    inflate(blend(0.05, torsoShape(s), upperArm(s, 'l'), upperArm(s, 'r'), limb(s.elbow.l, s.hand.l, 0.044, 0.036), limb(s.elbow.r, s.hand.r, 0.044, 0.036), skirt(s, 0.56)), 0.03),
    (p) => Math.max(-(Math.hypot(p[0] - s.hand.l[0], p[1] - s.hand.l[1], p[2] - s.hand.l[2]) - 0.08), -(Math.hypot(p[0] - s.hand.r[0], p[1] - s.hand.r[1], p[2] - s.hand.r[2]) - 0.08)),
  );
  out.push({ shape: wrinkle(mailShape, 0.006, 7), material: M.mail(), tex: 'mail' });
  const surcoat = intersect(
    inflate(blend(0.05, torsoShape(s), skirt(s, 0.6, 0.18, 0.26, 0.012)), 0.048),
    // Sans manches : on retire les bras.
    (p) => -(Math.min(upperArm(s, 'l')(p), upperArm(s, 'r')(p)) - 0.07),
  );
  out.push({ shape: intersect(wrinkle(surcoat, 0.008, 7), halfSpace([0, 1.45, 0], [0, 1, 0])), material: M.cloth(BLUE), tex: 'cloth', box: { center: [0, 1.0, 0.04], size: 1.0, res: 190 } });
  out.push({ shape: intersect(inflate(torsoShape(s), 0.058), (p) => Math.abs(p[1] - 1.0) - 0.022), material: M.leather(0x5a3a22), tex: 'leather' });
  // Heaume à fente sur un camail de mailles.
  const h = s.head;
  const helm = carve(
    blend(0.03, cylY([h[0], 0, h[2] + 0.005], h[1] - 0.11, h[1] + 0.07, 0.128, 0.122), sphere([h[0], h[1] + 0.06, h[2] + 0.005], 0.122)),
    union(roundBox([h[0], h[1] + 0.012, h[2] + 0.12], [0.085, 0.009, 0.05], 0.004), roundBox([h[0], h[1] - 0.04, h[2] + 0.12], [0.012, 0.03, 0.05], 0.004)),
  );
  out.push({ shape: helm, material: M.steel(0xc0c4cc), tex: 'steel' });
  out.push({ shape: intersect(inflate(limb(s.neck, [0, 1.6, 0], 0.07, 0.07), 0.02), halfSpace([0, 1.6, 0], [0, 1, 0])), material: M.mail(), tex: 'mail' });
  const g = layers(out, bbox);
  g.add(sword(s.hand.r, [0.55, 0.75, 0.35]));
  g.add(heaterShield([-0.27, 1.06, 0.26], BLUE, -0.3));
  return g;
}

function nobleFig() {
  const s = skeleton({ hands: { r: [0.26, 1.18, 0.12], l: [-0.16, 1.02, 0.12] }, elbows: { r: [0.3, 1.2, -0.04] } });
  const { out } = dressedBase(s, { tunic: { material: M.cloth(0x6a1f3a), tex: 'cloth' }, skirtBottom: 0.12, boots: true });
  // Grande cape de laine rouge tombant des épaules, col d'hermine, couronne.
  const capeVolume = cylY([0, 0, -0.04], 0.1, 1.46, 0.36, 0.2);
  const cape = intersect(intersect(shell(capeVolume, 0.016), halfSpace([0, 0, 0.02], [0, 0, 1])), halfSpace([0, 1.47, 0], [0, 1, 0]));
  out.push({ shape: wrinkle(displace(cape, (p) => Math.sin(Math.atan2(p[2], p[0]) * 9) * 0.014 * Math.max(0, (1.3 - p[1]) / 1.2)), 0.007, 6), material: M.wool(RED), tex: 'wool', box: { center: [0, 0.8, -0.05], size: 1.5, res: 240 } });
  out.push({ shape: intersect(intersect(intersect(inflate(limb([0, 1.45, -0.01], [0, 1.47, -0.01], 0.15, 0.15), 0.025), halfSpace([0, 1.5, 0], [0, 1, 0])), halfSpace([0, 1.39, 0], [0, -1, 0])), halfSpace([0, 0, 0.03], [0, 0, 1])), material: M.wool(0xf0ebe0), tex: 'wool' });
  const h = s.head;
  out.push({ shape: intersect(inflate(headShape(s), 0.014), (p) => Math.max(h[1] + 0.04 - 0.9 * Math.max(0, h[2] + 0.02 - p[2]) - p[1], p[2] - h[2] - 0.06)), material: M.hair(0xb89070), tex: 'hair', box: { center: [h[0], h[1], h[2] + 0.02], size: 0.42, res: 120 } });
  out.push({ shape: beard(s, 0.012), material: M.hair(0xb8a898), tex: 'hair', box: { center: [h[0], h[1], h[2] + 0.02], size: 0.42, res: 120 } });
  out.push({ shape: intersect(inflate(headShape(s), 0.016), halfSpace([0, h[1] + 0.01, 0], [0, -1, 0])), material: M.hair(0xb89070), tex: 'hair', box: { center: [h[0], h[1], h[2] + 0.02], size: 0.42, res: 120 } });
  const crown = union(
    shell(cylY([h[0], 0, h[2]], h[1] + 0.05, h[1] + 0.09, 0.098), 0.008),
    ...[0, 1, 2, 3, 4, 5, 6, 7].map((i) => {
      const a = (i / 8) * Math.PI * 2;
      return sphere([h[0] + Math.cos(a) * 0.098, h[1] + 0.105, h[2] + Math.sin(a) * 0.098], 0.014);
    }),
  );
  out.push({ shape: crown, material: M.gold(), tex: 'steel' });
  const g = layers(out, bbox);
  g.add(banner(s.hand.r, BLUE));
  return g;
}

// ---------- Cheval ----------

function horseShapes({ seatY = 1.42 } = {}) {
  // Jambe articulée : bras (ou cuisse) musclé, genou (ou jarret), canon fin, boulet, paturon.
  const leg = (x, top, elbow, knee, fetlock, hoof, rTop, rKnee) =>
    blend(
      0.035,
      limb([x, ...top], [x, ...elbow], rTop, rTop * 0.75),
      limb([x, ...elbow], [x, ...knee], rTop * 0.7, rKnee),
      sphere([x, ...knee], rKnee * 1.1),
      limb([x, ...knee], [x, ...fetlock], rKnee * 0.82, 0.04),
      sphere([x, ...fetlock], 0.046),
      limb([x, ...fetlock], [x, hoof[0], hoof[1]], 0.036, 0.04),
    );
  const body = blend(
    0.14,
    ellipsoid([0, 1.3, 0.0], [0.25, 0.3, 0.58]),
    ellipsoid([0, 1.3, 0.45], [0.25, 0.33, 0.3]), // poitrail
    ellipsoid([0, 1.36, -0.5], [0.27, 0.3, 0.3]), // croupe
    ellipsoid([-0.13, 1.25, 0.5], [0.12, 0.2, 0.15]), // épaules
    ellipsoid([0.13, 1.25, 0.5], [0.12, 0.2, 0.15]),
    ellipsoid([-0.14, 1.22, -0.55], [0.13, 0.24, 0.2]), // cuisses
    ellipsoid([0.14, 1.22, -0.55], [0.13, 0.24, 0.2]),
  );
  // Encolure épaisse à la base, crinière sur une ligne de dessus arquée.
  const neck = blend(0.08, limb([0, 1.42, 0.55], [0, 1.82, 0.9], 0.22, 0.13), limb([0, 1.62, 0.6], [0, 1.95, 0.88], 0.1, 0.08));
  const head = blend(
    0.05,
    ellipsoid([0, 1.92, 0.98], [0.08, 0.11, 0.12]), // ganache et front
    limb([0, 1.9, 1.02], [0, 1.66, 1.3], 0.075, 0.06), // chanfrein
    ellipsoid([0, 1.65, 1.3], [0.065, 0.06, 0.07]), // naseaux et bouche
    limb([-0.045, 2.02, 0.94], [-0.055, 2.13, 0.93], 0.024, 0.006), // oreilles
    limb([0.045, 2.02, 0.94], [0.055, 2.13, 0.93], 0.024, 0.006),
  );
  const nostrils = union(sphere([-0.04, 1.65, 1.36], 0.014), sphere([0.04, 1.65, 1.36], 0.014));
  const legs = union(
    // Antérieurs : l'un droit, l'autre légèrement avancé.
    leg(-0.14, [1.15, 0.5], [0.95, 0.52], [0.52, 0.55], [0.2, 0.56], [0.03, 0.6], 0.09, 0.045),
    leg(0.14, [1.15, 0.5], [0.95, 0.5], [0.53, 0.44], [0.2, 0.4], [0.03, 0.43], 0.09, 0.045),
    // Postérieurs : jarret coudé vers l'arrière.
    leg(-0.15, [1.2, -0.52], [0.85, -0.5], [0.58, -0.68], [0.2, -0.62], [0.03, -0.58], 0.12, 0.05),
    leg(0.15, [1.2, -0.52], [0.85, -0.52], [0.58, -0.72], [0.2, -0.68], [0.03, -0.65], 0.12, 0.05),
  );
  const coat = carve(blend(0.07, body, neck, head, legs), nostrils, 0.01);
  const hooves = union(...[[-0.14, 0.6], [0.14, 0.43], [-0.15, -0.58], [0.15, -0.65]].map(([x, z]) => cylY([x, 0, z], 0, 0.08, 0.06, 0.048)));
  const crest = (p) => 1.6 + (p[2] - 0.55) * 1.15;
  const mane = displace(intersect(shell(inflate(neck, 0.02), 0.035), (p) => -(p[1] - crest(p) - 0.08)), (p) => Math.sin(p[2] * 90 + p[1] * 30) * 0.01);
  const forelock = limb([0, 2.03, 0.98], [0, 1.95, 1.06], 0.03, 0.02);
  const tail = displace(blend(0.05, limb([0, 1.52, -0.8], [0, 1.25, -0.98], 0.06, 0.08), limb([0, 1.25, -0.98], [0, 0.72, -1.0], 0.08, 0.1)), (p) => Math.sin(p[0] * 70 + p[2] * 40) * 0.012);
  return { coat, hooves, hair: union(mane, forelock, tail), body, seatY };
}

function horseMeshes({ color = 0xffffff, caparison = null }) {
  const h = horseShapes();
  const opts = { center: [0, 1.15, 0.05], size: 2.7, res: 160 };
  const list = [
    { shape: h.coat, material: M.coat(color), tex: 'coat' },
    { shape: h.hooves, material: M.leather(0x3a3a3a), tex: 'leather' },
    { shape: h.hair, material: M.hair(0xa08878), tex: 'hair' },
    // Selle et tapis.
    { shape: intersect(inflate(h.body, 0.03), (p) => Math.max(Math.abs(p[2] + 0.02) - 0.24, 1.48 - p[1])), material: M.leather(0x7a5032), tex: 'leather' },
  ];
  if (caparison) {
    // Caparaçon : drap tombant des flancs, plis verticaux qui s'ouvrent vers le bas.
    const hang = (p) => Math.max(0, 1.3 - p[1]) * 0.12;
    const capVol = (p) => h.body([p[0] * (1 - hang(p)), p[1], p[2]]);
    const cap = intersect(intersect(shell(inflate(capVol, 0.05), 0.012), (p) => Math.max(0.9 - p[1], p[1] - 1.58)), (p) => Math.abs(p[2] + 0.02) - 0.64);
    list.push({ shape: wrinkle(displace(cap, (p) => Math.sin(p[2] * 38) * 0.012 * Math.max(0, 1.35 - p[1]) * 2), 0.006, 6), material: M.cloth(caparison), tex: 'cloth' });
  }
  return layers(list, opts);
}

function riderOn(horse, riderBuilder) {
  const r = riderBuilder();
  r.position.set(0, 0.7, -0.06);
  horse.add(r);
  return horse;
}

function cavalryFig() {
  const horse = horseMeshes({ color: 0x8a7a72, caparison: BLUE });
  return riderOn(horse, () => {
    const s = skeleton({ seated: true, hands: { r: [0.24, 1.12, 0.3], l: [-0.12, 1.05, 0.34] } });
    const { out } = dressedBase(s, { tunic: { material: M.quilt(), tex: 'quilt', quilted: true }, hose: 0x3e3a36, skirtBottom: 0.85 });
    out.push({
      shape: inflate(blend(0.05, torsoShape(s), upperArm(s, 'l'), upperArm(s, 'r')), 0.03),
      material: M.mail(),
      tex: 'mail',
    });
    out.push({ shape: intersect(inflate(torsoShape(s), 0.046), halfSpace([0, 1.45, 0], [0, 1, 0])), material: M.cloth(BLUE), tex: 'cloth' });
    const h = s.head;
    const helm = union(
      blend(0.02, cylY([h[0], 0, h[2]], h[1] - 0.05, h[1] + 0.05, 0.118), limb([h[0], h[1] + 0.05, h[2]], [h[0], h[1] + 0.15, h[2] - 0.01], 0.118, 0.02)),
      roundBox([h[0], h[1] - 0.02, h[2] + 0.12], [0.012, 0.05, 0.012], 0.005),
    );
    out.push({ shape: helm, material: M.steel(0xc0c4cc), tex: 'steel' });
    const g = layers(out, bbox);
    const lance = spear(s.hand.r, 2.7);
    lance.rotation.x = 1.05;
    lance.position.set(s.hand.r[0], s.hand.r[1], s.hand.r[2]);
    g.add(lance);
    g.add(heaterShield([-0.29, 1.12, 0.12], BLUE, -1.0));
    return g;
  });
}

function scoutFig() {
  const horse = horseMeshes({ color: 0xffffff });
  return riderOn(horse, () => {
    const s = skeleton({ seated: true, hands: { r: [0.16, 1.05, 0.36], l: [-0.14, 1.05, 0.36] } });
    const { out } = dressedBase(s, { tunic: { material: M.leather(0xb09070), tex: 'leather' }, hose: 0x3a3428, skirtBottom: 0.85 });
    const h = s.head;
    // Cape et capuche vertes.
    // Capuche : coque autour de la tête, ouverte sur le visage, qui retombe sur les épaules.
    const hoodVol = blend(0.04, inflate(headShape(s), 0.03), limb([0, 1.5, -0.01], [0, 1.43, -0.02], 0.09, 0.15));
    const hood = carve(shell(hoodVol, 0.01), ellipsoid([h[0], h[1] - 0.02, h[2] + 0.1], [0.07, 0.09, 0.08]), 0.02);
    const cape = intersect(shell(cylY([0, 0, -0.03], 0.8, 1.48, 0.34, 0.2), 0.012), halfSpace([0, 0, 0.03], [0, 0, 1]));
    out.push({ shape: wrinkle(hood, 0.004, 10), material: M.wool(0x6a7a58), tex: 'wool', box: { center: [h[0], h[1] - 0.04, h[2]], size: 0.5, res: 130 } });
    out.push({ shape: wrinkle(intersect(cape, halfSpace([0, 1.46, 0], [0, 1, 0])), 0.006, 7), material: M.wool(0x6a7a58), tex: 'wool' });
    const g = layers(out, bbox);
    // Arc court en bandoulière.
    const bow = mesh(new THREE.TorusGeometry(0.42, 0.012, 6, 24, Math.PI * 0.9), M.wood());
    bow.position.set(0.0, 1.25, -0.16);
    bow.rotation.set(0, 0, 1.2);
    g.add(bow);
    return g;
  });
}

// ---------- Objets tenus (géométrie classique, matières réalistes) ----------

function spear(handPos, length) {
  const g = new THREE.Group();
  const shaft = mesh(new THREE.CylinderGeometry(0.016, 0.019, length, 8), M.wood());
  shaft.position.y = length / 2 - 0.9;
  const head = mesh(new THREE.ConeGeometry(0.035, 0.26, 4), M.steel(0xd0d2d6));
  head.scale.set(1, 1, 0.35);
  head.position.y = length - 0.9 + 0.13;
  g.add(shaft, head);
  g.position.set(handPos[0], handPos[1], handPos[2]);
  return g;
}

function sword(handPos, dir) {
  const g = new THREE.Group();
  const shape = new THREE.Shape();
  shape.moveTo(-0.026, 0);
  shape.lineTo(0.026, 0);
  shape.lineTo(0.018, 0.78);
  shape.lineTo(0, 0.86);
  shape.lineTo(-0.018, 0.78);
  shape.closePath();
  const blade = mesh(new THREE.ExtrudeGeometry(shape, { depth: 0.006, bevelEnabled: true, bevelSize: 0.004, bevelThickness: 0.003, bevelSegments: 1 }), M.steel(0xe0e2e6));
  blade.position.set(0, 0.06, -0.003);
  const guard = mesh(new THREE.BoxGeometry(0.2, 0.022, 0.03), M.steel(0x9a9ca0));
  guard.position.y = 0.05;
  const grip = mesh(new THREE.CylinderGeometry(0.016, 0.016, 0.11, 8), M.leather(0x3a2416));
  const pommel = mesh(new THREE.SphereGeometry(0.026, 10, 8), M.steel(0x9a9ca0));
  pommel.position.y = -0.065;
  g.add(blade, guard, grip, pommel);
  g.position.set(handPos[0], handPos[1], handPos[2]);
  g.lookAt(handPos[0] + dir[0], handPos[1] + dir[1], handPos[2] + dir[2]);
  g.rotateX(Math.PI / 2);
  return g;
}

function paintedWood(color) {
  // Peinture sur bois : teinte franche, grain à peine visible.
  return mat('paint', { color, rough: 0.75, bump: 0.03 });
}

function roundShield(c, r, color, rotY) {
  const g = new THREE.Group();
  const board = mesh(new THREE.CylinderGeometry(r, r, 0.025, 32), paintedWood(color));
  board.rotation.x = Math.PI / 2;
  const rim = mesh(new THREE.TorusGeometry(r, 0.014, 6, 40), M.leather(0x5a3a22));
  const boss = mesh(new THREE.SphereGeometry(0.075, 16, 10, 0, Math.PI * 2, 0, Math.PI / 2), M.steel(0xb0b4ba));
  boss.rotation.x = Math.PI / 2;
  boss.position.z = 0.012;
  g.add(board, rim, boss);
  g.position.set(...c);
  g.rotation.y = rotY;
  return g;
}

function heaterShield(c, color, rotY) {
  const shape = new THREE.Shape();
  shape.moveTo(-0.27, 0.3);
  shape.lineTo(0.27, 0.3);
  shape.quadraticCurveTo(0.27, -0.18, 0, -0.42);
  shape.quadraticCurveTo(-0.27, -0.18, -0.27, 0.3);
  const geo = new THREE.ExtrudeGeometry(shape, { depth: 0.03, bevelEnabled: true, bevelSize: 0.012, bevelThickness: 0.01, bevelSegments: 2, curveSegments: 16 });
  // Bombé : on courbe le bouclier.
  const p = geo.attributes.position;
  for (let i = 0; i < p.count; i++) p.setZ(i, p.getZ(i) - p.getX(i) * p.getX(i) * 0.6);
  geo.computeVertexNormals();
  const g = new THREE.Group();
  g.add(mesh(geo, paintedWood(color)));
  const band = mesh(new THREE.BoxGeometry(0.07, 0.5, 0.012), M.gold());
  band.position.set(0, 0.0, 0.045);
  g.add(band);
  const band2 = mesh(new THREE.BoxGeometry(0.4, 0.06, 0.012), M.gold());
  band2.position.set(0, 0.1, 0.035);
  g.add(band2);
  g.position.set(...c);
  g.rotation.y = rotY;
  return g;
}

/** Étendard du fief : champ de couleur, tour d'or, bordure et franges, un peu passé. */
function bannerTexture(color) {
  const c = document.createElement('canvas');
  c.width = 256;
  c.height = 384;
  const g = c.getContext('2d');
  g.fillStyle = '#' + new THREE.Color(color).getHexString();
  g.fillRect(0, 0, 256, 384);
  g.strokeStyle = '#c9a23e';
  g.lineWidth = 10;
  g.strokeRect(10, 10, 236, 364);
  g.fillStyle = '#d8b24a';
  g.strokeStyle = '#3b2a1a';
  g.lineWidth = 5;
  // Tour crénelée (même emblème que l'icône du jeu).
  g.beginPath();
  g.moveTo(68, 270); g.lineTo(68, 150); g.lineTo(96, 150); g.lineTo(96, 126); g.lineTo(116, 126); g.lineTo(116, 150);
  g.lineTo(140, 150); g.lineTo(140, 126); g.lineTo(160, 126); g.lineTo(160, 150); g.lineTo(188, 150); g.lineTo(188, 270); g.closePath();
  g.fill();
  g.stroke();
  g.fillStyle = '#3b2a1a';
  g.beginPath();
  g.moveTo(110, 270); g.lineTo(110, 225); g.arc(128, 225, 18, Math.PI, 0); g.lineTo(146, 270); g.closePath();
  g.fill();
  // Usure : tissu délavé par endroits.
  for (let i = 0; i < 400; i++) {
    g.fillStyle = `rgba(${rand() < 0.5 ? '255,255,240' : '0,0,0'},0.05)`;
    g.fillRect(rand() * 256, rand() * 384, 2 + rand() * 20, 1 + rand() * 3);
  }
  const t = new THREE.CanvasTexture(c);
  t.colorSpace = THREE.SRGBColorSpace;
  return t;
}

function banner(handPos, color) {
  const g = new THREE.Group();
  const pole = mesh(new THREE.CylinderGeometry(0.016, 0.018, 2.6, 8), M.wood());
  pole.position.y = 1.3 - 1.0;
  const geo = new THREE.PlaneGeometry(0.55, 0.8, 12, 12);
  const p = geo.attributes.position;
  for (let i = 0; i < p.count; i++) {
    const x = p.getX(i) + 0.28, y = p.getY(i);
    p.setZ(i, Math.sin(x * 9 + y * 2) * 0.05 * x + Math.sin(x * 23) * 0.008);
  }
  geo.computeVertexNormals();
  const cloth = mesh(geo, new THREE.MeshStandardMaterial({ roughness: 0.9, side: THREE.DoubleSide, map: bannerTexture(color), bumpMap: mat('cloth').map, bumpScale: 0.01 }));
  cloth.position.set(0.3, 2.6 - 1.0 - 0.45, 0);
  const fin = mesh(new THREE.ConeGeometry(0.03, 0.1, 6), M.gold());
  fin.position.y = 2.6 - 1.0 + 0.05;
  g.add(pole, cloth, fin);
  g.position.set(...handPos);
  return g;
}

export const FIGURES = { spearman: spearmanFig, swordsman: swordsmanFig, noble: nobleFig, cavalry: cavalryFig, scout: scoutFig };
