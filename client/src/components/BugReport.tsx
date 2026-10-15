import { useCallback, useEffect, useState } from 'react';
import { BUG_DESCRIPTION_MAX, BUG_DESCRIPTION_MIN, BUG_STATUS_LABELS, type BugReportView } from '@aldoria/shared';
import { api } from '../api';
import { clockTime } from '../format';
import { useGame } from '../game';
import { PageBanner } from './PageBanner';
import './moderation.css';

/**
 * Page « Signaler un bug » : un formulaire court, la page d'où vient le joueur et son appareil sont relevés tout seuls.
 * En dessous, ses derniers bugs et la réponse de l'administration.
 */
export default function BugReport({ from }: { from: string }) {
  const { run, toast } = useGame();
  const [text, setText] = useState('');
  const [mine, setMine] = useState<BugReportView[] | null>(null);
  const load = useCallback(() => run(async () => setMine(await api<BugReportView[]>('/api/bugs/mine'))), [run]);
  useEffect(() => {
    load();
  }, [load]);

  const send = () =>
    run(async () => {
      await api('/api/bugs', {
        body: { description: text, page: from, device: navigator.userAgent, screen: `${window.innerWidth}x${window.innerHeight}` },
      });
      toast('Bug envoyé, merci de nous aider à améliorer le jeu');
      setText('');
      await load();
    });

  return (
    <div className="pg bugs">
      <PageBanner
        icon="bug"
        kicker="Aide"
        title="Signaler un bug"
        lead="Quelque chose ne marche pas comme prévu ? Décrivez ce que vous faisiez et ce qui s'est passé : l'administrateur reçoit votre message et vous répond ici."
      />
      <section className="pg-card">
        <form
          className="form"
          onSubmit={(e) => {
            e.preventDefault();
            send();
          }}
        >
          <label htmlFor="bug-text">Que s'est-il passé ?</label>
          <textarea
            id="bug-text"
            rows={6}
            minLength={BUG_DESCRIPTION_MIN}
            maxLength={BUG_DESCRIPTION_MAX}
            required
            placeholder="Ex. : sur la carte, après avoir zoomé, l'écran reste noir. J'étais sur iPhone."
            value={text}
            onChange={(e) => setText(e.target.value)}
          />
          <p className="muted small">
            Envoyé avec : la page {from ? <code>{from}</code> : 'd’accueil'}, votre navigateur et la taille de votre écran, pour retrouver le problème plus vite.
          </p>
          <div className="row">
            <button className="btn primary" disabled={text.trim().length < BUG_DESCRIPTION_MIN}>
              Envoyer
            </button>
          </div>
        </form>
      </section>
      {mine && mine.length > 0 && (
        <section className="pg-card">
          <h3 className="pg-section">Mes signalements</h3>
          <ul className="mod-list">
            {mine.map((b) => (
              <li key={b.id} className={`mod-card ${b.status}`}>
                <header className="mod-head">
                  <span className={`mod-tag ${b.status}`}>{BUG_STATUS_LABELS[b.status]}</span>
                  {b.page && <span className="muted small">{b.page}</span>}
                  <span className="muted small mod-date">{clockTime(b.createdAt)}</span>
                </header>
                <p className="mod-text">{b.description}</p>
                {b.adminNote && <blockquote className="mod-comment">Réponse : {b.adminNote}</blockquote>}
              </li>
            ))}
          </ul>
        </section>
      )}
    </div>
  );
}
