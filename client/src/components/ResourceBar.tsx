import { RESOURCES, RESOURCE_NAMES } from '@fiefs/shared';
import { fmt } from '../format';
import { useGame, useNow } from '../game';
import { liveResources, ResIcon } from '../ui';

export default function ResourceBar() {
  const { village } = useGame();
  const now = useNow();
  if (!village) return <div className="resbar" />;
  const res = liveResources(village, now);
  return (
    <div className="resbar">
      {RESOURCES.map((r) => (
        <div key={r} className={`res ${res[r] >= village.capacity ? 'full' : ''}`} title={`${RESOURCE_NAMES[r]} : ${fmt(village.rates[r])} par heure`}>
          <ResIcon r={r} size={22} />
          <span className="amount">{fmt(res[r])}</span>
          <span className={`rate ${village.rates[r] < 0 ? 'neg' : ''}`}>
            {village.rates[r] >= 0 ? '+' : ''}
            {fmt(village.rates[r])}/h
          </span>
        </div>
      ))}
      <div className="res cap" title="Capacité de l'entrepôt">
        <span className="muted">Entrepôt</span>
        <span className="amount">{fmt(village.capacity)}</span>
      </div>
    </div>
  );
}
