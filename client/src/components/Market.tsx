import { useEffect, useMemo, useState } from 'react';
import {
  MERCHANT_CAPACITY,
  RESOURCES,
  RESOURCE_NAMES,
  distance,
  merchantTravelTime,
  merchantsNeeded,
  type MapVillage,
  type Resource,
  type Resources,
} from '@aldoria/shared';
import { api } from '../api';
import { clockTime, duration, fmt } from '../format';
import { useGame, useNow, useRoute } from '../game';
import { Countdown, liveResources, Panel, ResIcon } from '../ui';

/** Marché : envoyer des ressources à un autre village de joueur et suivre les convois. */
export default function Market({ focus }: { focus?: string }) {
  const { village: v, me, world, setVillage, run, toast } = useGame();
  const [, go] = useRoute();
  const now = useNow();
  const [villages, setVillages] = useState<MapVillage[]>([]);
  const [coords, setCoords] = useState(focus?.replace(',', '|') ?? '');
  const [amounts, setAmounts] = useState<Partial<Record<Resource, string>>>({});

  useEffect(() => {
    run(async () => setVillages(await api<MapVillage[]>('/api/map')));
  }, [run]);

  const target = useMemo(() => {
    const m = coords.trim().match(/^(\d+)\s*[|,; ]\s*(\d+)$/);
    if (!m) return null;
    return villages.find((x) => x.x === Number(m[1]) && x.y === Number(m[2])) ?? null;
  }, [coords, villages]);

  if (!v) return <p className="muted">Chargement…</p>;
  if (v.buildings.market === 0) {
    return (
      <Panel title="Marché">
        <p className="muted">Construisez d'abord un marché dans votre village (hôtel de ville niveau 3 et entrepôt niveau 2).</p>
        <button className="btn" onClick={() => go('village')}>Retour au village</button>
      </Panel>
    );
  }

  const res = liveResources(v, now);
  const cargo = Object.fromEntries(RESOURCES.map((r) => [r, Math.max(0, Math.floor(Number(amounts[r] || 0)))])) as Resources;
  const needed = merchantsNeeded(cargo);
  const enough = RESOURCES.every((r) => cargo[r] <= Math.floor(res[r]));
  const own = villages.filter((x) => x.ownerId === me.player.id && x.id !== v.id);
  const targetError = !coords.trim()
    ? null
    : !target
      ? 'Aucun village à ces coordonnées'
      : target.id === v.id
        ? 'C’est le village actuel'
        : !target.ownerId
          ? 'Les marchands ne commercent pas avec les barbares'
          : null;
  const valid = target && !targetError && needed > 0 && needed <= v.market.available && enough;
  const travel = target ? merchantTravelTime(v, target, world.speed) : 0;

  const send = () =>
    run(async () => {
      setVillage(await api(`/api/villages/${v.id}/trade`, { body: { targetId: target!.id, resources: cargo } }));
      toast(`Vos marchands partent vers ${target!.name}`);
      setAmounts({});
    });

  const convoys = [
    ...v.outgoing.filter((c) => c.type === 'trade').map((c) => ({ c, dir: 'out' as const })),
    ...v.incoming.filter((c) => c.type === 'trade' || c.type === 'trade_return').map((c) => ({ c, dir: 'in' as const })),
  ].sort((a, b) => Date.parse(a.c.arriveAt) - Date.parse(b.c.arriveAt));

  return (
    <div className="stack">
      <Panel title={`Marché niveau ${v.buildings.market}`}>
        <p>
          Marchands disponibles : <b>{v.market.available}</b> / {v.market.merchants}{' '}
          <span className="muted small">· chacun porte {fmt(MERCHANT_CAPACITY)} ressources</span>
        </p>
        <div className="market-form">
          <label htmlFor="trade-target">Village de destination (x|y)</label>
          <div className="row">
            <input id="trade-target" placeholder="ex. 52|47" value={coords} onChange={(e) => setCoords(e.target.value)} inputMode="numeric" />
            {own.length > 0 && (
              <select aria-label="Mes villages" value="" onChange={(e) => setCoords(e.target.value)}>
                <option value="">Mes villages…</option>
                {own.map((x) => (
                  <option key={x.id} value={`${x.x}|${x.y}`}>
                    {x.name} ({x.x}|{x.y})
                  </option>
                ))}
              </select>
            )}
          </div>
          {target && !targetError && (
            <p className="small">
              {target.name} · {target.ownerName} · {distance(v, target).toFixed(1)} cases · trajet <b>{duration(travel)}</b>, arrivée{' '}
              {clockTime(new Date(now + travel * 1000))}
            </p>
          )}
          {targetError && <p className="warn small">{targetError}</p>}
          <div className="trade-grid">
            {RESOURCES.map((r) => (
              <label key={r} htmlFor={`trade-${r}`}>
                <ResIcon r={r} size={26} />
                <input
                  id={`trade-${r}`}
                  type="number"
                  min={0}
                  inputMode="numeric"
                  placeholder="0"
                  value={amounts[r] ?? ''}
                  onChange={(e) => setAmounts((a) => ({ ...a, [r]: e.target.value }))}
                />
                <button type="button" className="link small" onClick={() => setAmounts((a) => ({ ...a, [r]: String(Math.floor(res[r])) }))}>
                  ({fmt(res[r])})
                </button>
                <span className="sr-only">{RESOURCE_NAMES[r]}</span>
              </label>
            ))}
          </div>
          {needed > 0 && (
            <p className={`small ${needed > v.market.available ? 'warn' : ''}`}>
              {needed} marchand{needed > 1 ? 's' : ''} nécessaire{needed > 1 ? 's' : ''}
            </p>
          )}
          {!enough && <p className="warn small">Vous n'avez pas assez de ressources.</p>}
          <div className="row">
            <button className="btn primary" disabled={!valid} onClick={send}>
              Envoyer les marchands
            </button>
          </div>
        </div>
      </Panel>

      <Panel title="Convois en cours">
        {convoys.length === 0 ? (
          <p className="muted">Aucun convoi en route.</p>
        ) : (
          <ul className="movements">
            {convoys.map(({ c, dir }) => {
              const other = dir === 'out' ? c.target : c.origin;
              const label = c.type === 'trade_return' ? 'Retour' : dir === 'out' ? 'Livraison' : 'Arrivage';
              return (
                <li key={c.id} className={`movement type-${c.type}`}>
                  <span className="mv-type">{label}</span>
                  <span>
                    {dir === 'out' ? 'vers' : 'de'} {other.name} ({other.x}|{other.y})
                    {c.merchants > 0 && <span className="muted"> · {c.merchants} marchand{c.merchants > 1 ? 's' : ''}</span>}
                  </span>
                  {c.loot && c.type === 'trade' && (
                    <span className="cost">
                      {RESOURCES.filter((r) => c.loot![r] > 0).map((r) => (
                        <span key={r}>
                          <ResIcon r={r} size={16} />
                          {fmt(c.loot![r])}
                        </span>
                      ))}
                    </span>
                  )}
                  <span className="mv-time">
                    <Countdown to={c.arriveAt} />
                    <span className="muted small">{clockTime(c.arriveAt)}</span>
                  </span>
                </li>
              );
            })}
          </ul>
        )}
      </Panel>
    </div>
  );
}
