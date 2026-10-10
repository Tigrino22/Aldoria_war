import {
  CANCEL_GRACE_SECONDS,
  CANCEL_REFUND_SHARE,
  RESOURCES,
  RESOURCE_NAMES,
  UNITS,
  UNIT_KEYS,
  type Resources,
  type UnitCounts,
  type UnitKey,
  type VillageState,
} from '@aldoria/shared';
import { RESOURCE_IMG, UNIT_IMG } from './assets';
import { duration, fmt } from './format';
import { useNow } from './game';

/** Ressources du village à l'instant `now`, calculées comme sur le serveur. */
export function liveResources(v: VillageState, now: number): Resources {
  const hours = Math.max(0, (now - Date.parse(v.syncedAt)) / 3_600_000);
  const out = { ...v.resources };
  for (const r of RESOURCES) {
    const next = v.resources[r] + v.rates[r] * hours;
    out[r] = v.rates[r] >= 0 ? (v.resources[r] >= v.capacity ? v.resources[r] : Math.min(v.capacity, next)) : Math.max(0, next);
  }
  return out;
}

export function ResIcon({ r, size = 20 }: { r: keyof Resources; size?: number }) {
  return <img src={RESOURCE_IMG[r]} alt={RESOURCE_NAMES[r]} title={RESOURCE_NAMES[r]} width={size} height={size} />;
}

export function UnitIcon({ unit, size = 32 }: { unit: UnitKey; size?: number }) {
  return <img src={UNIT_IMG[unit]} alt={UNITS[unit].name} title={UNITS[unit].name} width={size} height={size} />;
}

export function Cost({ cost, have }: { cost: Resources; have?: Resources }) {
  return (
    <span className="cost">
      {RESOURCES.filter((r) => cost[r] > 0).map((r) => (
        <span key={r} className={have && have[r] < cost[r] ? 'short' : ''}>
          <ResIcon r={r} size={16} />
          {fmt(cost[r])}
        </span>
      ))}
    </span>
  );
}

export function Countdown({ to }: { to: string | number }) {
  const now = useNow();
  const left = (typeof to === 'number' ? to : Date.parse(to)) - now;
  return <span className="countdown">{left > 0 ? duration(left / 1000) : 'terminé'}</span>;
}

export function UnitList({ units, empty = 'Aucune troupe' }: { units: UnitCounts | null; empty?: string }) {
  if (!units) return <span className="muted">Inconnu</span>;
  const present = UNIT_KEYS.filter((k) => units[k] > 0);
  if (!present.length) return <span className="muted">{empty}</span>;
  return (
    <span className="unit-list">
      {present.map((k) => (
        <span key={k}>
          <UnitIcon unit={k} size={22} />
          {fmt(units[k])}
        </span>
      ))}
    </span>
  );
}

export function Panel({ title, children, actions }: { title: string; children: React.ReactNode; actions?: React.ReactNode }) {
  return (
    <section className="panel">
      <header className="panel-head">
        <h2>{title}</h2>
        {actions}
      </header>
      {children}
    </section>
  );
}

/** Bouton d'annulation : le texte dit si le remboursement est total ou partiel. */
export function CancelButton({ since, onCancel, movement = false }: { since: string; onCancel: () => void; movement?: boolean }) {
  const now = useNow();
  const elapsed = (now - Date.parse(since)) / 1000;
  const full = elapsed <= CANCEL_GRACE_SECONDS;
  if (movement && !full) return null;
  const hint = movement
    ? 'Les troupes font demi-tour'
    : full
      ? 'Remboursement total'
      : `Remboursement de ${Math.round(CANCEL_REFUND_SHARE * 100)} %`;
  return (
    <button className="btn small ghost" title={hint} onClick={onCancel}>
      Annuler{!movement && ` (${full ? 'remb. total' : `${Math.round(CANCEL_REFUND_SHARE * 100)} %`})`}
    </button>
  );
}
