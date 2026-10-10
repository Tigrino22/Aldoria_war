import { useState } from 'react';
import { UNITS, UNIT_KEYS, type CommandView, type UnitKey, type VillageState } from '@aldoria/shared';
import { api } from '../api';
import { clockTime, fmt } from '../format';
import { useGame } from '../game';
import { CancelButton, Cost, Countdown, Panel, PlayerLink, UnitIcon, UnitList } from '../ui';
import './disband.css';

const TYPE_LABEL = { attack: 'Attaque', support: 'Renfort', return: 'Retour', trade: 'Marchands', trade_return: 'Retour des marchands' } as const;

function Movement({ c, direction, onCancel }: { c: CommandView; direction: 'in' | 'out'; onCancel?: () => void }) {
  const other = direction === 'in' ? c.origin : c.target;
  const hostile = direction === 'in' && c.type === 'attack';
  return (
    <li className={`movement ${hostile ? 'hostile' : ''} type-${c.type}`}>
      <span className="mv-type">{TYPE_LABEL[c.type]}</span>
      <span>
        {direction === 'in' ? 'de' : 'vers'} <a href={`#/carte/${other.x},${other.y}`}>{other.name} ({other.x}|{other.y})</a>
        {other.ownerName && <span className="muted"> · <PlayerLink name={other.ownerName} /></span>}
      </span>
      <UnitList units={c.units} empty="" />
      <span className="mv-time">
        <Countdown to={c.arriveAt} />
        <span className="muted small">{clockTime(c.arriveAt)}</span>
      </span>
      {onCancel && (c.type === 'attack' || c.type === 'support') && <CancelButton movement since={c.sentAt} onCancel={onCancel} />}
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
            <span className="muted small">Blé économisé</span>
            <b className="ok">+{fmt(n * def.upkeep)}/h</b>
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
            <div className="table-wrap">
              <table className="troop-table disband-table">
                <thead>
                  <tr>
                    <th>Unité</th>
                    <th>Effectif</th>
                    <th>Entretien blé/h</th>
                    <th />
                  </tr>
                </thead>
                <tbody>
                  {UNIT_KEYS.filter((k) => v.troopsHome[k] > 0).map((k) => (
                    <tr key={k}>
                      <td>
                        <span className="row nowrap">
                          <UnitIcon unit={k} size={28} /> {UNITS[k].name}
                        </span>
                      </td>
                      <td>
                        <b>{fmt(v.troopsHome[k])}</b>
                      </td>
                      <td>−{fmt(v.troopsHome[k] * UNITS[k].upkeep)}</td>
                      <td>
                        <button className="btn small danger-outline" onClick={() => setDisband(k)}>
                          Dissoudre…
                        </button>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
            <p className="muted small">Dissoudre des unités libère leur entretien en blé. Aucune ressource n'est remboursée.</p>
          </>
        ) : (
          <p className="muted">Aucune troupe au village. Recrutez à la caserne.</p>
        )}
        <p className="muted small">Pour attaquer ou envoyer des renforts, choisissez un village sur la carte.</p>
      </Panel>

      <Panel title="Mouvements entrants">
        {v.incoming.length ? (
          <ul className="movements">{v.incoming.map((c) => <Movement key={c.id} c={c} direction="in" />)}</ul>
        ) : (
          <p className="muted">Rien en approche.</p>
        )}
      </Panel>

      <Panel title="Mouvements sortants">
        {v.outgoing.length ? (
          <ul className="movements">{v.outgoing.map((c) => <Movement key={c.id} c={c} direction="out" onCancel={() => cancelMove(c.id)} />)}</ul>
        ) : (
          <p className="muted">Aucune troupe en route.</p>
        )}
      </Panel>

      <Panel title="Renforts reçus">
        {v.supportHere.length ? (
          <ul className="movements">
            {v.supportHere.map((g) => (
              <li key={g.villageId} className="movement">
                <span>
                  {g.villageName} ({g.x}|{g.y}) {g.ownerName && <span className="muted">· <PlayerLink name={g.ownerName} /></span>}
                </span>
                <UnitList units={g.units} />
                <button className="btn small" onClick={() => recall(v.id, g.villageId)}>Renvoyer</button>
              </li>
            ))}
          </ul>
        ) : (
          <p className="muted">Aucun allié ne stationne ici.</p>
        )}
      </Panel>

      <Panel title="Vos renforts chez d'autres">
        {v.supportAway.length ? (
          <ul className="movements">
            {v.supportAway.map((g) => (
              <li key={g.villageId} className="movement">
                <span>
                  {g.villageName} ({g.x}|{g.y}) {g.ownerName && <span className="muted">· <PlayerLink name={g.ownerName} /></span>}
                </span>
                <UnitList units={g.units} />
                <button className="btn small" onClick={() => recall(g.villageId, v.id)}>Rappeler</button>
              </li>
            ))}
          </ul>
        ) : (
          <p className="muted">Toutes vos troupes sont à la maison.</p>
        )}
      </Panel>
      {disband && v.troopsHome[disband] > 0 && <DisbandDialog v={v} unit={disband} onClose={() => setDisband(null)} />}
    </div>
  );
}
