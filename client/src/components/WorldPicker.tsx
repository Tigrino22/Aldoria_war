import { useEffect, useState } from 'react';
import type { WorldChoice } from '@aldoria/shared';
import { api, ApiError } from '../api';
import { logo, villageBg } from '../assets';
import { ago, fmt } from '../format';
import './auth.css';

export interface SessionWorld {
  id: number;
  name: string;
}

/** Choix du monde après la connexion : ceux où le joueur est inscrit d'abord, puis les mondes qu'il peut rejoindre. */
export default function WorldPicker({ username, current, onEnter, onLogout, onBack }: {
  username: string;
  current: SessionWorld | null;
  onEnter: (w: SessionWorld) => void;
  onLogout: () => void;
  onBack?: () => void;
}) {
  const [worlds, setWorlds] = useState<WorldChoice[] | null>(null);
  const [error, setError] = useState('');
  const [busy, setBusy] = useState<number | null>(null);

  useEffect(() => {
    api<WorldChoice[]>('/api/worlds').then(setWorlds, (err) => {
      if (err instanceof ApiError && err.status === 401) return onLogout();
      setError(err instanceof Error ? err.message : 'Erreur');
    });
  }, [onLogout]);

  async function enter(w: WorldChoice) {
    setBusy(w.id);
    setError('');
    try {
      const res = await api<{ world: SessionWorld }>(`/api/worlds/${w.id}/enter`, { method: 'POST', body: {} });
      onEnter(res.world);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Erreur');
      setBusy(null);
    }
  }

  const mine = worlds?.filter((w) => w.member) ?? [];
  const others = worlds?.filter((w) => !w.member) ?? [];
  const row = (w: WorldChoice) => (
    <li key={w.id}>
      <button type="button" className={`world-row${w.id === current?.id ? ' current' : ''}`} onClick={() => enter(w)} disabled={busy !== null}>
        <span className="world-name">
          {w.name}
          {w.id === current?.id && <small>monde actuel</small>}
        </span>
        <span className="world-facts">
          {w.member
            ? `${w.member.villages > 1 ? `${w.member.villages} villages` : w.member.villages === 1 ? '1 village' : 'aucun village'} · ${fmt(w.member.points)} points · joué ${ago(w.member.lastPlayed)}`
            : `${w.players} joueur${w.players > 1 ? 's' : ''} · vitesse ×${w.speed} · carte ${w.mapSize}×${w.mapSize}`}
        </span>
        <span className="world-go">{busy === w.id ? '…' : w.member ? 'Jouer' : 'Rejoindre'}</span>
      </button>
    </li>
  );

  return (
    <div className="auth" style={{ backgroundImage: `url("${villageBg}")` }}>
      <div className="auth-card worlds-card">
        <img src={logo} alt="" width={64} height={64} />
        <h1>Choisissez un monde</h1>
        <p className="muted">Bienvenue, {username}. Un même compte joue dans plusieurs mondes, chacun avec sa carte et ses rivaux.</p>
        {!worlds && !error && <p className="hint">Chargement des mondes…</p>}
        {mine.length > 0 && (
          <>
            <label>Mes mondes</label>
            <ul className="world-list">{mine.map(row)}</ul>
          </>
        )}
        {others.length > 0 && (
          <>
            <label>{mine.length ? 'Autres mondes' : 'Mondes ouverts'}</label>
            <ul className="world-list">{others.map(row)}</ul>
          </>
        )}
        {worlds && worlds.length === 0 && <p className="hint">Aucun monde n’accepte de nouveaux joueurs pour le moment.</p>}
        {error && <p className="error">{error}</p>}
        <div className="world-actions">
          {onBack && current && (
            <button type="button" className="btn" onClick={onBack}>
              Revenir à {current.name}
            </button>
          )}
          <button type="button" className="btn ghost" onClick={onLogout}>
            Se déconnecter
          </button>
        </div>
      </div>
    </div>
  );
}
