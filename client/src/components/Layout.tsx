import { lazy, Suspense, useEffect, useRef, useState, type TouchEvent } from 'react';
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
  // L'administration est un tableau de bord séparé (/admin) : dans le jeu, l'entrée n'y mène que par un lien.
  Admin: () => import('./AdminLink'),
  BugReport: () => import('./BugReport'),
  VillageSheet: () => import('./VillageSheet'),
  Raid: () => import('./Raid'),
  IncomingAttacks: () => import('./IncomingAttacks'),
  Crusade: () => import('./Crusade'),
  Provinces: () => import('./Provinces'),
  Inventory: () => import('./Inventory'),
  Achievements: () => import('./Achievements'),
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
const BugReport = lazy(PAGES.BugReport);
const VillageSheet = lazy(PAGES.VillageSheet);
const Raid = lazy(PAGES.Raid);
const IncomingAttacks = lazy(PAGES.IncomingAttacks);
const Crusade = lazy(PAGES.Crusade);
const Provinces = lazy(PAGES.Provinces);
const Inventory = lazy(PAGES.Inventory);
const Achievements = lazy(PAGES.Achievements);

interface NavTab {
  path: string;
  label: string;
}

interface NavItem {
  path: string;
  label: string;
  icon: NavIconName;
  /** Pages regroupées sous cette entrée : elles s'affichent en onglets en haut de la page. */
  tabs?: NavTab[];
}

// Menu complet, groupé par thème : menu latéral sur ordinateur, tiroir « Menu » sur mobile.
// Une entrée par rubrique ; les pages voisines d'une même rubrique sont regroupées en onglets (`tabs`).
const GROUPS: { title: string; items: NavItem[] }[] = [
  {
    title: 'Village',
    items: [
      { path: 'village', label: 'Village', icon: 'village', tabs: [{ path: 'village', label: 'Vue du village' }, { path: 'hotel', label: 'Hôtel de ville' }] },
      { path: 'caserne', label: 'Caserne', icon: 'caserne' },
      { path: 'marche', label: 'Marché', icon: 'marche' },
      { path: 'apercu', label: 'Mes villages', icon: 'apercu', tabs: [{ path: 'apercu', label: 'Mes villages' }, { path: 'gestionnaire', label: 'Gestionnaire' }] },
    ],
  },
  {
    title: 'Armée',
    items: [
      { path: 'carte', label: 'Carte', icon: 'carte' },
      {
        path: 'troupes',
        label: 'Troupes',
        icon: 'troupes',
        tabs: [{ path: 'troupes', label: 'Troupes' }, { path: 'ralliement', label: 'Ralliement' }, { path: 'pillage', label: 'Pillage' }, { path: 'attaques', label: 'Attaques entrantes' }],
      },
      { path: 'croisade', label: 'Croisades', icon: 'croisade', tabs: [{ path: 'croisade', label: 'Croisades' }, { path: 'provinces', label: 'Provinces' }] },
    ],
  },
  {
    title: 'Social',
    items: [
      { path: 'rapports', label: 'Rapports', icon: 'rapports' },
      { path: 'messages', label: 'Messages', icon: 'messages' },
      { path: 'tribu', label: 'Tribu', icon: 'tribu' },
      {
        path: 'classement',
        label: 'Monde',
        icon: 'monde',
        tabs: [{ path: 'classement', label: 'Classement' }, { path: 'guerres', label: 'Guerres' }, { path: 'monde', label: 'Statistiques' }],
      },
    ],
  },
  {
    title: 'Mon compte',
    items: [
      {
        path: 'profil',
        label: 'Mon profil',
        icon: 'compte',
        tabs: [{ path: 'profil', label: 'Profil' }, { path: 'succes', label: 'Succès' }, { path: 'inventaire', label: 'Inventaire' }, { path: 'compte', label: 'Paramètres' }],
      },
      { path: 'wiki', label: 'Aide', icon: 'wiki', tabs: [{ path: 'wiki', label: 'Wiki' }, { path: 'bug', label: 'Signaler un bug' }] },
    ],
  },
];
const ADMIN_ITEM: NavItem = { path: 'admin', label: 'Administration', icon: 'admin' };
const ALL_ITEMS = [...GROUPS.flatMap((g) => g.items), ADMIN_ITEM];
/** Chemins couverts par une entrée du menu : la sienne et ceux de ses onglets. */
const pathsOf = (n: NavItem) => (n.tabs ? n.tabs.map((t) => t.path) : [n.path]);
/** Les quatre entrées toujours visibles en bas de l'écran sur mobile, le reste est dans « Menu ». */
const TAB_PATHS = ['village', 'carte', 'troupes', 'rapports'];
const TAB_ITEMS = TAB_PATHS.map((p) => ALL_ITEMS.find((n) => n.path === p)!);

/** Page du menu correspondant à l'adresse : « village/hotel » est l'hôtel de ville, « marche/offres » reste le marché. */
function currentPath(route: string[]) {
  const page = route[0] ?? 'village';
  return page === 'village' && route[1] === 'hotel' ? 'hotel' : page;
}

/** Onglets de la rubrique en cours, en haut de la page. */
function SectionTabs({ item, here }: { item: NavItem; here: string }) {
  const ref = useRef<HTMLElement>(null);
  // Sur téléphone, la barre défile : l'onglet actif est ramené en vue.
  useEffect(() => {
    const active = ref.current?.querySelector<HTMLElement>('a.active');
    if (active && ref.current) ref.current.scrollLeft = active.offsetLeft - (ref.current.clientWidth - active.offsetWidth) / 2;
  }, [here]);
  return (
    <nav ref={ref} className="section-tabs" aria-label={item.label}>
      {item.tabs!.map((t) => (
        <a key={t.path} href={`#/${t.path}`} className={here === t.path ? 'active' : ''} aria-current={here === t.path ? 'page' : undefined}>
          {t.label}
        </a>
      ))}
    </nav>
  );
}

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


/**
 * Glisser le tiroir vers le bas pour le fermer : il suit le doigt tant que sa liste est tout en haut,
 * puis se ferme au-delà d'un quart de sa hauteur (ou d'un geste rapide), sinon il remonte.
 */
function useSwipeToClose(onClose: () => void) {
  const ref = useRef<HTMLDivElement>(null);
  const drag = useRef<{ y: number; t: number; dy: number; active: boolean } | null>(null);
  const setOffset = (dy: number, animate: boolean) => {
    const el = ref.current;
    if (!el) return;
    el.style.transition = animate ? 'transform 0.2s ease-out' : 'none';
    el.style.transform = dy > 0 ? `translateY(${dy}px)` : '';
  };
  return {
    ref,
    onTouchStart: (e: TouchEvent) => {
      drag.current = { y: e.touches[0].clientY, t: Date.now(), dy: 0, active: (ref.current?.scrollTop ?? 0) <= 0 };
    },
    onTouchMove: (e: TouchEvent) => {
      const d = drag.current;
      if (!d) return;
      const dy = e.touches[0].clientY - d.y;
      // On ne tire le tiroir que s'il est déjà tout en haut de sa liste et que le doigt descend.
      if (!d.active || dy <= 0) {
        if (d.dy) setOffset(0, false);
        d.dy = 0;
        if (dy < 0) d.active = false;
        return;
      }
      d.dy = dy;
      setOffset(dy, false);
    },
    onTouchEnd: () => {
      const d = drag.current;
      drag.current = null;
      if (!d || d.dy <= 0) return;
      const height = ref.current?.offsetHeight ?? 600;
      const fast = d.dy / Math.max(1, Date.now() - d.t) > 0.6;
      if (d.dy > height / 4 || (fast && d.dy > 40)) {
        setOffset(height, true);
        window.setTimeout(onClose, 180);
      } else setOffset(0, true);
    },
  };
}

export default function Layout() {
  const { me, world, village, villageId, setVillageId, logout, chooseWorld, run, refreshMe } = useGame();
  const [route, go] = useRoute();
  const page = route[0] ?? 'village';
  const [drawer, setDrawer] = useState(false);
  // Dernière page visitée avant « Signaler un bug », jointe au bug pour le retrouver.
  const lastPage = useRef('');
  useEffect(() => {
    if (page !== 'bug') lastPage.current = route.join('/');
  });
  const swipe = useSwipeToClose(() => setDrawer(false));
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
  const pageBadge = (path: string) => (path === 'rapports' ? me.unreadReports : path === 'messages' ? me.unreadMessages : path === 'tribu' ? (me.newInvites ?? 0) : path === 'inventaire' ? (me.items ?? 0) : path === 'admin' ? (me.openModerationReports ?? 0) + (me.openBugReports ?? 0) : 0);
  /** Pastille d'une entrée du menu : la somme de ses onglets. */
  const badge = (n: NavItem) => pathsOf(n).reduce((sum, p) => sum + pageBadge(p), 0);

  // Ouvrir une page fait disparaître sa pastille : ses notifications sont marquées comme vues côté serveur.
  const herePath = currentPath(route);
  const hereBadge = pageBadge(herePath);
  useEffect(() => {
    if (hereBadge > 0) void api('/api/me/seen', { method: 'POST', body: { page: herePath } }).then(refreshMe, () => {});
  }, [herePath, hereBadge, refreshMe]);

  if (!me.villages.length) {
    return (
      <div className="splash">
        <img src={logo} alt="" width={96} height={96} />
        <h1>Votre dernier village est tombé</h1>
        <p>Vos terres ont été conquises. Vous pouvez fonder un nouveau village ailleurs sur la carte.</p>
        <button className="btn primary" onClick={() => run(async () => { await api('/api/me/restart', { method: 'POST' }); await refreshMe(); })}>
          Fonder un nouveau village
        </button>
        <button className="btn" onClick={chooseWorld}>Changer de monde</button>
        <button className="btn" onClick={logout}>Se déconnecter</button>
      </div>
    );
  }

  // L'entrée « Administration » n'existe que pour les pseudos listés côté serveur (ADMIN_USERNAMES).
  const groups = me.isAdmin ? GROUPS.map((g) => (g.title === 'Mon compte' ? { ...g, items: [...g.items, ADMIN_ITEM] } : g)) : GROUPS;
  const here = herePath;
  const section = (me.isAdmin ? ALL_ITEMS : ALL_ITEMS.slice(0, -1)).find((n) => pathsOf(n).includes(here));
  // Le bouton « Menu » reprend les pastilles des entrées qui ne sont pas dans la barre du bas.
  const drawerBadge = groups.flatMap((g) => g.items).filter((n) => !TAB_PATHS.includes(n.path)).reduce((sum, n) => sum + badge(n), 0);
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
        <a href="#/profil" className="who" title="Mon profil">
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
                <a key={n.path} href={`#/${n.path}`} className={section === n ? 'active' : ''}>
                  <span className="nav-medal"><NavIcon name={n.icon} /></span>
                  <span>{n.label}</span>
                  {badge(n) > 0 && <span className="badge-pill">{badge(n)}</span>}
                </a>
              ))}
            </nav>
          ))}
          <button className="side-quit side-world" onClick={chooseWorld} title="Changer de monde">
            <NavIcon name="carte" size={18} />
            Monde {world.name}
          </button>
          <button className="side-quit" onClick={logout}>
            <NavIcon name="quitter" size={18} />
            Se déconnecter
          </button>
        </aside>
        <main className="content">
          {section?.tabs && <SectionTabs item={section} here={here} />}
          <Suspense fallback={<p className="muted">Chargement…</p>}>
          {page === 'village' && route[1] !== 'hotel' && <VillageView />}
          {(page === 'hotel' || (page === 'village' && route[1] === 'hotel')) && (village ? <TownHall v={village} /> : <p className="muted">Chargement du village…</p>)}
          {page === 'caserne' && <Barracks />}
          {page === 'troupes' && <RallyPoint />}
          {page === 'ralliement' && <RallyPage focus={route[1]} />}
          {page === 'pillage' && <Raid />}
          {page === 'attaques' && <IncomingAttacks />}
          {page === 'croisade' && <Crusade />}
          {page === 'provinces' && <Provinces />}
          {page === 'inventaire' && <Inventory />}
          {page === 'succes' && <Achievements />}
          {page === 'carte' && (
            <Suspense fallback={<p className="muted">Chargement de la carte…</p>}>
              <MapView focus={route[1]} />
            </Suspense>
          )}
          {page === 'rapports' && <Reports id={route[1] ? Number(route[1]) : undefined} />}
          {page === 'messages' && <Messages id={route[1] && route[1] !== 'ecrire' ? Number(route[1]) : undefined} to={route[1] === 'ecrire' && route[2] ? decodeURIComponent(route[2]) : undefined} />}
          {page === 'joueur' && route[1] && <Profile name={decodeURIComponent(route[1])} />}
          {page === 'profil' && <Profile name={me.player.username} />}
          {page === 'tribu' && <Tribe id={route[1] ? Number(route[1]) : undefined} />}
          {page === 'classement' && <Ranking initial={route[1]} />}
          {page === 'monde' && <WorldStats />}
          {page === 'guerres' && <WorldWars />}
          {page === 'marche' && <Market focus={route[1]} />}
          {page === 'compte' && <Account />}
          {page === 'apercu' && <Overview />}
          {page === 'gestionnaire' && <Manager />}
          {page === 'admin' && me.isAdmin && <Admin />}
          {page === 'bug' && <BugReport from={lastPage.current} />}
          {page === 'fiche' && route[1] && <VillageSheet coords={route[1]} />}
          {page === 'wiki' && <Wiki section={route[1]} item={route[2]} />}
          </Suspense>
        </main>
      </div>
      <nav className="nav" aria-label="Navigation">
        {TAB_ITEMS.map((n) => (
          <button key={n.path} className={section === n && !drawer ? 'active' : ''} onClick={() => (setDrawer(false), go(n.path))}>
            <span className="nav-icon"><NavIcon name={n.icon} size={24} /></span>
            <span className="nav-label">{n.label}</span>
            {badge(n) > 0 && <span className="badge">{badge(n)}</span>}
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
          <div className="sheet" role="dialog" aria-modal="true" aria-label="Menu" onClick={(e) => e.stopPropagation()} {...swipe}>
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
                    <a key={n.path} href={`#/${n.path}`} className={section === n ? 'active' : ''} onClick={() => setDrawer(false)}>
                      <span className="nav-medal"><NavIcon name={n.icon} size={26} /></span>
                      <span>{n.label}</span>
                      {badge(n) > 0 && <span className="badge">{badge(n)}</span>}
                    </a>
                  ))}
                </div>
              </section>
            ))}
            <button className="btn ghost sheet-quit" onClick={chooseWorld}>
              <NavIcon name="carte" size={18} />
              Changer de monde ({world.name})
            </button>
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
