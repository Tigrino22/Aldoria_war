import { useGame } from '../game';
import { PageBanner } from './PageBanner';
import { OrderForm, PlannedOrders } from './RallyOrders';

/** Point de ralliement : page à part pour organiser les attaques et les soutiens (cible, heure d'arrivée, train de nobles). */
export default function RallyPage({ focus }: { focus?: string }) {
  const { village: v } = useGame();
  if (!v) return <p className="muted">Chargement…</p>;
  return (
    <div className="pg rally">
      <PageBanner
        icon="ralliement"
        kicker={`Armée · depuis ${v.name} (${v.x}|${v.y})`}
        title="Point de ralliement"
        lead="Organisez vos attaques et vos soutiens : cible, heure d’arrivée précise et train de nobles."
      />
      <div className="pg-grid rally-grid">
        <OrderForm v={v} focus={focus} />
        <PlannedOrders />
      </div>
    </div>
  );
}
