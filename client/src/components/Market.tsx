import { useCallback, useEffect, useMemo, useState } from 'react';
import {
  MERCHANT_CAPACITY,
  RESOURCES,
  RESOURCE_NAMES,
  distance,
  merchantTravelTime,
  merchantsNeeded,
  type MapVillage,
  type MarketOfferView,
  type Resource,
  type Resources,
  type VillageState,
} from '@aldoria/shared';
import { api } from '../api';
import { clockTime, duration, fmt } from '../format';
import { useGame, useNow, useRoute } from '../game';
import { Countdown, liveResources, Panel, ResIcon } from '../ui';
import './offers.css';

/** Marché : envoyer des ressources à un autre village de joueur et suivre les convois. */
export default function Market({ focus }: { focus?: string }) {
  const { village: v, me, world, setVillage, run, toast, refreshVillage } = useGame();
  const [, go] = useRoute();
  const now = useNow();
  const [villages, setVillages] = useState<MapVillage[]>([]);
  const [coords, setCoords] = useState(focus && focus !== 'offres' ? focus.replace(',', '|') : '');
  const [amounts, setAmounts] = useState<Partial<Record<Resource, string>>>({});
  const tab: 'send' | 'offers' = focus === 'offres' ? 'offers' : 'send';
  const setTab = (t: 'send' | 'offers') => go(t === 'offers' ? 'marche/offres' : 'marche');
  const [offers, setOffers] = useState<{ offers: MarketOfferView[]; mine: MarketOfferView[] } | null>(null);
  const [filter, setFilter] = useState<Resource | null>(null);
  const [filterPay, setFilterPay] = useState<Resource | null>(null);
  const [form, setForm] = useState<{ give: Resource; giveAmount: string; want: Resource; wantAmount: string }>({ give: 'wood', giveAmount: '', want: 'clay', wantAmount: '' });
  const villageId = v?.id;
  const hasMarket = (v?.buildings.market ?? 0) > 0;
  const loadOffers = useCallback(() => run(async () => setOffers(await api(`/api/villages/${villageId}/market/offers`))), [run, villageId]);
  useEffect(() => {
    if (tab === 'offers' && villageId) loadOffers();
  }, [tab, villageId, loadOffers]);

  useEffect(() => {
    run(async () => setVillages(await api<MapVillage[]>('/api/map')));
  }, [run]);

  const target = useMemo(() => {
    const m = coords.trim().match(/^(\d+)\s*[|,; ]\s*(\d+)$/);
    if (!m) return null;
    return villages.find((x) => x.x === Number(m[1]) && x.y === Number(m[2])) ?? null;
  }, [coords, villages]);

  if (!v) return <p className="muted">Chargement…</p>;
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

  const tabs = (
    <div className="tabs" role="tablist">
      <button role="tab" aria-selected={tab === 'send'} onClick={() => setTab('send')}>
        Envoyer
      </button>
      <button role="tab" aria-selected={tab === 'offers'} onClick={() => setTab('offers')}>
        Offres
      </button>
    </div>
  );

  const noMarket = v.buildings.market === 0;
  if (noMarket && tab === 'send') {
    return (
      <div className="stack">
        {tabs}
        <Panel title="Marché">
          <p className="muted">Construisez d'abord un marché dans votre village (hôtel de ville niveau 3 et entrepôt niveau 2). Vous pouvez déjà consulter les offres en cours dans l'onglet « Offres ».</p>
          <button className="btn" onClick={() => go('village')}>Retour au village</button>
        </Panel>
      </div>
    );
  }

  if (tab === 'offers') {
    const shown = (offers?.offers ?? []).filter((o) => (!filter || o.give.resource === filter) && (!filterPay || o.want.resource === filterPay));
    const giveAmount = Math.floor(Number(form.giveAmount) || 0);
    const wantAmount = Math.floor(Number(form.wantAmount) || 0);
    const rate = giveAmount > 0 ? wantAmount / giveAmount : 0;
    const formError =
      form.give === form.want
        ? 'Choisissez deux ressources différentes'
        : giveAmount < 50 || wantAmount < 50
          ? 'Au moins 50 ressources de chaque côté'
          : rate < 0.5 || rate > 2
            ? 'Taux déséquilibré : demandez entre la moitié et le double de ce que vous donnez'
            : giveAmount > Math.floor(res[form.give])
              ? "Vous n'avez pas assez de ressources"
              : null;
    const publish = () =>
      run(async () => {
        setVillage(await api<VillageState>(`/api/villages/${v.id}/market/offers`, { body: { give: form.give, giveAmount, want: form.want, wantAmount } }));
        toast('Offre publiée');
        setForm((f) => ({ ...f, giveAmount: '', wantAmount: '' }));
        await loadOffers();
      });
    const accept = (o: MarketOfferView) =>
      run(async () => {
        setVillage(await api<VillageState>(`/api/market/offers/${o.id}/accept`, { body: { villageId: v.id } }));
        toast(`Échange accepté avec ${o.ownerName}`);
        await loadOffers();
      });
    const cancel = (o: MarketOfferView) =>
      run(async () => {
        await api(`/api/market/offers/${o.id}`, { method: 'DELETE' });
        toast('Offre annulée, ressources rendues');
        await refreshVillage();
        await loadOffers();
      });
    // Taux affiché sur la même ligne : combien l'acheteur doit rendre pour 1 unité reçue.
    const ratio = (o: MarketOfferView) => (o.want.amount / o.give.amount).toLocaleString('fr-FR', { maximumFractionDigits: 2 });
    const Deal = ({ o }: { o: MarketOfferView }) => (
      <span className="offer-deal">
        <span className="inline-res"><ResIcon r={o.give.resource} size={22} /><b>{fmt(o.give.amount)}</b></span>
        <span className="arrow" aria-label="contre">⇄</span>
        <span className="inline-res"><ResIcon r={o.want.resource} size={22} /><b>{fmt(o.want.amount)}</b></span>
        <span className="chip offer-rate" title="Ressource demandée pour 1 ressource reçue">1 : {ratio(o)}</span>
      </span>
    );
    const left = (iso: string) => duration(Math.max(0, (Date.parse(iso) - now) / 1000));
    return (
      <div className="stack">
        {tabs}
        <Panel title="Offres près de chez vous" actions={<span className="muted small">Marchands : {v.market.available} / {v.market.merchants}</span>}>
          <p className="muted small">Chaque offre se lit « il donne ⇄ il veut ». En acceptant, vous payez ce qu'il veut et vos marchands partent à sa rencontre.</p>
          <div className="row offer-filter">
            <span className="muted small">Je veux :</span>
            {RESOURCES.map((r) => (
              <button key={r} className={`chip chip-btn ${filter === r ? 'chip-ok' : ''}`} aria-pressed={filter === r} onClick={() => setFilter(filter === r ? null : r)}>
                <ResIcon r={r} size={16} />
                {RESOURCE_NAMES[r]}
              </button>
            ))}
          </div>
          <div className="row offer-filter">
            <span className="muted small">J'offre :</span>
            {RESOURCES.map((r) => (
              <button key={r} className={`chip chip-btn ${filterPay === r ? 'chip-ok' : ''}`} aria-pressed={filterPay === r} onClick={() => setFilterPay(filterPay === r ? null : r)}>
                <ResIcon r={r} size={16} />
                {RESOURCE_NAMES[r]}
              </button>
            ))}
          </div>
          {!offers ? (
            <p className="muted">Chargement…</p>
          ) : shown.length === 0 ? (
            <p className="muted">Aucune offre pour le moment.</p>
          ) : (
            <ul className="offers">
              {shown.map((o) => {
                const can = Math.floor(res[o.want.resource]) >= o.want.amount;
                return (
                  <li key={o.id}>
                    <span className="offer-who">
                      <b>
                        {o.ownerName}
                        {o.isNpc && <span className="chip">PNJ</span>}
                      </b>
                      <span className="muted small">{o.villageName} · {o.distance} cases · expire dans {left(o.expiresAt)}</span>
                    </span>
                    <Deal o={o} />
                    <button className="btn primary small" disabled={!can || noMarket} title={noMarket ? "Construisez d'abord un marché" : can ? undefined : "Vous n'avez pas assez de ressources"} onClick={() => accept(o)}>
                      Accepter
                    </button>
                  </li>
                );
              })}
            </ul>
          )}
        </Panel>
        <Panel title="Créer une offre">
          <div className="offer-form">
            <label>
              Je donne
              <span className="row">
                <select value={form.give} onChange={(e) => setForm({ ...form, give: e.target.value as Resource })}>
                  {RESOURCES.map((r) => <option key={r} value={r}>{RESOURCE_NAMES[r]}</option>)}
                </select>
                <input type="number" min={0} inputMode="numeric" value={form.giveAmount} onChange={(e) => setForm({ ...form, giveAmount: e.target.value })} />
              </span>
            </label>
            <span className="arrow">⇄</span>
            <label>
              Je veux
              <span className="row">
                <select value={form.want} onChange={(e) => setForm({ ...form, want: e.target.value as Resource })}>
                  {RESOURCES.map((r) => <option key={r} value={r}>{RESOURCE_NAMES[r]}</option>)}
                </select>
                <input type="number" min={0} inputMode="numeric" value={form.wantAmount} onChange={(e) => setForm({ ...form, wantAmount: e.target.value })} />
              </span>
            </label>
            <button className="btn primary" disabled={!!formError || noMarket} title={noMarket ? "Construisez d'abord un marché" : undefined} onClick={publish}>
              Publier l'offre
            </button>
          </div>
          {formError && (giveAmount > 0 || wantAmount > 0) && <p className="warn small">{formError}</p>}
          <p className="muted small">Les ressources offertes sont mises de côté jusqu'à l'acceptation, l'annulation ou l'expiration (24 h de jeu). Taux accepté : entre 0,5 et 2.</p>
        </Panel>
        <Panel title="Mes offres">
          {!offers || offers.mine.length === 0 ? (
            <p className="muted">Aucune offre publiée.</p>
          ) : (
            <ul className="offers">
              {offers.mine.map((o) => (
                <li key={o.id}>
                  <span className="offer-who">
                    <b>Publiée par vous</b>
                    <span className="muted small">expire dans {left(o.expiresAt)}</span>
                  </span>
                  <Deal o={o} />
                  <button className="btn ghost small" onClick={() => cancel(o)}>
                    Annuler
                  </button>
                </li>
              ))}
            </ul>
          )}
        </Panel>
      </div>
    );
  }

  return (
    <div className="stack">
      {tabs}
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
