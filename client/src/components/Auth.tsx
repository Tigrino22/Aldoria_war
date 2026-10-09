import { useState, type FormEvent } from 'react';
import { api, setToken } from '../api';
import { logo, villageBg } from '../assets';

export default function Auth({ onLogin }: { onLogin: () => void }) {
  const [mode, setMode] = useState<'login' | 'register'>('login');
  const [username, setUsername] = useState('');
  const [password, setPassword] = useState('');
  const [error, setError] = useState('');
  const [busy, setBusy] = useState(false);

  async function submit(e: FormEvent) {
    e.preventDefault();
    setBusy(true);
    setError('');
    try {
      const { token } = await api<{ token: string }>(`/api/auth/${mode}`, { body: { username, password } });
      setToken(token);
      onLogin();
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Erreur');
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="auth" style={{ backgroundImage: `url("${villageBg}")` }}>
      <form className="auth-card" onSubmit={submit}>
        <img src={logo} alt="" width={72} height={72} />
        <h1>Fiefs</h1>
        <p className="muted">Bâtissez votre village, levez une armée, conquérez vos voisins.</p>
        <div className="tabs" role="tablist">
          <button type="button" role="tab" aria-selected={mode === 'login'} onClick={() => setMode('login')}>
            Connexion
          </button>
          <button type="button" role="tab" aria-selected={mode === 'register'} onClick={() => setMode('register')}>
            Inscription
          </button>
        </div>
        <label htmlFor="username">Pseudo</label>
        <input id="username" value={username} onChange={(e) => setUsername(e.target.value)} autoComplete="username" required minLength={3} maxLength={20} />
        <label htmlFor="password">Mot de passe</label>
        <input
          id="password"
          type="password"
          value={password}
          onChange={(e) => setPassword(e.target.value)}
          autoComplete={mode === 'login' ? 'current-password' : 'new-password'}
          required
          minLength={6}
        />
        {error && <p className="error">{error}</p>}
        <button className="btn primary" disabled={busy}>
          {mode === 'login' ? 'Entrer dans le royaume' : 'Fonder mon village'}
        </button>
        {mode === 'register' && <p className="hint">Vous serez protégé des attaques pendant vos premiers jours.</p>}
      </form>
    </div>
  );
}
