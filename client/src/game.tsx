import { createContext, useCallback, useContext, useEffect, useMemo, useRef, useState, type ReactNode } from 'react';
import type { MeResponse, VillageState, WorldInfo } from '@aldoria/shared';
import { api, ApiError, getToken, setToken } from './api';
import { wsUrl } from './config';
import { alertHaptic } from './native';

export interface Toast {
  id: number;
  text: string;
  kind: 'info' | 'error' | 'warning';
}

interface GameCtx {
  me: MeResponse;
  world: WorldInfo & { offset: number };
  villageId: number;
  village: VillageState | null;
  setVillageId: (id: number) => void;
  refreshMe: () => Promise<void>;
  refreshVillage: () => Promise<void>;
  setVillage: (v: VillageState) => void;
  toast: (text: string, kind?: Toast['kind']) => void;
  /** Lance une action serveur et affiche son erreur éventuelle. */
  run: <T>(fn: () => Promise<T>) => Promise<T | undefined>;
  logout: () => void;
}

const Ctx = createContext<GameCtx | null>(null);
export const useGame = () => {
  const ctx = useContext(Ctx);
  if (!ctx) throw new Error('useGame hors de GameProvider');
  return ctx;
};

const VILLAGE_KEY = 'aldoria.village';
const readStoredVillage = () => {
  try {
    return Number(localStorage.getItem(VILLAGE_KEY)) || 0;
  } catch {
    return 0;
  }
};

/** Heure du serveur, rafraîchie chaque seconde. */
let serverOffset = 0;
export function useNow(intervalMs = 1000) {
  const [now, setNow] = useState(() => Date.now() + serverOffset);
  useEffect(() => {
    const t = setInterval(() => setNow(Date.now() + serverOffset), intervalMs);
    return () => clearInterval(t);
  }, [intervalMs]);
  return now;
}

export function GameProvider({ children, onLogout }: { children: (state: 'loading' | 'ready') => ReactNode; onLogout: () => void }) {
  const [me, setMe] = useState<MeResponse | null>(null);
  const [world, setWorld] = useState<(WorldInfo & { offset: number }) | null>(null);
  const [villageId, setVillageIdState] = useState<number>(readStoredVillage);
  const [village, setVillage] = useState<VillageState | null>(null);
  const [toasts, setToasts] = useState<Toast[]>([]);
  const villageIdRef = useRef(villageId);
  villageIdRef.current = villageId;

  const toast = useCallback((text: string, kind: Toast['kind'] = 'info') => {
    const id = Math.random();
    setToasts((t) => [...t.slice(-3), { id, text, kind }]);
    setTimeout(() => setToasts((t) => t.filter((x) => x.id !== id)), kind === 'error' ? 5000 : 4000);
  }, []);

  const logout = useCallback(() => {
    api('/api/auth/logout', { method: 'POST' }).catch(() => undefined);
    setToken(null);
    onLogout();
  }, [onLogout]);

  const handleError = useCallback(
    (err: unknown) => {
      if (err instanceof ApiError && err.status === 401) return logout();
      toast(err instanceof Error ? err.message : 'Erreur inconnue', 'error');
    },
    [logout, toast],
  );

  const refreshMe = useCallback(async () => {
    try {
      const data = await api<MeResponse>('/api/me');
      setMe(data);
      if (data.villages.length && !data.villages.some((v) => v.id === villageIdRef.current)) {
        setVillageIdState(data.villages[0].id);
      }
    } catch (err) {
      handleError(err);
    }
  }, [handleError]);

  const refreshVillage = useCallback(async () => {
    const id = villageIdRef.current;
    if (!id) return;
    try {
      const v = await api<VillageState>(`/api/villages/${id}`);
      if (v.id === villageIdRef.current) setVillage(v);
    } catch (err) {
      if (err instanceof ApiError && err.status === 403) return refreshMe();
      handleError(err);
    }
  }, [handleError, refreshMe]);

  const run = useCallback(
    async <T,>(fn: () => Promise<T>) => {
      try {
        return await fn();
      } catch (err) {
        handleError(err);
        return undefined;
      }
    },
    [handleError],
  );

  const setVillageId = useCallback((id: number) => {
    setVillageIdState(id);
    setVillage(null);
    try {
      localStorage.setItem(VILLAGE_KEY, String(id));
    } catch {
      /* ignoré */
    }
  }, []);

  // Chargement initial.
  useEffect(() => {
    (async () => {
      try {
        const w = await api<WorldInfo>('/api/world');
        serverOffset = new Date(w.serverTime).getTime() - Date.now();
        setWorld({ ...w, offset: serverOffset });
      } catch (err) {
        handleError(err);
      }
      await refreshMe();
    })();
  }, [refreshMe, handleError]);

  useEffect(() => {
    if (villageId) refreshVillage();
  }, [villageId, refreshVillage]);

  // Rafraîchit le village au moment du prochain événement connu (construction finie, unité prête, troupes arrivées).
  useEffect(() => {
    if (!village) return;
    const times: number[] = [];
    for (const q of village.buildQueue) times.push(Date.parse(q.finishAt));
    for (const q of village.recruitQueue) times.push(Date.parse(q.startAt) + (q.delivered + 1) * q.unitSeconds * 1000);
    for (const c of [...village.incoming, ...village.outgoing]) times.push(Date.parse(c.arriveAt));
    const now = Date.now() + serverOffset;
    const next = Math.min(...times.filter((t) => t > now - 5000));
    if (!Number.isFinite(next)) return;
    const timer = setTimeout(refreshVillage, Math.max(300, next - now + 600));
    return () => clearTimeout(timer);
  }, [village, refreshVillage]);

  // Canal temps réel avec reconnexion automatique.
  useEffect(() => {
    let socket: WebSocket | null = null;
    let closed = false;
    let retry = 1000;
    const connect = () => {
      socket = new WebSocket(wsUrl(`/ws?token=${getToken() ?? ''}`));
      socket.onopen = () => (retry = 1000);
      socket.onmessage = (e) => {
        const msg = JSON.parse(e.data);
        if (msg.type === 'village' && msg.villageId === villageIdRef.current) refreshVillage();
        if (msg.type === 'me') refreshMe();
        if (msg.type === 'report') {
          toast(`Nouveau rapport : ${msg.title}`);
          refreshMe();
        }
        if (msg.type === 'message') {
          toast(`Nouveau message de ${msg.from}`);
          refreshMe();
        }
        if (msg.type === 'incoming') {
          toast('Une attaque se dirige vers votre village !', 'warning');
          alertHaptic();
          if ('Notification' in window && Notification.permission === 'granted') new Notification('Aldoria War', { body: 'Une attaque arrive sur votre village !' });
          if (msg.villageId === villageIdRef.current) refreshVillage();
        }
      };
      socket.onclose = (e) => {
        if (closed || e.code === 4001) return;
        setTimeout(connect, retry);
        retry = Math.min(retry * 2, 30000);
      };
    };
    connect();
    return () => {
      closed = true;
      socket?.close();
    };
  }, [refreshMe, refreshVillage, toast]);

  const value = useMemo<GameCtx | null>(
    () =>
      me && world
        ? { me, world, villageId, village, setVillageId, refreshMe, refreshVillage, setVillage, toast, run, logout }
        : null,
    [me, world, villageId, village, setVillageId, refreshMe, refreshVillage, toast, run, logout],
  );

  return (
    <>
      {value ? <Ctx.Provider value={value}>{children('ready')}</Ctx.Provider> : children('loading')}
      <div className="toasts" role="status" aria-live="polite">
        {toasts.map((t) => (
          <div key={t.id} className={`toast toast-${t.kind}`}>
            {t.text}
          </div>
        ))}
      </div>
    </>
  );
}

/** Routage par ancre (#/carte, #/rapports/12…), simple et compatible avec une PWA. */
export function useRoute(): [string[], (path: string) => void] {
  const parse = () => location.hash.replace(/^#\/?/, '').split('/').filter(Boolean);
  const [parts, setParts] = useState(parse);
  useEffect(() => {
    const on = () => setParts(parse());
    window.addEventListener('hashchange', on);
    return () => window.removeEventListener('hashchange', on);
  }, []);
  return [parts, (path: string) => (location.hash = `#/${path}`)];
}
