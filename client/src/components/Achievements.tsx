import { useEffect, useState } from 'react';
import { TIER_LABELS, type AchievementsPage, type AchievementView } from '@aldoria/shared';
import { api } from '../api';
import { clockTime, fmt } from '../format';
import { useGame } from '../game';
import { Medal } from './Badge';
import { CardTitle, PageBanner } from './PageBanner';
import './achievements.css';

/** Page des succès (`#/succes`) : progression vers le prochain palier, médailles gagnées et coffres prévus. */
export default function Achievements() {
  const { run, me } = useGame();
  const [page, setPage] = useState<AchievementsPage | null>(null);

  useEffect(() => {
    run(async () => setPage(await api<AchievementsPage>('/api/achievements')));
  }, [run]);

  if (!page) return <p className="muted">Chargement des succès…</p>;
  const earned = page.achievements.reduce((n, a) => n + a.tiers.filter((t) => t.earnedAt).length, 0);
  const total = page.achievements.length * 3;
  const gold = page.achievements.filter((a) => a.tiers[2].earnedAt).length;

  return (
    <div className="pg ach">
      <PageBanner
        icon="medaille"
        kicker="Succès"
        title="Hauts faits du royaume"
        lead={
          <>
            Chaque palier atteint ajoute un badge à <a href={`#/joueur/${encodeURIComponent(me.player.username)}`}>votre profil</a> et un coffre à votre{' '}
            <a href="#/inventaire">inventaire</a>.
          </>
        }
        chips={!page.enabled && <span className="pg-pill war">Succès suspendus par l’administration</span>}
        stats={[
          { value: `${earned} / ${total}`, label: 'Paliers obtenus', tone: 'gold' },
          { value: gold, label: 'Médailles d’or' },
        ]}
      />
      <section className="pg-card">
        <CardTitle icon="medaille" count={page.achievements.length}>
          Succès
        </CardTitle>
        <ul className="ach-list">
          {page.achievements.map((a) => (
            <AchievementRow key={a.key} a={a} />
          ))}
        </ul>
      </section>
    </div>
  );
}

function AchievementRow({ a }: { a: AchievementView }) {
  const next = a.tiers.find((t) => !t.earnedAt);
  const prev = [...a.tiers].reverse().find((t) => t.earnedAt);
  const from = prev?.threshold ?? 0;
  const progress = next ? Math.min(1, Math.max(0, (a.value - from) / Math.max(1, next.threshold - from))) : 1;
  return (
    <li className="ach-row">
      <Medal tier={prev?.tier ?? 'bronze'} size={48} muted={!prev} />
      <div className="ach-main">
        <div className="ach-head">
          <b>{a.title}</b>
          <span className="ach-value-inline">{fmt(a.value)}</span>
          <span className="muted small">{next ? next.goal : 'Tous les paliers obtenus'}</span>
        </div>
        <div className="ach-bar" role="progressbar" aria-valuemin={0} aria-valuemax={next?.threshold ?? a.value} aria-valuenow={a.value}>
          <span style={{ width: `${progress * 100}%` }} />
        </div>
        <div className="ach-tiers">
          {a.tiers.map((t) => (
            <span key={t.tier} className={`ach-tier ${t.tier} ${t.earnedAt ? 'done' : ''}`} title={t.earnedAt ? `Obtenu le ${clockTime(t.earnedAt)}` : t.goal}>
              <b>{TIER_LABELS[t.tier]}</b> {fmt(t.threshold)}
              {t.reward > 0 && <span className="muted"> · coffre {t.reward} %</span>}
              {t.earnedAt && ' ✓'}
            </span>
          ))}
        </div>
      </div>
      <span className="ach-value">{fmt(a.value)}</span>
    </li>
  );
}
