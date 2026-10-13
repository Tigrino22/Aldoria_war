import { useEffect, useState } from 'react';
import { api } from '../api';
import { clockTime } from '../format';
import { useGame, useRoute } from '../game';
import { PlayerLink } from '../ui';
import { PageBanner } from './PageBanner';
import './messages.css';

interface MessageSummary {
  id: number;
  subject: string;
  read: boolean;
  createdAt: string;
  from: string | null;
  to: string | null;
}

export default function Messages({ id, to }: { id?: number; to?: string }) {
  const { me, run, refreshMe, toast } = useGame();
  const [, go] = useRoute();
  const [box, setBox] = useState<'in' | 'out'>('in');
  const [list, setList] = useState<MessageSummary[]>([]);
  const [msg, setMsg] = useState<any>(null);
  const [compose, setCompose] = useState<{ to: string; subject: string; body: string } | null>(null);

  useEffect(() => {
    run(async () => setList(await api(`/api/messages?box=${box}`)));
  }, [box, run, id]);
  useEffect(() => {
    if (to) setCompose({ to, subject: '', body: '' });
  }, [to]);
  useEffect(() => {
    setMsg(null);
    if (id) run(async () => { setMsg(await api(`/api/messages/${id}`)); refreshMe(); });
  }, [id, run, refreshMe]);

  if (compose) {
    return (
      <div className="pg messages">
        <PageBanner icon="messages" kicker="Social · messagerie" title="Nouveau message" lead="Écrivez à un joueur : il le recevra dans sa messagerie, même hors ligne." />
        <section className="pg-card">
        <form
          className="form"
          onSubmit={(e) => {
            e.preventDefault();
            run(async () => {
              await api('/api/messages', { body: compose });
              toast('Message envoyé');
              setCompose(null);
              setBox('out');
              if (to) go('messages');
            });
          }}
        >
          <label htmlFor="msg-to">Destinataire</label>
          <input id="msg-to" value={compose.to} onChange={(e) => setCompose({ ...compose, to: e.target.value })} required />
          <label htmlFor="msg-subject">Objet</label>
          <input id="msg-subject" value={compose.subject} onChange={(e) => setCompose({ ...compose, subject: e.target.value })} required maxLength={120} />
          <label htmlFor="msg-body">Message</label>
          <textarea id="msg-body" rows={8} value={compose.body} onChange={(e) => setCompose({ ...compose, body: e.target.value })} required maxLength={5000} />
          <div className="row">
            <button className="btn primary">Envoyer</button>
            <button type="button" className="btn ghost" onClick={() => setCompose(null)}>Annuler</button>
          </div>
        </form>
        </section>
      </div>
    );
  }

  if (id && msg) {
    return (
      <div className="pg messages">
      <PageBanner
        icon="messages"
        kicker={`Message · ${clockTime(msg.createdAt)}`}
        title={msg.subject}
        lead={
          <>
            De {msg.from ? <PlayerLink name={msg.from} /> : 'joueur supprimé'} à <PlayerLink name={msg.to} />
          </>
        }
        actions={
          <>
            <button className="btn small" onClick={() => go('messages')}>← Retour</button>
            {/* On répond toujours à l'interlocuteur : si le message vient de moi, c'est son destinataire. */}
            {(() => {
              const other = msg.from === me.player.username ? msg.to : msg.from;
              return other ? (
                <button className="btn small primary" onClick={() => setCompose({ to: other, subject: `Re: ${msg.subject.replace(/^Re: /, '')}`, body: '' })}>Répondre</button>
              ) : null;
            })()}
          </>
        }
      />
        <section className="pg-card msg-letter">
          <p className="message-body">{msg.body}</p>
        </section>
      </div>
    );
  }

  return (
    <div className="pg messages">
      <PageBanner
        icon="messages"
        kicker="Social"
        title="Messagerie"
        lead="Vos échanges avec les autres seigneurs du royaume."
        actions={<button className="btn small primary" onClick={() => setCompose({ to: '', subject: '', body: '' })}>Écrire un message</button>}
        stats={box === 'in' ? [
          { value: list.length, label: 'messages reçus', tone: 'gold' },
          { value: list.filter((m) => !m.read).length, label: 'non lus' },
        ] : [{ value: list.length, label: 'messages envoyés', tone: 'gold' }]}
      />
      <div className="tabs" role="tablist">
        <button role="tab" aria-selected={box === 'in'} onClick={() => setBox('in')}>Reçus</button>
        <button role="tab" aria-selected={box === 'out'} onClick={() => setBox('out')}>Envoyés</button>
      </div>
      <section className="pg-card">
      {list.length === 0 ? (
        <p className="pg-empty">Aucun message.</p>
      ) : (
        <ul className="msg-list">
          {list.map((m) => {
            const who = (box === 'in' ? m.from : m.to) ?? '?';
            return (
              <li key={m.id}>
                <a href={`#/messages/${m.id}`} className={!m.read && box === 'in' ? 'unread' : ''}>
                  <span className="avatar">{who.slice(0, 1).toUpperCase()}</span>
                  <span className="msg-main">
                    <b>{m.subject}</b>
                    <span className="muted small">{box === 'in' ? `de ${who}` : `à ${who}`}</span>
                  </span>
                  <span className="muted small msg-date">{clockTime(m.createdAt)}</span>
                </a>
              </li>
            );
          })}
        </ul>
      )}
      </section>
    </div>
  );
}
