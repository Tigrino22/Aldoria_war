import { useCallback, useEffect, useState } from 'react';
import { BUG_STATUS_LABELS, MODERATION_COMMENT_MAX, type AdminBugReportView, type BugStatus } from '@aldoria/shared';
import { api } from '../api';
import { clockTime } from '../format';
import { useGame } from '../game';
import { PlayerLink } from '../ui';
import './moderation.css';

/** Administration > Bugs : bugs remontés par les joueurs. La réponse saisie est visible par le joueur sur sa page « Signaler un bug ». */
export default function AdminBugs() {
  const { run, refreshMe } = useGame();
  const [view, setView] = useState<'open' | 'closed'>('open');
  const [bugs, setBugs] = useState<AdminBugReportView[] | null>(null);

  const load = useCallback(() => run(async () => setBugs(await api<AdminBugReportView[]>(`/api/admin/bugs?status=${view}`))), [run, view]);
  useEffect(() => {
    setBugs(null);
    load();
    const t = setInterval(load, 30_000);
    return () => clearInterval(t);
  }, [load]);

  const decide = (id: number, status: BugStatus, note: string) =>
    run(async () => {
      await api(`/api/admin/bugs/${id}`, { method: 'PUT', body: { status, note } });
      await load();
      refreshMe();
    });

  return (
    <section className="pg-card mod">
      <div className="tabs" role="tablist">
        <button role="tab" aria-selected={view === 'open'} onClick={() => setView('open')}>À traiter</button>
        <button role="tab" aria-selected={view === 'closed'} onClick={() => setView('closed')}>Historique</button>
      </div>
      {!bugs ? (
        <p className="muted">Chargement…</p>
      ) : bugs.length === 0 ? (
        <p className="pg-empty">{view === 'open' ? 'Aucun bug en attente.' : 'Aucun bug traité pour le moment.'}</p>
      ) : (
        <ul className="mod-list">
          {bugs.map((b) => (
            <BugCard key={b.id} b={b} onDecide={decide} />
          ))}
        </ul>
      )}
    </section>
  );
}

function BugCard({ b, onDecide }: { b: AdminBugReportView; onDecide: (id: number, status: BugStatus, note: string) => void }) {
  const [note, setNote] = useState('');
  return (
    <li className={`mod-card ${b.status}`}>
      <header className="mod-head">
        <span className="mod-tag">Bug</span>
        {b.page ? <a href={`#/${b.page}`}>{b.page}</a> : <span className="muted small">page inconnue</span>}
        <span className="muted small mod-date">{clockTime(b.createdAt)}</span>
      </header>
      <p className="mod-line">
        Signalé par <PlayerLink name={b.reporter} />
      </p>
      <p className="mod-text">{b.description}</p>
      <p className="mod-device">
        {b.screen && `Écran ${b.screen} · `}
        {b.device}
      </p>
      {b.status === 'open' ? (
        <div className="mod-actions">
          <input
            aria-label="Réponse au joueur"
            placeholder="Réponse au joueur (facultatif)"
            maxLength={MODERATION_COMMENT_MAX}
            value={note}
            onChange={(e) => setNote(e.target.value)}
          />
          <button className="btn small primary" onClick={() => onDecide(b.id, 'fixed', note)}>Corrigé</button>
          <button className="btn small ghost" onClick={() => onDecide(b.id, 'rejected', note)}>Non retenu</button>
        </div>
      ) : (
        <div className="mod-actions">
          <span className={`mod-tag ${b.status}`}>{BUG_STATUS_LABELS[b.status]}</span>
          <span className="muted small">
            par {b.handledBy} {b.handledAt && `le ${clockTime(b.handledAt)}`}
            {b.adminNote && ` · ${b.adminNote}`}
          </span>
          <button className="btn small ghost" onClick={() => onDecide(b.id, 'open', '')}>Rouvrir</button>
        </div>
      )}
    </li>
  );
}
