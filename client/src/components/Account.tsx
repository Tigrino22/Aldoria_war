import { useEffect, useState } from 'react';
import type { CrusadeTitleKey, PlayerTitleView } from '@aldoria/shared';
import { api } from '../api';
import { useGame } from '../game';
import { Panel } from '../ui';
import { PageBanner } from './PageBanner';
import './account.css';

/** Compte : déconnexion, données personnelles et suppression définitive du compte. */
export default function Account() {
  const { me, world, logout, chooseWorld, run } = useGame();
  const [confirming, setConfirming] = useState(false);
  const [password, setPassword] = useState('');
  const [titles, setTitles] = useState<{ titles: PlayerTitleView[]; current: CrusadeTitleKey | null } | null>(null);
  useEffect(() => {
    run(async () => setTitles(await api('/api/me/titles')));
  }, [run]);
  const choose = (title: CrusadeTitleKey | null) =>
    run(async () => {
      await api('/api/me/title', { method: 'PUT', body: { title } });
      setTitles((t) => (t ? { ...t, current: title } : t));
    });
  const earned = titles?.titles.filter((t) => t.earnedAt) ?? [];

  const remove = () =>
    run(async () => {
      await api('/api/me', { method: 'DELETE', body: { password } });
      logout();
    });

  return (
    <div className="pg account">
      <PageBanner
        icon="compte"
        kicker="Mon compte"
        title={me.player.username}
        lead={me.player.tribe ? <>Membre de la tribu <b>[{me.player.tribe.tag}] {me.player.tribe.name}</b></> : 'Sans tribu pour le moment'}
        actions={
          <>
            <button className="btn" onClick={chooseWorld}>Changer de monde</button>
            <button className="btn" onClick={logout}>Se déconnecter</button>
          </>
        }
        stats={[
          { value: me.player.points, label: 'Points', tone: 'gold' },
          { value: me.villages.length, label: me.villages.length > 1 ? 'Villages' : 'Village' },
          { value: world.name, label: 'Monde' },
        ]}
      />

      <Panel title="Titres de croisade">
        <p className="small">
          Les titres se gagnent aux <a href="#/croisade">Croisades</a>. Celui que vous choisissez s'affiche à côté de votre nom dans les classements de gloire et sur votre profil.
        </p>
        {!titles ? (
          <p className="muted">Chargement…</p>
        ) : (
          <div className="titles-grid">
            {titles.titles.map((t) => {
              const on = titles.current === t.key;
              return (
                <button
                  key={t.key}
                  className={`title-card ${t.earnedAt ? 'earned' : 'locked'} ${on ? 'on' : ''}`}
                  disabled={!t.earnedAt}
                  aria-pressed={on}
                  onClick={() => choose(on ? null : t.key)}
                >
                  <b>{t.label}</b>
                  <span>{t.help}</span>
                  <i>{on ? 'Affiché' : t.earnedAt ? `Gagné le ${new Date(t.earnedAt).toLocaleDateString('fr-FR')}` : 'À gagner'}</i>
                </button>
              );
            })}
          </div>
        )}
        {earned.length === 0 && titles && <p className="small muted">Vous n'avez encore aucun titre : combattez à la prochaine croisade pour gagner celui de Croisé.</p>}
      </Panel>

      <Panel title="Vos données">
        <p className="small">
          Aldoria War conserve uniquement votre pseudo, votre mot de passe chiffré et vos données de jeu (villages, troupes,
          rapports, messages). Aucune publicité, aucun pistage, aucune donnée revendue.
        </p>
      </Panel>

      <Panel title="Supprimer mon compte">
        <p className="small">
          La suppression est définitive et vaut pour tous vos mondes : vos villages deviennent des villages barbares, vos
          troupes en route sont perdues, vos rapports et messages sont effacés.
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
