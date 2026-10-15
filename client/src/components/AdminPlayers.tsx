import { useCallback, useEffect, useMemo, useState } from 'react';
import { BUILDINGS, BUILDING_KEYS, RESOURCES, UNIT_KEYS, type BuildingKey, type Resources, type UnitCounts } from '@aldoria/shared';
import { api } from '../api';
import { ago, clockTime, fmt } from '../format';
import { useGame } from '../game';
import { Panel, PlayerLink, ResIcon, UnitList } from '../ui';

export interface AdminPlayer {
  id: number;
  username: string;
  isNpc: boolean;
  profile: string | null;
  tribe: string | null;
  tribeName: string | null;
  villages: number;
  points: number;
  warScore: number;
  glory: number;
  attacksIn: number;
  createdAt: string;
  lastSeen: string | null;
}

interface AdminVillage {
  id: number;
  name: string;
  x: number;
  y: number;
  kind: string;
  points: number;
  loyalty: number;
  resources: Resources;
  rates: Resources;
  capacity: number;
  population: number;
  populationCap: number;
  buildings: Record<BuildingKey, number>;
  troopsHome: UnitCounts;
  troopsAway: UnitCounts;
  troopsQueued: UnitCounts;
  building: { building: BuildingKey; level: number; finishAt: string } | null;
  buildQueue: number;
  manager: boolean;
}

interface AdminPlayerDetail {
  id: number;
  username: string;
  isNpc: boolean;
  profile: string | null;
  createdAt: string;
  lastSeen: string | null;
  protectionUntil: string | null;
  relicUntil: string | null;
  title: string | null;
  sessions: number;
  tribe: {
    id: number;
    name: string;
    tag: string;
    isNpc: boolean;
    leader: boolean;
    members: number;
  } | null;
  rank: {
    all: number;
    allCount: number;
    humans: number | null;
    humanCount: number;
  };
  points: number;
  war: {
    conquests: number;
    villagesLost: number;
    attackWins: number;
    defenseWins: number;
    killsAttack: number;
    killsDefense: number;
    score: number;
  };
  glory: number;
  crusades: number;
  titles: { title: string; earnedAt: string }[];
  movements: {
    attacksOut: number;
    supportsOut: number;
    attacksIn: number;
    planned: number;
  };
  items: number;
  offers: number;
  messages: { sent7: number; received7: number };
  unreadReports: number;
  troops: {
    home: UnitCounts;
    away: UnitCounts;
    queued: UnitCounts;
    total: number;
  };
  villages: AdminVillage[];
  reports: {
    id: number;
    type: string;
    title: string;
    read: boolean;
    at: string;
  }[];
}

type Sort = 'points' | 'villages' | 'seen' | 'created' | 'war' | 'glory';
type Who = 'humans' | 'npc' | 'all';

const SORTS: [Sort, string][] = [
  ['points', 'Points'],
  ['villages', 'Villages'],
  ['seen', 'Dernière activité'],
  ['created', 'Inscription'],
  ['war', 'Score de guerre'],
  ['glory', 'Gloire'],
];
const time = (iso: string | null) => (iso ? Date.parse(iso) : 0);
const SORT_FN: Record<Sort, (a: AdminPlayer, b: AdminPlayer) => number> = {
  points: (a, b) => b.points - a.points,
  villages: (a, b) => b.villages - a.villages || b.points - a.points,
  seen: (a, b) => time(b.lastSeen) - time(a.lastSeen),
  created: (a, b) => time(b.createdAt) - time(a.createdAt),
  war: (a, b) => b.warScore - a.warScore,
  glory: (a, b) => b.glory - a.glory,
};
const DAY = 86_400_000;
const ord = (n: number) => (n === 1 ? '1er' : `${n}e`);

/** Onglet « Joueurs » de l'administration : liste filtrable et fiche détaillée de chaque joueur, en lecture seule. */
export default function AdminPlayers() {
  const { run } = useGame();
  const [players, setPlayers] = useState<AdminPlayer[] | null>(null);
  const [selected, setSelected] = useState<number | null>(null);
  const [query, setQuery] = useState('');
  const [who, setWho] = useState<Who>('humans');
  const [sort, setSort] = useState<Sort>('points');

  const load = useCallback(() => run(async () => setPlayers(await api<AdminPlayer[]>('/api/admin/players'))), [run]);
  useEffect(() => {
    if (selected !== null) return;
    load();
    const t = setInterval(load, 20_000);
    return () => clearInterval(t);
  }, [load, selected]);

  const shown = useMemo(() => {
    const q = query.trim().toLowerCase();
    return (players ?? [])
      .filter((p) => (who === 'all' ? true : who === 'npc' ? p.isNpc : !p.isNpc))
      .filter((p) => !q || p.username.toLowerCase().includes(q) || (p.tribe ?? '').toLowerCase().includes(q) || (p.tribeName ?? '').toLowerCase().includes(q))
      .sort(SORT_FN[sort]);
  }, [players, query, who, sort]);

  if (selected !== null) return <PlayerDetail id={selected} onBack={() => setSelected(null)} />;

  const humans = (players ?? []).filter((p) => !p.isNpc);
  const now = Date.now();
  const kpis: [string, number | undefined][] = [
    ['Joueurs', players ? humans.length : undefined],
    ['Actifs (24 h)', players ? humans.filter((p) => now - time(p.lastSeen) < DAY).length : undefined],
    ['Actifs (7 j)', players ? humans.filter((p) => now - time(p.lastSeen) < 7 * DAY).length : undefined],
    ['Inscrits (7 j)', players ? humans.filter((p) => now - time(p.createdAt) < 7 * DAY).length : undefined],
    ['Sans tribu', players ? humans.filter((p) => !p.tribe).length : undefined],
    ['Attaqués en ce moment', players ? humans.filter((p) => p.attacksIn > 0).length : undefined],
  ];

  return (
    <>
      <div className="admin-kpis">
        {kpis.map(([label, value]) => (
          <div key={label} className="admin-kpi">
            <i>{label}</i>
            <b>{value === undefined ? '…' : fmt(value)}</b>
          </div>
        ))}
      </div>
      <Panel title="Joueurs" actions={<span className="muted small">Touchez un joueur pour ouvrir sa fiche</span>}>
        <div className="admin-pl-tools">
          <input type="search" placeholder="Pseudo ou tribu…" aria-label="Rechercher un joueur" value={query} onChange={(e) => setQuery(e.target.value)} />
          <div className="row admin-chips">
            {(
              [
                ['humans', 'Joueurs'],
                ['npc', 'PNJ'],
                ['all', 'Tous'],
              ] as [Who, string][]
            ).map(([k, label]) => (
              <button key={k} className={`chip chip-btn ${who === k ? 'chip-ok' : ''}`} aria-pressed={who === k} onClick={() => setWho(k)}>
                {label}
              </button>
            ))}
          </div>
          <label className="admin-pl-sort small">
            Trier par
            <select value={sort} onChange={(e) => setSort(e.target.value as Sort)}>
              {SORTS.map(([k, label]) => (
                <option key={k} value={k}>
                  {label}
                </option>
              ))}
            </select>
          </label>
        </div>
        {!players ? (
          <p className="muted">Chargement…</p>
        ) : shown.length === 0 ? (
          <p className="muted">Aucun joueur ne correspond.</p>
        ) : (
          <div className="admin-scroll">
            <table className="admin-table admin-pl-list">
              <thead>
                <tr>
                  <th>Pseudo</th>
                  <th>Tribu</th>
                  <th className="num">Villages</th>
                  <th className="num">Points</th>
                  <th className="num hide-m">Guerre</th>
                  <th className="num hide-m">Gloire</th>
                  <th className="hide-m">Inscription</th>
                  <th>Activité</th>
                </tr>
              </thead>
              <tbody>
                {shown.map((p) => (
                  <tr key={p.id} tabIndex={0} onClick={() => setSelected(p.id)} onKeyDown={(e) => e.key === 'Enter' && setSelected(p.id)}>
                    <td className="admin-pl-name">
                      <b>{p.username}</b>
                      {p.isNpc && <span className="chip">PNJ{p.profile ? ` · ${p.profile}` : ''}</span>}
                      {p.attacksIn > 0 && (
                        <span className="chip chip-warn" title="Attaques en route vers ce joueur">
                          ⚔ {p.attacksIn}
                        </span>
                      )}
                    </td>
                    <td title={p.tribeName ?? undefined}>{p.tribe ? `[${p.tribe}]` : '—'}</td>
                    <td className="num">{p.villages}</td>
                    <td className="num">{fmt(p.points)}</td>
                    <td className="num hide-m">{fmt(p.warScore)}</td>
                    <td className="num hide-m">{fmt(p.glory)}</td>
                    <td className="t hide-m">
                      {new Date(p.createdAt).toLocaleDateString('fr-FR', {
                        day: 'numeric',
                        month: 'short',
                      })}
                    </td>
                    <td className="t">{p.isNpc ? '—' : p.lastSeen ? ago(p.lastSeen) : 'jamais'}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </Panel>
    </>
  );
}

function PlayerDetail({ id, onBack }: { id: number; onBack: () => void }) {
  const { run } = useGame();
  const [d, setD] = useState<AdminPlayerDetail | null>(null);
  const load = useCallback(() => run(async () => setD(await api<AdminPlayerDetail>(`/api/admin/players/${id}`))), [run, id]);
  useEffect(() => {
    load();
    const t = setInterval(load, 20_000);
    return () => clearInterval(t);
  }, [load]);

  const back = (
    <button className="btn small ghost admin-pl-back" onClick={onBack}>
      ← Tous les joueurs
    </button>
  );
  if (!d)
    return (
      <>
        {back}
        <p className="muted">Chargement…</p>
      </>
    );

  const sumRes = Object.fromEntries(RESOURCES.map((r) => [r, d.villages.reduce((s, v) => s + v.resources[r], 0)])) as unknown as Resources;
  const sumRates = Object.fromEntries(RESOURCES.map((r) => [r, d.villages.reduce((s, v) => s + v.rates[r], 0)])) as unknown as Resources;

  return (
    <>
      {back}
      <section className="panel admin-pl-head">
        <div className="admin-pl-id">
          <h2>{d.username}</h2>
          <span className="admin-pl-chips">
            {d.isNpc && <span className="chip">PNJ{d.profile ? ` · ${d.profile}` : ''}</span>}
            {d.tribe && (
              <span className="chip">
                [{d.tribe.tag}] {d.tribe.name}
                {d.tribe.leader && ' · chef'}
              </span>
            )}
            {d.title && <span className="chip chip-ok">{d.title}</span>}
            {d.protectionUntil && <span className="chip">Protégé jusqu'au {clockTime(d.protectionUntil)}</span>}
            {d.relicUntil && <span className="chip chip-ok">Relique jusqu'au {clockTime(d.relicUntil)}</span>}
            {d.movements.attacksIn > 0 && (
              <span className="chip chip-warn">
                ⚔ {d.movements.attacksIn} attaque
                {d.movements.attacksIn > 1 ? 's' : ''} en route vers lui
              </span>
            )}
          </span>
          <span className="small muted">
            Profil public : <PlayerLink name={d.username} />
          </span>
        </div>
        <div className="admin-kpis">
          <Tile
            label="Points"
            value={fmt(d.points)}
            sub={`${ord(d.rank.all)} sur ${d.rank.allCount}${d.rank.humans ? ` · ${ord(d.rank.humans)} joueur` : ''}`}
          />
          <Tile label="Villages" value={fmt(d.villages.length)} />
          <Tile label="Troupes" value={fmt(d.troops.total)} />
          <Tile label="Score de guerre" value={fmt(d.war.score)} />
          <Tile label="Gloire" value={fmt(d.glory)} sub={`${d.crusades} croisade${d.crusades > 1 ? 's' : ''}`} />
          <Tile label="Dernière activité" text value={d.isNpc ? '—' : d.lastSeen ? ago(d.lastSeen) : 'jamais'} />
        </div>
      </section>

      <div className="admin-grid2">
        <Panel title="Compte">
          <dl className="admin-dl">
            <dt>Inscription</dt>
            <dd>
              {new Date(d.createdAt).toLocaleDateString('fr-FR', {
                day: 'numeric',
                month: 'long',
                year: 'numeric',
              })}{' '}
              ({ago(d.createdAt)})
            </dd>
            <dt>Dernière activité</dt>
            <dd>{d.lastSeen ? clockTime(d.lastSeen) : 'jamais'}</dd>
            <dt>Connexions ouvertes</dt>
            <dd>{d.sessions}</dd>
            <dt>Tribu</dt>
            <dd>
              {d.tribe
                ? `[${d.tribe.tag}] ${d.tribe.name} · ${d.tribe.members} membre${d.tribe.members > 1 ? 's' : ''}${d.tribe.leader ? ' · chef' : ''}`
                : 'aucune'}
            </dd>
            <dt>Messages (7 j)</dt>
            <dd>
              {d.messages.sent7} envoyé{d.messages.sent7 > 1 ? 's' : ''} · {d.messages.received7} reçu{d.messages.received7 > 1 ? 's' : ''}
            </dd>
            <dt>Rapports non lus</dt>
            <dd>{d.unreadReports}</dd>
            <dt>Inventaire</dt>
            <dd>
              {d.items} objet{d.items > 1 ? 's' : ''} · {d.offers} offre
              {d.offers > 1 ? 's' : ''} au marché
            </dd>
          </dl>
        </Panel>
        <Panel title="Guerre">
          <dl className="admin-dl">
            <dt>Conquêtes</dt>
            <dd>
              {d.war.conquests} · {d.war.villagesLost} village
              {d.war.villagesLost > 1 ? 's' : ''} perdu
              {d.war.villagesLost > 1 ? 's' : ''}
            </dd>
            <dt>Victoires</dt>
            <dd>
              {d.war.attackWins} en attaque · {d.war.defenseWins} en défense
            </dd>
            <dt>Troupes tuées</dt>
            <dd>
              {fmt(d.war.killsAttack)} en attaque · {fmt(d.war.killsDefense)} en défense
            </dd>
            <dt>En route</dt>
            <dd>
              {d.movements.attacksOut} attaque
              {d.movements.attacksOut > 1 ? 's' : ''} · {d.movements.supportsOut} renfort
              {d.movements.supportsOut > 1 ? 's' : ''} · {d.movements.planned} planifié
              {d.movements.planned > 1 ? 's' : ''}
            </dd>
            <dt>Titres</dt>
            <dd>{d.titles.length ? d.titles.map((t) => t.title).join(', ') : 'aucun'}</dd>
          </dl>
        </Panel>
      </div>

      <Panel title="Armée">
        <dl className="admin-dl">
          <dt>Au village</dt>
          <dd>
            <UnitList units={d.troops.home} />
          </dd>
          <dt>Dehors</dt>
          <dd>
            <UnitList units={d.troops.away} empty="Aucune" />
          </dd>
          <dt>En recrutement</dt>
          <dd>
            <UnitList units={d.troops.queued} empty="Aucun" />
          </dd>
        </dl>
      </Panel>

      <Panel title={`Villages (${d.villages.length})`} actions={<span className="muted small">Ressources estimées à l'instant</span>}>
        {d.villages.length === 0 ? (
          <p className="muted">Aucun village.</p>
        ) : (
          <>
            <div className="admin-pl-total">
              <b>Total</b>
              {RESOURCES.map((r) => (
                <span key={r}>
                  <ResIcon r={r} size={16} /> {fmt(sumRes[r])} <i className="muted">+{fmt(sumRates[r])}/h</i>
                </span>
              ))}
            </div>
            <div className="admin-pl-villages">
              {d.villages.map((v) => (
                <article key={v.id} className="admin-pl-village">
                  <header>
                    <a href={`#/carte/${v.x},${v.y}`}>
                      <b>{v.name}</b> ({v.x}|{v.y})
                    </a>
                    <span className="muted small">
                      {fmt(v.points)} pts · loyauté {v.loyalty} %{v.manager && ' · gestionnaire'}
                    </span>
                  </header>
                  <div className="admin-pl-res">
                    {RESOURCES.map((r) => (
                      <span key={r} className={v.resources[r] >= v.capacity ? 'full' : ''} title={`${fmt(v.rates[r])} par heure`}>
                        <ResIcon r={r} size={16} /> {fmt(v.resources[r])}
                      </span>
                    ))}
                    <span className="muted small">entrepôt {fmt(v.capacity)}</span>
                  </div>
                  <div className="small">
                    Population {fmt(v.population)} / {fmt(v.populationCap)}
                    {v.building ? (
                      <>
                        {' '}
                        · construit {BUILDINGS[v.building.building]?.name ?? v.building.building} niv. {v.building.level}
                        {v.buildQueue > 1 && ` (+${v.buildQueue - 1} en file)`}
                      </>
                    ) : (
                      ' · aucune construction'
                    )}
                  </div>
                  <ul className="admin-pl-buildings" aria-label="Bâtiments">
                    {BUILDING_KEYS.map((b) => {
                      const level = v.buildings[b] ?? 0;
                      const max = BUILDINGS[b].maxLevel;
                      return (
                        <li key={b} className={level === 0 ? 'none' : level >= max ? 'max' : ''} title={`${BUILDINGS[b].name} : niveau ${level} sur ${max}`}>
                          <span>{BUILDINGS[b].name}</span>
                          <b>{level}</b>
                        </li>
                      );
                    })}
                  </ul>
                  {UNIT_KEYS.some((u) => v.troopsHome[u] > 0) && (
                    <div className="small">
                      <UnitList units={v.troopsHome} />
                    </div>
                  )}
                </article>
              ))}
            </div>
          </>
        )}
      </Panel>

      <Panel title="Rapports récents">
        {d.reports.length === 0 ? (
          <p className="muted">Aucun rapport.</p>
        ) : (
          <table className="admin-table admin-pl-reports">
            <tbody>
              {d.reports.map((r) => (
                <tr key={r.id}>
                  <td className="t">{clockTime(r.at)}</td>
                  <td className={r.read ? '' : 'admin-unread'}>{r.title}</td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
      </Panel>
    </>
  );
}

function Tile({ label, value, sub, text }: { label: string; value: string; sub?: string; text?: boolean }) {
  return (
    <div className={`admin-kpi ${text ? 'admin-kpi-text' : ''}`}>
      <i>{label}</i>
      <b>{value}</b>
      {sub && <small className="muted">{sub}</small>}
    </div>
  );
}
