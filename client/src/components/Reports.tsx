import { useEffect, useState } from 'react';
import { BUILDINGS, BUILDING_KEYS, RESOURCES, UNIT_KEYS, type AttackReportData, type Intel, type Resources, type ReportSummary, type ScoutReportData, type TradeReportData, type UnitCounts } from '@aldoria/shared';
import { api } from '../api';
import { clockTime, fmt } from '../format';
import { useGame, useRoute } from '../game';
import { Panel, PlayerLink, ResIcon, UnitIcon, UnitList } from '../ui';

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

function ResLine({ label, res }: { label: string; res: Resources }) {
  return (
    <p className="cost">
      {label} :
      {RESOURCES.map((r) => (
        <span key={r}>
          <ResIcon r={r} size={16} />
          {fmt(res[r])}
        </span>
      ))}
    </p>
  );
}

function IntelBlock({ intel }: { intel: Intel }) {
  return (
    <div className="stack">
      <h3>Ce que les éclaireurs ont vu</h3>
      <ResLine label="Ressources" res={intel.resources} />
      <div className="intel-grid">
        {BUILDING_KEYS.map((k) => (
          <span key={k}>
            {BUILDINGS[k].name} <b>{intel.buildings[k] ?? 0}</b>
          </span>
        ))}
      </div>
    </div>
  );
}

const villageLink = (v: { name: string; x: number; y: number }) => <a href={`#/carte/${v.x},${v.y}`}>{v.name} ({v.x}|{v.y})</a>;

function ScoutReport({ d }: { d: ScoutReportData }) {
  return (
    <div className="stack">
      <p className={`verdict ${d.intel ? 'win' : 'loss'}`}>{d.intel ? 'Espionnage réussi' : "Aucun éclaireur n'est revenu"}</p>
      <h3>
        Éclaireurs de {d.attacker.playerName ? <PlayerLink name={d.attacker.playerName} /> : 'inconnu'} · {villageLink(d.attacker.village)}
      </h3>
      <TroopTable units={d.attacker.units} losses={d.attacker.losses} />
      <h3>
        Cible : {d.defender.playerName ? <PlayerLink name={d.defender.playerName} /> : 'barbares'} · {villageLink(d.defender.village)}
      </h3>
      {d.intel && (
        <>
          <h3>Troupes présentes</h3>
          <TroopTable units={d.intel.troops} losses={null} />
          <IntelBlock intel={d.intel} />
        </>
      )}
    </div>
  );
}

function TradeReport({ d }: { d: TradeReportData }) {
  return (
    <div className="stack">
      <p>
        De {villageLink(d.from)} {d.from.playerName && <span className="muted">(<PlayerLink name={d.from.playerName} />)</span>} vers {villageLink(d.to)}{' '}
        {d.to.playerName && <span className="muted">(<PlayerLink name={d.to.playerName} />)</span>}
      </p>
      <ResLine label="Cargaison" res={d.resources} />
      <p className="muted small">Ce qui dépassait la capacité de l'entrepôt a été perdu.</p>
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
        Attaquant : {d.attacker.playerName ? <PlayerLink name={d.attacker.playerName} /> : 'inconnu'} · <a href={`#/carte/${d.attacker.village.x},${d.attacker.village.y}`}>{d.attacker.village.name} ({d.attacker.village.x}|{d.attacker.village.y})</a>
      </h3>
      <TroopTable units={d.attacker.units} losses={d.attacker.losses} />
      <h3>
        Défenseur : {d.defender.playerName ? <PlayerLink name={d.defender.playerName} /> : 'barbares'} · <a href={`#/carte/${d.defender.village.x},${d.defender.village.y}`}>{d.defender.village.name} ({d.defender.village.x}|{d.defender.village.y})</a>
      </h3>
      <TroopTable units={d.defender.units} losses={d.defender.losses} />
      {d.wall !== null && <p>Muraille : niveau {d.wall}</p>}
      {d.wallDamage && (
        <p>
          Les béliers ont abîmé la muraille : niveau {d.wallDamage.before} → <b>{d.wallDamage.after}</b>
        </p>
      )}
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
      {d.intel && <IntelBlock intel={d.intel} />}
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
        {report.type === 'scout' ? (
          <ScoutReport d={report.data} />
        ) : report.type === 'trade' ? (
          <TradeReport d={report.data} />
        ) : report.type === 'attack' || report.type === 'defense' || report.data.attacker ? (
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
        <p className="muted">Aucun rapport pour l'instant. Ils apparaissent après chaque combat, espionnage, livraison ou arrivée de renforts.</p>
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
