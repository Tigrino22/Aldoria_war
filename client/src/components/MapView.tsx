import { useCallback, useEffect, useLayoutEffect, useMemo, useRef, useState } from 'react';
import { Application, Assets, BitmapText, Container, Graphics, GraphicsContext, Sprite, TextStyle, Texture, TilingSprite } from 'pixi.js';
import { PROVINCE_BONUS_LABEL, provinceGrid, type MapArmy, type MapMovement, type MapRelations, type MapVillage, type ProvincesState } from '@aldoria/shared';
import { api } from '../api';
import { MAP_IMG } from '../assets';
import { useGame } from '../game';
import SendTroops from './SendTroops';
import MapVillageCard from './MapVillageCard';
import MapColors from './MapColors';
import { CrusadeMapHud } from './CrusadeBanner';
import { PlayerLink } from '../ui';
import { REL_COLORS, hash, hexToNum, makeColorContext, readMarks, styleOf, terrainAt, terrainCanvas, writeMarks, type ColorContext, type Mark } from './mapStyle';
import { ARMY_COLORS, ARMY_LABELS, drawArmies, pickArmy } from './mapArmies';
import ArmyCard from './ArmyCard';
import './map.css';

const TILE = 64;
/** Côté (en cases) d'un bloc de décor ou de villages : seuls les blocs à l'écran sont dessinés. */
const CHUNK = 10;
const MIN_ZOOM = 0.15;
const MAX_ZOOM = 2;
/** En dessous de ce zoom, les villages deviennent des pastilles colorées (vue d'ensemble lisible et rapide). */
const LOD_ZOOM = 0.42;
const NAME_ZOOM = 0.6;
const NO_RELATIONS: MapRelations = { warTribeIds: [], allyTribeIds: [] };

/** Dernière carte reçue : la rouvrir s'affiche tout de suite, la mise à jour arrive ensuite. */
let cache: { villages: MapVillage[]; relations: MapRelations; movements: MapMovement[]; armies: MapArmy[]; provinces: ProvincesState | null } | null = null;

/** Préférences d'affichage de la carte, gardées dans le navigateur. */
function readPref(key: string, fallback: boolean): boolean {
  try {
    const v = localStorage.getItem(`aldoria.map.${key}`);
    return v === null ? fallback : v === '1';
  } catch {
    return fallback;
  }
}
function writePref(key: string, on: boolean) {
  try {
    localStorage.setItem(`aldoria.map.${key}`, on ? '1' : '0');
  } catch {
    /* stockage indisponible : la préférence ne sera pas gardée */
  }
}

interface Scene {
  app: Application;
  world: Container;
  decoChunks: Container[];
  villageChunks: Container[];
  dots: Graphics;
  fineGrid: Graphics;
  strongGrid: Container;
  overlay: Graphics;
  textures: Record<string, Texture>;
  shapes: { ring: GraphicsContext; relic: GraphicsContext; shadow: GraphicsContext; attack: GraphicsContext; threat: GraphicsContext; support: GraphicsContext };
  /** Sprites de décor par case, masqués sous les villages. */
  decoAt: Map<string, Sprite[]>;
  /** Villages déjà dessinés, avec la signature de leur apparence pour ne redessiner que ce qui change. */
  drawn: Map<number, { node: Container; sig: string; chunk: number }>;
  /** Pastilles de la vue d'ensemble, redessinées à taille constante quand le zoom change. */
  dotsFor: { v: MapVillage; st: ReturnType<typeof styleOf> }[];
  dotsScale: number;
  request: () => void;
  /** Animations en cours (Citadelle : halo de l'assaut, étendard au vent), jouées à petite cadence seulement quand il y en a. */
  anims: Set<(t: number) => void>;
  /** Mises à jour de position (armées en marche) : jouées aussi quand l'animation est réduite, une fois par seconde. */
  ticks: Set<(t: number) => void>;
  /** L'appareil demande moins d'animations : les armées glissent sans balancer. */
  still: boolean;
  /** Calque des armées en marche (au-dessus des villages). */
  armyLayer: Container;
  /** Provinces : teinte des provinces tenues, frontières (fines de près, épaisses en vue d'ensemble), halo des bastions et noms. */
  provinceLayer: { root: Container; fill: Graphics; halos: Graphics; near: Graphics; far: Graphics; labels: Container };
  /**
   * Styles de texte partagés, un par apparence. Avec un contour, Pixi fabrique une police bitmap (et ses canevas) pour chaque objet
   * de style et ne la libère jamais : recréer les styles à chaque mise à jour de la carte remplissait la mémoire jusqu'au plantage
   * de l'onglet sur iPhone.
   */
  /** Halos des bastions tenus, par case « x,y » : repris en vue d'ensemble à taille constante sous les pastilles. */
  halos: Map<string, { color: number; alpha: number }>;
  textStyle: (key: string, make: () => ConstructorParameters<typeof TextStyle>[0]) => TextStyle;
  centerOn: (x: number, y: number) => void;
  zoomBy: (factor: number) => void;
}

export default function MapView({ focus }: { focus?: string }) {
  const { me, world, village, villageId, run } = useGame();
  const stageRef = useRef<HTMLDivElement>(null);
  const hostRef = useRef<HTMLDivElement>(null);
  const tipRef = useRef<HTMLDivElement>(null);
  const miniRef = useRef<HTMLCanvasElement>(null);
  const [villages, setVillages] = useState<MapVillage[]>(cache?.villages ?? []);
  const [relations, setRelations] = useState<MapRelations>(cache?.relations ?? NO_RELATIONS);
  const [movements, setMovements] = useState<MapMovement[]>(cache?.movements ?? []);
  const [armies, setArmies] = useState<MapArmy[]>(cache?.armies ?? []);
  const [marks, setMarks] = useState<Mark[]>(() => readMarks(me.player.id));
  const [selected, setSelected] = useState<MapVillage | null>(null);
  const [hovered, setHovered] = useState<MapVillage | null>(null);
  const [cell, setCell] = useState<{ x: number; y: number } | null>(null);
  const [ready, setReady] = useState(false);
  const [jump, setJump] = useState('');
  const [panel, setPanel] = useState(false);
  const [showGrid, setShowGrid] = useState(() => readPref('grid', true));
  const [showMini, setShowMini] = useState(() => readPref('mini', true));
  const [showArmies, setShowArmies] = useState(() => readPref('armies', true));
  const [showProvinces, setShowProvinces] = useState(() => readPref('provinces', true));
  const [provinces, setProvinces] = useState<ProvincesState | null>(cache?.provinces ?? null);
  const scene = useRef<Scene | null>(null);
  // Le navigateur peut jeter le contexte graphique de la carte (iOS le fait souvent quand on change d'application) : la scène
  // est alors reconstruite (`epoch`). La mini-map, dessinée sur des canevas 2D que Safari vide aussi, se refait au retour (`miniEpoch`).
  const [epoch, setEpoch] = useState(0);
  const [miniEpoch, setMiniEpoch] = useState(0);
  /** Position et zoom de la vue, gardés quand la scène est reconstruite. */
  const viewRef = useRef<{ x: number; y: number; scale: number } | null>(null);
  const villagesRef = useRef<Map<string, MapVillage>>(new Map());
  const [armySel, setArmySel] = useState<MapArmy | null>(null);
  const selectRef = useRef<(v: MapVillage | null) => void>(() => undefined);
  selectRef.current = (v) => {
    setSelected(v);
    setArmySel(null);
  };
  // Une armée sous le doigt passe avant le village de la case.
  const pickArmyRef = useRef<(fx: number, fy: number, scale: number) => boolean>(() => false);
  pickArmyRef.current = (fx, fy, scale) => {
    const a = showArmies ? pickArmy(armies, fx, fy, scale) : null;
    if (!a) return false;
    setArmySel(a);
    setSelected(null);
    return true;
  };
  const hoverRef = useRef<(v: MapVillage | null, c: { x: number; y: number } | null) => void>(() => undefined);
  hoverRef.current = (v, c) => {
    setHovered(v);
    setCell(c);
  };

  const colors = useMemo(
    () => makeColorContext({ playerId: me.player.id, activeVillageId: villageId, tribeId: me.player.tribe?.id ?? null }, relations.warTribeIds, relations.allyTribeIds, marks),
    [me.player.id, villageId, me.player.tribe?.id, relations, marks],
  );
  const colorsRef = useRef<ColorContext>(colors);
  colorsRef.current = colors;
  const showMiniRef = useRef(showMini);
  showMiniRef.current = showMini;
  const showGridRef = useRef(showGrid);
  showGridRef.current = showGrid;

  const load = useCallback(
    () =>
      run(async () => {
        const [list, rel, moves, marching, prov] = await Promise.all([
          api<MapVillage[]>('/api/map'),
          api<MapRelations>('/api/map/relations').catch(() => NO_RELATIONS),
          api<MapMovement[]>('/api/map/movements').catch(() => []),
          api<MapArmy[]>('/api/map/armies').catch(() => []),
          api<ProvincesState>('/api/provinces').catch(() => null),
        ]);
        cache = { villages: list, relations: rel, movements: moves, armies: marching, provinces: prov };
        setProvinces(prov);
        setVillages(list);
        setRelations(rel);
        setMovements(moves);
        setArmies(marching);
        // La fiche ouverte suit l'armée rechargée (composition dévoilée en approchant) ou se ferme si elle est arrivée.
        setArmySel((cur) => (cur ? (marching.find((a) => a.id === cur.id) ?? null) : null));
      }),
    [run],
  );
  // Pendant l'assaut d'une croisade, la carte se met à jour toutes les 10 secondes (sinon toutes les 30).
  const assault = villages.some((v) => v.crusade && Date.now() >= Date.parse(v.crusade.opensAt) - 60_000);
  useEffect(() => {
    load();
    const t = setInterval(load, assault ? 10_000 : 30_000);
    return () => clearInterval(t);
  }, [load, assault]);

  const citadel = villages.find((v) => v.kind === 'citadel' && v.crusade);

  const updateMarks = (next: Mark[]) => {
    setMarks(next);
    writeMarks(me.player.id, next);
  };

  // La carte occupe toute la hauteur disponible sous l'en-tête (et au-dessus de la navigation sur téléphone).
  useLayoutEffect(() => {
    const fit = () => {
      const el = stageRef.current;
      if (!el) return;
      const nav = document.querySelector<HTMLElement>('.nav');
      const navH = nav && getComputedStyle(nav).position === 'fixed' ? nav.offsetHeight : 0;
      const top = el.getBoundingClientRect().top + window.scrollY;
      el.style.height = `${Math.max(360, window.innerHeight - top - navH - (navH ? 0 : 16))}px`;
    };
    fit();
    window.addEventListener('resize', fit);
    return () => window.removeEventListener('resize', fit);
  }, []);

  // Mini-map : un fond précalculé (relief + villages), recopié à chaque image avec le cadre de la vue.
  const miniBase = useRef<HTMLCanvasElement | null>(null);
  // eslint-disable-next-line react-hooks/exhaustive-deps
  const miniTerrain = useMemo(() => terrainCanvas(world.mapSize, 'mini'), [world.mapSize, miniEpoch, epoch]);
  const drawMini = useCallback(() => {
    const cv = miniRef.current;
    const s = scene.current;
    const base = miniBase.current;
    if (!cv || !s || !base) return;
    const dpr = Math.min(2, window.devicePixelRatio || 1);
    const css = cv.clientWidth || 1;
    if (cv.width !== Math.round(css * dpr)) cv.width = cv.height = Math.round(css * dpr);
    const W = cv.width;
    const g = cv.getContext('2d')!;
    g.imageSmoothingEnabled = true;
    g.drawImage(base, 0, 0, W, W);
    const k = W / world.mapSize;
    const sc = s.world.scale.x * TILE;
    const x0 = (-s.world.x / sc) * k;
    const y0 = (-s.world.y / sc) * k;
    const w = (s.app.screen.width / sc) * k;
    const h = (s.app.screen.height / sc) * k;
    g.fillStyle = 'rgba(255,255,255,.12)';
    g.fillRect(x0, y0, w, h);
    g.strokeStyle = '#f3e2b3';
    g.lineWidth = 1.5 * dpr;
    g.strokeRect(x0, y0, w, h);
  }, [world.mapSize]);
  const drawMiniRef = useRef(drawMini);
  drawMiniRef.current = drawMini;

  // Création de la scène PixiJS (une seule fois). Rien n'est redessiné tant que la vue ne bouge pas.
  useEffect(() => {
    const host = hostRef.current!;
    let destroyed = false;
    const app = new Application();
    const cleanups: (() => void)[] = [];

    (async () => {
      // Après une perte du contexte, les images sont rechargées : celles du cache ont pu perdre leurs pixels.
      if (epoch > 0) await Promise.all(Object.values(MAP_IMG).map((src) => Assets.unload(src).catch(() => undefined)));
      if (destroyed) return;
      const assets = Promise.all(
        Object.entries(MAP_IMG).map(async ([k, src]) => [k, (await Assets.load(k === 'flag' ? { src, data: { resolution: 3 } } : src)) as Texture] as const),
      );
      await app.init({
        resizeTo: host,
        background: '#24301a',
        antialias: true,
        autoStart: false,
        preference: 'webgl',
        resolution: Math.min(2, window.devicePixelRatio || 1),
        autoDensity: true,
      });
      const textures: Record<string, Texture> = Object.fromEntries(await assets);
      if (destroyed) return app.destroy(true);
      host.appendChild(app.canvas);

      const size = world.mapSize;
      const full = size * TILE;
      const worldC = new Container();
      app.stage.addChild(worldC);

      // Prairie : herbe répétée, teintée par une image du relief (variations, sous-bois, terres sèches).
      const meadow = new TilingSprite({ texture: textures.ground, width: full, height: full });
      meadow.tileScale.set((TILE * 4) / textures.ground.width);
      worldC.addChild(meadow);
      const tint = new Sprite(Texture.from(terrainCanvas(size, 'map')));
      tint.texture.source.scaleMode = 'linear';
      tint.width = tint.height = full;
      tint.blendMode = 'multiply';
      worldC.addChild(tint);

      const fineGrid = new Graphics();
      for (let i = 0; i <= size; i++) {
        fineGrid.moveTo(i * TILE, 0).lineTo(i * TILE, full);
        fineGrid.moveTo(0, i * TILE).lineTo(full, i * TILE);
      }
      fineGrid.stroke({ width: 1, color: 0x000000, alpha: 0.06 });
      worldC.addChild(fineGrid);

      // Décor en massifs : forêts denses, collines groupées, quelques arbres isolés. Rangé par blocs.
      const n = Math.ceil(size / CHUNK);
      const decoChunks: Container[] = [];
      const decoAt = new Map<string, Sprite[]>();
      const decoLayer = new Container();
      for (let i = 0; i < n * n; i++) decoLayer.addChild((decoChunks[i] = new Container()));
      for (let x = 0; x < size; x++) {
        for (let y = 0; y < size; y++) {
          const kind = terrainAt(x, y);
          const list: Sprite[] = [];
          const add = (tex: Texture, scale: number, dx: number, dy: number) => {
            const s = new Sprite(tex);
            s.anchor.set(0.5, 0.62);
            s.width = s.height = TILE * scale;
            s.position.set(x * TILE + TILE / 2 + dx * TILE, y * TILE + TILE / 2 + dy * TILE);
            list.push(s);
          };
          if (kind === 'forest') {
            const count = 3 + Math.floor(hash(x, y + 5) * 2);
            for (let t = 0; t < count; t++) add(textures.trees, 0.55 + hash(x + t, y) * 0.2, (hash(x * 3 + t, y) - 0.5) * 0.55, (hash(x, y * 3 + t) - 0.5) * 0.5 + (t - count / 2) * 0.12);
          } else if (kind === 'hill' && hash(x + 11, y) < 0.55) {
            add(textures.hill, 0.85 + hash(x, y + 9) * 0.25, (hash(x + 2, y) - 0.5) * 0.2, 0);
          } else if (hash(y + 7, x + 13) < 0.035) {
            add(textures.trees, 0.6 + hash(x, y + 3) * 0.2, (hash(x + 4, y) - 0.5) * 0.3, (hash(x, y + 4) - 0.5) * 0.3);
          }
          if (!list.length) continue;
          list.sort((a, b) => a.y - b.y);
          const chunk = decoChunks[Math.floor(y / CHUNK) * n + Math.floor(x / CHUNK)];
          list.forEach((s) => chunk.addChild(s));
          decoAt.set(`${x},${y}`, list);
        }
      }
      worldC.addChild(decoLayer);

      // Quadrillage des 10 cases, avec repères x|y (affichable à la demande).
      const strongGrid = new Container();
      const lines = new Graphics();
      for (let i = 0; i <= size; i += 10) {
        lines.moveTo(i * TILE, 0).lineTo(i * TILE, full);
        lines.moveTo(0, i * TILE).lineTo(full, i * TILE);
      }
      lines.stroke({ width: 2, color: 0x1c140c, alpha: 0.35 });
      strongGrid.addChild(lines);
      // Un seul style partagé : avec un contour, Pixi crée une police bitmap par objet TextStyle (une centaine sinon).
      const coordStyle = new TextStyle({ fontFamily: 'Inter, sans-serif', fontSize: 14, fontWeight: '700', fill: 0xf3e9d2, stroke: { color: 0x1c140c, width: 3 } });
      for (let gx = 0; gx < size; gx += 10) {
        for (let gy = 0; gy < size; gy += 10) {
          const t = new BitmapText({ text: `${gx}|${gy}`, style: coordStyle });
          t.alpha = 0.8;
          t.position.set(gx * TILE + 6, gy * TILE + 4);
          strongGrid.addChild(t);
        }
      }
      strongGrid.visible = showGridRef.current;
      worldC.addChild(strongGrid);

      // Provinces : sous les villages, au-dessus du décor.
      const provinceLayer = { root: new Container(), fill: new Graphics(), halos: new Graphics(), near: new Graphics(), far: new Graphics(), labels: new Container() };
      provinceLayer.root.addChild(provinceLayer.fill, provinceLayer.halos, provinceLayer.near, provinceLayer.far, provinceLayer.labels);
      const styles = new Map<string, TextStyle>();
      const textStyle = (key: string, make: () => ConstructorParameters<typeof TextStyle>[0]) => {
        let st = styles.get(key);
        if (!st) styles.set(key, (st = new TextStyle(make())));
        return st;
      };
      worldC.addChild(provinceLayer.root);

      const dots = new Graphics();
      dots.visible = false;
      worldC.addChild(dots);
      const villageLayer = new Container();
      const villageChunks: Container[] = [];
      for (let i = 0; i < n * n; i++) villageLayer.addChild((villageChunks[i] = new Container()));
      worldC.addChild(villageLayer);
      const armyLayer = new Container();
      worldC.addChild(armyLayer);
      const overlay = new Graphics();
      worldC.addChild(overlay);

      // Bord du monde : cadre sombre, la carte se détache du vide.
      const frame = new Graphics().rect(-4, -4, full + 8, full + 8).stroke({ width: 8, color: 0x140e08, alpha: 0.85 });
      worldC.addChild(frame);

      const shapes = {
        ring: new GraphicsContext()
          .ellipse(TILE / 2, TILE * 0.74, TILE * 0.47, TILE * 0.2)
          .fill({ color: 0xffffff, alpha: 0.3 })
          .ellipse(TILE / 2, TILE * 0.74, TILE * 0.47, TILE * 0.2)
          .stroke({ width: 2.5, color: 0xffffff, alpha: 0.95 }),
        // Liseré doré des villages dont le camp détient la relique d'une croisade.
        relic: new GraphicsContext()
          .ellipse(TILE / 2, TILE * 0.74, TILE * 0.52, TILE * 0.24)
          .stroke({ width: 2, color: 0xf1cc63, alpha: 0.95 })
          .ellipse(TILE / 2, TILE * 0.74, TILE * 0.58, TILE * 0.28)
          .stroke({ width: 1, color: 0xf1cc63, alpha: 0.45 }),
        shadow: new GraphicsContext().ellipse(TILE / 2, TILE * 0.76, TILE * 0.38, TILE * 0.14).fill({ color: 0x000000, alpha: 0.3 }),
        attack: swordsBadge(false),
        threat: swordsBadge(true),
        support: shieldBadge(),
      };

      // Dessin à la demande : une image seulement quand quelque chose change.
      let frameReq = 0;
      const updateVisibility = () => {
        const sc = worldC.scale.x;
        const lod = sc < LOD_ZOOM;
        const tx0 = Math.floor(-worldC.x / (TILE * sc) / CHUNK) - 1;
        const ty0 = Math.floor(-worldC.y / (TILE * sc) / CHUNK) - 1;
        const tx1 = Math.floor((app.screen.width - worldC.x) / (TILE * sc) / CHUNK) + 1;
        const ty1 = Math.floor((app.screen.height - worldC.y) / (TILE * sc) / CHUNK) + 1;
        for (let cy = 0; cy < n; cy++) {
          for (let cx = 0; cx < n; cx++) {
            const on = cx >= tx0 && cx <= tx1 && cy >= ty0 && cy <= ty1;
            decoChunks[cy * n + cx].visible = on && sc >= 0.25;
            villageChunks[cy * n + cx].visible = on && !lod;
          }
        }
        dots.visible = lod;
        const sc0 = scene.current;
        if (lod && sc0 && Math.abs(sc0.dotsScale - sc) > sc * 0.08) {
          sc0.dotsScale = sc;
          dots.clear();
          for (const { v, st } of sc0.dotsFor) {
            const citadel = v.kind === 'citadel';
            const bastion = v.kind === 'bastion';
            const px = citadel ? 7 : bastion ? (v.holy ? 7 : 5.5) : !v.ownerId ? 2.2 : st.rel === 'own' || st.rel === 'active' || st.mark ? 5 : 3.8;
            const cx = (v.x + 0.5) * TILE;
            const cy = (v.y + 0.5) * TILE;
            const halo = bastion && provinceLayer.root.visible ? sc0.halos.get(`${v.x},${v.y}`) : undefined;
            if (halo) {
              dots.circle(cx, cy, 16 / sc).fill({ color: halo.color, alpha: 0.24 * halo.alpha });
              dots.circle(cx, cy, 16 / sc).stroke({ width: 1.5 / sc, color: halo.color, alpha: 0.6 * halo.alpha });
            }
            dots.circle(cx, cy, (px + 1.2) / sc).fill({ color: 0x140e08, alpha: v.ownerId || citadel || bastion ? 0.75 : 0.4 });
            if (bastion) dots.rect(cx - px / sc, cy - px / sc, (2 * px) / sc, (2 * px) / sc).fill({ color: 0xc9a24a }).stroke({ width: 1.5 / sc, color: 0x140e08 });
            else dots.circle(cx, cy, px / sc).fill({ color: citadel ? 0xf1cc63 : hexToNum(st.color) });
          }
        }
        fineGrid.visible = sc >= LOD_ZOOM;
        provinceLayer.near.visible = !lod;
        provinceLayer.far.visible = lod;
        // En vue d'ensemble, les halos des bastions sont redessinés à taille constante avec les pastilles.
        provinceLayer.halos.visible = !lod;
        // Noms des provinces : à taille lisible quel que soit le zoom, cachés de tout près (les noms des villages prennent le relais).
        provinceLayer.labels.visible = sc < 0.75;
        const k = Math.min(7, Math.max(1, 0.85 / sc));
        for (const l of provinceLayer.labels.children) l.scale.set(k);
        const names = sc >= NAME_ZOOM;
        if (names !== nameState) {
          nameState = names;
          for (const d of drawnMap.values()) {
            const label = d.node.getChildByLabel('name');
            if (label) label.visible = names;
          }
        }
      };
      let nameState = worldC.scale.x >= NAME_ZOOM;
      const drawnMap = new Map<number, { node: Container; sig: string; chunk: number }>();
      const request = () => {
        if (frameReq) return;
        frameReq = requestAnimationFrame(() => {
          frameReq = 0;
          if (destroyed) return;
          updateVisibility();
          app.render();
          if (showMiniRef.current) drawMiniRef.current();
        });
      };
      app.renderer.on('resize', request);
      cleanups.push(() => cancelAnimationFrame(frameReq));
      // La carte ne se redessine qu'à la demande. Seuls la Citadelle et les armées en marche s'animent, à 12 images par seconde ;
      // si l'appareil demande moins d'animations, les armées avancent une fois par seconde et la Citadelle reste immobile.
      const anims = new Set<(t: number) => void>();
      const ticks = new Set<(t: number) => void>();
      const still = !!window.matchMedia?.('(prefers-reduced-motion: reduce)').matches;
      let lastTick = 0;
      const animTimer = window.setInterval(() => {
        if (document.hidden) return;
        const t = performance.now() / 1000;
        let dirty = false;
        if (!still && anims.size) {
          for (const f of anims) f(t);
          dirty = true;
        }
        if (ticks.size && t - lastTick >= 1) {
          lastTick = t;
          for (const f of ticks) f(t);
          dirty = true;
        }
        if (dirty) request();
      }, 80);
      cleanups.push(() => window.clearInterval(animTimer));

      const clampView = () => {
        // On garde au moins un quart d'écran de carte visible.
        const sc = worldC.scale.x * TILE;
        const minX = app.screen.width * 0.25 - size * sc;
        const minY = app.screen.height * 0.25 - size * sc;
        worldC.x = Math.min(app.screen.width * 0.75, Math.max(minX, worldC.x));
        worldC.y = Math.min(app.screen.height * 0.75, Math.max(minY, worldC.y));
      };
      const centerOn = (x: number, y: number) => {
        worldC.position.set(app.screen.width / 2 - (x + 0.5) * TILE * worldC.scale.x, app.screen.height / 2 - (y + 0.5) * TILE * worldC.scale.y);
        clampView();
        request();
      };
      const zoomAtLocal = (px: number, py: number, factor: number) => {
        const old = worldC.scale.x;
        const next = Math.min(MAX_ZOOM, Math.max(MIN_ZOOM, old * factor));
        worldC.position.set(px - ((px - worldC.x) * next) / old, py - ((py - worldC.y) * next) / old);
        worldC.scale.set(next);
        clampView();
        request();
      };
      const zoomBy = (factor: number) => zoomAtLocal(app.screen.width / 2, app.screen.height / 2, factor);
      worldC.scale.set(window.innerWidth < 700 ? 0.75 : 0.9);
      if (viewRef.current) {
        worldC.scale.set(viewRef.current.scale);
        worldC.position.set(viewRef.current.x, viewRef.current.y);
      }
      scene.current = {
        app,
        world: worldC,
        decoChunks,
        villageChunks,
        dots,
        fineGrid,
        strongGrid,
        overlay,
        textures,
        shapes,
        decoAt,
        drawn: drawnMap,
        dotsFor: [],
        dotsScale: 0,
        request,
        anims,
        ticks,
        still,
        armyLayer,
        provinceLayer,
        halos: new Map(),
        textStyle,
        centerOn,
        zoomBy,
      };
      setReady(true);

      // Navigation : glisser pour se déplacer, molette ou pincement pour zoomer, toucher pour sélectionner, survol à la souris.
      const canvas = app.canvas;
      const pointers = new Map<number, { x: number; y: number }>();
      let moved = 0;
      let pinchDist = 0;
      let lastCell = '';
      const toCell = (cx: number, cy: number) => {
        const r = canvas.getBoundingClientRect();
        return {
          x: Math.floor((cx - r.left - worldC.x) / (TILE * worldC.scale.x)),
          y: Math.floor((cy - r.top - worldC.y) / (TILE * worldC.scale.y)),
        };
      };
      const zoomAt = (cx: number, cy: number, factor: number) => {
        const r = canvas.getBoundingClientRect();
        zoomAtLocal(cx - r.left, cy - r.top, factor);
      };
      const placeTip = (cx: number, cy: number) => {
        const tip = tipRef.current;
        if (!tip) return;
        const r = host.getBoundingClientRect();
        const w = tip.offsetWidth || 280;
        const h = tip.offsetHeight || 160;
        let x = cx - r.left + 18;
        let y = cy - r.top + 18;
        if (x + w > r.width - 8) x = cx - r.left - w - 18;
        if (y + h > r.height - 8) y = Math.max(8, cy - r.top - h - 18);
        tip.style.transform = `translate(${Math.max(8, x)}px, ${y}px)`;
      };
      const hoverAt = (cx: number, cy: number) => {
        const c = toCell(cx, cy);
        const key = `${c.x},${c.y}`;
        placeTip(cx, cy);
        if (key === lastCell) return;
        lastCell = key;
        const inside = c.x >= 0 && c.y >= 0 && c.x < size && c.y < size;
        hoverRef.current(inside ? (villagesRef.current.get(key) ?? null) : null, inside ? c : null);
      };
      const down = (e: PointerEvent) => {
        canvas.setPointerCapture(e.pointerId);
        pointers.set(e.pointerId, { x: e.clientX, y: e.clientY });
        moved = 0;
        if (pointers.size === 2) {
          const [a, b] = [...pointers.values()];
          pinchDist = Math.hypot(a.x - b.x, a.y - b.y);
        }
      };
      const move = (e: PointerEvent) => {
        const prev = pointers.get(e.pointerId);
        if (!prev) {
          if (e.pointerType === 'mouse') hoverAt(e.clientX, e.clientY);
          return;
        }
        if (pointers.size === 2) {
          pointers.set(e.pointerId, { x: e.clientX, y: e.clientY });
          const [a, b] = [...pointers.values()];
          const d = Math.hypot(a.x - b.x, a.y - b.y);
          if (pinchDist > 0) zoomAt((a.x + b.x) / 2, (a.y + b.y) / 2, d / pinchDist);
          pinchDist = d;
          moved += 10;
          return;
        }
        worldC.x += e.clientX - prev.x;
        worldC.y += e.clientY - prev.y;
        clampView();
        moved += Math.abs(e.clientX - prev.x) + Math.abs(e.clientY - prev.y);
        pointers.set(e.pointerId, { x: e.clientX, y: e.clientY });
        if (moved > 8 && lastCell) {
          lastCell = '';
          hoverRef.current(null, null);
        }
        request();
      };
      const up = (e: PointerEvent) => {
        const wasTap = pointers.size === 1 && moved < 8;
        pointers.delete(e.pointerId);
        if (pointers.size < 2) pinchDist = 0;
        if (wasTap) {
          const r = canvas.getBoundingClientRect();
          const sc = worldC.scale.x;
          const fx = (e.clientX - r.left - worldC.x) / (TILE * sc);
          const fy = (e.clientY - r.top - worldC.y) / (TILE * sc);
          if (!pickArmyRef.current(fx, fy, sc)) {
            const c = toCell(e.clientX, e.clientY);
            selectRef.current(villagesRef.current.get(`${c.x},${c.y}`) ?? null);
          }
        }
        if (e.pointerType === 'mouse') {
          lastCell = '';
          hoverAt(e.clientX, e.clientY);
        }
      };
      const leave = () => {
        lastCell = '';
        hoverRef.current(null, null);
      };
      const wheel = (e: WheelEvent) => {
        e.preventDefault();
        zoomAt(e.clientX, e.clientY, Math.exp(-Math.max(-60, Math.min(60, e.deltaY)) * 0.004));
      };
      canvas.addEventListener('pointerdown', down);
      canvas.addEventListener('pointermove', move);
      canvas.addEventListener('pointerup', up);
      canvas.addEventListener('pointercancel', up);
      canvas.addEventListener('pointerleave', leave);
      canvas.addEventListener('wheel', wheel, { passive: false });
      canvas.style.touchAction = 'none';
      // Contexte graphique perdu (application en arrière-plan, mémoire saturée) : la carte deviendrait sombre ou vide.
      // Pixi tente de tout renvoyer à la carte graphique, mais sur iOS les images et la teinte du relief reviennent noires :
      // on reconstruit toute la scène dès que le contexte revient, à la même position.
      const lost = (e: Event) => e.preventDefault();
      const restored = () => setEpoch((n) => n + 1);
      canvas.addEventListener('webglcontextlost', lost);
      canvas.addEventListener('webglcontextrestored', restored);
      const back = () => {
        if (document.hidden) return;
        setMiniEpoch((n) => n + 1);
        const gl = (app.renderer as { gl?: WebGLRenderingContext }).gl;
        if (!gl?.isContextLost()) request();
      };
      document.addEventListener('visibilitychange', back);
      window.addEventListener('pageshow', back);
      cleanups.push(() => {
        canvas.removeEventListener('webglcontextlost', lost);
        canvas.removeEventListener('webglcontextrestored', restored);
        document.removeEventListener('visibilitychange', back);
        window.removeEventListener('pageshow', back);
      });
      cleanups.push(() => {
        canvas.removeEventListener('pointerdown', down);
        canvas.removeEventListener('pointermove', move);
        canvas.removeEventListener('pointerup', up);
        canvas.removeEventListener('pointercancel', up);
        canvas.removeEventListener('pointerleave', leave);
        canvas.removeEventListener('wheel', wheel);
      });
    })();

    return () => {
      destroyed = true;
      cleanups.forEach((f) => f());
      if (scene.current) {
        const w = scene.current.world;
        viewRef.current = { x: w.x, y: w.y, scale: w.scale.x };
        scene.current = null;
        setReady(false);
        app.destroy(true, { children: true });
      }
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [world.mapSize, epoch]);
  // Centrage initial : sur la case demandée, sinon sur le village actif.
  const centered = useRef(false);
  useEffect(() => {
    const s = scene.current;
    if (!s || !village) return;
    if (focus) {
      const [fx, fy] = focus.split(',').map(Number);
      if (Number.isFinite(fx) && Number.isFinite(fy)) {
        s.centerOn(fx, fy);
        const target = villages.find((v) => v.x === fx && v.y === fy);
        if (target) setSelected(target);
        centered.current = true;
        return;
      }
    }
    if (!centered.current) {
      s.centerOn(village.x, village.y);
      centered.current = true;
    }
  }, [focus, village, villages, ready]);

  // Villages : seuls ceux dont l'apparence a changé sont redessinés.
  useEffect(() => {
    villagesRef.current = new Map(villages.map((v) => [`${v.x},${v.y}`, v]));
    const s = scene.current;
    if (!s) return;
    const n = Math.ceil(world.mapSize / CHUNK);
    const seen = new Set<number>();
    for (const d of s.decoAt.values()) for (const sp of d) sp.visible = true;
    const moves = new Map(movements.map((m) => [m.villageId, m]));
    for (const v of villages) {
      seen.add(v.id);
      const mv = moves.get(v.id);
      s.decoAt.get(`${v.x},${v.y}`)?.forEach((sp) => (sp.visible = false));
      const st = styleOf(v, colors);
      const chunk = Math.floor(v.y / CHUNK) * n + Math.floor(v.x / CHUNK);
      const cz = v.crusade;
      const czSig = cz ? `${cz.wall}|${cz.holderTribeId}|${cz.holderPlayerId}|${cz.attacks}|${cz.supports}|${+(Date.now() >= Date.parse(cz.opensAt))}` : '';
      const sig = `${v.name}|${v.tribeTag}|${v.points}|${v.ownerId}|${v.holderTag ?? ''}|${holderColor(v, colors) ?? ''}|${czSig}|${+!!v.relic}|${st.color}|${st.rel}|${mv ? `${+mv.attack}${+mv.support}${+mv.threat}` : ''}`;
      const prev = s.drawn.get(v.id);
      if (prev && prev.sig === sig && prev.chunk === chunk) continue;
      if (prev) {
        (prev.node as Container & { stopAnim?: () => void }).stopAnim?.();
        prev.node.destroy({ children: true });
      }
      const node = drawVillage(s, v, st.color, st.rel === 'active' || st.rel === 'own', mv, holderColor(v, colors));
      s.villageChunks[chunk].addChild(node);
      s.drawn.set(v.id, { node, sig, chunk });
    }
    for (const [id, d] of s.drawn) {
      if (!seen.has(id)) {
        (d.node as Container & { stopAnim?: () => void }).stopAnim?.();
        d.node.destroy({ children: true });
        s.drawn.delete(id);
      }
    }
    // Les villages du bas passent devant ceux du haut.
    for (const c of s.villageChunks) c.children.sort((a, b) => a.y - b.y);
    s.dotsFor = villages.map((v) => ({ v, st: styleOf(v, colors) })).sort((a, b) => rank(a.st.rel) - rank(b.st.rel));
    s.dotsScale = 0;

    // Fond de la mini-map.
    const k = 4;
    const base = miniBase.current ?? document.createElement('canvas');
    base.width = base.height = world.mapSize * k;
    const g = base.getContext('2d')!;
    g.imageSmoothingEnabled = true;
    g.drawImage(miniTerrain, 0, 0, base.width, base.height);
    g.fillStyle = 'rgba(20,14,8,.18)';
    for (let i = 10; i < world.mapSize; i += 10) {
      g.fillRect(i * k, 0, 1, base.height);
      g.fillRect(0, i * k, base.width, 1);
    }
    const ordered = [...villages].sort((a, b) => rank(styleOf(a, colors).rel) - rank(styleOf(b, colors).rel));
    for (const v of ordered) {
      const st = styleOf(v, colors);
      const cx = (v.x + 0.5) * k;
      const cy = (v.y + 0.5) * k;
      if (!v.ownerId) {
        g.fillStyle = st.color;
        g.fillRect(cx - 1.25, cy - 1.25, 2.5, 2.5);
        continue;
      }
      const big = st.rel === 'active' || st.rel === 'own' || st.mark;
      g.beginPath();
      g.arc(cx, cy, big ? 3.6 : 2.6, 0, Math.PI * 2);
      g.fillStyle = st.color;
      g.fill();
      g.lineWidth = big ? 1.4 : 0.8;
      g.strokeStyle = 'rgba(20,14,8,.85)';
      g.stroke();
    }
    miniBase.current = base;
    s.request();
  }, [villages, movements, colors, world.mapSize, miniTerrain, ready]);

  // Provinces : découpage recalculé une fois à partir des points (identique au serveur), teinte et frontières redessinées
  // quand une bannière change de camp.
  const seedsKey = provinces?.provinces.map((p) => `${p.id},${p.x},${p.y},${p.weight}`).join(';') ?? '';
  const grid = useMemo(
    () => (provinces?.provinces.length ? provinceGrid(world.mapSize, provinces.provinces) : null),
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [seedsKey, world.mapSize],
  );
  // Frontières : ne changent qu'avec le découpage. Les bords de case voisins sont fusionnés en longs traits (bien moins de géométrie).
  useEffect(() => {
    const s = scene.current;
    if (!s) return;
    const { near, far } = s.provinceLayer;
    near.clear();
    far.clear();
    if (!grid || !provinces) return s.request();
    const size = world.mapSize;
    const holyIdx = provinces.provinces.findIndex((p) => p.kind === 'holy');
    const plain: number[][] = [];
    const holy: number[][] = [];
    // `edge(i, j)` : null sans frontière, sinon true si elle touche la Terre sainte. Les segments consécutifs de même nature sont fusionnés.
    const runs = (count: number, length: number, edge: (i: number, j: number) => boolean | null, seg: (i: number, j0: number, j1: number) => number[]) => {
      for (let i = 0; i < count; i++) {
        let j = 0;
        while (j < length) {
          const e = edge(i, j);
          if (e === null) {
            j++;
            continue;
          }
          let k = j + 1;
          while (k < length && edge(i, k) === e) k++;
          (e ? holy : plain).push(seg(i, j, k));
          j = k;
        }
      }
    };
    const at = (x: number, y: number) => grid[y * size + x];
    const kind = (a: number, b: number) => (a === b ? null : a === holyIdx || b === holyIdx);
    // Bords verticaux entre les colonnes x et x + 1, puis bords horizontaux entre les lignes y et y + 1.
    runs(size - 1, size, (x, y) => kind(at(x, y), at(x + 1, y)), (x, y0, y1) => [(x + 1) * TILE, y0 * TILE, (x + 1) * TILE, y1 * TILE]);
    runs(size - 1, size, (y, x) => kind(at(x, y), at(x, y + 1)), (y, x0, x1) => [x0 * TILE, (y + 1) * TILE, x1 * TILE, (y + 1) * TILE]);
    const stroke = (g: Graphics, segs: number[][], width: number, color: number, alpha: number) => {
      if (!segs.length) return;
      for (const [x0, y0, x1, y1] of segs) g.moveTo(x0, y0).lineTo(x1, y1);
      g.stroke({ width, color, alpha, cap: 'round' });
    };
    stroke(near, plain, 7, 0x140e08, 0.28);
    stroke(near, plain, 3, 0xe0b23c, 0.6);
    stroke(near, holy, 11, 0x140e08, 0.3);
    stroke(near, holy, 5, 0xf1cc63, 0.9);
    stroke(far, plain, 18, 0x140e08, 0.3);
    stroke(far, plain, 9, 0xe0b23c, 0.65);
    stroke(far, holy, 26, 0x140e08, 0.3);
    stroke(far, holy, 14, 0xf1cc63, 0.95);
    s.request();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [grid, world.mapSize, ready]);

  // Teinte, halos des bastions et noms : redessinés seulement quand une bannière, un nom ou une couleur change, pas à chaque
  // rechargement de la carte (toutes les 10 à 30 secondes).
  const provinceSig =
    provinces?.provinces
      .map((p) => `${p.id}|${p.name}|${p.tier}|${p.bonus}|${p.bonusPercent}|${p.holder?.tag ?? ''}|${tribeColor(p.holder?.tribeId, colors) ?? ''}|${+p.controlled}|${p.bastion ? `${p.bastion.x},${p.bastion.y}` : ''}`)
      .join(';') ?? '';
  const provincesRef = useRef(provinces);
  provincesRef.current = provinces;
  useEffect(() => {
    const s = scene.current;
    const provinces = provincesRef.current;
    if (!s) return;
    const { fill, halos, labels } = s.provinceLayer;
    fill.clear();
    halos.clear();
    s.halos.clear();
    s.dotsScale = 0;
    labels.removeChildren().forEach((c) => c.destroy());
    if (!grid || !provinces) return s.request();
    const size = world.mapSize;
    const list = provinces.provinces;
    // Teinte : la couleur fixe de la tribu qui tient la bannière (plus marquée une fois la province contrôlée), or pâle pour la Terre sainte.
    const tints = list.map((p) => {
      const c = p.holder ? tribeColor(p.holder.tribeId, colors) : null;
      if (c) return { color: hexToNum(c), alpha: p.controlled ? 0.16 : 0.08 };
      return p.kind === 'holy' ? { color: 0xf1cc63, alpha: 0.1 } : null;
    });
    for (let y = 0; y < size; y++) {
      let x = 0;
      while (x < size) {
        const i = grid[y * size + x];
        let end = x + 1;
        while (end < size && grid[y * size + end] === i) end++;
        const t = tints[i];
        if (t) fill.rect(x * TILE, y * TILE, (end - x) * TILE, TILE).fill(t);
        x = end;
      }
    }
    // Halo derrière le bastion d'une province tenue par votre tribu (bleu), une alliée (bleu ciel) ou un ennemi (rouge) ; rien sinon.
    for (const p of list) {
      const halo = p.bastion && p.holder ? bastionHalo(p.holder.tribeId, colors) : null;
      if (!halo || !p.bastion) continue;
      const cx = (p.bastion.x + 0.5) * TILE;
      const cy = (p.bastion.y + 0.6) * TILE;
      const a = p.controlled ? 1 : 0.7;
      s.halos.set(`${p.bastion.x},${p.bastion.y}`, { color: halo, alpha: a });
      halos.circle(cx, cy, TILE * 1.25).fill({ color: halo, alpha: 0.14 * a });
      halos.circle(cx, cy, TILE * 0.85).fill({ color: halo, alpha: 0.2 * a });
      halos.circle(cx, cy, TILE * 1.25).stroke({ width: 2, color: halo, alpha: 0.45 * a });
    }
    // Noms au centre de chaque province (moyenne de ses cases), avec le bonus ou la bannière.
    const sums = list.map(() => ({ x: 0, y: 0, n: 0 }));
    for (let y = 0; y < size; y++)
      for (let x = 0; x < size; x++) {
        const m = sums[grid[y * size + x]];
        m.x += x + 0.5;
        m.y += y + 0.5;
        m.n++;
      }
    list.forEach((p, i) => {
      const m = sums[i];
      if (!m.n) return;
      const box = new Container();
      const titleFill = p.kind === 'holy' ? 0xf7d778 : 0xf3e2b3;
      const title = new BitmapText({
        text: p.name.toUpperCase(),
        style: s.textStyle(`province-title-${titleFill}`, () => ({ fontFamily: 'Cinzel, serif', fontSize: 15, fontWeight: '700', fill: titleFill, stroke: { color: 0x140e08, width: 4 }, letterSpacing: 1 })),
      });
      title.anchor.set(0.5, 1);
      const subFill = p.holder ? hexToNum(tribeColor(p.holder.tribeId, colors) ?? '#f3e2b3') : 0xe9dcc0;
      const sub = new BitmapText({
        text: p.holder ? `[${p.holder.tag}]${p.controlled ? '' : ' · bannière'}` : p.kind === 'holy' ? 'Victoire du monde' : `Niveau ${p.tier}${p.bonus ? ` · ${PROVINCE_BONUS_LABEL[p.bonus]} +${p.bonusPercent} %` : ''}`,
        style: s.textStyle(`province-sub-${subFill}`, () => ({ fontFamily: 'Inter, sans-serif', fontSize: 11, fontWeight: '700', fill: subFill, stroke: { color: 0x140e08, width: 3 } })),
      });
      sub.anchor.set(0.5, 0);
      sub.y = 2;
      box.addChild(title, sub);
      box.position.set((m.x / m.n) * TILE, (m.y / m.n) * TILE);
      box.alpha = 0.92;
      labels.addChild(box);
    });
    // Échelle des noms selon le zoom actuel.
    const k = Math.min(7, Math.max(1, 0.85 / s.world.scale.x));
    for (const l of labels.children) l.scale.set(k);
    s.request();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [grid, provinceSig, world.mapSize, ready]);

  useEffect(() => {
    const s = scene.current;
    if (!s) return;
    s.provinceLayer.root.visible = showProvinces;
    s.dotsScale = 0;
    s.request();
  }, [showProvinces, ready]);

  // Village choisi et case survolée : un simple calque par-dessus.
  useEffect(() => {
    const s = scene.current;
    if (!s) return;
    const o = s.overlay.clear();
    if (cell && !hovered) o.rect(cell.x * TILE, cell.y * TILE, TILE, TILE).fill({ color: 0xffffff, alpha: 0.1 });
    const mark = (v: MapVillage, color: number, alpha: number) => {
      const x = v.x * TILE;
      const y = v.y * TILE;
      const L = 14;
      o.moveTo(x, y + L).lineTo(x, y).lineTo(x + L, y);
      o.moveTo(x + TILE - L, y).lineTo(x + TILE, y).lineTo(x + TILE, y + L);
      o.moveTo(x + TILE, y + TILE - L).lineTo(x + TILE, y + TILE).lineTo(x + TILE - L, y + TILE);
      o.moveTo(x + L, y + TILE).lineTo(x, y + TILE).lineTo(x, y + TILE - L);
      o.stroke({ width: 3, color, alpha });
    };
    if (hovered && hovered.id !== selected?.id) mark(hovered, 0xffffff, 0.7);
    if (selected) mark(selected, 0xf3e2b3, 1);
    s.request();
  }, [hovered, cell, selected, ready]);

  // Armées en marche : redessinées à chaque rechargement de la carte, puis animées sur place sans rien demander au serveur.
  useEffect(() => {
    const s = scene.current;
    if (!s || !showArmies) return;
    return drawArmies(s, armies);
  }, [armies, showArmies, ready]);

  useEffect(() => {
    const s = scene.current;
    if (!s) return;
    s.strongGrid.visible = showGrid;
    s.request();
  }, [showGrid, ready]);
  useEffect(() => {
    if (showMini) drawMini();
  }, [showMini, drawMini, villages, colors]);

  const miniJump = (e: React.PointerEvent<HTMLCanvasElement>) => {
    const r = e.currentTarget.getBoundingClientRect();
    scene.current?.centerOn(((e.clientX - r.left) / r.width) * world.mapSize, ((e.clientY - r.top) / r.height) * world.mapSize);
  };
  const centerOn = (x: number, y: number) => scene.current?.centerOn(x, y);
  const from = village ? { x: village.x, y: village.y } : null;
  const card = (v: MapVillage, interactive: boolean) => {
    const st = styleOf(v, colors);
    return (
      <MapVillageCard
        v={v}
        rel={st.rel}
        color={st.color}
        mark={st.mark}
        from={v.id === villageId ? null : from}
        worldSpeed={world.speed}
        ownerSlot={interactive && v.ownerName ? <PlayerLink name={v.ownerName} /> : undefined}
        province={v.provinceId ? provinces?.provinces.find((p) => p.id === v.provinceId) : undefined}
        speedBonus={village?.speedBonus}
      />
    );
  };
  const legend: [string, string][] = [
    [REL_COLORS.own, 'Vous'],
    [REL_COLORS.active, 'Actif'],
    [REL_COLORS.tribe, 'Tribu'],
    [REL_COLORS.ally, 'Alliés'],
    [REL_COLORS.war, 'Guerre'],
    [REL_COLORS.other, 'Autres'],
    [REL_COLORS.barbarian, 'Barbares'],
  ];

  return (
    <div className="map-page">
      <div ref={stageRef} className={`map-stage ${selected || armySel ? 'has-popup' : ''}`}>
        <div className="map-canvas" ref={hostRef} />
        <div className="map-vignette" />
        {!ready && (
          <div className="map-loading">
            <span className="map-spinner" /> Chargement de la carte…
          </div>
        )}

        <div className="map-bar">
          <button className="map-btn" onClick={() => village && centerOn(village.x, village.y)} title="Revenir sur mon village">
            <span aria-hidden>⌂</span>
            <span className="lbl">Mon village</span>
          </button>
          <form
            className="map-jump"
            onSubmit={(e) => {
              e.preventDefault();
              const [x, y] = jump.split(/[|,; ]+/).map(Number);
              if (Number.isFinite(x) && Number.isFinite(y)) centerOn(x, y);
            }}
          >
            <input id="map-jump" placeholder="x|y" value={jump} onChange={(e) => setJump(e.target.value)} size={6} inputMode="numeric" aria-label="Aller aux coordonnées" />
            <button className="map-btn" aria-label="Aller">
              ➜
            </button>
          </form>
          <span className="map-sep" />
          <button className={`map-btn ${showGrid ? 'on' : ''}`} aria-pressed={showGrid} onClick={() => (writePref('grid', !showGrid), setShowGrid(!showGrid))} title="Quadrillage">
            <span aria-hidden>#</span>
            <span className="lbl">Quadrillage</span>
          </button>
          <button className={`map-btn ${showMini ? 'on' : ''}`} aria-pressed={showMini} onClick={() => (writePref('mini', !showMini), setShowMini(!showMini))} title="Mini-map">
            <span aria-hidden>▣</span>
            <span className="lbl">Mini-map</span>
          </button>
          <button className={`map-btn ${showArmies ? 'on' : ''}`} aria-pressed={showArmies} onClick={() => (writePref('armies', !showArmies), setShowArmies(!showArmies))} title="Armées en marche">
            <span aria-hidden>⚑</span>
            <span className="lbl">Armées</span>
          </button>
          {provinces && provinces.provinces.length > 0 && (
            <button
              className={`map-btn ${showProvinces ? 'on' : ''}`}
              aria-pressed={showProvinces}
              onClick={() => (writePref('provinces', !showProvinces), setShowProvinces(!showProvinces))}
              title="Provinces"
            >
              <span aria-hidden>⬡</span>
              <span className="lbl">Provinces</span>
            </button>
          )}
          <button className={`map-btn ${panel ? 'on' : ''}`} aria-pressed={panel} onClick={() => setPanel(!panel)} title="Couleurs et repères">
            <span className="map-swatches" aria-hidden>
              <i style={{ background: REL_COLORS.own }} />
              <i style={{ background: REL_COLORS.tribe }} />
              <i style={{ background: REL_COLORS.war }} />
            </span>
            <span className="lbl">Couleurs</span>
          </button>
        </div>

        <div className="map-legend" aria-label="Légende">
          {legend.map(([c, l]) => (
            <span key={l}>
              <i style={{ background: c }} />
              {l}
            </span>
          ))}
          {showArmies &&
            (['threat', 'seen'] as const).filter((rel) => armies.some((a) => a.rel === rel)).map((rel) => (
              <span key={`army-${rel}`} className="legend-army">
                <i style={{ background: ARMY_COLORS[rel] }} />
                {ARMY_LABELS[rel]}
              </span>
            ))}
          {marks.map((m) => (
            <span key={`${m.kind}${m.id}`}>
              <i style={{ background: m.color }} />
              {m.kind === 'tribe' ? `[${m.name}]` : m.name}
            </span>
          ))}
        </div>

        {citadel && (
          <CrusadeMapHud
            citadel={citadel}
            holderColor={holderColor(citadel, colors)}
            onShow={() => {
              centerOn(citadel.x, citadel.y);
              setSelected(citadel);
            }}
          />
        )}

        <div className="map-zoom">
          <button className="map-btn" onClick={() => scene.current?.zoomBy(1.4)} aria-label="Zoomer">
            +
          </button>
          <button className="map-btn" onClick={() => scene.current?.zoomBy(1 / 1.4)} aria-label="Dézoomer">
            −
          </button>
        </div>
        {cell && <span className="map-cell">{cell.x}|{cell.y}</span>}

        {showMini && (
          <div className="minimap">
            <canvas ref={miniRef} onPointerDown={(e) => (e.currentTarget.setPointerCapture(e.pointerId), miniJump(e))} onPointerMove={(e) => e.buttons === 1 && miniJump(e)} />
            <span>
              Monde {world.mapSize}×{world.mapSize}
            </span>
          </div>
        )}

        <div ref={tipRef} className={`map-tip ${hovered && hovered.id !== selected?.id ? 'show' : ''}`} aria-hidden>
          {hovered && card(hovered, false)}
        </div>

        {panel && (
          <MapColors
            marks={marks}
            villages={villages}
            selfId={me.player.id}
            selfTribeId={me.player.tribe?.id ?? null}
            onChange={updateMarks}
            onClose={() => setPanel(false)}
          />
        )}

        {armySel && !selected && (
          <aside className="map-popup">
            <button className="map-close" onClick={() => setArmySel(null)} aria-label="Fermer">
              ✕
            </button>
            <ArmyCard
              army={armySel}
              onSent={() => {
                setArmySel(null);
                load();
              }}
            />
          </aside>
        )}
        {selected && (
          <aside className="map-popup">
            <button className="map-close" onClick={() => setSelected(null)} aria-label="Fermer">
              ✕
            </button>
            {card(selected, true)}
            {selected.id === villageId ? (
              <p className="muted small">C'est votre village actif.</p>
            ) : (
              <>
                <SendTroops
                  target={selected}
                  protectedTarget={selected.protected}
                  onSent={() => {
                    setSelected(null);
                    load();
                  }}
                />
                <div className="row wrap">
                  <a className="btn ghost small" href={`#/ralliement/${selected.x},${selected.y}`}>
                    Point de ralliement
                  </a>
                  {selected.ownerId && village && village.buildings.market > 0 && (
                    <a className="btn ghost small" href={`#/marche/${selected.x},${selected.y}`}>
                      Envoyer des ressources
                    </a>
                  )}
                </div>
              </>
            )}
          </aside>
        )}
      </div>
    </div>
  );
}

/** Ordre de dessin sur la mini-map : les pastilles importantes passent au-dessus. */
function rank(rel: string) {
  return ['barbarian', 'other', 'war', 'ally', 'tribe', 'own', 'active'].indexOf(rel);
}

/** Couleur fixe d'une tribu sur la carte (la vôtre, alliée, en guerre, autre). */
function tribeColor(tribeId: number | null | undefined, ctx: ColorContext): string | null {
  if (!tribeId) return null;
  if (tribeId === ctx.tribeId) return REL_COLORS.tribe;
  if (ctx.allies.has(tribeId)) return REL_COLORS.ally;
  if (ctx.wars.has(tribeId)) return REL_COLORS.war;
  return REL_COLORS.other;
}

/** Couleur du halo d'un bastion : votre tribu, une alliée ou un ennemi (toute autre tribu, en guerre ou non, en rouge vif). */
function bastionHalo(tribeId: number, ctx: ColorContext): number {
  if (tribeId === ctx.tribeId) return hexToNum(REL_COLORS.tribe);
  if (ctx.allies.has(tribeId)) return hexToNum(REL_COLORS.ally);
  return hexToNum(REL_COLORS.war);
}

/** Couleur du camp qui tient la bannière de la Citadelle ou d'un bastion, avec les couleurs fixes de la carte (vous, tribu, alliés, guerre, autres). */
function holderColor(v: MapVillage, ctx: ColorContext): string | null {
  if (v.kind === 'bastion') return tribeColor(v.holderTribeId, ctx);
  const c = v.crusade;
  if (!c || (!c.holderTribeId && !c.holderPlayerId)) return null;
  if (c.holderTribeId) {
    if (c.holderTribeId === ctx.tribeId) return REL_COLORS.tribe;
    if (ctx.allies.has(c.holderTribeId)) return REL_COLORS.ally;
    if (ctx.wars.has(c.holderTribeId)) return REL_COLORS.war;
    return REL_COLORS.other;
  }
  return c.holderPlayerId === ctx.playerId ? REL_COLORS.own : REL_COLORS.other;
}

function drawVillage(s: Scene, v: MapVillage, color: string, mine: boolean, mv?: MapMovement, holder?: string | null): Container {
  const c = new Container();
  c.position.set(v.x * TILE, v.y * TILE);
  const tint = hexToNum(color);
  c.addChild(new Graphics(s.shapes.shadow));
  const citadel = v.kind === 'citadel';
  const bastion = v.kind === 'bastion';
  const ring = new Graphics(s.shapes.ring);
  // La Citadelle garde son socle doré, quel que soit le camp qui tient sa bannière ; un camp qui détient la relique a un socle doré lui aussi.
  ring.tint = citadel ? 0xf1cc63 : bastion ? (holder ? hexToNum(holder) : 0xc9a24a) : tint;
  ring.alpha = v.ownerId || citadel || bastion ? 1 : 0.45;
  if (citadel) ring.scale.set(1.25), ring.position.set(-TILE * 0.125, -TILE * 0.2);
  if (bastion) ring.scale.set(v.holy ? 1.25 : 1.1), ring.position.set(-TILE * (v.holy ? 0.125 : 0.05), -TILE * (v.holy ? 0.2 : 0.1));
  c.addChild(ring);
  if (v.relic) {
    const halo = new Graphics(s.shapes.relic);
    c.addChild(halo);
  }
  // Hameau, bourg puis cité fortifiée selon les points du village ; la Citadelle déborde de sa case.
  const tex = citadel ? s.textures.citadel : bastion ? (v.holy ? s.textures.sanctuary : s.textures.bastion) : !v.ownerId ? s.textures.barbarian : v.points < 80 ? s.textures.village1 : v.points < 500 ? s.textures.village2 : s.textures.village3;
  const sp = new Sprite(tex);
  const scale = citadel ? 1.6 : bastion ? (v.holy ? 1.6 : 1.35) : v.ownerId ? 1.12 : 0.95;
  sp.width = sp.height = TILE * scale;
  sp.position.set((TILE - sp.width) / 2, (TILE - sp.height) / 2 - (citadel || bastion ? 12 : 4));
  c.addChild(sp);
  if (citadel && v.crusade) drawCitadelLive(s, c, v.crusade, holder ?? null);
  // Bastion tenu : l'étendard de la tribu au sommet du donjon.
  if (bastion && holder) {
    const flag = new Sprite(s.textures.flag);
    flag.tint = hexToNum(holder);
    flag.width = TILE * 0.42;
    flag.height = TILE * 0.52;
    flag.position.set(TILE * 0.52, -TILE * (v.holy ? 0.72 : 0.6));
    const pole = new Graphics().rect(0, 0, 2, TILE * 0.55).fill({ color: 0x2b2018 });
    pole.position.set(TILE * 0.51, -TILE * (v.holy ? 0.7 : 0.58));
    c.addChild(pole, flag);
  }
  if (v.ownerId) {
    const f = new Sprite(s.textures.flag);
    f.width = TILE * (mine ? 0.34 : 0.3);
    f.height = TILE * (mine ? 0.45 : 0.4);
    f.position.set(TILE * 0.64, -TILE * 0.06);
    f.tint = tint;
    c.addChild(f);
  }
  // Mouvements en route vers ce village : petits médaillons empilés en haut à droite (attaque au-dessus, soutien en dessous).
  if (mv && (mv.attack || mv.support)) {
    const badges: GraphicsContext[] = [];
    if (mv.attack) badges.push(mv.threat ? s.shapes.threat : s.shapes.attack);
    if (mv.support) badges.push(s.shapes.support);
    badges.forEach((ctx, i) => {
      const b = new Graphics(ctx);
      // À droite du drapeau d'un village de joueur ; plus près du toit d'un village barbare, plus petit et sans drapeau.
      b.position.set(TILE * (v.ownerId ? 1.1 : 0.9), TILE * ((v.ownerId ? 0.08 : 0.18) + i * 0.32));
      c.addChild(b);
    });
  }
  // Étiquette : pastille sombre, point de couleur et nom (texte bitmap partagé, bien plus léger qu'un texte par village).
  const label = new Container();
  const special = citadel || bastion;
  label.label = special ? 'name-fixed' : 'name';
  const text = new BitmapText({
    text: special ? (v.holderTag ? `${v.name} · [${v.holderTag}]` : v.name) : v.tribeTag ? `[${v.tribeTag}] ${v.name}` : v.name,
    style: { fontFamily: 'Inter, sans-serif', fontSize: 11, fontWeight: '600', fill: 0xf7efdc },
  });
  const maxW = TILE * (special ? 3 : 1.7);
  if (text.width > maxW) text.scale.set(maxW / text.width);
  const w = text.width + 18;
  const pill = new Graphics()
    .roundRect(-w / 2, 0, w, 16, 8)
    .fill({ color: special ? 0x3a2a12 : 0x17110b, alpha: special ? 0.92 : 0.78 })
    .circle(-w / 2 + 8, 8, 3.2)
    .fill({ color: citadel ? 0xf1cc63 : bastion ? (holder ? hexToNum(holder) : 0xc9a24a) : tint });
  if (special) pill.roundRect(-w / 2, 0, w, 16, 8).stroke({ width: 1, color: 0xf1cc63, alpha: 0.9 });
  text.position.set(-w / 2 + 14, 8 - text.height / 2);
  label.addChild(pill, text);
  label.position.set(TILE / 2, TILE - 6);
  // Le nom de la Citadelle et des bastions reste lisible même de loin.
  label.visible = special || s.world.scale.x >= NAME_ZOOM;
  c.addChild(label);
  return c;
}

/**
 * Citadelle en direct : halo doré qui pulse pendant l'assaut, étendard au vent aux couleurs du camp qui tient la bannière,
 * jauge de la muraille et nombre d'armées en marche (attaques en rouge, renforts en vert ; jamais leur origine).
 */
function drawCitadelLive(s: Scene, c: Container, cz: NonNullable<MapVillage['crusade']>, holder: string | null) {
  const open = Date.now() >= Date.parse(cz.opensAt);
  const stops: (() => void)[] = [];
  const animate = (f: (t: number) => void) => {
    s.anims.add(f);
    stops.push(() => s.anims.delete(f));
  };
  if (open) {
    const aura = new Graphics()
      .ellipse(0, 0, TILE * 0.95, TILE * 0.42)
      .stroke({ width: 3, color: 0xf1cc63, alpha: 0.9 })
      .ellipse(0, 0, TILE * 1.1, TILE * 0.5)
      .stroke({ width: 1.5, color: 0xf1cc63, alpha: 0.5 });
    aura.position.set(TILE / 2, TILE * 0.72);
    c.addChildAt(aura, 1);
    animate((t) => {
      const k = (Math.sin(t * 3) + 1) / 2;
      aura.scale.set(0.92 + k * 0.14);
      aura.alpha = 0.35 + k * 0.6;
    });
  }
  // Étendard du camp qui tient la Citadelle, planté au sommet du donjon.
  if (holder) {
    const pole = new Graphics().rect(0, 0, 2, TILE * 0.62).fill({ color: 0x2b2018 });
    pole.position.set(TILE * 0.53, -TILE * 0.78);
    const flag = new Sprite(s.textures.flag);
    flag.tint = hexToNum(holder);
    flag.width = TILE * 0.5;
    flag.height = TILE * 0.62;
    flag.position.set(TILE * 0.54, -TILE * 0.8);
    c.addChild(pole, flag);
    if (open) {
      const w = flag.width;
      animate((t) => {
        flag.width = w * (0.86 + 0.14 * Math.sin(t * 5));
        flag.skew.y = 0.08 * Math.sin(t * 5 + 1);
      });
    }
  }
  // Jauge de la muraille : 20 crans, dorés tant qu'ils tiennent.
  const segW = (TILE * 1.2) / 20;
  const gauge = new Graphics().roundRect(-2, -2, segW * 20 + 3, 7, 3).fill({ color: 0x17110b, alpha: 0.85 });
  for (let i = 0; i < 20; i++) gauge.rect(i * segW, 0, segW - 1, 3).fill({ color: i < cz.wall ? 0xf1cc63 : 0x5a4228 });
  gauge.position.set(TILE / 2 - (segW * 20) / 2, TILE - 14);
  c.addChild(gauge);
  // Armées en marche vers la Citadelle.
  const counts: [number, GraphicsContext][] = [
    [cz.attacks, s.shapes.threat],
    [cz.supports, s.shapes.support],
  ];
  counts
    .filter(([n]) => n > 0)
    .forEach(([n, ctx], i) => {
      const b = new Graphics(ctx);
      b.position.set(TILE * 1.25, TILE * (0.05 + i * 0.36));
      const txt = new BitmapText({ text: `${n}`, style: { fontFamily: 'Inter, sans-serif', fontSize: 11, fontWeight: '700', fill: 0xfbf3df } });
      txt.position.set(TILE * 1.25 + 12, TILE * (0.05 + i * 0.36) - txt.height / 2);
      c.addChild(b, txt);
    });
  (c as Container & { stopAnim?: () => void }).stopAnim = () => stops.forEach((f) => f());
}

/** Médaillon des icônes de mouvement (charte : disque de bois sombre cerclé d'or), centré sur l'origine. */
function medallion(g: GraphicsContext, danger: boolean) {
  return g
    .circle(0, 0, 10)
    .fill({ color: 0x000000, alpha: 0.35 })
    .circle(0, 0, 9)
    .fill({ color: danger ? 0x5a1512 : 0x2a1f15, alpha: 0.94 })
    .circle(0, 0, 9)
    .stroke({ width: 1.2, color: danger ? 0xe04848 : 0xe0b23c, alpha: 0.9 });
}

/** Deux épées croisées, fines : or pour vos attaques, ivoire sur fond rouge pour une attaque qui vise l'un de vos villages. */
function swordsBadge(danger: boolean) {
  const ink = danger ? 0xffd9cf : 0xf1cc63;
  const g = medallion(new GraphicsContext(), danger);
  for (const d of [1, -1]) {
    g.moveTo(-4.6 * d, 4.6).lineTo(4.4 * d, -4.4).stroke({ width: 1.5, color: ink, cap: 'round' });
    g.moveTo(-4.4 * d, 1.6).lineTo(-1.6 * d, 4.4).stroke({ width: 1.3, color: ink, cap: 'round' });
    g.circle(-5.4 * d, 5.4, 0.9).fill({ color: ink });
  }
  return g;
}

/** Écu à pointe, or, partagé d'un filet sombre. */
function shieldBadge() {
  return medallion(new GraphicsContext(), false)
    .moveTo(-4.6, -5)
    .lineTo(4.6, -5)
    .lineTo(4.6, -0.4)
    .quadraticCurveTo(4.4, 3.6, 0, 5.8)
    .quadraticCurveTo(-4.4, 3.6, -4.6, -0.4)
    .closePath()
    .fill({ color: 0xf1cc63 })
    .moveTo(0, -4.4)
    .lineTo(0, 5)
    .stroke({ width: 1, color: 0x2b2018, alpha: 0.55 })
    .moveTo(-3.9, -1.2)
    .lineTo(3.9, -1.2)
    .stroke({ width: 1, color: 0x2b2018, alpha: 0.55 });
}
