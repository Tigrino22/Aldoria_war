import type { MapVillage } from '@aldoria/shared';

/** Couleurs fixes de la carte et de la mini-map : elles ne se personnalisent pas. */
export const REL_COLORS = {
  active: '#ffffff',
  own: '#f5c518',
  tribe: '#2f6fdc',
  ally: '#62c8ff',
  war: '#ff2b2b',
  other: '#8c1c1c',
  barbarian: '#9c927f',
} as const;
export type Relation = keyof typeof REL_COLORS;

export const REL_LABELS: Record<Relation, string> = {
  active: 'Village actif',
  own: 'Vos villages',
  tribe: 'Votre tribu',
  ally: 'Tribus alliées',
  war: 'En guerre déclarée',
  other: 'Autres joueurs',
  barbarian: 'Barbares',
};

/** Couleurs proposées pour les repères : aucune ne se confond avec une couleur fixe. */
export const MARK_PALETTE = [
  { name: 'Violet', color: '#a35ee8' },
  { name: 'Orange', color: '#ff8a1f' },
  { name: 'Vert', color: '#35c759' },
  { name: 'Rose', color: '#ff5ca8' },
  { name: 'Turquoise', color: '#14bfae' },
  { name: 'Brun', color: '#9a6630' },
  { name: 'Noir', color: '#1c1c1c' },
  { name: 'Citron', color: '#c6e83a' },
];

/** Un joueur ou une tribu que le joueur a choisi de repérer avec sa propre couleur. */
export interface Mark {
  kind: 'player' | 'tribe';
  id: number;
  name: string;
  color: string;
}

const marksKey = (playerId: number) => `aldoria.map.marks.${playerId}`;
export function readMarks(playerId: number): Mark[] {
  try {
    const raw = JSON.parse(localStorage.getItem(marksKey(playerId)) ?? '[]');
    return Array.isArray(raw) ? raw.filter((m) => m && (m.kind === 'player' || m.kind === 'tribe') && Number.isFinite(m.id)) : [];
  } catch {
    return [];
  }
}
export function writeMarks(playerId: number, marks: Mark[]) {
  try {
    localStorage.setItem(marksKey(playerId), JSON.stringify(marks));
  } catch {
    /* stockage indisponible : les repères ne seront pas gardés */
  }
}

export interface ColorContext {
  playerId: number;
  activeVillageId: number | null;
  tribeId: number | null;
  wars: Set<number>;
  allies: Set<number>;
  playerMarks: Map<number, Mark>;
  tribeMarks: Map<number, Mark>;
}

export function makeColorContext(base: Omit<ColorContext, 'playerMarks' | 'tribeMarks' | 'wars' | 'allies'>, wars: number[], allies: number[], marks: Mark[]): ColorContext {
  return {
    ...base,
    wars: new Set(wars),
    allies: new Set(allies),
    playerMarks: new Map(marks.filter((m) => m.kind === 'player').map((m) => [m.id, m])),
    tribeMarks: new Map(marks.filter((m) => m.kind === 'tribe').map((m) => [m.id, m])),
  };
}

/**
 * Relation d'un village avec le joueur. Les couleurs fixes passent en premier ;
 * un repère ne recolore que les « autres joueurs » (repère de joueur avant repère de tribu).
 */
export function styleOf(v: MapVillage, c: ColorContext): { rel: Relation; color: string; mark: Mark | null } {
  const fixed = (rel: Relation) => ({ rel, color: REL_COLORS[rel], mark: null });
  if (!v.ownerId) return fixed('barbarian');
  if (v.id === c.activeVillageId) return fixed('active');
  if (v.ownerId === c.playerId) return fixed('own');
  if (v.tribeId && v.tribeId === c.tribeId) return fixed('tribe');
  if (v.tribeId && c.allies.has(v.tribeId)) return fixed('ally');
  if (v.tribeId && c.wars.has(v.tribeId)) return fixed('war');
  const mark = c.playerMarks.get(v.ownerId) ?? (v.tribeId ? c.tribeMarks.get(v.tribeId) : undefined);
  if (mark) return { rel: 'other', color: mark.color, mark };
  return fixed('other');
}

export const hexToNum = (hex: string) => parseInt(hex.slice(1), 16);

/** Bruit déterministe : le décor est le même pour tout le monde et à chaque visite. */
export function hash(x: number, y: number) {
  let h = (x * 374761393 + y * 668265263) | 0;
  h = Math.imul(h ^ (h >>> 13), 1274126177);
  return ((h ^ (h >>> 16)) >>> 0) / 4294967296;
}

/** Bruit lissé (valeur interpolée) sur plusieurs octaves : forêts et clairières en massifs plutôt qu'en confettis. */
export function fbm(x: number, y: number, seed = 0) {
  const smooth = (t: number) => t * t * (3 - 2 * t);
  const noise = (px: number, py: number) => {
    const ix = Math.floor(px);
    const iy = Math.floor(py);
    const fx = smooth(px - ix);
    const fy = smooth(py - iy);
    const a = hash(ix + seed, iy);
    const b = hash(ix + 1 + seed, iy);
    const c = hash(ix + seed, iy + 1);
    const d = hash(ix + 1 + seed, iy + 1);
    return a + (b - a) * fx + (c - a) * fy + (a - b - c + d) * fx * fy;
  };
  return noise(x, y) * 0.6 + noise(x * 2.1, y * 2.1) * 0.28 + noise(x * 4.3, y * 4.3) * 0.12;
}

/** Nature d'une case du décor : forêt, colline ou prairie. Partagé entre la carte et la mini-map. */
export function terrainAt(x: number, y: number): 'forest' | 'hill' | 'meadow' {
  if (fbm(x / 7, y / 7, 101) > 0.66) return 'forest';
  if (fbm(x / 9, y / 9, 977) > 0.72) return 'hill';
  return 'meadow';
}

/**
 * Teinte de fond d'une case (variations de prairie, sous-bois plus sombres, terres sèches).
 * Une image de mapSize × mapSize pixels étirée sur la carte : quelques kilo-octets pour tout le relief.
 */
export function terrainCanvas(size: number, kind: 'map' | 'mini'): HTMLCanvasElement {
  const cv = document.createElement('canvas');
  cv.width = cv.height = size;
  const g = cv.getContext('2d')!;
  const img = g.createImageData(size, size);
  for (let y = 0; y < size; y++) {
    for (let x = 0; x < size; x++) {
      const n = fbm(x / 12, y / 12, 31);
      const dry = Math.max(0, fbm(x / 16, y / 16, 555) - 0.6) * 2.4;
      const t = terrainAt(x, y);
      let r: number, gg: number, b: number;
      if (kind === 'map') {
        // Teinte multipliée sur l'herbe : 255 = inchangé.
        const light = 0.86 + n * 0.22;
        r = 255 * light * (1 + dry * 0.25);
        gg = 255 * light * (1 - dry * 0.05);
        b = 255 * light * (1 - dry * 0.35);
        if (t === 'forest') (r *= 0.72), (gg *= 0.8), (b *= 0.72);
      } else {
        const light = 0.85 + n * 0.25;
        r = (88 + dry * 60) * light;
        gg = (128 + dry * 20) * light;
        b = (62 - dry * 10) * light;
        if (t === 'forest') (r = 58 * light), (gg = 100 * light), (b = 52 * light);
        if (t === 'hill') (r *= 1.12), (gg *= 1.05), (b *= 1.0);
      }
      const i = (y * size + x) * 4;
      img.data[i] = Math.min(255, r);
      img.data[i + 1] = Math.min(255, gg);
      img.data[i + 2] = Math.min(255, b);
      img.data[i + 3] = 255;
    }
  }
  g.putImageData(img, 0, 0);
  return cv;
}
