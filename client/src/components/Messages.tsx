import { useEffect, useState } from 'react';
import { api } from '../api';
import { clockTime } from '../format';
import { useGame, useRoute } from '../game';
import { Panel } from '../ui';

interface MessageSummary {
  id: number;
  subject: string;
  read: boolean;
  createdAt: string;
  from: string | null;
  to: string | null;
}

export default function Messages({ id }: { id?: number }) {
  const { run, refreshMe, toast } = useGame();
  const [, go] = useRoute();
  const [box, setBox] = useState<'in' | 'out'>('in');
  const [list, setList] = useState<MessageSummary[]>([]);
  const [msg, setMsg] = useState<any>(null);
  const [compose, setCompose] = useState<{ to: string; subject: string; body: string } | null>(null);

  useEffect(() => {
    run(async () => setList(await api(`/api/messages?box=${box}`)));
  }, [box, run, id]);
  useEffect(() => {
    setMsg(null);
    if (id) run(async () => { setMsg(await api(`/api/messages/${id}`)); refreshMe(); });
  }, [id, run, refreshMe]);

  if (compose) {
    return (
      <Panel title="Nouveau message">
        <form
          className="form"
          onSubmit={(e) => {
            e.preventDefault();
            run(async () => {
              await api('/api/messages', { body: compose });
              toast('Message envoyé');
              setCompose(null);
              setBox('out');
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
      </Panel>
    );
  }

  if (id && msg) {
    return (
      <Panel
        title={msg.subject}
        actions={
          <div className="row">
            <button className="btn small ghost" onClick={() => go('messages')}>Retour</button>
            {msg.from && (
              <button className="btn small" onClick={() => setCompose({ to: msg.from, subject: `Re: ${msg.subject}`, body: '' })}>Répondre</button>
            )}
          </div>
        }
      >
        <p className="muted small">
          De {msg.from ?? 'joueur supprimé'} à {msg.to} · {clockTime(msg.createdAt)}
        </p>
        <p className="message-body">{msg.body}</p>
      </Panel>
    );
  }

  return (
    <Panel title="Messagerie" actions={<button className="btn small primary" onClick={() => setCompose({ to: '', subject: '', body: '' })}>Écrire</button>}>
      <div className="tabs" role="tablist">
        <button role="tab" aria-selected={box === 'in'} onClick={() => setBox('in')}>Reçus</button>
        <button role="tab" aria-selected={box === 'out'} onClick={() => setBox('out')}>Envoyés</button>
      </div>
      {list.length === 0 ? (
        <p className="muted">Aucun message.</p>
      ) : (
        <ul className="list">
          {list.map((m) => (
            <li key={m.id}>
              <a href={`#/messages/${m.id}`} className={!m.read && box === 'in' ? 'unread' : ''}>
                <span>{m.subject}</span>
                <span className="muted small">
                  {box === 'in' ? m.from : `à ${m.to}`} · {clockTime(m.createdAt)}
                </span>
              </a>
            </li>
          ))}
        </ul>
      )}
    </Panel>
  );
}
