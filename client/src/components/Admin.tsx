import { useCallback, useEffect, useState } from 'react';
import { api } from '../api';
import { clockTime, fmt } from '../format';
import { useGame } from '../game';
import { Panel } from '../ui';
import './admin.css';

type Tab = 'npc' | 'players' | 'market' | 'world';
type Kind = 'all' | 'attack' | 'scout' | 'market' | 'quiet';

interface NpcEvent {
  at: string;
  npc: string;
  kind: 'attack' | 'scout' | 'market';
  target: string;
  onBarbarian: boolean;
  onPlayer: boolean;
  result: string;
  quiet: boolean;
}
interface NpcLog {
  hours: number;
  stats: { npcCount: number; attacks: number; onBarbarians: number; onPlayers: number; scouts: number; offers: number; quietAttacks: number };
  events: NpcEvent[];
}
interface AdminPlayer {
  id: number;
  username: string;
  isNpc: boolean;
  profile: string | null;
  tribe: string | null;
  villages: number;
  points: number;
  createdAt: string;
  lastSeen: string | null;
}
interface AdminOffer {
  id: number;
  owner: string;
  isNpc: boolean;
  status: string;
  give: { resource: string; amount: number };
  want: { resource: string; amount: number };
  createdAt: string;
  expiresAt: string;
}
interface AdminWorld {
  totals: Record<string, number>;
  settings: Record<string, string | number>;
}

const KIND_LABEL: Record<NpcEvent['kind'], string> = { attack: 'Pillage / attaque', scout: 'Espionnage', market: 'Offre de marché' };
const TOTAL_LABEL: Record<string, string> = {
  humans: 'Joueurs',
  npcs: 'PNJ',
  barbarians: 'Villages barbares',
  owned: 'Villages occupés',
  tribes: 'Tribus',
  attacksinflight: 'Attaques en route',
};
const SETTING_LABEL: Record<string, string> = {
  worldSpeed: 'Vitesse du monde',
  mapSize: 'Taille de la carte',
  npcCount: 'Nombre de PNJ',
  npcDifficulty: 'Difficulté des PNJ',
  npcTimezone: 'Fuseau des heures calmes',
  quietHours: 'Heures calmes',
};
const STATUS_LABEL: Record<string, string> = { open: 'Ouverte', accepted: 'Acceptée', cancelled: 'Annulée', expired: 'Expirée' };

/** Page d'administration (lecture seule), réservée aux pseudos de ADMIN_USERNAMES. */
export default function Admin() {
  const { run } = useGame();
  const [tab, setTab] = useState<Tab>('npc');
  const [hours, setHours] = useState(24);
  const [kind, setKind] = useState<Kind>('all');
  const [log, setLog] = useState<NpcLog | null>(null);
  const [players, setPlayers] = useState<AdminPlayer[] | null>(null);
  const [offers, setOffers] = useState<AdminOffer[] | null>(null);
  const [world, setWorld] = useState<AdminWorld | null>(null);
  const [showNpc, setShowNpc] = useState(true);

  const load = useCallback(
    () =>
      run(async () => {
        if (tab === 'npc') setLog(await api<NpcLog>(`/api/admin/npc?hours=${hours}`));
        if (tab === 'players') setPlayers(await api<AdminPlayer[]>('/api/admin/players'));
        if (tab === 'market') setOffers(await api<AdminOffer[]>(`/api/admin/market?hours=${hours}`));
        if (tab === 'world') setWorld(await api<AdminWorld>('/api/admin/world'));
      }),
    [run, tab, hours],
  );
  useEffect(() => {
    load();
    const t = setInterval(load, 20_000);
    return () => clearInterval(t);
  }, [load]);

  const tabs: [Tab, string][] = [
    ['npc', 'PNJ'],
    ['players', 'Joueurs'],
    ['market', 'Marché'],
    ['world', 'Monde'],
  ];
  const kinds: [Kind, string][] = [
    ['all', 'Tout'],
    ['attack', 'Attaques'],
    ['scout', 'Espionnages'],
    ['market', 'Marché'],
    ['quiet', 'Heures calmes seulement'],
  ];
  const events = (log?.events ?? []).filter((e) => (kind === 'all' ? true : kind === 'quiet' ? e.quiet : e.kind === kind));

  return (
    <div className="stack admin">
      <Panel title="Administration" actions={<span className="muted small">Lecture seule · actualisé toutes les 20 s</span>}>
        <div className="tabs" role="tablist">
          {tabs.map(([k, label]) => (
            <button key={k} role="tab" aria-selected={tab === k} onClick={() => setTab(k)}>
              {label}
            </button>
          ))}
        </div>
        {(tab === 'npc' || tab === 'market') && (
          <div className="row admin-chips">
            <span className="muted small">Période :</span>
            {[1, 6, 24, 72].map((h) => (
              <button key={h} className={`chip chip-btn ${hours === h ? 'chip-ok' : ''}`} aria-pressed={hours === h} onClick={() => setHours(h)}>
                {h} h
              </button>
            ))}
          </div>
        )}
      </Panel>

      {tab === 'npc' && (
        <>
          <div className="admin-kpis">
            <Kpi label="PNJ" value={log?.stats.npcCount} />
            <Kpi label={`Attaques (${hours} h)`} value={log?.stats.attacks} />
            <Kpi label="dont sur barbares" value={log?.stats.onBarbarians} />
            <Kpi label="dont sur joueurs" value={log?.stats.onPlayers} />
            <Kpi label="Espionnages" value={log?.stats.scouts} />
            <Kpi label="Offres de marché" value={log?.stats.offers} />
            <Kpi label="Attaques en heures calmes" value={log?.stats.quietAttacks} />
          </div>
          <Panel title="Activité des PNJ">
            <div className="row admin-chips">
              {kinds.map(([k, label]) => (
                <button key={k} className={`chip chip-btn ${kind === k ? 'chip-ok' : ''}`} aria-pressed={kind === k} onClick={() => setKind(k)}>
                  {label}
                </button>
              ))}
            </div>
            {!log ? (
              <p className="muted">Chargement…</p>
            ) : events.length === 0 ? (
              <p className="muted">Aucune activité sur cette période.</p>
            ) : (
              <div className="admin-scroll">
                <table className="admin-table">
                  <thead>
                    <tr>
                      <th>Heure</th>
                      <th>PNJ</th>
                      <th>Action</th>
                      <th className="hide-m">Cible</th>
                      <th>Résultat</th>
                    </tr>
                  </thead>
                  <tbody>
                    {events.map((e, i) => (
                      <tr key={i}>
                        <td className="t">
                          {clockTime(e.at)}
                          {e.quiet && <span className="chip" title="Heures calmes"> 🌙</span>}
                        </td>
                        <td>{e.npc}</td>
                        <td>{KIND_LABEL[e.kind]}</td>
                        <td className="hide-m">{e.target}</td>
                        <td>{e.result}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            )}
          </Panel>
        </>
      )}

      {tab === 'players' && (
        <Panel
          title="Joueurs et PNJ"
          actions={
            <label className="small">
              <input type="checkbox" checked={showNpc} onChange={(e) => setShowNpc(e.target.checked)} /> Afficher les PNJ
            </label>
          }
        >
          {!players ? (
            <p className="muted">Chargement…</p>
          ) : (
            <div className="admin-scroll">
              <table className="admin-table">
                <thead>
                  <tr>
                    <th>Pseudo</th>
                    <th>Tribu</th>
                    <th>Villages</th>
                    <th>Points</th>
                    <th className="hide-m">Dernière activité</th>
                  </tr>
                </thead>
                <tbody>
                  {players
                    .filter((p) => showNpc || !p.isNpc)
                    .map((p) => (
                      <tr key={p.id}>
                        <td>
                          {p.username}
                          {p.isNpc && <span className="chip">PNJ{p.profile ? ` · ${p.profile}` : ''}</span>}
                        </td>
                        <td>{p.tribe ? `[${p.tribe}]` : '—'}</td>
                        <td>{p.villages}</td>
                        <td>{fmt(p.points)}</td>
                        <td className="t hide-m">{p.isNpc ? '—' : p.lastSeen ? clockTime(p.lastSeen) : 'jamais'}</td>
                      </tr>
                    ))}
                </tbody>
              </table>
            </div>
          )}
        </Panel>
      )}

      {tab === 'market' && (
        <Panel title="Offres du marché">
          {!offers ? (
            <p className="muted">Chargement…</p>
          ) : offers.length === 0 ? (
            <p className="muted">Aucune offre sur cette période.</p>
          ) : (
            <div className="admin-scroll">
              <table className="admin-table">
                <thead>
                  <tr>
                    <th>Publiée</th>
                    <th>Auteur</th>
                    <th>Offre</th>
                    <th>Statut</th>
                  </tr>
                </thead>
                <tbody>
                  {offers.map((o) => (
                    <tr key={o.id}>
                      <td className="t">{clockTime(o.createdAt)}</td>
                      <td>
                        {o.owner}
                        {o.isNpc && <span className="chip">PNJ</span>}
                      </td>
                      <td>
                        {fmt(o.give.amount)} {o.give.resource} ⇄ {fmt(o.want.amount)} {o.want.resource}
                      </td>
                      <td>{STATUS_LABEL[o.status] ?? o.status}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </Panel>
      )}

      {tab === 'world' && (
        <>
          <div className="admin-kpis">
            {world && Object.entries(world.totals).map(([k, v]) => <Kpi key={k} label={TOTAL_LABEL[k.toLowerCase()] ?? k} value={v} />)}
          </div>
          <Panel title="Paramètres actifs">
            {!world ? (
              <p className="muted">Chargement…</p>
            ) : (
              <table className="admin-table">
                <tbody>
                  {Object.entries(world.settings).map(([k, v]) => (
                    <tr key={k}>
                      <td>{SETTING_LABEL[k] ?? k}</td>
                      <td>
                        <b>{String(v)}</b>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            )}
          </Panel>
        </>
      )}
    </div>
  );
}

function Kpi({ label, value }: { label: string; value: number | undefined }) {
  return (
    <div className="admin-kpi">
      <i>{label}</i>
      <b>{value === undefined ? '…' : fmt(value)}</b>
    </div>
  );
}
