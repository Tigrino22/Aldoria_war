import { useCallback, useEffect, useRef, useState } from 'react';
import { Application, Assets, Container, Graphics, Sprite, Text, Texture, TilingSprite } from 'pixi.js';
import type { MapVillage } from '@aldoria/shared';
import { api } from '../api';
import { MAP_IMG } from '../assets';
import { fmt } from '../format';
import { useGame } from '../game';
import SendTroops from './SendTroops';
import { PlayerLink } from '../ui';

const TILE = 64;
const COLORS = { own: 0x2f6fdc, tribe: 0x3ca34a, enemy: 0xd0453a };

/** Bruit déterministe : le décor est le même pour tout le monde et à chaque visite. */
function hash(x: number, y: number) {
  let h = (x * 374761393 + y * 668265263) | 0;
  h = Math.imul(h ^ (h >>> 13), 1274126177);
  return ((h ^ (h >>> 16)) >>> 0) / 4294967296;
}

interface PublicInfo {
  id: number;
  protected: boolean;
}

export default function MapView({ focus }: { focus?: string }) {
  const { me, world, village, villageId, run } = useGame();
  const hostRef = useRef<HTMLDivElement>(null);
  const [villages, setVillages] = useState<MapVillage[]>([]);
  const [selected, setSelected] = useState<MapVillage | null>(null);
  const [info, setInfo] = useState<PublicInfo | null>(null);
  const [hover, setHover] = useState<{ x: number; y: number } | null>(null);
  const [jump, setJump] = useState('');
  const pixi = useRef<{ app: Application; world: Container; layer: Container; textures: Record<string, Texture>; centerOn: (x: number, y: number) => void } | null>(null);
  const villagesRef = useRef<Map<string, MapVillage>>(new Map());
  const selectRef = useRef<(v: MapVillage | null) => void>(() => undefined);
  selectRef.current = (v) => setSelected(v);

  const load = useCallback(() => run(async () => setVillages(await api<MapVillage[]>('/api/map'))), [run]);
  useEffect(() => {
    load();
    const t = setInterval(load, 30000);
    return () => clearInterval(t);
  }, [load]);

  useEffect(() => {
    setInfo(null);
    if (selected) run(async () => setInfo(await api<PublicInfo>(`/api/villages/${selected.id}/public`)));
  }, [selected, run]);

  // Création de la scène PixiJS (une seule fois).
  useEffect(() => {
    const host = hostRef.current!;
    let destroyed = false;
    const app = new Application();
    const cleanups: (() => void)[] = [];

    (async () => {
      await app.init({ resizeTo: host, background: '#6f9e45', antialias: true, resolution: Math.min(2, window.devicePixelRatio || 1), autoDensity: true });
      if (destroyed) return app.destroy(true);
      host.appendChild(app.canvas);
      const textures: Record<string, Texture> = {};
      for (const [k, src] of Object.entries(MAP_IMG)) textures[k] = await Assets.load(k === 'flag' ? { src, data: { resolution: 3 } } : src);
      if (destroyed) return;

      const size = world.mapSize;
      const worldC = new Container();
      app.stage.addChild(worldC);

      // Prairie : texture d'herbe répétée, puis un quadrillage discret des cases.
      const meadow = new TilingSprite({ texture: textures.ground, width: size * TILE, height: size * TILE });
      meadow.tileScale.set((TILE * 4) / textures.ground.width);
      worldC.addChild(meadow);
      const ground = new Graphics();
      for (let i = 0; i <= size; i++) {
        ground.moveTo(i * TILE, 0).lineTo(i * TILE, size * TILE);
        ground.moveTo(0, i * TILE).lineTo(size * TILE, i * TILE);
      }
      ground.stroke({ width: 1, color: 0x000000, alpha: 0.07 });
      ground.rect(0, 0, size * TILE, size * TILE).stroke({ width: 6, color: 0x3b2a1a, alpha: 0.5 });
      worldC.addChild(ground);

      const deco = new Container();
      for (let x = 0; x < size; x++) {
        for (let y = 0; y < size; y++) {
          const n = hash(y + 7, x + 13);
          if (n > 0.16) continue;
          const s = new Sprite(n < 0.12 ? textures.trees : textures.hill);
          s.width = s.height = TILE * (0.8 + hash(x, y + 3) * 0.3);
          s.position.set(x * TILE + (TILE - s.width) / 2, y * TILE + (TILE - s.height) / 2);
          s.label = `${x},${y}`;
          deco.addChild(s);
        }
      }
      worldC.addChild(deco);
      const layer = new Container();
      worldC.addChild(layer);

      const centerOn = (x: number, y: number) => {
        worldC.position.set(app.screen.width / 2 - (x + 0.5) * TILE * worldC.scale.x, app.screen.height / 2 - (y + 0.5) * TILE * worldC.scale.y);
      };
      pixi.current = { app, world: worldC, layer, textures, centerOn };
      worldC.scale.set(window.innerWidth < 700 ? 0.8 : 1);
      setVillages((v) => [...v]); // force le premier dessin des villages

      // Navigation : glisser pour se déplacer, molette ou pincement pour zoomer, toucher pour sélectionner.
      const canvas = app.canvas;
      const pointers = new Map<number, { x: number; y: number }>();
      let moved = 0;
      let pinchDist = 0;
      const toCell = (cx: number, cy: number) => {
        const r = canvas.getBoundingClientRect();
        return {
          x: Math.floor((cx - r.left - worldC.x) / (TILE * worldC.scale.x)),
          y: Math.floor((cy - r.top - worldC.y) / (TILE * worldC.scale.y)),
        };
      };
      const zoomAt = (cx: number, cy: number, factor: number) => {
        const r = canvas.getBoundingClientRect();
        const px = cx - r.left;
        const py = cy - r.top;
        const old = worldC.scale.x;
        const next = Math.min(2, Math.max(0.25, old * factor));
        worldC.position.set(px - ((px - worldC.x) * next) / old, py - ((py - worldC.y) * next) / old);
        worldC.scale.set(next);
        layer.children.forEach((c) => {
          const label = (c as Container).getChildByLabel?.('name');
          if (label) label.visible = next >= 0.6;
        });
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
          if (e.pointerType === 'mouse') setHover(toCell(e.clientX, e.clientY));
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
        moved += Math.abs(e.clientX - prev.x) + Math.abs(e.clientY - prev.y);
        pointers.set(e.pointerId, { x: e.clientX, y: e.clientY });
      };
      const up = (e: PointerEvent) => {
        const wasTap = pointers.size === 1 && moved < 8;
        pointers.delete(e.pointerId);
        if (pointers.size < 2) pinchDist = 0;
        if (wasTap) {
          const cell = toCell(e.clientX, e.clientY);
          selectRef.current(villagesRef.current.get(`${cell.x},${cell.y}`) ?? null);
        }
      };
      const wheel = (e: WheelEvent) => {
        e.preventDefault();
        zoomAt(e.clientX, e.clientY, e.deltaY < 0 ? 1.15 : 1 / 1.15);
      };
      canvas.addEventListener('pointerdown', down);
      canvas.addEventListener('pointermove', move);
      canvas.addEventListener('pointerup', up);
      canvas.addEventListener('pointercancel', up);
      canvas.addEventListener('wheel', wheel, { passive: false });
      canvas.style.touchAction = 'none';
      cleanups.push(() => {
        canvas.removeEventListener('pointerdown', down);
        canvas.removeEventListener('pointermove', move);
        canvas.removeEventListener('pointerup', up);
        canvas.removeEventListener('pointercancel', up);
        canvas.removeEventListener('wheel', wheel);
      });
    })();

    return () => {
      destroyed = true;
      cleanups.forEach((f) => f());
      if (pixi.current) {
        pixi.current = null;
        app.destroy(true, { children: true });
      }
    };
  }, [world.mapSize]);

  // Centrage initial : sur la case demandée, sinon sur le village actif.
  const centered = useRef(false);
  useEffect(() => {
    const p = pixi.current;
    if (!p || !village) return;
    if (focus) {
      const [fx, fy] = focus.split(',').map(Number);
      if (Number.isFinite(fx) && Number.isFinite(fy)) {
        p.centerOn(fx, fy);
        const target = villages.find((v) => v.x === fx && v.y === fy);
        if (target) setSelected(target);
        centered.current = true;
        return;
      }
    }
    if (!centered.current) {
      p.centerOn(village.x, village.y);
      centered.current = true;
    }
  }, [focus, village, villages]);

  // Dessin des villages.
  useEffect(() => {
    const p = pixi.current;
    villagesRef.current = new Map(villages.map((v) => [`${v.x},${v.y}`, v]));
    if (!p) return;
    p.layer.removeChildren().forEach((c) => c.destroy({ children: true }));
    // Le décor ne doit pas recouvrir les villages.
    const occupied = new Set(villagesRef.current.keys());
    const deco = p.world.children[2] as Container;
    deco.children.forEach((s) => (s.visible = !occupied.has(s.label)));

    const myTribe = me.player.tribe?.id ?? null;
    for (const v of villages) {
      const c = new Container();
      c.position.set(v.x * TILE, v.y * TILE);
      // Hameau, bourg puis cité fortifiée selon les points du village.
      const tex = !v.ownerId ? p.textures.barbarian : v.points < 120 ? p.textures.village1 : v.points < 600 ? p.textures.village2 : p.textures.village3;
      const scale = v.ownerId ? 1.15 : 1;
      if (v.id === villageId) {
        const ring = new Graphics().circle(TILE / 2, TILE / 2, TILE * 0.48).fill({ color: 0xffffff, alpha: 0.35 }).stroke({ width: 3, color: COLORS.own });
        c.addChild(ring);
      }
      if (selected && v.id === selected.id) {
        c.addChild(new Graphics().rect(2, 2, TILE - 4, TILE - 4).stroke({ width: 3, color: 0xf2c230 }));
      }
      const s = new Sprite(tex);
      s.width = s.height = TILE * scale;
      s.position.set((TILE - s.width) / 2, (TILE - s.height) / 2 - 2);
      c.addChild(s);
      if (v.ownerId) {
        const f = new Sprite(p.textures.flag);
        f.width = TILE * 0.28;
        f.height = TILE * 0.37;
        f.position.set(TILE * 0.62, TILE * 0.02);
        f.tint = v.ownerId === me.player.id ? COLORS.own : myTribe && v.tribeId === myTribe ? COLORS.tribe : COLORS.enemy;
        c.addChild(f);
      }
      const name = new Text({
        text: v.tribeTag ? `[${v.tribeTag}] ${v.name}` : v.name,
        style: { fontFamily: 'Inter, sans-serif', fontSize: 11, fill: 0xffffff, stroke: { color: 0x2b2018, width: 3 } },
      });
      name.label = 'name';
      name.anchor.set(0.5, 0);
      name.position.set(TILE / 2, TILE - 10);
      name.visible = p.world.scale.x >= 0.6;
      if (name.width > TILE * 1.6) name.scale.set((TILE * 1.6) / name.width);
      c.addChild(name);
      p.layer.addChild(c);
    }
  }, [villages, villageId, selected, me.player.id, me.player.tribe]);

  const centerOn = (x: number, y: number) => pixi.current?.centerOn(x, y);

  return (
    <div className="map-page">
      <div className="map-tools">
        <button className="btn small" onClick={() => village && centerOn(village.x, village.y)}>
          Mon village
        </button>
        <form
          className="row"
          onSubmit={(e) => {
            e.preventDefault();
            const [x, y] = jump.split(/[|,; ]+/).map(Number);
            if (Number.isFinite(x) && Number.isFinite(y)) centerOn(x, y);
          }}
        >
          <input id="map-jump" placeholder="x|y" value={jump} onChange={(e) => setJump(e.target.value)} size={7} />
          <button className="btn small">Aller</button>
        </form>
        {hover && hover.x >= 0 && hover.y >= 0 && hover.x < world.mapSize && hover.y < world.mapSize && (
          <span className="muted small">
            Case {hover.x}|{hover.y}
          </span>
        )}
        <span className="legend">
          <i style={{ background: '#2f6fdc' }} /> vous <i style={{ background: '#3ca34a' }} /> tribu <i style={{ background: '#d0453a' }} /> autres <i style={{ background: '#a39886' }} /> barbares
        </span>
      </div>
      <div className="map-canvas" ref={hostRef} />
      {selected && (
        <aside className="map-popup">
          <header>
            <div>
              <h3>
                {selected.tribeTag && <span className="muted">[{selected.tribeTag}] </span>}
                {selected.name}
              </h3>
              <p className="muted small">
                ({selected.x}|{selected.y}) · {fmt(selected.points)} points · {selected.ownerName ? <PlayerLink name={selected.ownerName} /> : 'Village barbare'}
                {info?.protected && ' · sous protection'}
              </p>
            </div>
            <button className="btn ghost small" onClick={() => setSelected(null)} aria-label="Fermer">
              ✕
            </button>
          </header>
          {selected.id === villageId ? (
            <p className="muted">C'est votre village actif.</p>
          ) : (
            <>
              <SendTroops target={selected} protectedTarget={!!info?.protected} onSent={() => setSelected(null)} />
              {selected.ownerId && village && village.buildings.market > 0 && (
                <a className="btn ghost small" href={`#/marche/${selected.x},${selected.y}`}>
                  Envoyer des ressources
                </a>
              )}
            </>
          )}
        </aside>
      )}
    </div>
  );
}
