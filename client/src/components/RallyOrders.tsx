import { useCallback, useEffect, useMemo, useState } from 'react';
import {
  DEFAULT_NOBLE_GAP_SECONDS,
  NOBLE_LOYALTY_MAX,
  NOBLE_LOYALTY_MIN,
  UNITS,
  UNIT_KEYS,
  attackWheatCost,
  distance,
  emptyUnits,
  normalizeUnits,
  orderTotal,
  planOrderParts,
  totalUnits,
  trainCapacity,
  travelTime,
  type MapVillage,
  type NobleTrain,
  type PlannedOrderView,
  type UnitKey,
  type VillageState,
} from '@aldoria/shared';
import { api } from '../api';
import { clockTime, fmt } from '../format';
import { useGame, useNow } from '../game';
import { Countdown, liveResources, Panel, PlayerLink, UnitIcon, UnitList } from '../ui';
import './rally.css';

const pad = (n: number) => String(n).padStart(2, '0');
/** Valeur d'un champ « datetime-local » (heure locale, à la seconde). */
const toLocalInput = (d: Date) => `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}T${pad(d.getHours())}:${pad(d.getMinutes())}:${pad(d.getSeconds())}`;
const timeOf = (d: Date) => d.toLocaleTimeString('fr-FR', { hour: '2-digit', minute: '2-digit', second: '2-digit' });

/** Un ordre du point de ralliement : attaque ou soutien, tout de suite ou à heure d'arrivée précise, avec ou sans train de nobles. */
export function OrderForm({ v, focus }: { v: VillageState; focus?: string }) {
  const { me, world, run, toast, setVillage } = useGame();
  const now = useNow();
  const [villages, setVillages] = useState<MapVillage[]>([]);
  const [coords, setCoords] = useState(focus ? focus.replace(',', '|') : '');
  const [type, setType] = useState<'attack' | 'support'>('attack');
  const [counts, setCounts] = useState<Partial<Record<UnitKey, string>>>({});
  const [timing, setTiming] = useState<'now' | 'at'>('now');
  const [landInput, setLandInput] = useState('');
  const [train, setTrain] = useState(false);
  const [nobles, setNobles] = useState('3');
  const [escort, setEscort] = useState<Partial<Record<UnitKey, string>>>({ swordsman: '2' });
  const [gap, setGap] = useState(String(DEFAULT_NOBLE_GAP_SECONDS));

  useEffect(() => {
    run(async () => setVillages(await api<MapVillage[]>('/api/map')));
  }, [run]);
  useEffect(() => {
    if (focus) setCoords(focus.replace(',', '|'));
  }, [focus]);

  const target = useMemo(() => {
    const m = coords.trim().match(/^(\d+)\s*[|,; ]\s*(\d+)$/);
    return m ? villages.find((t) => t.x === Number(m[1]) && t.y === Number(m[2])) ?? null : null;
  }, [coords, villages]);
  const ownTarget = !!target && target.ownerId === me.player.id;
  const attack = type === 'attack' && !ownTarget;

  const strike = normalizeUnits(Object.fromEntries(UNIT_KEYS.map((k) => [k, k === 'noble' && train ? 0 : Number(counts[k] || 0)])));
  const escortUnits = normalizeUnits(Object.fromEntries(UNIT_KEYS.map((k) => [k, k === 'noble' ? 0 : Number(escort[k] || 0)])));
  const wantedNobles = Math.max(0, Math.floor(Number(nobles) || 0));
  // Pas assez de troupes pour tous les nobles demandés : seuls ceux qui ont leur escorte partent.
  const possibleNobles = trainCapacity(v.troopsHome, strike, wantedNobles, escortUnits);
  const trainSpec: NobleTrain | null =
    train && attack ? { nobles: possibleNobles, escort: escortUnits, gapMs: Math.max(1, Math.min(10, Math.floor(Number(gap) || 1))) * 1000 } : null;
  const total = orderTotal(strike, trainSpec);
  const enough = UNIT_KEYS.every((k) => total[k] <= v.troopsHome[k]);
  const wheat = attack ? attackWheatCost(total) : 0;
  const wheatHave = Math.floor(liveResources(v, now).wheat);
  const travelMs = (u: typeof strike) => travelTime(u, v, target ?? v, world.speed) * 1000;
  const landAt = timing === 'at' && landInput ? new Date(landInput) : null;
  const plan = target && totalUnits(total) > 0 ? planOrderParts(strike, trainSpec, { landAt: timing === 'at' ? landAt : null, now: new Date(now), travelMs }) : null;
  const problem = !coords.trim()
    ? 'Indiquez les coordonnées de la cible.'
    : !target
      ? 'Aucun village à ces coordonnées.'
      : target.id === v.id
        ? 'Choisissez un autre village que celui d’où partent les troupes.'
        : trainSpec && trainSpec.nobles < 1
          ? 'Pas assez de troupes pour envoyer un noble avec son escorte.'
          : totalUnits(total) === 0
          ? 'Sélectionnez des troupes.'
          : !enough
            ? 'Vous n’avez pas assez de troupes dans ce village.'
            : wheat > wheatHave
              ? `Il faut ${fmt(wheat)} blé pour nourrir ces troupes en campagne, vous en avez ${fmt(wheatHave)}.`
            : timing === 'at' && !landAt
              ? 'Indiquez l’heure d’arrivée.'
              : plan?.error ?? null;

  const useEarliest = () => {
    const earliest = planOrderParts(strike, trainSpec, { landAt: null, now: new Date(now), travelMs });
    if (earliest.parts) setLandInput(toLocalInput(new Date(earliest.parts[0].arriveAt.getTime() + 60_000)));
  };

  const send = () =>
    run(async () => {
      if (!target) return;
      const body = {
        type: ownTarget ? 'support' : type,
        targetId: target.id,
        units: strike,
        arriveAt: timing === 'at' && landAt ? landAt.toISOString() : null,
        train: trainSpec ? { nobles: wantedNobles, escort: trainSpec.escort, gapSeconds: trainSpec.gapMs / 1000 } : null,
      };
      setVillage(await api<VillageState>(`/api/villages/${v.id}/orders`, { body }));
      toast(timing === 'at' ? 'Ordre planifié : les troupes partiront à l’heure voulue' : 'Vos troupes sont en route');
      setCounts({});
      window.dispatchEvent(new Event('aldoria:orders'));
    });

  return (
    <Panel title="Nouvel ordre">
      <div className="rally-form">
        <p className="muted small">Depuis {v.name} ({v.x}|{v.y}). Pour envoyer depuis un autre village, changez de village en haut de l’écran.</p>
        <div className="rally-row">
          <label htmlFor="rally-target">Cible</label>
          <input id="rally-target" placeholder="ex. 52|47" value={coords} onChange={(e) => setCoords(e.target.value)} inputMode="numeric" />
          {target && (
            <span className="small">
              {target.name} · {target.ownerName ? <PlayerLink name={target.ownerName} /> : 'village barbare'} · {distance(v, target).toFixed(1)} cases
            </span>
          )}
        </div>
        <div className="rally-row" role="radiogroup" aria-label="Type d’ordre">
          <label className="rally-choice">
            <input type="radio" name="rally-type" checked={type === 'attack'} disabled={ownTarget} onChange={() => setType('attack')} /> Attaque
          </label>
          <label className="rally-choice">
            <input type="radio" name="rally-type" checked={type === 'support' || ownTarget} onChange={() => setType('support')} /> Soutien
          </label>
        </div>

        <div className="send-grid">
          {UNIT_KEYS.map((k) => {
            const off = k === 'noble' && train;
            return (
              <label key={k} className={v.troopsHome[k] === 0 || off ? 'dim' : ''} htmlFor={`rally-${k}`}>
                <UnitIcon unit={k} size={28} />
                <input
                  id={`rally-${k}`}
                  type="number"
                  min={0}
                  max={v.troopsHome[k]}
                  inputMode="numeric"
                  placeholder="0"
                  value={off ? '' : counts[k] ?? ''}
                  disabled={v.troopsHome[k] === 0 || off}
                  onChange={(e) => setCounts((c) => ({ ...c, [k]: e.target.value }))}
                />
                <button type="button" className="link small" disabled={off} onClick={() => setCounts((c) => ({ ...c, [k]: String(v.troopsHome[k]) }))}>
                  ({fmt(v.troopsHome[k])})
                </button>
                <span className="sr-only">{UNITS[k].name}</span>
              </label>
            );
          })}
        </div>

        {attack && v.troopsHome.noble > 0 && (
          <fieldset className="rally-train">
            <legend>
              <label className="rally-choice">
                <input type="checkbox" checked={train} onChange={(e) => setTrain(e.target.checked)} /> Train de nobles
              </label>
            </legend>
            <p className="muted small">
              Chaque attaque ne fait baisser la loyauté qu’une seule fois ({NOBLE_LOYALTY_MIN} à {NOBLE_LOYALTY_MAX}), quel que soit le nombre de nobles qu’elle compte. Le train envoie donc l’assaut, puis un noble
              par attaque, chacun arrivant quelques secondes après le précédent. Choisissez l’escorte de chaque noble : sans elle, un noble seul ne survit pas à la défense de base du village.
            </p>
            {train && (
              <>
                <div className="rally-row">
                  <label htmlFor="train-nobles">Nobles</label>
                  <input id="train-nobles" type="number" min={1} max={v.troopsHome.noble} value={nobles} onChange={(e) => setNobles(e.target.value)} />
                  <label htmlFor="train-gap">Écart (s)</label>
                  <input id="train-gap" type="number" min={1} max={10} value={gap} onChange={(e) => setGap(e.target.value)} />
                </div>
                <p className="small">Escorte de chaque noble :</p>
                <div className="send-grid">
                  {UNIT_KEYS.filter((k) => k !== 'noble').map((k) => (
                    <label key={k} className={v.troopsHome[k] === 0 ? 'dim' : ''} htmlFor={`escort-${k}`}>
                      <UnitIcon unit={k} size={28} />
                      <input
                        id={`escort-${k}`}
                        type="number"
                        min={0}
                        inputMode="numeric"
                        placeholder="0"
                        value={escort[k] ?? ''}
                        disabled={v.troopsHome[k] === 0}
                        onChange={(e) => setEscort((c) => ({ ...c, [k]: e.target.value }))}
                      />
                      <span className="small muted">({fmt(v.troopsHome[k])})</span>
                      <span className="sr-only">{UNITS[k].name}</span>
                    </label>
                  ))}
                </div>
                {possibleNobles < wantedNobles && possibleNobles > 0 && (
                  <p className="warn small">
                    Troupes insuffisantes pour {wantedNobles} nobles : seules {possibleNobles} attaque{possibleNobles > 1 ? 's' : ''} partiront.
                  </p>
                )}
              </>
            )}
          </fieldset>
        )}

        <div className="rally-row" role="radiogroup" aria-label="Moment du départ">
          <label className="rally-choice">
            <input type="radio" name="rally-timing" checked={timing === 'now'} onChange={() => setTiming('now')} /> Partir maintenant
          </label>
          <label className="rally-choice">
            <input type="radio" name="rally-timing" checked={timing === 'at'} onChange={() => setTiming('at')} /> Arriver à une heure précise
          </label>
          {timing === 'at' && (
            <>
              <input type="datetime-local" step={1} aria-label="Heure d’arrivée" value={landInput} onChange={(e) => setLandInput(e.target.value)} />
              <button type="button" className="btn ghost small" disabled={!target || totalUnits(total) === 0} onClick={useEarliest}>
                Au plus tôt
              </button>
            </>
          )}
        </div>

        {plan?.parts && !problem && (
          <ol className="rally-plan">
            {plan.parts.map((p, i) => (
              <li key={i}>
                <UnitList units={p.units} />
                <span className="small">
                  départ {timeOf(p.departAt)} · arrivée <b>{timeOf(p.arriveAt)}</b>
                </span>
              </li>
            ))}
          </ol>
        )}
        {attack && wheat > 0 && !problem && <p className="small">Rations : <b>{fmt(wheat)}</b> blé, payées dès maintenant et rendues si vous annulez l’ordre.</p>}
        {problem && <p className="muted small">{problem}</p>}
        <div className="row">
          <button className={`btn ${attack ? 'danger' : ''}`} disabled={!!problem} onClick={send}>
            {attack ? (train ? 'Lancer le train' : 'Attaquer') : 'Envoyer le soutien'}
            {timing === 'at' ? ' à l’heure dite' : ''}
          </button>
        </div>
      </div>
    </Panel>
  );
}

/** Ordres planifiés : leurs mouvements partent seuls à l'heure prévue ; on peut les annuler tant qu'ils ne sont pas partis. */
export function PlannedOrders() {
  const { run, refreshVillage } = useGame();
  const [orders, setOrders] = useState<PlannedOrderView[] | null>(null);
  const load = useCallback(() => run(async () => setOrders(await api<PlannedOrderView[]>('/api/orders'))), [run]);
  useEffect(() => {
    load();
    const t = setInterval(load, 5000);
    window.addEventListener('aldoria:orders', load);
    return () => {
      clearInterval(t);
      window.removeEventListener('aldoria:orders', load);
    };
  }, [load]);
  const cancel = (groupId: string) =>
    run(async () => {
      await api(`/api/orders/${groupId}`, { method: 'DELETE' });
      await Promise.all([load(), refreshVillage()]);
    });

  return (
    <Panel title="Ordres planifiés">
      {!orders?.length ? (
        <p className="muted">Aucun ordre en attente. Les troupes d’un ordre planifié sont réservées jusqu’au départ.</p>
      ) : (
        <ul className="movements">
          {orders.map((o) => (
            <li key={o.groupId} className={`movement type-${o.type} rally-order`}>
              <span className="mv-type">{o.type === 'attack' ? 'Attaque' : 'Soutien'}</span>
              <span>
                de {o.origin.name} ({o.origin.x}|{o.origin.y}) vers{' '}
                <a href={`#/carte/${o.target.x},${o.target.y}`}>
                  {o.target.name} ({o.target.x}|{o.target.y})
                </a>
                {o.target.ownerName && <span className="muted"> · <PlayerLink name={o.target.ownerName} /></span>}
              </span>
              <ol className="rally-plan">
                {o.parts.map((p) => (
                  <li key={p.id}>
                    <UnitList units={p.units} />
                    <span className="small">
                      départ dans <Countdown to={p.departAt} /> · arrivée <b>{clockTime(p.arriveAt)}</b>
                    </span>
                  </li>
                ))}
              </ol>
              <button className="btn small ghost" onClick={() => cancel(o.groupId)}>
                Annuler
              </button>
            </li>
          ))}
        </ul>
      )}
    </Panel>
  );
}
