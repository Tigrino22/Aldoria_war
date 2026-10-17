import { useCallback, useEffect, useMemo, useState, type ReactNode } from 'react';
import type { AdminWorldSummary, MeResponse } from '@aldoria/shared';
import { api, ApiError, configureApi, getToken, setToken } from '../api';
import { logo } from '../assets';
import Admin from '../components/Admin';
import Auth from '../components/Auth';
import { NavIcon } from '../components/NavIcon';
import '../components/nav.css';
import { GameContext, useRoute, type GameCtx, type Toast } from '../game';
import Accounts from './Accounts';
import NewWorld from './NewWorld';
import Worlds, { WorldHeader } from './Worlds';
import './dashboard.css';

interface SessionInfo {
  account: { id: number; username: string; isAdmin: boolean };
}

/**
 * Tableau de bord d'administration, séparé du jeu (page /admin). Il n'affiche rien d'autre que la connexion tant que
 * le compte n'est pas administrateur ; le serveur refuse de toute façon chaque route d'administration aux autres comptes.
 */
export default function Dashboard() {
  const [token, setTok] = useState(getToken());
  const [session, setSession] = useState<SessionInfo | null>(null);
  const [denied, setDenied] = useState(false);

  const logout = useCallback(() => {
    api('/api/auth/logout', { method: 'POST' }).catch(() => undefined);
    setToken(null);
    setSession(null);
    setTok(null);
  }, []);

  useEffect(() => {
    if (!token) return;
    api<SessionInfo>('/api/session').then(
      (s) => {
        if (s.account.isAdmin) return setSession(s);
        // Compte ordinaire : on referme aussitôt sa session du tableau de bord.
        setDenied(true);
        logout();
      },
      (err) => {
        if (err instanceof ApiError && err.status === 401) logout();
      },
    );
  }, [token, logout]);

  if (!token || !session) {
    if (token && !denied) return <div className="splash"><img src={logo} alt="" width={96} height={96} /><p>Connexion…</p></div>;
    return (
      <>
        <Auth
          title="Administration"
          lead={denied ? 'Ce compte n’est pas administrateur : l’accès au tableau de bord lui est refusé.' : 'Réservé aux administrateurs d’Aldoria War.'}
          allowRegister={false}
          onLogin={() => {
            setDenied(false);
            setTok(getToken());
          }}
        />
      </>
    );
  }
  return <Shell username={session.account.username} onLogout={logout} />;
}

function Shell({ username, onLogout }: { username: string; onLogout: () => void }) {
  const [route, go] = useRoute();
  const [worlds, setWorlds] = useState<AdminWorldSummary[] | null>(null);
  const [toasts, setToasts] = useState<Toast[]>([]);

  const toast = useCallback((text: string, kind: Toast['kind'] = 'info') => {
    const id = Math.random();
    setToasts((t) => [...t.slice(-3), { id, text, kind }]);
    setTimeout(() => setToasts((t) => t.filter((x) => x.id !== id)), kind === 'error' ? 5000 : 4000);
  }, []);
  const run = useCallback(
    async <T,>(fn: () => Promise<T>) => {
      try {
        return await fn();
      } catch (err) {
        if (err instanceof ApiError && (err.status === 401 || err.status === 403)) onLogout();
        else toast(err instanceof Error ? err.message : 'Erreur inconnue', 'error');
        return undefined;
      }
    },
    [toast, onLogout],
  );
  const reload = useCallback(() => run(async () => setWorlds(await api<AdminWorldSummary[]>('/api/admin/worlds'))), [run]);
  useEffect(() => {
    configureApi({ world: null });
    reload();
  }, [reload]);

  const page = route[0] ?? 'mondes';
  const worldId = page === 'monde' ? Number(route[1]) : null;
  const world = worlds?.find((w) => w.id === worldId) ?? null;
  // Les pages d'administration d'un monde visent ce monde (en-tête x-world) ; les autres pages, aucun.
  configureApi({ world: worldId });

  // Contexte minimal pour réutiliser les onglets d'administration du jeu (PNJ, guerres, joueurs, réglages…).
  const ctx = useMemo(
    () =>
      ({
        me: { isAdmin: true, openModerationReports: 0, openBugReports: 0 } as unknown as MeResponse,
        run,
        toast,
        refreshMe: async () => undefined,
        logout: onLogout,
      }) as unknown as GameCtx,
    [run, toast, onLogout],
  );

  const link = (path: string, label: ReactNode, icon: Parameters<typeof NavIcon>[0]['name'], active: boolean) => (
    <a key={path} href={`#/${path}`} className={active ? 'active' : ''}>
      <span className="nav-medal"><NavIcon name={icon} /></span>
      <span>{label}</span>
    </a>
  );

  return (
    <GameContext value={ctx}>
      <div className="app dash">
        <header className="topbar">
          <a className="brand" href="#/mondes">
            <img src={logo} alt="" width={32} height={32} />
            <span>Aldoria War</span>
          </a>
          <span className="dash-title">Administration</span>
          <span className="who" title="Compte administrateur">
            <span className="avatar">{username[0]}</span>
            <span className="who-txt"><b>{username}</b><i>administrateur</i></span>
          </span>
        </header>
        <div className="body">
          <aside className="side">
            <nav className="side-group" aria-label="Tableau de bord">
              <h4>Tableau de bord</h4>
              {link('mondes', 'Tous les mondes', 'monde', page === 'mondes')}
              {link('joueurs', 'Tous les joueurs', 'compte', page === 'joueurs')}
              {link('nouveau', 'Nouveau monde', 'banniere', page === 'nouveau')}
            </nav>
            <nav className="side-group" aria-label="Mondes">
              <h4>Mondes</h4>
              {(worlds ?? []).map((w) => link(`monde/${w.id}`, w.name, 'carte', w.id === worldId))}
            </nav>
            <a className="side-quit" href="/">
              <NavIcon name="village" size={18} />
              Retour au jeu
            </a>
            <button className="side-quit" onClick={onLogout}>
              <NavIcon name="quitter" size={18} />
              Se déconnecter
            </button>
          </aside>
          <main className="content">
            <select className="dash-mnav" aria-label="Page" value={worldId ? `monde/${worldId}` : page} onChange={(e) => go(e.target.value)}>
              <option value="mondes">Tous les mondes</option>
              <option value="joueurs">Tous les joueurs</option>
              <option value="nouveau">Nouveau monde</option>
              {(worlds ?? []).map((w) => (
                <option key={w.id} value={`monde/${w.id}`}>Monde {w.name}</option>
              ))}
            </select>
            {page === 'mondes' && <Worlds worlds={worlds} onChanged={reload} />}
            {page === 'joueurs' && <Accounts />}
            {page === 'nouveau' && (
              <NewWorld
                onCreated={async (w) => {
                  await reload();
                  toast(`Monde ${w.name} créé`);
                  go(`monde/${w.id}`);
                }}
              />
            )}
            {page === 'monde' &&
              (world ? (
                <Admin key={world.id} header={<WorldHeader world={world} onChanged={reload} />} />
              ) : (
                <p className="muted">{worlds ? 'Monde introuvable.' : 'Chargement…'}</p>
              ))}
          </main>
        </div>
        <div className="toasts" role="status" aria-live="polite">
          {toasts.map((t) => (
            <div key={t.id} className={`toast toast-${t.kind}`}>{t.text}</div>
          ))}
        </div>
      </div>
    </GameContext>
  );
}
