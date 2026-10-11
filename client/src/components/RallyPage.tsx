import { useGame } from '../game';
import { OrderForm, PlannedOrders } from './RallyOrders';

/** Point de ralliement : page à part pour organiser les attaques et les soutiens (cible, heure d'arrivée, train de nobles). */
export default function RallyPage({ focus }: { focus?: string }) {
  const { village: v } = useGame();
  if (!v) return <p className="muted">Chargement…</p>;
  return (
    <div className="stack">
      <OrderForm v={v} focus={focus} />
      <PlannedOrders />
    </div>
  );
}
