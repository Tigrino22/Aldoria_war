import { useState } from 'react';
import { api } from '../api';
import { useGame } from '../game';
import { Panel } from '../ui';

/** Compte : déconnexion, données personnelles et suppression définitive du compte. */
export default function Account() {
  const { me, logout, run } = useGame();
  const [confirming, setConfirming] = useState(false);
  const [password, setPassword] = useState('');

  const remove = () =>
    run(async () => {
      await api('/api/me', { method: 'DELETE', body: { password } });
      logout();
    });

  return (
    <div className="stack">
      <Panel title="Mon compte">
        <p>
          Connecté en tant que <b>{me.player.username}</b>
          {me.player.tribe && <> · tribu [{me.player.tribe.tag}] {me.player.tribe.name}</>}
        </p>
        <div className="row">
          <button className="btn" onClick={logout}>Se déconnecter</button>
        </div>
      </Panel>

      <Panel title="Vos données">
        <p className="small">
          Aldoria War conserve uniquement votre pseudo, votre mot de passe chiffré et vos données de jeu (villages, troupes,
          rapports, messages). Aucune publicité, aucun pistage, aucune donnée revendue.
        </p>
      </Panel>

      <Panel title="Supprimer mon compte">
        <p className="small">
          La suppression est définitive : vos villages deviennent des villages barbares, vos troupes en route sont perdues,
          vos rapports et messages sont effacés.
        </p>
        {!confirming ? (
          <button className="btn danger" onClick={() => setConfirming(true)}>Supprimer mon compte…</button>
        ) : (
          <div className="market-form">
            <label htmlFor="delete-password">Confirmez avec votre mot de passe</label>
            <input id="delete-password" type="password" autoComplete="current-password" value={password} onChange={(e) => setPassword(e.target.value)} />
            <div className="row">
              <button className="btn danger" disabled={!password} onClick={remove}>Supprimer définitivement</button>
              <button className="btn" onClick={() => { setConfirming(false); setPassword(''); }}>Annuler</button>
            </div>
          </div>
        )}
      </Panel>
    </div>
  );
}
