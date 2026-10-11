import { useState } from 'react';
import { Panel } from '../ui';
import AdminWars from './AdminWars';
import './admin.css';

/** Guerres du monde, visibles par tous les joueurs : guerres en cours, batailles, conquêtes et journal des dernières heures. */
export default function WorldWars() {
  const [hours, setHours] = useState(24);
  return (
    <div className="stack">
      <Panel title="Guerres du monde">
        <p className="muted small">
          Toutes les guerres entre tribus (PNJ et joueurs), leurs batailles et leurs conquêtes. Les attaques en route ne sont pas détaillées. L'historique couvre au plus 72 heures.
        </p>
        <div className="row admin-chips">
          <span className="muted small">Période :</span>
          {[1, 6, 24, 72].map((h) => (
            <button key={h} className={`chip chip-btn ${hours === h ? 'chip-ok' : ''}`} aria-pressed={hours === h} onClick={() => setHours(h)}>
              {h} h
            </button>
          ))}
        </div>
      </Panel>
      <AdminWars hours={hours} publicView />
    </div>
  );
}
