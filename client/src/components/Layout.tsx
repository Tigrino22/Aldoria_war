import { lazy, Suspense, useEffect, useState } from 'react';
import { RESOURCES } from '@aldoria/shared';
import { buildingImg, logo, MAP_IMG, NAV_IMG, RESOURCE_IMG, UNIT_IMG } from '../assets';
import { fmt } from '../format';
import { useGame, useNow, useRoute } from '../game';
import { liveResources } from '../ui';
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
import Overview from './Overview';
import Profile from './Profile';
import Wiki from './Wiki';
import { api } from '../api';

// La carte embarque PixiJS : elle n'est chargée qu'à la première ouverture.
const MapView = lazy(() => import('./MapView'));

interface NavItem {
  path: string;
  label: string;
  img: string;
}

// Menu complet, groupé : menu latéral sur ordinateur, tiroir « Menu » sur mobile.
const GROUPS: { title: string; items: NavItem[] }[] = [
  {
    title: 'Village',
    items: [
      { path: 'village', label: 'Vue du village', img: NAV_IMG.village },
      { path: 'village/hotel', label: 'Hôtel de ville', img: buildingImg('townhall', 15) },
      { path: 'caserne', label: 'Caserne', img: NAV_IMG.caserne },
      { path: 'marche', label: 'Marché', img: buildingImg('market', 15) },
      { path: 'apercu', label: 'Mes villages', img: MAP_IMG.village3 },
    ],
  },
  {
    title: 'Armée',
    items: [
      { path: 'troupes', label: 'Troupes', img: NAV_IMG.troupes },
      { path: 'carte', label: 'Carte', img: NAV_IMG.carte },
    ],
  },
  {
    title: 'Social',
    items: [
      { path: 'rapports', label: 'Rapports', img: NAV_IMG.rapports },
      { path: 'messages', label: 'Messages', img: NAV_IMG.messages },
      { path: 'tribu', label: 'Tribu', img: NAV_IMG.tribu },
      { path: 'classement', label: 'Classement', img: NAV_IMG.classement },
    ],
  },
  {
    title: 'Aide',
    items: [
      { path: 'wiki', label: 'Wiki', img: NAV_IMG.rapports },
      { path: 'compte', label: 'Mon compte', img: UNIT_IMG.noble },
    ],
  },
];
const ALL_ITEMS = GROUPS.flatMap((g) => g.items);
/** Les quatre entrées toujours visibles en bas de l'écran sur mobile, le reste est dans « Menu ». */
const TAB_PATHS = ['village', 'carte', 'troupes', 'rapports'];
const TAB_ITEMS = TAB_PATHS.map((p) => ALL_ITEMS.find((n) => n.path === p)!);

/** Ressources du village actif, dans la barre du haut (ordinateur). */
function TopResources() {
  const { village } = useGame();
  const now = useNow();
  if (!village) return null;
  const res = liveResources(village, now);
  return (
    <div className="top-res">
      {RESOURCES.map((r) => (
        <span key={r} className={`tr ${res[r] >= village.capacity ? 'full' : ''}`} title={`${fmt(village.rates[r])} par heure`}>
          <img src={RESOURCE_IMG[r]} alt="" width={22} height={22} />
          <span className="tr-txt">
            <b>{fmt(res[r])}</b>
            <i className={village.rates[r] < 0 ? 'neg' : ''}>
              {village.rates[r] >= 0 ? '+' : ''}
              {fmt(village.rates[r])}/h
            </i>
          </span>
          <span className="tr-fill" style={{ width: `${Math.min(100, (res[r] / village.capacity) * 100)}%` }} />
        </span>
      ))}
      <span className="tr cap" title="Capacité de l'entrepôt">
        <span className="tr-txt">
          <i>Entrepôt</i>
          <b>{fmt(village.capacity)}</b>
        </span>
      </span>
    </div>
  );
}

export default function Layout() {
  const { me, villageId, setVillageId, logout, run, refreshMe } = useGame();
  const [route, go] = useRoute();
  const page = route[0] ?? 'village';
  const [drawer, setDrawer] = useState(false);
  useEffect(() => setDrawer(false), [route.join('/')]);
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

  const here = route.length > 1 && ALL_ITEMS.some((n) => n.path === route.slice(0, 2).join('/')) ? route.slice(0, 2).join('/') : page;
  const drawerBadge = badge('messages') + badge('tribu');
  const shiftVillage = (d: number) => {
    const i = me.villages.findIndex((x) => x.id === villageId);
    setVillageId(me.villages[(i + d + me.villages.length) % me.villages.length].id);
  };

  return (
    <div className="app">
      <header className="topbar">
        <a className="brand" href="#/village">
          <img src={logo} alt="" width={32} height={32} />
          <span>Aldoria War</span>
        </a>
        <div className="vswitch">
          <button aria-label="Village précédent" disabled={me.villages.length < 2} onClick={() => shiftVillage(-1)}>
            ‹
          </button>
          <select aria-label="Village actif" value={villageId} onChange={(e) => setVillageId(Number(e.target.value))}>
            {me.villages.map((v) => (
              <option key={v.id} value={v.id}>
                {v.name} ({v.x}|{v.y})
              </option>
            ))}
          </select>
          <button aria-label="Village suivant" disabled={me.villages.length < 2} onClick={() => shiftVillage(1)}>
            ›
          </button>
        </div>
        <TopResources />
        <a href="#/compte" className="who">
          <span className="avatar">{me.player.username[0]}</span>
          <span className="who-txt">
            <b>
              {me.player.username}
              {me.player.tribe && <> [{me.player.tribe.tag}]</>}
            </b>
            <i>{me.player.points.toLocaleString('fr-FR')} pts</i>
          </span>
        </a>
      </header>
      <div className="mob-res">
        <ResourceBar />
      </div>
      <div className="body">
        <aside className="side">
          {GROUPS.map((g) => (
            <nav key={g.title} className="side-group" aria-label={g.title}>
              <h4>{g.title}</h4>
              {g.items.map((n) => (
                <a key={n.path} href={`#/${n.path}`} className={here === n.path ? 'active' : ''}>
                  <img src={n.img} alt="" width={28} height={28} />
                  <span>{n.label}</span>
                  {badge(n.path) > 0 && <span className="badge-pill">{badge(n.path)}</span>}
                </a>
              ))}
            </nav>
          ))}
          <button className="side-quit" onClick={logout}>
            Se déconnecter
          </button>
        </aside>
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
          {page === 'messages' && <Messages id={route[1] && route[1] !== 'ecrire' ? Number(route[1]) : undefined} to={route[1] === 'ecrire' && route[2] ? decodeURIComponent(route[2]) : undefined} />}
          {page === 'joueur' && route[1] && <Profile name={decodeURIComponent(route[1])} />}
          {page === 'tribu' && <Tribe id={route[1] ? Number(route[1]) : undefined} />}
          {page === 'classement' && <Ranking />}
          {page === 'marche' && <Market focus={route[1]} />}
          {page === 'compte' && <Account />}
          {page === 'apercu' && <Overview />}
          {page === 'wiki' && <Wiki section={route[1]} item={route[2]} />}
        </main>
      </div>
      <nav className="nav" aria-label="Navigation">
        {TAB_ITEMS.map((n) => (
          <button key={n.path} className={page === n.path && !drawer ? 'active' : ''} onClick={() => (setDrawer(false), go(n.path))}>
            <img className="nav-icon" src={n.img} alt="" width={26} height={26} />
            <span className="nav-label">{n.path === 'village' ? 'Village' : n.label}</span>
            {badge(n.path) > 0 && <span className="badge">{badge(n.path)}</span>}
          </button>
        ))}
        <button className={drawer ? 'active' : ''} aria-expanded={drawer} onClick={() => setDrawer((d) => !d)}>
          <span className="burger" aria-hidden>
            <i />
            <i />
            <i />
          </span>
          <span className="nav-label">Menu</span>
          {drawerBadge > 0 && !drawer && <span className="badge">{drawerBadge}</span>}
        </button>
      </nav>
      {drawer && (
        <div className="sheet-backdrop" onClick={() => setDrawer(false)}>
          <div className="sheet" onClick={(e) => e.stopPropagation()}>
            <div className="sheet-grip" />
            {GROUPS.map((g) => (
              <section key={g.title}>
                <h4>{g.title}</h4>
                <div className="sheet-grid">
                  {g.items.map((n) => (
                    <a key={n.path} href={`#/${n.path}`} className={here === n.path ? 'active' : ''}>
                      <img src={n.img} alt="" width={38} height={38} />
                      <span>{n.label}</span>
                      {badge(n.path) > 0 && <span className="badge">{badge(n.path)}</span>}
                    </a>
                  ))}
                </div>
              </section>
            ))}
            <button className="btn ghost sheet-quit" onClick={logout}>
              Se déconnecter
            </button>
          </div>
        </div>
      )}
    </div>
  );
}
