import { useState } from 'react';
import { createPortal } from 'react-dom';
import {
  MODERATION_COMMENT_MAX,
  MODERATION_REASONS,
  MODERATION_REASON_LABELS,
  type ModerationKind,
  type ModerationReason,
} from '@aldoria/shared';
import { api } from '../api';
import { useGame } from '../game';
import { NavIcon } from './NavIcon';
import './moderation.css';

/**
 * Bouton « Signaler » (rouge, bien visible) et sa fenêtre : motif, commentaire, envoi à l'administration.
 * `target` : pseudo du joueur, id du message reçu ou id de la tribu ; `label` nomme ce qui est signalé dans la fenêtre.
 */
export default function ReportButton({ kind, target, label }: { kind: ModerationKind; target: string | number; label: string }) {
  const [open, setOpen] = useState(false);
  return (
    <>
      <button type="button" className="btn small danger report-btn" onClick={() => setOpen(true)}>
        <NavIcon name="banniere" size={15} />
        Signaler
      </button>
      {/* Rendue à la racine du document : dans la bannière, le flou d'arrière-plan enfermerait la fenêtre. */}
      {open && createPortal(<ReportDialog kind={kind} target={target} label={label} onClose={() => setOpen(false)} />, document.body)}
    </>
  );
}

function ReportDialog({ kind, target, label, onClose }: { kind: ModerationKind; target: string | number; label: string; onClose: () => void }) {
  const { run, toast } = useGame();
  const [reason, setReason] = useState<ModerationReason | null>(null);
  const [comment, setComment] = useState('');
  const send = () =>
    run(async () => {
      await api('/api/moderation/reports', { body: { kind, target, reason, comment } });
      toast('Signalement envoyé à l’administration, merci');
      onClose();
    });
  return (
    <div className="modal-backdrop" onClick={onClose}>
      <form
        className="report-dialog"
        role="dialog"
        aria-modal="true"
        aria-label={`Signaler ${label}`}
        onClick={(e) => e.stopPropagation()}
        onSubmit={(e) => {
          e.preventDefault();
          if (reason) send();
        }}
      >
        <h2>Signaler {label}</h2>
        <p className="muted small">
          {kind === 'message'
            ? 'Une copie de ce message sera transmise à l’administration, qui ne lit pas les messageries.'
            : 'L’administration examinera votre signalement. Le joueur visé ne saura pas qui l’a signalé.'}
        </p>
        <fieldset className="report-reasons">
          <legend>Motif</legend>
          {MODERATION_REASONS.map((r) => (
            <label key={r} className={reason === r ? 'on' : ''}>
              <input type="radio" name="report-reason" value={r} checked={reason === r} onChange={() => setReason(r)} />
              {MODERATION_REASON_LABELS[r]}
            </label>
          ))}
        </fieldset>
        <label htmlFor="report-comment">Précisions (facultatif)</label>
        <textarea id="report-comment" rows={4} maxLength={MODERATION_COMMENT_MAX} value={comment} onChange={(e) => setComment(e.target.value)} />
        <div className="row between">
          <button type="button" className="btn ghost" onClick={onClose}>
            Annuler
          </button>
          <button className="btn danger" disabled={!reason}>
            Envoyer le signalement
          </button>
        </div>
      </form>
    </div>
  );
}
