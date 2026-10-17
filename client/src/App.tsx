import { useCallback, useEffect, useState } from 'react';
import { api, ApiError, getToken, setToken } from './api';
import { logo } from './assets';
import Auth from './components/Auth';
import Layout from './components/Layout';
import WorldPicker, { type SessionWorld } from './components/WorldPicker';
import { GameProvider } from './game';

interface SessionInfo {
  account: { id: number; username: string; isAdmin: boolean };
  world: SessionWorld | null;
}

const Splash = ({ text }: { text: string }) => (
  <div className="splash">
    <img src={logo} alt="" width={96} height={96} />
    <p>{text}</p>
  </div>
);

export default function App() {
  const [token, setTok] = useState(getToken());
  const [session, setSession] = useState<SessionInfo | null>(null);
  const [picking, setPicking] = useState(false);

  const logout = useCallback(() => {
    api('/api/auth/logout', { method: 'POST' }).catch(() => undefined);
    setToken(null);
    setSession(null);
    setPicking(false);
    setTok(null);
  }, []);

  // Le compte connecté et son monde : sans monde choisi, la liste des mondes s'affiche.
  useEffect(() => {
    if (!token) return;
    let alive = true;
    api<SessionInfo>('/api/session').then(
      (s) => alive && setSession(s),
      (err) => {
        if (!alive) return;
        if (err instanceof ApiError && err.status === 401) logout();
        else setSession({ account: { id: 0, username: '', isAdmin: false }, world: null });
      },
    );
    return () => {
      alive = false;
    };
  }, [token, logout]);

  if (!token) return <Auth onLogin={() => setTok(getToken())} />;
  if (!session) return <Splash text="Connexion…" />;
  if (!session.world || picking) {
    return (
      <WorldPicker
        username={session.account.username}
        current={session.world}
        onEnter={(world) => {
          setSession({ ...session, world });
          setPicking(false);
        }}
        onBack={() => setPicking(false)}
        onLogout={logout}
      />
    );
  }
  return (
    <GameProvider key={`${token}:${session.world.id}`} onLogout={logout} onChooseWorld={() => setPicking(true)}>
      {(state) => (state === 'loading' ? <Splash text="Chargement du royaume…" /> : <Layout />)}
    </GameProvider>
  );
}
