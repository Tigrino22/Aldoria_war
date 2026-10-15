import { useCallback, useEffect, useState } from 'react';
import {
  MODERATION_COMMENT_MAX,
  MODERATION_KIND_LABELS,
  MODERATION_REASON_LABELS,
  type ModerationReportView,
  type ModerationStatus,
} from '@aldoria/shared';
import { api } from '../api';
import { clockTime } from '../format';
import { useGame } from '../game';
import { PlayerLink } from '../ui';
import './moderation.css';

const STATUS_LABEL: Record<ModerationStatus, string> = { open: 'À traiter', done: 'Traité', rejected: 'Rejeté' };

/** Administration > Signalements : ceux à traiter (les plus anciens d'abord), puis l'historique des décisions. */
export default function AdminModeration() {
  const { run, refreshMe } = useGame();
  const [view, setView] = useState<'open' | 'closed'>('open');
  const [reports, setReports] = useState<ModerationReportView[] | null>(null);

  const load = useCallback(() => run(async () => setReports(await api<ModerationReportView[]>(`/api/admin/moderation?status=${view}`))), [run, view]);
  useEffect(() => {
    setReports(null);
    load();
    const t = setInterval(load, 30_000);
    return () => clearInterval(t);
  }, [load]);

  const decide = (id: number, status: ModerationStatus, note: string) =>
    run(async () => {
      await api(`/api/admin/moderation/${id}`, { method: 'PUT', body: { status, note } });
      await load();
      refreshMe();
    });

  return (
    <section className="pg-card mod">
      <div className="tabs" role="tablist">
        <button role="tab" aria-selected={view === 'open'} onClick={() => setView('open')}>À traiter</button>
        <button role="tab" aria-selected={view === 'closed'} onClick={() => setView('closed')}>Historique</button>
      </div>
      {!reports ? (
        <p className="muted">Chargement…</p>
      ) : reports.length === 0 ? (
        <p className="pg-empty">{view === 'open' ? 'Aucun signalement en attente.' : 'Aucun signalement traité pour le moment.'}</p>
      ) : (
        <ul className="mod-list">
          {reports.map((r) => (
            <ReportCard key={r.id} r={r} onDecide={decide} />
          ))}
        </ul>
      )}
    </section>
  );
}

function ReportCard({ r, onDecide }: { r: ModerationReportView; onDecide: (id: number, status: ModerationStatus, note: string) => void }) {
  const [note, setNote] = useState('');
  return (
    <li className={`mod-card ${r.status}`}>
      <header className="mod-head">
        <span className="mod-tag">{MODERATION_KIND_LABELS[r.kind]}</span>
        <b>{MODERATION_REASON_LABELS[r.reason]}</b>
        {r.sameTarget > 1 && <span className="mod-tag alert">{r.sameTarget} signalements sur cette cible</span>}
        <span className="muted small mod-date">{clockTime(r.createdAt)}</span>
      </header>
      <p className="mod-line">
        {r.targetTribe ? (
          <>Tribu {r.targetTribe.id ? <a href={`#/tribu/${r.targetTribe.id}`}>{r.targetTribe.name}</a> : r.targetTribe.name}</>
        ) : (
          <>{r.kind === 'message' ? 'Auteur' : 'Joueur'} : {r.targetPlayer?.id ? <PlayerLink name={r.targetPlayer.name} /> : r.targetPlayer?.name}</>
        )}
        <span className="muted"> · signalé par <PlayerLink name={r.reporter} /></span>
      </p>
      {r.comment && <blockquote className="mod-comment">{r.comment}</blockquote>}
      {r.message && (
        <div className="mod-message">
          <span className="muted small">Message transmis par le destinataire</span>
          <b>{r.message.subject}</b>
          <p>{r.message.body}</p>
        </div>
      )}
      {r.status === 'open' ? (
        <div className="mod-actions">
          <input
            aria-label="Note de l’administrateur"
            placeholder="Note (facultatif) : averti, suspendu…"
            maxLength={MODERATION_COMMENT_MAX}
            value={note}
            onChange={(e) => setNote(e.target.value)}
          />
          <button className="btn small primary" onClick={() => onDecide(r.id, 'done', note)}>Traité</button>
          <button className="btn small ghost" onClick={() => onDecide(r.id, 'rejected', note)}>Rejeter</button>
        </div>
      ) : (
        <div className="mod-actions">
          <span className={`mod-tag ${r.status}`}>{STATUS_LABEL[r.status]}</span>
          <span className="muted small">
            par {r.handledBy} {r.handledAt && `le ${clockTime(r.handledAt)}`}
            {r.adminNote && ` · ${r.adminNote}`}
          </span>
          <button className="btn small ghost" onClick={() => onDecide(r.id, 'open', '')}>Rouvrir</button>
        </div>
      )}
    </li>
  );
}
