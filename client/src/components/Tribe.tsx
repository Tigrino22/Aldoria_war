import './tribe.css';
import { useCallback, useEffect, useState } from 'react';
import { api } from '../api';
import { fmt } from '../format';
import { useGame } from '../game';
import { PlayerLink } from '../ui';
import TribeAlliances from './TribeAlliances';
import TribeCrest from './TribeCrest';
import { Broadcast, MemberAttacks, Threats } from './TribeTools';
import TribeWars from './TribeWars';

interface Viewer {
  relation: 'self' | 'ally' | 'war' | 'sent' | 'received' | null;
  inviteId?: number;
  canPropose: boolean;
  /** Le joueur est chef et cette tribu lui a proposé une alliance. */
  canAnswer?: boolean;
}

interface TribeInfo {
  id: number;
  name: string;
  tag: string;
  description: string;
  leaderId: number;
  isNpc?: boolean;
  createdAt: string | null;
  points: number;
  killsAttack: number;
  killsDefense: number;
  members: { id: number; username: string; villages: number; points: number; killsAttack: number; killsDefense: number }[];
  invites: { id: number; username: string }[];
  allies: { id: number; tag: string; name: string }[];
  wars: number;
  viewer: Viewer;
}

type Tab = 'tribe' | 'alliances' | 'wars';

const RELATION: Record<Exclude<Viewer['relation'], 'self' | null>, [string, string]> = {
  ally: ['Tribu alliée', 'ally'],
  war: ['En guerre contre vous', 'war'],
  sent: ['Alliance proposée', 'pending'],
  received: ['Vous propose une alliance', 'pending'],
};

function Stat({ value, label, tone }: { value: number; label: string; tone?: string }) {
  return (
    <div className={`tr-stat ${tone ?? ''}`}>
      <b>{fmt(value)}</b>
      <span>{label}</span>
    </div>
  );
}

/** En-tête de la tribu : blason, nom, relation avec la tribu du joueur et chiffres clés. */
function Banner({ tribe, actions }: { tribe: TribeInfo; actions?: React.ReactNode }) {
  const rel = tribe.viewer.relation && tribe.viewer.relation !== 'self' ? RELATION[tribe.viewer.relation] : null;
  const leader = tribe.members.find((m) => m.id === tribe.leaderId);
  return (
    <header className="tr-banner">
      <div className="tr-banner-top">
        <TribeCrest id={tribe.id} tag={tribe.tag} size={84} ally={tribe.viewer.relation === 'ally'} />
        <div className="tr-title">
          <span className="tr-kicker">
            Tribu{tribe.isNpc ? ' de PNJ' : ''}
            {tribe.createdAt && !tribe.isNpc ? ` · fondée le ${new Date(tribe.createdAt).toLocaleDateString('fr-FR', { day: 'numeric', month: 'long', year: 'numeric' })}` : ''}
          </span>
          <h1>
            <span className="tr-tag">[{tribe.tag}]</span> {tribe.name}
          </h1>
          <span className="tr-chips">
            {leader && (
              <span className="tr-pill">
                <span aria-hidden="true">♛</span> Chef : <PlayerLink name={leader.username} />
              </span>
            )}
            {rel && <span className={`tr-pill ${rel[1]}`}>{rel[0]}</span>}
          </span>
        </div>
        {actions && <div className="tr-banner-actions">{actions}</div>}
      </div>
      <div className="tr-stats">
        <Stat value={tribe.members.length} label={tribe.members.length > 1 ? 'membres' : 'membre'} />
        <Stat value={tribe.points} label="points" />
        <Stat value={tribe.killsAttack} label="battus en attaque" />
        <Stat value={tribe.killsDefense} label="battus en défense" />
        <Stat value={tribe.allies.length} label={tribe.allies.length > 1 ? 'alliées' : 'alliée'} tone="sky" />
        <Stat value={tribe.wars} label={tribe.wars > 1 ? 'guerres' : 'guerre'} tone={tribe.wars ? 'red' : ''} />
      </div>
    </header>
  );
}

/** Membres classés par points, avec leur part des points de la tribu. */
function Members({ tribe, isLeader, onKick }: { tribe: TribeInfo; isLeader: boolean; onKick: (id: number, name: string) => void }) {
  const { me } = useGame();
  const top = Math.max(1, ...tribe.members.map((m) => m.points));
  return (
    <section className="tr-card">
      <header className="tr-card-head">
        <h3 className="tr-h">
          Membres <span className="tr-count">{tribe.members.length}</span>
        </h3>
      </header>
      <ol className="tr-members">
        {tribe.members.map((m, i) => (
          <li key={m.id} className={m.id === me.player.id ? 'me' : ''}>
            <span className="tr-rank">{i + 1}</span>
            <span className={`avatar ${m.id === tribe.leaderId ? 'leader' : ''}`}>{m.username.slice(0, 1).toUpperCase()}</span>
            <div className="tr-grow">
              <span className="tr-member-name">
                <PlayerLink name={m.username} />
                {m.id === tribe.leaderId && <span className="tr-crown" title="Chef de tribu">♛ chef</span>}
              </span>
              <span className="tr-bar" aria-hidden="true">
                <i style={{ width: `${Math.max(3, (m.points / top) * 100)}%` }} />
              </span>
            </div>
            <span className="tr-member-facts">
              <span>
                <b>{fmt(m.points)}</b> pts
              </span>
              <span className="muted">
                {m.villages} village{m.villages > 1 ? 's' : ''} · ⚔ {fmt(m.killsAttack)} · 🛡 {fmt(m.killsDefense)}
              </span>
            </span>
            {isLeader && m.id !== me.player.id && (
              <button className="tr-icon-btn" title={`Exclure ${m.username}`} aria-label={`Exclure ${m.username}`} onClick={() => onKick(m.id, m.username)}>
                ✕
              </button>
            )}
          </li>
        ))}
      </ol>
    </section>
  );
}

function Description({ tribe, isLeader, onSaved }: { tribe: TribeInfo; isLeader: boolean; onSaved: () => void }) {
  const { run } = useGame();
  const [desc, setDesc] = useState<string | null>(null);
  return (
    <section className="tr-card tr-charter">
      <header className="tr-card-head">
        <h3 className="tr-h">Charte de la tribu</h3>
        {isLeader && desc === null && (
          <button className="link small" onClick={() => setDesc(tribe.description)}>
            Modifier
          </button>
        )}
      </header>
      {desc !== null ? (
        <form
          className="form"
          onSubmit={(e) => {
            e.preventDefault();
            run(async () => {
              await api('/api/tribes/description', { body: { description: desc } });
              setDesc(null);
              onSaved();
            });
          }}
        >
          <textarea id="tribe-desc" rows={5} value={desc} onChange={(e) => setDesc(e.target.value)} maxLength={2000} />
          <div className="row">
            <button className="btn small primary">Enregistrer</button>
            <button type="button" className="btn small ghost" onClick={() => setDesc(null)}>
              Annuler
            </button>
          </div>
        </form>
      ) : tribe.description ? (
        <p className="tr-charter-text message-body">{tribe.description}</p>
      ) : (
        <p className="muted">{isLeader ? 'Écrivez la charte de votre tribu : ses objectifs, ses règles, comment la rejoindre.' : 'Pas encore de description.'}</p>
      )}
    </section>
  );
}

/** Alliés en bref, pour la colonne de droite et la page publique. */
function AlliesBrief({ tribe, onOpen }: { tribe: TribeInfo; onOpen?: () => void }) {
  return (
    <section className="tr-card">
      <header className="tr-card-head">
        <h3 className="tr-h">
          Alliés <span className="tr-count">{tribe.allies.length}</span>
        </h3>
        {onOpen && (
          <button className="link small" onClick={onOpen}>
            Gérer
          </button>
        )}
      </header>
      {tribe.allies.length === 0 ? (
        <p className="muted small">Aucune tribu alliée pour l’instant.</p>
      ) : (
        <ul className="tr-ally-chips">
          {tribe.allies.map((a) => (
            <li key={a.id}>
              <a href={`#/tribu/${a.id}`}>
                <TribeCrest id={a.id} tag={a.tag} size={26} ally />
                <span>
                  <b>[{a.tag}]</b> {a.name}
                </span>
              </a>
            </li>
          ))}
        </ul>
      )}
    </section>
  );
}

function InvitePlayer({ tribe, onSent }: { tribe: TribeInfo; onSent: () => void }) {
  const { run, toast } = useGame();
  const [name, setName] = useState('');
  return (
    <section className="tr-card">
      <h3 className="tr-h">Recruter un joueur</h3>
      <form
        className="tr-propose"
        onSubmit={(e) => {
          e.preventDefault();
          run(async () => {
            await api('/api/tribes/invite', { body: { username: name } });
            setName('');
            toast('Invitation envoyée');
            onSent();
          });
        }}
      >
        <label htmlFor="tribe-invite" className="sr-only">
          Pseudo
        </label>
        <input id="tribe-invite" placeholder="Pseudo du joueur" value={name} onChange={(e) => setName(e.target.value)} required />
        <button className="btn primary">Inviter</button>
      </form>
      {tribe.invites.length > 0 && (
        <p className="muted small">
          En attente : {tribe.invites.map((i) => i.username).join(', ')}
        </p>
      )}
    </section>
  );
}

/** Invitations à rejoindre une tribu, reçues par le joueur. */
function PlayerInvites() {
  const { me, run, refreshMe } = useGame();
  if (me.invites.length === 0) return null;
  const answer = (id: number, action: 'accept' | 'decline') =>
    run(async () => {
      await api(`/api/invites/${id}/${action}`, { method: 'POST' });
      await refreshMe();
    });
  return (
    <section className="tr-card tr-callout">
      <h3 className="tr-h">Invitations reçues</h3>
      <ul className="tr-invites">
        {me.invites.map((i) => (
          <li key={i.id}>
            <TribeCrest id={i.tribeId} tag={i.tribeTag} size={44} />
            <div className="tr-grow">
              <a className="tr-name" href={`#/tribu/${i.tribeId}`}>
                [{i.tribeTag}] {i.tribeName}
              </a>
              <span className="muted small">vous invite à la rejoindre</span>
            </div>
            <div className="tr-actions">
              <button className="btn small primary" onClick={() => answer(i.id, 'accept')}>
                Rejoindre
              </button>
              <button className="btn small ghost" onClick={() => answer(i.id, 'decline')}>
                Refuser
              </button>
            </div>
          </li>
        ))}
      </ul>
    </section>
  );
}

function Found() {
  const { run, refreshMe, toast } = useGame();
  const [form, setForm] = useState({ name: '', tag: '' });
  const preview = form.tag.trim().toUpperCase() || 'TAG';
  return (
    <div className="tr-page">
      <PlayerInvites />
      <section className="tr-banner tr-found">
        <div className="tr-banner-top">
          <TribeCrest id={[...preview].reduce((n, ch) => n + ch.charCodeAt(0), 0)} tag={preview} size={84} />
          <div className="tr-title">
            <span className="tr-kicker">Vous n’avez pas encore de tribu</span>
            <h1>Fonder une tribu</h1>
            <p className="tr-lead">Une tribu permet de se défendre ensemble, de s’envoyer des renforts, de conclure des alliances et de grimper au classement des tribus.</p>
          </div>
        </div>
        <form
          className="tr-found-form"
          onSubmit={(e) => {
            e.preventDefault();
            run(async () => {
              await api('/api/tribes', { body: form });
              await refreshMe();
              toast('Tribu fondée');
            });
          }}
        >
          <label>
            <span>Nom</span>
            <input id="tribe-name" value={form.name} onChange={(e) => setForm({ ...form, name: e.target.value })} minLength={3} maxLength={32} required />
          </label>
          <label>
            <span>Tag (2 à 6 caractères)</span>
            <input id="tribe-tag" value={form.tag} onChange={(e) => setForm({ ...form, tag: e.target.value })} minLength={2} maxLength={6} required />
          </label>
          <button className="btn gold">Fonder la tribu</button>
        </form>
      </section>
    </div>
  );
}

export default function Tribe({ id }: { id?: number }) {
  const { me, run, refreshMe, toast } = useGame();
  const tribeId = id ?? me.player.tribe?.id;
  const [tribe, setTribe] = useState<TribeInfo | null>(null);
  const [tab, setTab] = useState<Tab>('tribe');
  const [warCount, setWarCount] = useState<number | null>(null);
  const [allyCount, setAllyCount] = useState<{ allies: number; pending: number } | null>(null);

  const load = useCallback(() => tribeId && run(async () => setTribe(await api(`/api/tribes/${tribeId}`))), [tribeId, run]);
  useEffect(() => {
    setTribe(null);
    setTab('tribe');
    load();
  }, [tribeId]); // eslint-disable-line react-hooks/exhaustive-deps

  // Les compteurs des onglets s'affichent dès l'ouverture de la page.
  const ownTribe = me.player.tribe?.id === tribeId;
  useEffect(() => {
    if (!ownTribe) return;
    run(async () => setWarCount((await api<{ active: unknown[] }>('/api/tribes/mine/wars')).active.length));
    run(async () => {
      const v = await api<{ allies: unknown[]; received: unknown[] }>('/api/tribes/mine/alliances');
      setAllyCount({ allies: v.allies.length, pending: v.received.length });
    });
  }, [ownTribe, run]);
  const onAllyCount = useCallback(
    (allies: number, pending: number) => {
      setAllyCount((old) => {
        if (old && old.allies !== allies) load();
        return { allies, pending };
      });
    },
    [load],
  );

  if (!tribeId) return <Found />;
  if (!tribe) return <p className="muted">Chargement…</p>;
  const isMember = me.player.tribe?.id === tribe.id;
  const isLeader = tribe.leaderId === me.player.id;

  const kick = (memberId: number, name: string) =>
    window.confirm(`Exclure ${name} de la tribu ?`) &&
    run(async () => {
      await api('/api/tribes/kick', { body: { memberId } });
      load();
    });
  const leave = () =>
    window.confirm('Quitter la tribu ?') &&
    run(async () => {
      await api('/api/tribes/leave', { method: 'POST' });
      await refreshMe();
      location.hash = '#/tribu';
    });

  // Sur la page d'une autre tribu, le chef peut proposer une alliance ou répondre à celle qu'elle propose.
  const v = tribe.viewer;
  const answer = (action: 'accept' | 'decline') =>
    run(async () => {
      await api(`/api/tribes/mine/alliances/invites/${v.inviteId}/${action}`, { method: 'POST' });
      toast(action === 'accept' ? `Alliance conclue avec [${tribe.tag}]` : 'Proposition refusée');
      load();
    });
  const bannerActions = !isMember && (
    <>
      {v.canPropose && (
        <button
          className="btn ally"
          onClick={() =>
            run(async () => {
              await api('/api/tribes/mine/alliances', { body: { targetId: tribe.id } });
              toast(`Proposition d’alliance envoyée à [${tribe.tag}]`);
              load();
            })
          }
        >
          🤝 Proposer une alliance
        </button>
      )}
      {v.canAnswer && (
        <>
          <button className="btn ally" onClick={() => answer('accept')}>
            Accepter l’alliance
          </button>
          <button className="btn ghost on-dark" onClick={() => answer('decline')}>
            Refuser
          </button>
        </>
      )}
    </>
  );

  const tabs: [Tab, string, React.ReactNode][] = [
    ['tribe', 'Tribu', null],
    ['alliances', 'Alliances', allyCount ? (allyCount.pending ? <span className="tr-badge alert">{allyCount.pending}</span> : <span className="tr-badge">{allyCount.allies}</span>) : null],
    ['wars', 'Guerres', warCount ? <span className="tr-badge red">{warCount}</span> : null],
  ];

  return (
    <div className="tr-page">
      <PlayerInvites />
      <Banner tribe={tribe} actions={bannerActions || undefined} />
      {isMember && (
        <nav className="tr-tabs" role="tablist">
          {tabs.map(([key, label, badge]) => (
            <button key={key} role="tab" aria-selected={tab === key} onClick={() => setTab(key)}>
              {label}
              {badge}
            </button>
          ))}
        </nav>
      )}
      {isMember && tab === 'wars' && <TribeWars onCount={setWarCount} />}
      {isMember && tab === 'alliances' && <TribeAlliances onCount={onAllyCount} />}
      {(!isMember || tab === 'tribe') && (
        <div className="tr-grid">
          <div className="tr-main">
            <Description tribe={tribe} isLeader={isLeader} onSaved={load} />
            <Members tribe={tribe} isLeader={isLeader} onKick={kick} />
            {isMember && <Threats />}
            {isMember && <MemberAttacks />}
          </div>
          <aside className="tr-side">
            <AlliesBrief tribe={tribe} onOpen={isMember ? () => setTab('alliances') : undefined} />
            {isLeader && <InvitePlayer tribe={tribe} onSent={load} />}
            {isMember && <Broadcast />}
            {isMember && (
              <button className="btn danger ghost tr-leave" onClick={leave}>
                Quitter la tribu
              </button>
            )}
          </aside>
        </div>
      )}
    </div>
  );
}

