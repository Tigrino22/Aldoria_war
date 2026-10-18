import { useCallback, useEffect, useState } from 'react';
import { BUILDINGS, BUILDING_KEYS, RELIC_DAYS, RESOURCES, TIER_LABELS, UNIT_KEYS, type AchievementTier, type AttackReportData, type Intel, type Resources, type ReportSummary, type ScoutReportData, type TradeReportData, type UnitCounts } from '@aldoria/shared';
import { api } from '../api';
import { clockTime, fmt } from '../format';
import { useGame, useRoute } from '../game';
import { PlayerLink, ResIcon, UnitIcon, UnitList, VillageLink } from '../ui';
import { PageBanner } from './PageBanner';
import { Medal } from './Badge';
import './reports.css';

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


/** Verdict tiré des effectifs, pas des renseignements : la copie du défenseur n'en contient jamais. */
function scoutVerdict(d: ScoutReportData): { win: boolean; text: string } {
  const back = (d.attacker.units?.scout ?? 0) - (d.attacker.losses?.scout ?? 0);
  if (back <= 0) return { win: false, text: "Aucun éclaireur n'est revenu" };
  const s = back > 1 ? 's' : '';
  if (!d.intel) return { win: false, text: `${back} éclaireur${s} ennemi${s} ${back > 1 ? 'sont repartis' : 'est reparti'} avec des renseignements sur votre village` };
  return { win: true, text: d.attacker.losses?.scout ? `Espionnage réussi · ${back} éclaireur${s} revenu${s}` : 'Espionnage réussi' };
}

function ScoutReport({ d }: { d: ScoutReportData }) {
  const verdict = scoutVerdict(d);
  return (
    <div className="stack">
      <p className={`verdict ${verdict.win ? 'win' : 'loss'}`}>{verdict.text}</p>
      <h3>
        Éclaireurs de {d.attacker.playerName ? <PlayerLink name={d.attacker.playerName} /> : 'inconnu'} · <VillageLink v={d.attacker.village} />
      </h3>
      <TroopTable units={d.attacker.units} losses={d.attacker.losses} />
      <h3>
        Cible : {d.defender.playerName ? <PlayerLink name={d.defender.playerName} /> : 'barbares'} · <VillageLink v={d.defender.village} />
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
        De <VillageLink v={d.from} /> {d.from.playerName && <span className="muted">(<PlayerLink name={d.from.playerName} />)</span>} vers <VillageLink v={d.to} />{' '}
        {d.to.playerName && <span className="muted">(<PlayerLink name={d.to.playerName} />)</span>}
      </p>
      <ResLine label="Cargaison" res={d.resources} />
      <p className="muted small">Ce qui dépassait la capacité de l'entrepôt a été perdu.</p>
    </div>
  );
}

/** Compte rendu d'une croisade (fin de l'assaut) ou troupes refoulées aux portes de la Citadelle. */
/** Rapport des provinces : bannière plantée ou tombée, contrôle, victoire du monde, troupes renvoyées. */
function AchievementReport({ d }: { d: { earned?: { title: string; tier: AchievementTier; goal: string; reward: number }[] } }) {
  return (
    <div className="ach-report">
      <ul>
        {(d.earned ?? []).map((e, i) => (
          <li key={i}>
            <Medal tier={e.tier} size={40} />
            <span>
              <b>
                {e.title} · {TIER_LABELS[e.tier]}
              </b>
              <br />
              <span className="muted small">
                {e.goal}
                {e.reward > 0 && ` · coffre de ${e.reward} % de l’entrepôt dans votre inventaire`}
              </span>
            </span>
          </li>
        ))}
      </ul>
      <p>
        <a href="#/succes">Voir mes succès</a> · <a href="#/inventaire">Ouvrir l’inventaire</a>
      </p>
    </div>
  );
}

function ProvinceReport({ d }: { d: any }) {
  return (
    <div className="stack">
      {d.province && (
        <p>
          <b>{d.province}</b>
          {d.bastion ? ` · ${d.bastion}` : ''}
        </p>
      )}
      {d.text && <p>{d.text}</p>}
      {d.units && <UnitList units={d.units} />}
      <p>
        <a href="#/provinces">Voir les provinces</a>
      </p>
    </div>
  );
}

function CrusadeReport({ d }: { d: any }) {
  if (!d.crusadeId) {
    return (
      <div className="stack">
        <p>
          {d.citadel} : {d.reason}. Vos troupes rentrent au village.
        </p>
        {d.units && <UnitList units={d.units} />}
      </div>
    );
  }
  return (
    <div className="stack">
      <p className={`verdict ${d.won ? 'win' : 'loss'}`}>{d.won ? 'Votre camp remporte la croisade !' : d.winner ? `${d.winner} remporte la croisade` : 'La Citadelle a tenu'}</p>
      <p>
        Vous finissez <b>{d.rank === 1 ? '1er' : `${d.rank}e`}</b> avec <b>{fmt(d.glory)}</b> de gloire.
        {d.won && ` La relique augmente la production de vos villages pendant ${RELIC_DAYS} jours.`}
      </p>
      {d.treasure > 0 && (
        <p>
          Votre part du trésor : <b>{fmt(d.treasure)}</b> de chaque ressource, livrée à votre plus ancien village
          {d.delivered < d.treasure * 4 ? ' (ce qui dépassait la capacité de l’entrepôt a été perdu)' : ''}.
        </p>
      )}
      <p>
        <a href="#/croisade">Voir la chronique</a> · <a href="#/compte">Choisir mon titre</a>
      </p>
    </div>
  );
}

function AttackReport({ d }: { d: AttackReportData }) {
  return (
    <div className="stack">
      <p className={`verdict ${d.attackerWins ? 'win' : 'loss'}`}>
        {d.conquered ? 'Le village a été conquis !' : d.field ? (d.attackerWins ? "L'armée interceptée est détruite" : "L'armée interceptée force le passage") : d.attackerWins ? "L'attaquant l'emporte" : 'Le défenseur tient bon'}
      </p>
      {d.field && (
        <p>
          Bataille en rase campagne près de <a href={`#/carte/${Math.floor(d.field.x)},${Math.floor(d.field.y)}`}>({Math.floor(d.field.x)}|{Math.floor(d.field.y)})</a>, sans muraille. Ci-dessous, les villages d'où viennent les deux armées.
        </p>
      )}
      <h3>
        {d.field ? 'Intercepteur' : 'Attaquant'} : {d.attacker.playerName ? <PlayerLink name={d.attacker.playerName} /> : 'inconnu'} · <VillageLink v={d.attacker.village} />
      </h3>
      <TroopTable units={d.attacker.units} losses={d.attacker.losses} />
      <h3>
        {d.field ? 'Armée interceptée' : 'Défenseur'} : {d.defender.playerName ? <PlayerLink name={d.defender.playerName} /> : 'barbares'} · <VillageLink v={d.defender.village} />
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

/** Contenu d'un rapport selon son type (aussi ouvert depuis le journal des guerres de l'administration). */
export function ReportBody({ report }: { report: { type: string; data: any } }) {
  return report.type === 'scout' ? (
    <ScoutReport d={report.data} />
  ) : report.type === 'trade' ? (
    <TradeReport d={report.data} />
  ) : report.type === 'crusade' ? (
    <CrusadeReport d={report.data} />
  ) : report.type === 'province' ? (
    <ProvinceReport d={report.data} />
  ) : report.type === 'achievement' ? (
    <AchievementReport d={report.data} />
  ) : report.type === 'attack' || report.type === 'defense' || report.data.attacker ? (
    <AttackReport d={report.data} />
  ) : (
    <div className="stack">
      {report.data.units && <UnitList units={report.data.units} />}
      {report.data.from && <p>Depuis {report.data.from}</p>}
    </div>
  );
}

export default function Reports({ id }: { id?: number }) {
  const { run, refreshMe } = useGame();
  const [, go] = useRoute();
  const [report, setReport] = useState<any>(null);

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
      <div className="pg reports">
        <PageBanner
          icon="rapports"
          kicker={`Rapport · ${clockTime(report.createdAt)}`}
          title={report.title}
          actions={
            <>
              <button className="btn small" onClick={() => go('rapports')}>← Retour</button>
              <button
                className="btn small danger"
                onClick={() => run(async () => { await api(`/api/reports/${id}`, { method: 'DELETE' }); go('rapports'); })}
              >
                Supprimer
              </button>
            </>
          }
        />
        <section className="pg-card rp-body">
          <ReportBody report={report} />
        </section>
      </div>
    );
  }

  return <ReportList />;
}

const CATEGORIES: { key: string; label: string }[] = [
  { key: 'all', label: 'Toutes les catégories' },
  { key: 'attack', label: 'Attaques' },
  { key: 'defense', label: 'Défenses' },
  { key: 'scout', label: 'Espionnage' },
  { key: 'trade', label: 'Livraisons' },
  { key: 'support', label: 'Renforts' },
  { key: 'crusade', label: 'Croisades' },
  { key: 'province', label: 'Provinces' },
  { key: 'achievement', label: 'Succès' },
];

const LEGEND: { tone: string; label: string }[] = [
  { tone: 'scout', label: 'Espionnage' },
  { tone: 'win', label: 'Réussite sans perte' },
  { tone: 'mixed', label: 'Réussite avec pertes' },
  { tone: 'loss', label: 'Défaite ou 100 % des troupes perdues' },
];

function ReportList() {
  const { run, refreshMe } = useGame();
  const [list, setList] = useState<ReportSummary[]>([]);
  const [archives, setArchives] = useState(false);
  const [category, setCategory] = useState('all');
  const [selected, setSelected] = useState<Set<number>>(new Set());
  const [confirming, setConfirming] = useState(false);

  const load = useCallback(
    () => run(async () => { setList(await api(`/api/reports?archived=${archives ? 1 : 0}`)); refreshMe(); }),
    [run, refreshMe, archives],
  );
  useEffect(() => { setSelected(new Set()); setConfirming(false); load(); }, [load]);

  const shown = list.filter((r) => category === 'all' || r.type === category);
  const allSelected = shown.length > 0 && shown.every((r) => selected.has(r.id));
  const toggle = (id: number) => setSelected((s) => { const n = new Set(s); if (n.has(id)) n.delete(id); else n.add(id); return n; });
  const toggleAll = () => setSelected(allSelected ? new Set() : new Set(shown.map((r) => r.id)));
  const bulk = (action: 'delete' | 'archive' | 'unarchive') =>
    run(async () => {
      await api('/api/reports/bulk', { method: 'POST', body: { ids: [...selected], action } });
      setSelected(new Set());
      setConfirming(false);
      await load();
    });

  return (
    <div className="pg reports">
      <PageBanner
        icon="rapports"
        kicker="Social"
        title={archives ? 'Rapports archivés' : 'Rapports'}
        lead="Combats, espionnages, livraisons et renforts : tout ce qui s'est passé autour de vos villages."
        actions={<button className="btn small" onClick={() => setArchives(!archives)}>{archives ? 'Retour aux rapports' : 'Archives'}</button>}
        stats={[
          { value: list.length, label: archives ? 'archivés' : 'rapports', tone: 'gold' },
          { value: list.filter((r) => !r.read).length, label: 'non lus' },
          { value: list.filter((r) => r.tone === 'loss').length, label: 'défaites', tone: list.some((r) => r.tone === 'loss') ? 'red' : '' },
        ]}
      />
      <section className="pg-card">
      <ul className="report-legend row small">
        {LEGEND.map((l) => (
          <li key={l.tone}><span className={`dot tone-${l.tone}`} /> {l.label}</li>
        ))}
      </ul>
      <div className="report-toolbar row">
        <label className="row small">
          <input type="checkbox" checked={allSelected} onChange={toggleAll} disabled={!shown.length} /> Tout sélectionner
        </label>
        <select value={category} onChange={(e) => { setCategory(e.target.value); setSelected(new Set()); }} aria-label="Catégorie">
          {CATEGORIES.map((c) => <option key={c.key} value={c.key}>{c.label}</option>)}
        </select>
        {selected.size > 0 && (
          <>
            <span className="muted small">{selected.size} sélectionné{selected.size > 1 ? 's' : ''}</span>
            {archives ? (
              <button className="btn small" onClick={() => bulk('unarchive')}>Désarchiver</button>
            ) : (
              <button className="btn small" onClick={() => bulk('archive')}>Archiver</button>
            )}
            {confirming ? (
              <>
                <button className="btn small danger" onClick={() => bulk('delete')}>Confirmer la suppression</button>
                <button className="btn small ghost" onClick={() => setConfirming(false)}>Annuler</button>
              </>
            ) : (
              <button className="btn small danger" onClick={() => setConfirming(true)}>Supprimer</button>
            )}
          </>
        )}
      </div>
      {shown.length === 0 ? (
        <p className="muted">
          {archives
            ? 'Aucun rapport archivé.'
            : list.length
              ? 'Aucun rapport dans cette catégorie.'
              : "Aucun rapport pour l'instant. Ils apparaissent après chaque combat, espionnage, livraison ou arrivée de renforts."}
        </p>
      ) : (
        <ul className="list report-list">
          {shown.map((r) => (
            <li key={r.id}>
              <input type="checkbox" checked={selected.has(r.id)} onChange={() => toggle(r.id)} aria-label={`Sélectionner : ${r.title}`} />
              <a href={`#/rapports/${r.id}`} className={r.read ? '' : 'unread'}>
                <span className={`dot tone-${r.tone}`} />
                <span>{r.title}</span>
                <span className="muted small">{clockTime(r.createdAt)}</span>
              </a>
            </li>
          ))}
        </ul>
      )}
      </section>
    </div>
  );
}
