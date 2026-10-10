import { useEffect, useState } from 'react';
import { api } from '../api';
import { fmt } from '../format';
import { useGame } from '../game';
import { Panel, PlayerLink } from '../ui';
import TribeTools from './TribeTools';

interface TribeInfo {
  id: number;
  name: string;
  tag: string;
  description: string;
  leaderId: number;
  isNpc?: boolean;
  points: number;
  members: { id: number; username: string; villages: number; points: number }[];
  invites: { id: number; username: string }[];
}

export default function Tribe({ id }: { id?: number }) {
  const { me, run, refreshMe, toast } = useGame();
  const tribeId = id ?? me.player.tribe?.id;
  const [tribe, setTribe] = useState<TribeInfo | null>(null);
  const [form, setForm] = useState({ name: '', tag: '' });
  const [invite, setInvite] = useState('');
  const [desc, setDesc] = useState<string | null>(null);

  const load = () => tribeId && run(async () => setTribe(await api(`/api/tribes/${tribeId}`)));
  useEffect(() => {
    setTribe(null);
    load();
  }, [tribeId]); // eslint-disable-line react-hooks/exhaustive-deps

  const invites = me.invites.length > 0 && (
    <Panel title="Invitations reçues">
      <ul className="list">
        {me.invites.map((i) => (
          <li key={i.id} className="row between">
            <span>
              [{i.tribeTag}] {i.tribeName}
            </span>
            <span className="row">
              <button className="btn small primary" onClick={() => run(async () => { await api(`/api/invites/${i.id}/accept`, { method: 'POST' }); await refreshMe(); })}>
                Rejoindre
              </button>
              <button className="btn small ghost" onClick={() => run(async () => { await api(`/api/invites/${i.id}/decline`, { method: 'POST' }); await refreshMe(); })}>
                Refuser
              </button>
            </span>
          </li>
        ))}
      </ul>
    </Panel>
  );

  if (!tribeId) {
    return (
      <div className="stack">
        {invites}
        <Panel title="Fonder une tribu">
          <p className="muted">Une tribu permet de se défendre ensemble, de s'envoyer des renforts et de grimper au classement des tribus.</p>
          <form
            className="form"
            onSubmit={(e) => {
              e.preventDefault();
              run(async () => {
                await api('/api/tribes', { body: form });
                await refreshMe();
                toast('Tribu fondée');
              });
            }}
          >
            <label htmlFor="tribe-name">Nom</label>
            <input id="tribe-name" value={form.name} onChange={(e) => setForm({ ...form, name: e.target.value })} minLength={3} maxLength={32} required />
            <label htmlFor="tribe-tag">Tag (2 à 6 caractères)</label>
            <input id="tribe-tag" value={form.tag} onChange={(e) => setForm({ ...form, tag: e.target.value })} minLength={2} maxLength={6} required />
            <button className="btn primary">Fonder la tribu</button>
          </form>
        </Panel>
      </div>
    );
  }

  if (!tribe) return <p className="muted">Chargement…</p>;
  const isMember = me.player.tribe?.id === tribe.id;
  const isLeader = tribe.leaderId === me.player.id;

  return (
    <div className="stack">
      {invites}
      <Panel title={`[${tribe.tag}] ${tribe.name}`}>
        <p className="muted">
          {tribe.members.length} membre{tribe.members.length > 1 ? 's' : ''} · {fmt(tribe.points)} points
        </p>
        {desc !== null ? (
          <form className="form" onSubmit={(e) => { e.preventDefault(); run(async () => { await api('/api/tribes/description', { body: { description: desc } }); setDesc(null); load(); }); }}>
            <textarea id="tribe-desc" rows={5} value={desc} onChange={(e) => setDesc(e.target.value)} maxLength={2000} />
            <div className="row">
              <button className="btn small primary">Enregistrer</button>
              <button type="button" className="btn small ghost" onClick={() => setDesc(null)}>Annuler</button>
            </div>
          </form>
        ) : (
          <>
            <p className="message-body">{tribe.description || <span className="muted">Pas encore de description.</span>}</p>
            {isLeader && <button className="link" onClick={() => setDesc(tribe.description)}>Modifier la description</button>}
          </>
        )}
      </Panel>


      <Panel title="Membres">
        <div className="table-wrap">
          <table className="rank-table">
            <thead>
              <tr><th>Joueur</th><th>Villages</th><th>Points</th>{isLeader && <th />}</tr>
            </thead>
            <tbody>
              {tribe.members.map((m) => (
                <tr key={m.id}>
                  <td><PlayerLink name={m.username} />{m.id === tribe.leaderId && <span className="chip">chef</span>}</td>
                  <td>{m.villages}</td>
                  <td>{fmt(m.points)}</td>
                  {isLeader && (
                    <td>
                      {m.id !== me.player.id && (
                        <button className="link small" onClick={() => run(async () => { await api('/api/tribes/kick', { body: { memberId: m.id } }); load(); })}>
                          exclure
                        </button>
                      )}
                    </td>
                  )}
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </Panel>

      {isMember && <TribeTools />}

      {isLeader && (
        <Panel title="Inviter un joueur">
          <form className="row" onSubmit={(e) => { e.preventDefault(); run(async () => { await api('/api/tribes/invite', { body: { username: invite } }); setInvite(''); toast('Invitation envoyée'); load(); }); }}>
            <input id="tribe-invite" placeholder="Pseudo" value={invite} onChange={(e) => setInvite(e.target.value)} required />
            <button className="btn primary">Inviter</button>
          </form>
          {tribe.invites.length > 0 && <p className="muted small">En attente : {tribe.invites.map((i) => i.username).join(', ')}</p>}
        </Panel>
      )}

      {isMember && (
        <button className="btn danger" onClick={() => run(async () => { await api('/api/tribes/leave', { method: 'POST' }); await refreshMe(); location.hash = '#/tribu'; })}>
          Quitter la tribu
        </button>
      )}
    </div>
  );
}
