import type { ReactNode } from 'react';
import { fmt } from '../format';
import { NavIcon, type NavIconName } from './NavIcon';
import './page.css';

export interface BannerStat {
  value: ReactNode;
  label: string;
  tone?: '' | 'gold' | 'sky' | 'red' | 'ok';
  className?: string;
}

/**
 * En-tête des pages du jeu, thème « Heure dorée » (docs/CHARTE-GRAPHIQUE.md) : bois sombre texturé, médaillon doré,
 * sur-titre, titre Cinzel et chiffres clés en tuiles de verre, comme la bannière de la page Tribu.
 */
export function PageBanner({
  icon,
  kicker,
  title,
  lead,
  chips,
  actions,
  stats,
  media,
  statsClass,
}: {
  icon?: NavIconName;
  kicker?: ReactNode;
  title: ReactNode;
  lead?: ReactNode;
  chips?: ReactNode;
  actions?: ReactNode;
  stats?: BannerStat[];
  /** Image à la place du médaillon (bâtiment, unité…). */
  media?: ReactNode;
  statsClass?: string;
}) {
  return (
    <header className="pg-banner">
      <div className="pg-banner-top">
        {media ? (
          <span className="pg-media">{media}</span>
        ) : (
          icon && (
            <span className="pg-medal" aria-hidden>
              <NavIcon name={icon} size={30} />
            </span>
          )
        )}
        <div className="pg-title">
          {kicker && <span className="pg-kicker">{kicker}</span>}
          <h1>{title}</h1>
          {lead && <p className="pg-lead">{lead}</p>}
          {chips && <span className="pg-chips">{chips}</span>}
        </div>
        {actions && <div className="pg-banner-actions">{actions}</div>}
      </div>
      {stats && stats.length > 0 && (
        <div className={`pg-stats cols-${Math.min(stats.length, 6)} ${statsClass ?? ''}`}>
          {stats.map((s, i) => (
            <div key={i} className={`pg-stat ${s.tone ?? ''} ${s.className ?? ''}`}>
              <b>{typeof s.value === 'number' ? fmt(s.value) : s.value}</b>
              <span>{s.label}</span>
            </div>
          ))}
        </div>
      )}
    </header>
  );
}

/** Titre de carte : majuscules espacées, icône dorée devant, compteur rond facultatif. */
export function CardTitle({ icon, children, count }: { icon?: NavIconName; children: ReactNode; count?: ReactNode }) {
  return (
    <h2 className="pg-h">
      {icon && <NavIcon name={icon} size={16} />}
      {children}
      {count !== undefined && <span className="pg-count">{count}</span>}
    </h2>
  );
}
