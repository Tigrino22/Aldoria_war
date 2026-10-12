import { useState } from 'react';
import { UNITS, UNIT_KEYS, type CommandView, type UnitKey, type VillageState } from '@aldoria/shared';
import { api } from '../api';
import { clockTime, fmt } from '../format';
import { useGame } from '../game';
import { CancelButton, Cost, Countdown, Panel, PlayerLink, UnitIcon, UnitList } from '../ui';
import { progress } from './TribeTools';
import './disband.css';
import './tribe-attacks.css';
import './troops.css';

const TYPE_LABEL = { attack: 'Attaque', support: 'Renfort', return: 'Retour', trade: 'Marchands', trade_return: 'Retour des marchands' } as const;

function Movement({ c, direction, onCancel }: { c: CommandView; direction: 'in' | 'out'; onCancel?: () => void }) {
  const other = direction === 'in' ? c.origin : c.target;
  const hostile = direction === 'in' && c.type === 'attack';
  const kind = hostile ? 'attack' : c.type === 'trade' || c.type === 'trade_return' ? 'trade' : c.type;
  return (
    <li className={`ta-card kind-${kind}`}>
      <div className="ta-main">
        <span className="ta-kind">{hostile ? 'Attaque ennemie' : TYPE_LABEL[c.type]}</span>
        <span className="ta-route">
          <span className="muted small">{direction === 'in' ? 'de' : 'vers'}</span>{' '}
          <a href={`#/carte/${other.x},${other.y}`}>{other.name} ({other.x}|{other.y})</a>
          {other.ownerName && <span className="muted small"> · {other.ownerTag && `[${other.ownerTag}] `}<PlayerLink name={other.ownerName} /></span>}
        </span>
        {c.units && <UnitList units={c.units} empty="" />}
      </div>
      <div className="mv-time">
        <Countdown to={c.arriveAt} />
        <span className="muted small">{clockTime(c.arriveAt)}</span>
        {onCancel && (c.type === 'attack' || c.type === 'support') && <CancelButton movement since={c.sentAt} onCancel={onCancel} />}
      </div>
      <div className="ta-bar" aria-hidden="true">
        <div className="ta-fill" style={{ width: `${progress(c.sentAt, c.arriveAt)}%` }} />
      </div>
    </li>
  );
}

function Support({ g, label, onClick }: { g: VillageState['supportHere'][number]; label: string; onClick: () => void }) {
  return (
    <li className="ta-card kind-support">
      <div className="ta-main">
        <span className="ta-kind">{g.villageName} ({g.x}|{g.y})</span>
        {g.ownerName && <span className="muted small"><PlayerLink name={g.ownerName} /></span>}
        <UnitList units={g.units} />
      </div>
      <button className="btn small" onClick={onClick}>{label}</button>
    </li>
  );
}

/** Fenêtre de confirmation : dissoudre une partie des unités d'un type, sans remboursement. */
function DisbandDialog({ v, unit, onClose }: { v: VillageState; unit: UnitKey; onClose: () => void }) {
  const { run, setVillage } = useGame();
  const have = v.troopsHome[unit];
  const [qty, setQty] = useState(Math.min(have, Math.max(1, Math.floor(have / 4))));
  const n = Math.min(have, Math.max(0, Math.floor(qty) || 0));
  const def = UNITS[unit];
  const lost = { wood: def.cost.wood * n, clay: def.cost.clay * n, iron: def.cost.iron * n, wheat: def.cost.wheat * n };
  const confirm = () =>
    run(async () => {
      setVillage(await api<VillageState>(`/api/villages/${v.id}/disband`, { body: { unit, count: n } }));
      onClose();
    });
  return (
    <div className="modal-backdrop" onClick={onClose}>
      <div className="disband" role="dialog" aria-modal="true" aria-label={`Dissoudre des ${def.name.toLowerCase()}s`} onClick={(e) => e.stopPropagation()}>
        <div className="row">
          <UnitIcon unit={unit} size={56} />
          <div>
            <h2>Dissoudre des {def.name.toLowerCase()}s</h2>
            <p className="muted small">{fmt(have)} au village</p>
          </div>
        </div>
        <label htmlFor="disband-qty">Combien d'unités dissoudre ?</label>
        <div className="row">
          <input type="range" min={1} max={have} value={n || 1} aria-label="Quantité" onChange={(e) => setQty(Number(e.target.value))} style={{ flex: 1 }} />
          <input id="disband-qty" type="number" min={1} max={have} value={qty} onChange={(e) => setQty(Number(e.target.value))} />
          <button className="btn small" onClick={() => setQty(have)}>
            Tout
          </button>
        </div>
        <div className="disband-sum">
          <div>
            <span className="muted small">Restera au village</span>
            <b>{fmt(have - n)}</b>
          </div>
          <div>
            <span className="muted small">Population libérée</span>
            <b className="ok">+{fmt(n * def.population)}</b>
          </div>
          <div>
            <span className="muted small">Ressources perdues</span>
            <Cost cost={lost} />
          </div>
        </div>
        <p className="warn small">⚠ Action définitive : les unités dissoutes ne sont pas remboursées.</p>
        <div className="row between">
          <button className="btn ghost" onClick={onClose}>
            Annuler
          </button>
          <button className="btn danger" disabled={n < 1} onClick={confirm}>
            Dissoudre {fmt(n)} unité{n > 1 ? 's' : ''}
          </button>
        </div>
      </div>
    </div>
  );
}

export default function RallyPoint() {
  const { village: v, run, refreshVillage } = useGame();
  const [disband, setDisband] = useState<UnitKey | null>(null);
  if (!v) return <p className="muted">Chargement…</p>;

  const cancelMove = (id: number) =>
    run(async () => {
      await api(`/api/commands/${id}`, { method: 'DELETE' });
      await refreshVillage();
    });

  const recall = (stationedId: number, homeId: number) =>
    run(async () => {
      await api('/api/troops/recall', { body: { stationedId, homeId } });
      await refreshVillage();
    });

  return (
    <div className="stack">
      <Panel title="Troupes au village">
        {UNIT_KEYS.some((k) => v.troopsHome[k] > 0) ? (
          <>
            <p className="troop-summary">
              <b>{fmt(UNIT_KEYS.reduce((t, k) => t + v.troopsHome[k], 0))}</b> unités · <b>{fmt(UNIT_KEYS.reduce((t, k) => t + v.troopsHome[k] * UNITS[k].population, 0))}</b> places de population
            </p>
            <div className="troop-grid">
              {UNIT_KEYS.filter((k) => v.troopsHome[k] > 0).map((k) => (
                <article key={k} className="troop-card">
                  <UnitIcon unit={k} size={64} />
                  <h3>{UNITS[k].name}</h3>
                  <strong className="troop-count">{fmt(v.troopsHome[k])}</strong>
                  <span className="muted small">{fmt(v.troopsHome[k] * UNITS[k].population)} pop.</span>
                  <button className="btn small danger-outline" onClick={() => setDisband(k)}>
                    Dissoudre…
                  </button>
                </article>
              ))}
            </div>
            <p className="muted small">Dissoudre des unités libère leurs places de population. Aucune ressource n'est remboursée.</p>
          </>
        ) : (
          <p className="muted">Aucune troupe au village. Recrutez à la caserne.</p>
        )}
      </Panel>

      <Panel title="Mouvements entrants">
        {v.incoming.length ? (
          <ul className="ta-list">{v.incoming.map((c) => <Movement key={c.id} c={c} direction="in" />)}</ul>
        ) : (
          <p className="muted">Rien en approche.</p>
        )}
      </Panel>

      <Panel title="Mouvements sortants">
        {v.outgoing.length ? (
          <ul className="ta-list">{v.outgoing.map((c) => <Movement key={c.id} c={c} direction="out" onCancel={() => cancelMove(c.id)} />)}</ul>
        ) : (
          <p className="muted">Aucune troupe en route.</p>
        )}
      </Panel>

      <Panel title="Renforts reçus">
        {v.supportHere.length ? (
          <ul className="ta-list">{v.supportHere.map((g) => <Support key={g.villageId} g={g} label="Renvoyer" onClick={() => recall(v.id, g.villageId)} />)}</ul>
        ) : (
          <p className="muted">Aucun allié ne stationne ici.</p>
        )}
      </Panel>

      <Panel title="Vos renforts chez d'autres">
        {v.supportAway.length ? (
          <ul className="ta-list">{v.supportAway.map((g) => <Support key={g.villageId} g={g} label="Rappeler" onClick={() => recall(g.villageId, v.id)} />)}</ul>
        ) : (
          <p className="muted">Toutes vos troupes sont à la maison.</p>
        )}
      </Panel>
      {disband && v.troopsHome[disband] > 0 && <DisbandDialog v={v} unit={disband} onClose={() => setDisband(null)} />}
    </div>
  );
}
