import { TIER_LABELS, type AchievementTier } from '@aldoria/shared';
import { NavIcon } from './NavIcon';
import './achievements.css';

/** Médaille d'un palier de succès (bronze, argent, or), avec ou sans son nom. */
export function Medal({ tier, size = 40, muted = false }: { tier: AchievementTier; size?: number; muted?: boolean }) {
  return (
    <span className={`ach-medal ${tier} ${muted ? 'muted' : ''}`} style={{ width: size, height: size }} aria-label={TIER_LABELS[tier]}>
      <NavIcon name="medaille" size={Math.round(size * 0.6)} />
    </span>
  );
}

/** Badge du profil : la médaille du plus haut palier et le nom du succès. */
export function Badge({ title, tier }: { title: string; tier: AchievementTier }) {
  return (
    <span className={`ach-badge ${tier}`} title={`${title} · ${TIER_LABELS[tier]}`}>
      <Medal tier={tier} size={30} />
      <span>
        <b>{title}</b>
        <span className="muted small">{TIER_LABELS[tier]}</span>
      </span>
    </span>
  );
}
