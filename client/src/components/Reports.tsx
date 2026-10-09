import { useEffect, useState } from 'react';
import { RESOURCES, UNIT_KEYS, type AttackReportData, type ReportSummary, type UnitCounts } from '@fiefs/shared';
import { api } from '../api';
import { clockTime, fmt } from '../format';
import { useGame, useRoute } from '../game';
import { Panel, ResIcon, UnitIcon, UnitList } from '../ui';

function TroopTable({ units, losses }: { units: UnitCounts | null; losses: UnitCounts | null }) {
  if (!units) return <p className="muted small">Aucun survivant n'a pu observer les défenseurs.</p>;
  return (
    <div className="table-wrap">
      <table className="troop-table">
        <thead>
          <tr>
            <th />
            {UNIT_KEYS.map((k) => (
              <th key={k}>
                <UnitIcon unit={k} size={24} />
              </th>
            ))}
          </tr>
        </thead>
        <tbody>
          <tr>
            <th>Troupes</th>
            {UNIT_KEYS.map((k) => <td key={k}>{fmt(units[k])}</td>)}
          </tr>
          <tr>
            <th>Pertes</th>
            {UNIT_KEYS.map((k) => <td key={k} className={losses && losses[k] ? 'loss' : ''}>{losses ? fmt(losses[k]) : '?'}</td>)}
          </tr>
        </tbody>
      </table>
    </div>
  );
}

function AttackReport({ d }: { d: AttackReportData }) {
  return (
    <div className="stack">
      <p className={`verdict ${d.attackerWins ? 'win' : 'loss'}`}>
        {d.conquered ? 'Le village a été conquis !' : d.attackerWins ? "L'attaquant l'emporte" : 'Le défenseur tient bon'}
      </p>
      <h3>
        Attaquant : {d.attacker.playerName ?? 'inconnu'} · <a href={`#/carte/${d.attacker.village.x},${d.attacker.village.y}`}>{d.attacker.village.name} ({d.attacker.village.x}|{d.attacker.village.y})</a>
      </h3>
      <TroopTable units={d.attacker.units} losses={d.attacker.losses} />
      <h3>
        Défenseur : {d.defender.playerName ?? 'barbares'} · <a href={`#/carte/${d.defender.village.x},${d.defender.village.y}`}>{d.defender.village.name} ({d.defender.village.x}|{d.defender.village.y})</a>
      </h3>
      <TroopTable units={d.defender.units} losses={d.defender.losses} />
      {d.wall !== null && <p>Muraille : niveau {d.wall}</p>}
      {d.loot && (
        <p className="cost">
          Butin :
          {RESOURCES.map((r) => (
            <span key={r}>
              <ResIcon r={r} size={16} />
              {fmt(d.loot![r])}
            </span>
          ))}
        </p>
      )}
      {d.loyalty && (
        <p>
          Loyauté : {d.loyalty.before} → <b>{d.loyalty.after}</b>
        </p>
      )}
    </div>
  );
}

export default function Reports({ id }: { id?: number }) {
  const { run, refreshMe } = useGame();
  const [, go] = useRoute();
  const [list, setList] = useState<ReportSummary[]>([]);
  const [report, setReport] = useState<any>(null);

  useEffect(() => {
    run(async () => setList(await api('/api/reports')));
  }, [run, id]);
  useEffect(() => {
    setReport(null);
    if (id)
      run(async () => {
        setReport(await api(`/api/reports/${id}`));
        refreshMe();
      });
  }, [id, run, refreshMe]);

  if (id && report) {
    return (
      <Panel
        title={report.title}
        actions={
          <div className="row">
            <button className="btn small ghost" onClick={() => go('rapports')}>Retour</button>
            <button
              className="btn small"
              onClick={() => run(async () => { await api(`/api/reports/${id}`, { method: 'DELETE' }); go('rapports'); })}
            >
              Supprimer
            </button>
          </div>
        }
      >
        <p className="muted small">{clockTime(report.createdAt)}</p>
        {report.type === 'attack' || report.type === 'defense' || report.data.attacker ? (
          <AttackReport d={report.data} />
        ) : (
          <div className="stack">
            {report.data.units && <UnitList units={report.data.units} />}
            {report.data.from && <p>Depuis {report.data.from}</p>}
          </div>
        )}
      </Panel>
    );
  }

  return (
    <Panel title="Rapports">
      {list.length === 0 ? (
        <p className="muted">Aucun rapport pour l'instant. Ils apparaissent après chaque combat ou arrivée de renforts.</p>
      ) : (
        <ul className="list">
          {list.map((r) => (
            <li key={r.id}>
              <a href={`#/rapports/${r.id}`} className={r.read ? '' : 'unread'}>
                <span className={`dot type-${r.type}`} />
                <span>{r.title}</span>
                <span className="muted small">{clockTime(r.createdAt)}</span>
              </a>
            </li>
          ))}
        </ul>
      )}
    </Panel>
  );
}
