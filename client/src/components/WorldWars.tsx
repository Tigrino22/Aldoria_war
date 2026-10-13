import { useState } from 'react';
import { PageBanner } from './PageBanner';
import AdminWars from './AdminWars';
import './admin.css';

/** Guerres du monde, visibles par tous les joueurs : guerres en cours, batailles, conquêtes et journal des dernières heures. */
export default function WorldWars() {
  const [hours, setHours] = useState(24);
  return (
    <div className="pg worldwars">
      <PageBanner
        icon="guerres"
        kicker="Social · chroniques"
        title="Guerres du monde"
        lead="Toutes les guerres entre tribus (PNJ et joueurs), leurs batailles et leurs conquêtes. Les attaques en route ne sont pas détaillées. L'historique couvre au plus 72 heures."
        chips={
          <>
            <span className="pg-chip-label">Période :</span>
            {[1, 6, 24, 72].map((h) => (
              <button key={h} className={`chip chip-btn ${hours === h ? 'chip-ok' : ''}`} aria-pressed={hours === h} onClick={() => setHours(h)}>
                {h} h
              </button>
            ))}
          </>
        }
      />
      <AdminWars hours={hours} publicView />
    </div>
  );
}
