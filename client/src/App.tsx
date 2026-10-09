import { useState } from 'react';
import { getToken } from './api';
import { logo } from './assets';
import Auth from './components/Auth';
import Layout from './components/Layout';
import { GameProvider } from './game';

export default function App() {
  const [token, setTok] = useState(getToken());
  if (!token) return <Auth onLogin={() => setTok(getToken())} />;
  return (
    <GameProvider key={token} onLogout={() => setTok(null)}>
      {(state) =>
        state === 'loading' ? (
          <div className="splash">
            <img src={logo} alt="" width={96} height={96} />
            <p>Chargement du royaume…</p>
          </div>
        ) : (
          <Layout />
        )
      }
    </GameProvider>
  );
}
