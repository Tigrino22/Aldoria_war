import { lazy, Suspense, useEffect, useState } from 'react';
import { RESOURCES } from '@aldoria/shared';
import { logo, RESOURCE_IMG } from '../assets';
import { NavIcon, type NavIconName } from './NavIcon';
import './nav.css';
import { fmt } from '../format';
import { useGame, useNow, useRoute } from '../game';
import { liveResources } from '../ui';
import Barracks from './Barracks';
import RallyPoint from './RallyPoint';
import ResourceBar from './ResourceBar';
import TownHall from './TownHall';
import VillageView from './VillageView';
import { api } from '../api';

// La carte embarque PixiJS : elle n'alourdit pas le premier affichage, puis se précharge dès que le jeu est au repos.
const loadMap = () => import('./MapView');
const MapView = lazy(loadMap);

// Pages secondaires : chargées à la première visite (puis préchargées au repos), pour que le jeu s'ouvre plus vite.
const PAGES = {
  Messages: () => import('./Messages'),
  RallyPage: () => import('./RallyPage'),
  Ranking: () => import('./Ranking'),
  Reports: () => import('./Reports'),
  Market: () => import('./Market'),
  Account: () => import('./Account'),
  Tribe: () => import('./Tribe'),
  Manager: () => import('./Manager'),
  Overview: () => import('./Overview'),
  Profile: () => import('./Profile'),
  Wiki: () => import('./Wiki'),
  WorldStats: () => import('./WorldStats'),
  WorldWars: () => import('./WorldWars'),
  Admin: () => import('./Admin'),
  Raid: () => import('./Raid'),
};
const Messages = lazy(PAGES.Messages);
const RallyPage = lazy(PAGES.RallyPage);
const Ranking = lazy(PAGES.Ranking);
const Reports = lazy(PAGES.Reports);
const Market = lazy(PAGES.Market);
const Account = lazy(PAGES.Account);
const Tribe = lazy(PAGES.Tribe);
const Manager = lazy(PAGES.Manager);
const Overview = lazy(PAGES.Overview);
const Profile = lazy(PAGES.Profile);
const Wiki = lazy(PAGES.Wiki);
const WorldStats = lazy(PAGES.WorldStats);
const WorldWars = lazy(PAGES.WorldWars);
const Admin = lazy(PAGES.Admin);
const Raid = lazy(PAGES.Raid);

interface NavItem {
  path: string;
  label: string;
  icon: NavIconName;
}

// Menu complet, groupé : menu latéral sur ordinateur, tiroir « Menu » sur mobile.
const GROUPS: { title: string; items: NavItem[] }[] = [
  {
    title: 'Village',
    items: [
      { path: 'village', label: 'Vue du village', icon: 'village' },
      { path: 'hotel', label: 'Hôtel de ville', icon: 'hotel' },
      { path: 'caserne', label: 'Caserne', icon: 'caserne' },
      { path: 'marche', label: 'Marché', icon: 'marche' },
      { path: 'marche/offres', label: 'Offres du marché', icon: 'offres' },
      { path: 'apercu', label: 'Mes villages', icon: 'apercu' },
      { path: 'gestionnaire', label: 'Gestionnaire de compte', icon: 'gestionnaire' },
    ],
  },
  {
    title: 'Armée',
    items: [
      { path: 'troupes', label: 'Troupes', icon: 'troupes' },
      { path: 'ralliement', label: 'Point de ralliement', icon: 'ralliement' },
      { path: 'pillage', label: 'Assistant de pillage', icon: 'pillage' },
      { path: 'carte', label: 'Carte', icon: 'carte' },
    ],
  },
  {
    title: 'Social',
    items: [
      { path: 'rapports', label: 'Rapports', icon: 'rapports' },
      { path: 'messages', label: 'Messages', icon: 'messages' },
      { path: 'tribu', label: 'Tribu', icon: 'tribu' },
      { path: 'classement', label: 'Classement', icon: 'classement' },
      { path: 'guerres', label: 'Guerres du monde', icon: 'guerres' },
      { path: 'monde', label: 'Statistiques du monde', icon: 'monde' },
    ],
  },
  {
    title: 'Aide',
    items: [
      { path: 'wiki', label: 'Wiki', icon: 'wiki' },
      { path: 'compte', label: 'Mon compte', icon: 'compte' },
    ],
  },
];
const ADMIN_ITEM: NavItem = { path: 'admin', label: 'Administration', icon: 'admin' };
const ALL_ITEMS = [...GROUPS.flatMap((g) => g.items), ADMIN_ITEM];
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
  const { me, village, villageId, setVillageId, logout, run, refreshMe } = useGame();
  const [route, go] = useRoute();
  const page = route[0] ?? 'village';
  const [drawer, setDrawer] = useState(false);
  useEffect(() => setDrawer(false), [route.join('/')]);
  // Le tiroir se ferme aussi avec la touche Échap.
  useEffect(() => {
    if (!drawer) return;
    const onKey = (e: KeyboardEvent) => e.key === 'Escape' && setDrawer(false);
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [drawer]);
  useEffect(() => {
    const idle = window.requestIdleCallback ?? ((cb: () => void) => window.setTimeout(cb, 2000));
    idle(() => {
      void loadMap();
      for (const load of Object.values(PAGES)) void load();
    });
  }, []);
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

  // L'entrée « Administration » n'existe que pour les pseudos listés côté serveur (ADMIN_USERNAMES).
  const groups = me.isAdmin ? GROUPS.map((g) => (g.title === 'Aide' ? { ...g, items: [...g.items, ADMIN_ITEM] } : g)) : GROUPS;
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
          {groups.map((g) => (
            <nav key={g.title} className="side-group" aria-label={g.title}>
              <h4>{g.title}</h4>
              {g.items.map((n) => (
                <a key={n.path} href={`#/${n.path}`} className={here === n.path ? 'active' : ''}>
                  <span className="nav-medal"><NavIcon name={n.icon} /></span>
                  <span>{n.label}</span>
                  {badge(n.path) > 0 && <span className="badge-pill">{badge(n.path)}</span>}
                </a>
              ))}
            </nav>
          ))}
          <button className="side-quit" onClick={logout}>
            <NavIcon name="quitter" size={18} />
            Se déconnecter
          </button>
        </aside>
        <main className="content">
          <Suspense fallback={<p className="muted">Chargement…</p>}>
          {page === 'village' && route[1] !== 'hotel' && <VillageView />}
          {(page === 'hotel' || (page === 'village' && route[1] === 'hotel')) && (village ? <TownHall v={village} /> : <p className="muted">Chargement du village…</p>)}
          {page === 'caserne' && <Barracks />}
          {page === 'troupes' && <RallyPoint />}
          {page === 'ralliement' && <RallyPage focus={route[1]} />}
          {page === 'pillage' && <Raid />}
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
          {page === 'monde' && <WorldStats />}
          {page === 'guerres' && <WorldWars />}
          {page === 'marche' && <Market focus={route[1]} />}
          {page === 'compte' && <Account />}
          {page === 'apercu' && <Overview />}
          {page === 'gestionnaire' && <Manager />}
          {page === 'admin' && me.isAdmin && <Admin />}
          {page === 'wiki' && <Wiki section={route[1]} item={route[2]} />}
          </Suspense>
        </main>
      </div>
      <nav className="nav" aria-label="Navigation">
        {TAB_ITEMS.map((n) => (
          <button key={n.path} className={page === n.path && !drawer ? 'active' : ''} onClick={() => (setDrawer(false), go(n.path))}>
            <span className="nav-icon"><NavIcon name={n.icon} size={24} /></span>
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
          <div className="sheet" role="dialog" aria-modal="true" aria-label="Menu" onClick={(e) => e.stopPropagation()}>
            <div className="sheet-head">
              <div className="sheet-grip" />
              <button className="sheet-close" aria-label="Fermer le menu" onClick={() => setDrawer(false)}>
                ✕
              </button>
            </div>
            {groups.map((g) => (
              <section key={g.title}>
                <h4>{g.title}</h4>
                <div className="sheet-grid">
                  {g.items.map((n) => (
                    <a key={n.path} href={`#/${n.path}`} className={here === n.path ? 'active' : ''} onClick={() => setDrawer(false)}>
                      <span className="nav-medal"><NavIcon name={n.icon} size={26} /></span>
                      <span>{n.label}</span>
                      {badge(n.path) > 0 && <span className="badge">{badge(n.path)}</span>}
                    </a>
                  ))}
                </div>
              </section>
            ))}
            <button className="btn ghost sheet-quit" onClick={logout}>
              <NavIcon name="quitter" size={18} />
              Se déconnecter
            </button>
          </div>
        </div>
      )}
    </div>
  );
}
