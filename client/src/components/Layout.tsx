import { lazy, Suspense } from 'react';
import { logo, NAV_IMG } from '../assets';
import { useGame, useRoute } from '../game';
import Barracks from './Barracks';
import Messages from './Messages';
import RallyPoint from './RallyPoint';
import Ranking from './Ranking';
import Reports from './Reports';
import Market from './Market';
import Account from './Account';
import ResourceBar from './ResourceBar';
import Tribe from './Tribe';
import VillageView from './VillageView';
import Wiki from './Wiki';
import { api } from '../api';

// La carte embarque PixiJS : elle n'est chargée qu'à la première ouverture.
const MapView = lazy(() => import('./MapView'));

const NAV: { path: keyof typeof NAV_IMG; label: string }[] = [
  { path: 'village', label: 'Village' },
  { path: 'caserne', label: 'Caserne' },
  { path: 'troupes', label: 'Troupes' },
  { path: 'carte', label: 'Carte' },
  { path: 'rapports', label: 'Rapports' },
  { path: 'messages', label: 'Messages' },
  { path: 'tribu', label: 'Tribu' },
  { path: 'classement', label: 'Classement' },
];

export default function Layout() {
  const { me, villageId, setVillageId, logout, run, refreshMe } = useGame();
  const [route, go] = useRoute();
  const page = route[0] ?? 'village';
  const badge = (path: string) => (path === 'rapports' ? me.unreadReports : path === 'messages' ? me.unreadMessages : path === 'tribu' ? me.invites.length : 0);

  if (!me.villages.length) {
    return (
      <div className="splash">
        <img src={logo} alt="" width={96} height={96} />
        <h1>Votre dernier village est tombé</h1>
        <p>Vos terres ont été conquises. Vous pouvez fonder un nouveau village ailleurs sur la carte.</p>
        <button className="btn primary" onClick={() => run(async () => { await api('/api/me/restart', { method: 'POST' }); await refreshMe(); })}>
          Fonder un nouveau village
        </button>
        <button className="btn" onClick={logout}>Se déconnecter</button>
      </div>
    );
  }

  return (
    <div className="app">
      <header className="topbar">
        <a className="brand" href="#/village">
          <img src={logo} alt="" width={32} height={32} />
          <span>Aldoria War</span>
        </a>
        <select aria-label="Village actif" value={villageId} onChange={(e) => setVillageId(Number(e.target.value))}>
          {me.villages.map((v) => (
            <option key={v.id} value={v.id}>
              {v.name} ({v.x}|{v.y})
            </option>
          ))}
        </select>
        <div className="who">
          <a href="#/compte" className="who-name">
            {me.player.username}
            {me.player.tribe && <b> [{me.player.tribe.tag}]</b>}
          </a>
          <span className="muted">{me.player.points.toLocaleString('fr-FR')} pts</span>
          <a href="#/wiki" className="who-wiki">Wiki</a>
          <button className="link" onClick={logout}>Quitter</button>
        </div>
      </header>
      <ResourceBar />
      <main className="content">
        {page === 'village' && <VillageView />}
        {page === 'caserne' && <Barracks />}
        {page === 'troupes' && <RallyPoint />}
        {page === 'carte' && (
          <Suspense fallback={<p className="muted">Chargement de la carte…</p>}>
            <MapView focus={route[1]} />
          </Suspense>
        )}
        {page === 'rapports' && <Reports id={route[1] ? Number(route[1]) : undefined} />}
        {page === 'messages' && <Messages id={route[1] ? Number(route[1]) : undefined} />}
        {page === 'tribu' && <Tribe id={route[1] ? Number(route[1]) : undefined} />}
        {page === 'classement' && <Ranking />}
        {page === 'marche' && <Market focus={route[1]} />}
        {page === 'compte' && <Account />}
        {page === 'wiki' && <Wiki section={route[1]} item={route[2]} />}
      </main>
      <nav className="nav">
        {NAV.map((n) => (
          <button key={n.path} className={page === n.path ? 'active' : ''} onClick={() => go(n.path)}>
            <img className="nav-icon" src={NAV_IMG[n.path]} alt="" width={26} height={26} />
            <span className="nav-label">{n.label}</span>
            {badge(n.path) > 0 && <span className="badge">{badge(n.path)}</span>}
          </button>
        ))}
      </nav>
    </div>
  );
}
