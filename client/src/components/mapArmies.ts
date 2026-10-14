import { Container, Graphics, GraphicsContext } from 'pixi.js';
import type { MapArmy, MapArmyRelation } from '@aldoria/shared';
import { serverNow } from '../game';
import { REL_COLORS, hexToNum } from './mapStyle';

/**
 * Armées en marche sur la carte : un petit groupe de soldats derrière un fanion, qui avance le long d'un chemin en pointillés.
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
}

const INK = 0x1c140d;
const contexts = new Map<string, GraphicsContext>();

/** Un fantassin vu de profil (tourné vers la droite), à la couleur de son camp. Les dessins sont partagés entre toutes les armées. */
function soldier(color: number, spear: boolean): GraphicsContext {
  const key = `s${color}${+spear}`;
  let g = contexts.get(key);
  if (g) return g;
  g = new GraphicsContext()
    .rect(-2.4, 2, 1.7, 4.5)
    .fill({ color: 0x2b2018 })
    .rect(0.7, 2, 1.7, 4.5)
    .fill({ color: 0x2b2018 })
    .roundRect(-3.2, -4.2, 6.4, 7.2, 1.6)
    .fill({ color })
    .stroke({ width: 1, color: INK })
    .circle(0.3, -6.8, 2.5)
    .fill({ color: 0xe9c9a0 })
    .stroke({ width: 0.8, color: INK })
    .rect(-2.3, -9.6, 5.2, 1.8)
    .fill({ color: 0x8a8f96 });
  if (spear) g.moveTo(3.6, -13).lineTo(3.6, 5).stroke({ width: 1.1, color: 0xcfc6b4 }).poly([3.6, -15.5, 2.5, -12.6, 4.7, -12.6]).fill({ color: 0xf0ece2 });
  contexts.set(key, g);
  return g;
}

/** Fanion du chef de colonne : queue d'aronde pour une attaque, carré pour un renfort, triangle pour un retour ou une armée inconnue. */
function pennant(color: number, type: MapArmy['type']): GraphicsContext {
  const key = `p${color}${type}`;
  let g = contexts.get(key);
  if (g) return g;
  const pts =
    type === 'attack' ? [0, 0, -14, 2, -9, 5, -14, 8, 0, 10] : type === 'support' ? [0, 0, -12, 0, -12, 9, 0, 9] : [0, 0, -13, 4.5, 0, 9];
  g = new GraphicsContext().poly(pts).fill({ color }).stroke({ width: 1, color: INK, alpha: 0.9 });
  contexts.set(key, g);
  return g;
}

/** Places des soldats dans la colonne, le chef en tête (vers la droite). */
const FORMATION = [
  [9, 0],
  [-1, -4],
  [-1, 4],
  [-11, -4],
  [-11, 4],
];

interface Token {
  a: MapArmy;
  node: Container;
  men: Graphics[];
  flag: Graphics;
  t0: number;
  t1: number;
  dir: number;
  phase: number;
}

function token(a: MapArmy, color: number, count: number): Omit<Token, 't0' | 't1' | 'dir' | 'phase' | 'a'> {
  const node = new Container();
  const w = 8 + count * 4;
  // Ombre au sol, teintée du camp : la couleur se lit même de loin.
  node.addChild(new Graphics().ellipse(-1, 6, w, 5).fill({ color: 0x000000, alpha: 0.3 }).ellipse(-1, 6, w - 2, 3.6).fill({ color, alpha: a.rel === 'threat' ? 0.55 : 0.35 }));
  const men: Graphics[] = [];
  const spots = FORMATION.slice(0, count).sort((p, q) => p[1] - q[1]);
  for (const [x, y] of spots) {
    const m = new Graphics(soldier(color, !a.scouts));
    m.position.set(x, y);
    node.addChild(m);
    men.push(m);
  }
  // Le chef porte le fanion, qui flotte derrière lui.
  const lead = FORMATION[0];
  node.addChild(new Graphics().moveTo(lead[0] - 3.4, lead[1] - 21).lineTo(lead[0] - 3.4, lead[1] + 3).stroke({ width: 1.3, color: 0x3a2a1a }));
  const flag = new Graphics(pennant(color, a.type));
  flag.position.set(lead[0] - 3.4, lead[1] - 21);
  node.addChild(flag);
  if (a.type === 'return' && count > 1) {
    // Le butin rentre au village : un sac sur le dos du dernier soldat.
    const last = FORMATION[count - 1];
    node.addChild(new Graphics().circle(last[0] - 4, last[1] - 3, 3.2).fill({ color: 0xb08850 }).stroke({ width: 0.9, color: INK }));
  }
  if (a.rel === 'seen') node.alpha = 0.92;
  return { node, men, flag };
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
  for (const a of armies) {
    const color = hexToNum(ARMY_COLORS[a.rel]);
    if (a.rel !== 'seen') dashed(paths, a, color);
    const count = a.size === 1 ? 1 : a.size === 2 ? (big ? 2 : 3) : big ? 3 : 5;
    const t = token(a, color, count);
    layer.addChild(t.node);
    tokens.push({ a, ...t, t0: Date.parse(a.fromAt), t1: Date.parse(a.toAt), dir: a.to.x < a.from.x ? -1 : 1, phase: (a.id % 13) * 0.7 });
  }
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
      if (!s.still) {
        tk.men.forEach((m, i) => (m.pivot.y = Math.abs(Math.sin(t * 7 + tk.phase + i * 1.3)) * 1.6));
        tk.flag.scale.x = 0.82 + 0.18 * Math.sin(t * 5 + tk.phase);
      }
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
