import { Container, Graphics, Rectangle, Sprite, Texture } from 'pixi.js';
import type { ArmyKind, MapArmy, MapArmyRelation } from '@aldoria/shared';
import { MARCH_SHEETS } from '../assets';
import { serverNow } from '../game';
import { REL_COLORS, hexToNum } from './mapStyle';

/**
 * Armées en marche sur la carte : une petite colonne de soldats rendus en 3D (fantassins, cavaliers, éclaireurs, noble, bélier),
 * qui marchent au pas derrière le fanion de leur camp, en soulevant un peu de poussière, le long d'un chemin en pointillés.
 * Le serveur n'envoie que le départ, l'arrivée et leurs heures ; la position est recalculée ici, sans autre requête.
 */

const TILE = 64;

export const ARMY_COLORS: Record<MapArmyRelation, string> = {
  own: REL_COLORS.own,
  tribe: REL_COLORS.tribe,
  ally: REL_COLORS.ally,
  threat: REL_COLORS.war,
  guest: REL_COLORS.ally,
  seen: '#e3d6b8',
};

export const ARMY_LABELS: Record<MapArmyRelation, string> = {
  own: 'Vos armées',
  tribe: 'Votre tribu',
  ally: 'Vos alliés',
  threat: 'Attaque contre vous',
  guest: 'Renfort pour vous',
  seen: 'Armée aperçue',
};

interface ArmyScene {
  world: Container;
  armyLayer: Container;
  anims: Set<(t: number) => void>;
  ticks: Set<(t: number) => void>;
  still: boolean;
  request: () => void;
  app: { screen: { width: number; height: number } };
  textures: Record<string, Texture>;
}

const INK = 0x1c140d;

/** Genre d'unité → image de marche (bande de foulées rendue en 3D, voir tools/render) et taille sur la carte. */
const SHEETS: Record<ArmyKind, { key: string; height: number; fps: number; gap: number; hop: number }> = {
  foot: { key: 'marchFoot', height: 21, fps: 6, gap: 9, hop: 0.9 },
  noble: { key: 'marchNoble', height: 22, fps: 6, gap: 9, hop: 0.9 },
  horse: { key: 'marchHorse', height: 25, fps: 8, gap: 15, hop: 0.4 },
  scout: { key: 'marchScout', height: 23, fps: 9, gap: 14, hop: 0.4 },
  ram: { key: 'marchRam', height: 20, fps: 0, gap: 18, hop: 0.5 },
};
const frameCache = new Map<string, Texture[]>();
function framesOf(kind: ArmyKind, textures: Record<string, Texture>): Texture[] {
  const sheet = SHEETS[kind];
  let list = frameCache.get(sheet.key);
  const base = textures[sheet.key];
  if (list && list[0].source === base?.source) return list;
  const meta = MARCH_SHEETS[kind];
  if (!base || !meta) return [];
  // La bande est rendue en pixels « image » ; la texture peut être chargée à une autre résolution.
  const k = base.width / (meta.w * meta.frames);
  list = Array.from({ length: meta.frames }, (_, i) => new Texture({ source: base.source, frame: new Rectangle(i * meta.w * k, 0, meta.w * k, meta.h * k) }));
  frameCache.set(sheet.key, list);
  return list;
}

/** Répartit `count` soldats entre les genres présents (au moins un de chacun), le noble en tête et les béliers derrière. */
function column(kinds: ArmyKind[], count: number): ArmyKind[] {
  const n = Math.max(count, Math.min(kinds.length, 5));
  const out: ArmyKind[] = [...kinds];
  for (let i = 0; out.length < n; i++) out.push(kinds[i % Math.min(kinds.length, i < 2 ? 1 : kinds.length)]);
  const rank = (k: ArmyKind) => (k === 'noble' ? 0 : k === 'ram' ? 2 : 1);
  return out.sort((a, b) => rank(a) - rank(b));
}

interface Member {
  sprite: Sprite;
  frames: Texture[];
  fps: number;
  hop: number;
  y: number;
}

interface Token {
  a: MapArmy;
  node: Container;
  men: Member[];
  flag: Graphics;
  flagColor: number;
  dust: Graphics;
  ring: Graphics | null;
  back: number;
  t0: number;
  t1: number;
  dir: number;
  phase: number;
}

/** Fanion du chef de colonne, qui ondule : queue d'aronde pour une attaque, carré pour un renfort, triangle pour un retour. */
function drawFlag(g: Graphics, type: MapArmy['type'], color: number, t: number) {
  const L = type === 'support' ? 12 : 14;
  const H = 9;
  const wave = (x: number) => Math.sin(t * 7 - x * 0.45) * (x / L) * 1.8;
  const top: number[] = [];
  const bottom: number[] = [];
  for (let i = 0; i <= 6; i++) {
    const x = (L * i) / 6;
    const tip = type === 'support' ? H : type === 'attack' ? H : H * (1 - x / L);
    const y0 = type === 'support' || type === 'attack' ? 0 : (H - tip) / 2;
    top.push(-x, y0 + wave(x));
    bottom.unshift(-x, y0 + tip + wave(x));
  }
  if (type === 'attack') {
    // Queue d'aronde : une encoche au bout.
    bottom.splice(0, 2, -L, H + wave(L), -L + 5, H / 2 + wave(L - 5));
  }
  g.clear().poly([...top, ...bottom]).fill({ color }).stroke({ width: 1, color: INK, alpha: 0.85 });
}

function token(a: MapArmy, color: number, count: number, textures: Record<string, Texture>, t: number): Omit<Token, 't0' | 't1' | 'dir' | 'phase' | 'a'> {
  const node = new Container();
  const kinds = column(a.kinds?.length ? a.kinds : ['foot'], count);
  // Places dans la colonne : en file par deux, de la tête (droite) vers l'arrière.
  const slots: { kind: ArmyKind; x: number; y: number }[] = [];
  let x = 10;
  for (let i = 0; i < kinds.length; i++) {
    const k = kinds[i];
    const spread = k === 'foot' || k === 'noble' ? 3.5 : 5.5;
    const y = kinds.length === 1 ? 0 : i === 0 ? 0 : i % 2 ? -spread : spread;
    slots.push({ kind: k, x, y });
    if (i === 0 || i % 2 === 0) x -= SHEETS[k].gap;
  }
  const back = x;
  const w = (10 - back) / 2 + 6;
  const cx = (10 + back) / 2;
  // Ombre au sol, teintée du camp : la couleur se lit même de loin.
  node.addChild(new Graphics().ellipse(cx, 2, w, 6).fill({ color: 0x000000, alpha: 0.28 }).ellipse(cx, 2, w - 2, 4.4).fill({ color, alpha: a.rel === 'threat' ? 0.6 : 0.42 }));
  let ring: Graphics | null = null;
  if (a.rel === 'threat') {
    ring = new Graphics().ellipse(cx, 2, w + 4, 8).stroke({ width: 1.6, color, alpha: 0.9 });
    node.addChild(ring);
  }
  const dust = new Graphics();
  node.addChild(dust);
  const men: Member[] = [];
  for (const sl of [...slots].sort((p, q) => p.y - q.y)) {
    const frames = framesOf(sl.kind, textures);
    if (!frames.length) continue;
    const sh = SHEETS[sl.kind];
    const sprite = new Sprite(frames[0]);
    sprite.anchor.set(0.5, 0.94);
    sprite.scale.set(sh.height / frames[0].height);
    sprite.position.set(sl.x, sl.y);
    if (a.rel === 'seen') sprite.tint = 0xd8d0c0;
    node.addChild(sprite);
    men.push({ sprite, frames, fps: sh.fps, hop: sh.hop, y: sl.y });
  }
  // Le chef porte le fanion du camp, au bout d'une hampe, qui flotte derrière lui.
  const lead = slots[0];
  const top = lead.y - SHEETS[lead.kind].height - 9;
  node.addChild(new Graphics().moveTo(lead.x - 4, top).lineTo(lead.x - 4, lead.y - 4).stroke({ width: 1.4, color: 0x3a2a1a }));
  const flag = new Graphics();
  flag.position.set(lead.x - 4, top);
  drawFlag(flag, a.type, color, t);
  node.addChild(flag);
  if (a.rel === 'seen') node.alpha = 0.94;
  return { node, men, flag, flagColor: color, dust, ring, back };
}

/** Chemin en pointillés du départ à l'arrivée, avec un repère sur la cible. */
function dashed(g: Graphics, a: MapArmy, color: number) {
  const x0 = a.from.x * TILE;
  const y0 = a.from.y * TILE;
  const x1 = a.to.x * TILE;
  const y1 = a.to.y * TILE;
  const len = Math.hypot(x1 - x0, y1 - y0);
  if (len < 1) return;
  const ux = (x1 - x0) / len;
  const uy = (y1 - y0) / len;
  const dash = 10;
  const gap = len > 4000 ? 18 : 8;
  g.moveTo(x0, y0).lineTo(x1, y1).stroke({ width: 5, color: 0x000000, alpha: 0.16 });
  for (let d = 0; d < len; d += dash + gap) {
    const e = Math.min(len, d + dash);
    g.moveTo(x0 + ux * d, y0 + uy * d).lineTo(x0 + ux * e, y0 + uy * e);
  }
  g.stroke({ width: 2.4, color, alpha: a.rel === 'threat' ? 0.95 : 0.75, cap: 'round' });
  g.circle(x1, y1, 10).stroke({ width: 2, color, alpha: 0.9 });
  if (a.type === 'attack') {
    g.moveTo(x1 - 5, y1 - 5).lineTo(x1 + 5, y1 + 5).moveTo(x1 + 5, y1 - 5).lineTo(x1 - 5, y1 + 5).stroke({ width: 2, color, alpha: 0.9 });
  }
}

/** Dessine les armées et lance leur marche. Renvoie la fonction qui les retire. */
export function drawArmies(s: ArmyScene, armies: MapArmy[]): () => void {
  const layer = new Container();
  s.armyLayer.addChild(layer);
  const paths = new Graphics();
  layer.addChild(paths);
  const big = armies.length > 120;
  const tokens: Token[] = [];
  const t0 = performance.now() / 1000;
  for (const a of armies) {
    const color = hexToNum(ARMY_COLORS[a.rel]);
    if (a.rel !== 'seen') dashed(paths, a, color);
    const count = a.size === 1 ? 1 : a.size === 2 ? (big ? 2 : 3) : big ? 3 : 5;
    const t = token(a, color, count, s.textures, t0);
    layer.addChild(t.node);
    tokens.push({ a, ...t, t0: Date.parse(a.fromAt), t1: Date.parse(a.toAt), dir: a.to.x < a.from.x ? -1 : 1, phase: (a.id % 13) * 0.7 });
  }
  // Foulée de chaque soldat (décalée d'un soldat à l'autre pour que la colonne ne marche pas comme un robot),
  // fanion qui ondule, petits nuages de poussière qui restent en arrière.
  const animate = (tk: Token, t: number) => {
    tk.men.forEach((m, i) => {
      if (m.frames.length > 1) m.sprite.texture = m.frames[Math.floor(t * m.fps + tk.phase * 3 + i * 1.7) % m.frames.length];
      m.sprite.y = m.y - Math.abs(Math.sin(t * m.fps * 0.5 * Math.PI + i)) * m.hop;
    });
    drawFlag(tk.flag, tk.a.type, tk.flagColor, t + tk.phase);
    const d = tk.dust.clear();
    for (let j = 0; j < 3; j++) {
      const age = (t * 0.9 + tk.phase + j / 3) % 1;
      d.circle(tk.back - 2 - age * 10, 2 - age * 3 + (j - 1) * 2.5, 1.6 + age * 3.4).fill({ color: 0xc8b48a, alpha: 0.32 * (1 - age) });
    }
    if (tk.ring) tk.ring.alpha = 0.45 + 0.45 * Math.sin(t * 4);
  };
  const update = (t: number) => {
    const now = serverNow();
    const w = s.world;
    const sc = w.scale.x;
    const k = Math.min(4, Math.max(1.6, 1.2 / sc));
    const vx0 = -w.x / sc - TILE;
    const vy0 = -w.y / sc - TILE;
    const vx1 = (s.app.screen.width - w.x) / sc + TILE;
    const vy1 = (s.app.screen.height - w.y) / sc + TILE;
    for (const tk of tokens) {
      const p = (now - tk.t0) / Math.max(1, tk.t1 - tk.t0);
      if (p < 0 || p >= 1) {
        tk.node.visible = false;
        continue;
      }
      const x = (tk.a.from.x + (tk.a.to.x - tk.a.from.x) * p) * TILE;
      const y = (tk.a.from.y + (tk.a.to.y - tk.a.from.y) * p) * TILE;
      const on = x >= vx0 && x <= vx1 && y >= vy0 && y <= vy1;
      tk.node.visible = on;
      if (!on) continue;
      tk.node.position.set(x, y);
      tk.node.scale.set(tk.dir * k, k);
      if (!s.still) animate(tk, t);
    }
    // Les armées les plus au sud passent devant.
    layer.children.sort((a, b) => (a === paths ? -1 : b === paths ? 1 : a.y - b.y));
  };
  update(performance.now() / 1000);
  const set = s.still ? s.ticks : s.anims;
  if (tokens.length) set.add(update);
  s.request();
  return () => {
    set.delete(update);
    layer.destroy({ children: true });
    s.request();
  };
}
