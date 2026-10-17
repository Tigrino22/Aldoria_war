import { useCallback, useEffect, useState } from 'react';
import { api } from '../api';
import { fmt } from '../format';
import { useGame } from '../game';
import { Countdown, Panel } from '../ui';
import { ReportBody } from './Reports';
import './reports.css';

interface Side {
  id: number;
  tag: string;
  name: string;
  isNpc: boolean;
  members: number;
  villages: number;
  points: number;
}
interface Front {
  a: Side;
  b: Side;
  until: string | null;
  startedAt: string | null;
  battles: number;
  conquests: { a: number; b: number };
  wins: { a: number; b: number };
  losses: { a: number; b: number };
  inFlight: number;
}
interface Battle {
  /** Absent de la vue publique : seule l'administration ouvre les rapports. */
  reportId?: number;
  at: string;
  attacker: { player: string; tag: string; village: string };
  defender: { player: string; tag: string; village: string };
  attackerWins: boolean;
  conquered: boolean;
  attackerLosses: number;
  defenderLosses: number;
  atWar: boolean;
}
interface Flight {
  arriveAt: string;
  sentAt: string;
  attacker: { player: string; tag: string; village: string };
  target: { player: string; tag: string; village: string; x: number; y: number };
  units: number;
  nobles: number;
}
interface Overview {
  enabled: boolean;
  hours: number;
  now: string;
  fronts: Front[];
  truce: { tribe: Side; nextWarAt: string | null }[];
  battles: Battle[];
  inFlight: Flight[];
  hourly: { hour: string; battles: number; conquests: number }[];
  log: { at: string; kind: 'declared' | 'ended'; a: string; b: string }[];
}

type Line = { at: string; node: React.ReactNode; reportId?: number };

interface AdminReport {
  id: number;
  type: string;
  title: string;
  data: any;
  createdAt: string;
  player: string;
}

/** Heure courte (« 12:48 »), précédée du jour quand ce n'est pas aujourd'hui. */
const shortTime = (iso: string) => {
  const d = new Date(iso);
  const t = d.toLocaleTimeString('fr-FR', { hour: '2-digit', minute: '2-digit' });
  return d.toDateString() === new Date().toDateString() ? t : `${d.toLocaleDateString('fr-FR', { weekday: 'short' })} ${t}`;
};
const hourLabel = (iso: string) => new Date(iso).toLocaleTimeString('fr-FR', { hour: '2-digit', minute: '2-digit' });

function Score({ f }: { f: Front }) {
  return (
    <span className="war-score">
      <b>{f.wins.a}</b> – <b>{f.wins.b}</b>
    </span>
  );
}

/** Onglet « Guerres » de l'administration : suivi en direct des guerres entre tribus de PNJ, et ce qui s'est passé sur la période. */
export default function AdminWars({ hours, publicView = false }: { hours: number; publicView?: boolean }) {
  const { run } = useGame();
  const [data, setData] = useState<Overview | null>(null);
  const [all, setAll] = useState(false);
  const [report, setReport] = useState<AdminReport | null>(null);
  const openReport = (id: number) => run(async () => setReport(await api<AdminReport>(`/api/admin/reports/${id}`)));
  const load = useCallback(() => run(async () => setData(await api<Overview>(`/api/${publicView ? 'world' : 'admin'}/wars?hours=${hours}`))), [run, hours, publicView]);
  useEffect(() => {
    load();
    const t = setInterval(load, publicView ? 15_000 : 5000);
    return () => clearInterval(t);
  }, [load, publicView]);

  if (!data) return <p className="muted">Chargement…</p>;

  const active = data.fronts.filter((f) => f.until);
  const conquests = data.battles.filter((b) => b.conquered).length;
  const peak = Math.max(1, ...data.hourly.map((h) => h.battles));
  const timeline: Line[] = [
    ...data.battles.map((b) => ({
      at: b.at,
      reportId: publicView ? undefined : b.reportId,
      node: (
        <>
          <b>[{b.attacker.tag}] {b.attacker.player}</b> {b.conquered ? 'conquiert' : 'attaque'} {b.defender.village} de <b>[{b.defender.tag}] {b.defender.player}</b> :{' '}
          {b.conquered ? 'village conquis' : b.attackerWins ? 'victoire de l’attaquant' : 'la défense tient'}
          <span className="muted small"> · pertes {fmt(b.attackerLosses)} / {fmt(b.defenderLosses)}</span>
          {!b.atWar && <span className="chip" title="Pas de guerre déclarée en ce moment entre ces tribus">riposte</span>}
          {b.conquered && <span className="chip chip-ok">conquête</span>}
        </>
      ),
    })),
    ...data.log.map((l) => ({
      at: l.at,
      node: (
        <>
          {l.kind === 'declared' ? '⚔ Guerre déclarée' : '🕊 Fin de la guerre'} entre <b>[{l.a}]</b> et <b>[{l.b}]</b>
        </>
      ),
    })),
  ].sort((x, y) => Date.parse(y.at) - Date.parse(x.at));

  return (
    <>
      {!data.enabled && (
        <Panel title="Guerres désactivées">
          <p className="muted">Le réglage « Guerres entre tribus de PNJ » est coupé (onglet Monde) : aucune guerre n’est déclarée. Les ripostes entre PNJ restent visibles ci-dessous.</p>
        </Panel>
      )}
      <div className="admin-kpis">
        <div className="admin-kpi"><i>Guerres en cours</i><b>{active.length}</b></div>
        <div className="admin-kpi"><i>Attaques en route</i><b>{publicView ? data.fronts.reduce((n, f) => n + f.inFlight, 0) : data.inFlight.length}</b></div>
        <div className="admin-kpi"><i>Batailles ({hours} h)</i><b>{data.battles.length}</b></div>
        <div className="admin-kpi"><i>Conquêtes ({hours} h)</i><b>{conquests}</b></div>
      </div>

      <Panel title="Fronts" actions={<span className="muted small">actualisé toutes les {publicView ? 15 : 5} s</span>}>
        {data.fronts.length === 0 ? (
          <p className="muted">Aucune guerre en cours ni bataille sur la période.</p>
        ) : (
          <div className="admin-scroll">
            <table className="admin-table">
              <thead>
                <tr>
                  <th>Tribus</th>
                  <th>État</th>
                  <th className="num">Villages</th>
                  <th className="num">Victoires</th>
                  <th className="num hide-m">Conquêtes</th>
                  <th className="num hide-m">Pertes</th>
                  <th className="num">En route</th>
                </tr>
              </thead>
              <tbody>
                {data.fronts.map((f) => (
                  <tr key={`${f.a.id}-${f.b.id}`}>
                    <td>
                      <b>[{f.a.tag}]</b>
                      {!f.a.isNpc && <span className="chip">joueurs</span>} contre <b>[{f.b.tag}]</b>
                      {!f.b.isNpc && <span className="chip">joueurs</span>}
                    </td>
                    <td>{f.until ? <>fin dans <Countdown to={f.until} /></> : <span className="muted" title="Rivalités et ripostes : aucune guerre déclarée entre ces tribus en ce moment">hors guerre</span>}</td>
                    <td className="num">{f.a.villages} – {f.b.villages}</td>
                    <td className="num"><Score f={f} /></td>
                    <td className="num hide-m">{f.conquests.a} – {f.conquests.b}</td>
                    <td className="num hide-m">{fmt(f.losses.a)} – {fmt(f.losses.b)}</td>
                    <td className="num">{f.inFlight}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
        <p className="muted small">Les colonnes comparent la première tribu à la seconde. Pertes : unités perdues par chaque camp sur la période.</p>
      </Panel>

      {!publicView && (
      <Panel title="Attaques en route" actions={<span className="muted small">en direct</span>}>
        {data.inFlight.length === 0 ? (
          <p className="muted">Aucune attaque entre tribus de PNJ en ce moment.</p>
        ) : (
          <div className="admin-scroll">
            <table className="admin-table">
              <thead>
                <tr>
                  <th>Arrivée</th>
                  <th>Attaquant</th>
                  <th>Cible</th>
                  <th className="num">Troupes</th>
                </tr>
              </thead>
              <tbody>
                {data.inFlight.map((f, i) => (
                  <tr key={i}>
                    <td className="t">
                      <Countdown to={f.arriveAt} /> <span className="small hide-m">({shortTime(f.arriveAt)})</span>
                    </td>
                    <td>[{f.attacker.tag}] {f.attacker.player} <span className="muted small">de {f.attacker.village}</span></td>
                    <td>
                      [{f.target.tag}] {f.target.player} <span className="muted small">{f.target.village} ({f.target.x}|{f.target.y})</span>
                    </td>
                    <td className="num">
                      {fmt(f.units)}
                      {f.nobles > 0 && <span className="chip chip-ok" title="Nobles : tentative de conquête">{f.nobles} noble{f.nobles > 1 ? 's' : ''}</span>}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </Panel>
      )}

      <Panel title={`Rythme des batailles (${hours} h)`}>
        <div className="war-chart" role="img" aria-label="Batailles par heure">
          {data.hourly.map((h) => (
            <div key={h.hour} className="war-col" title={`${hourLabel(h.hour)} : ${h.battles} bataille${h.battles > 1 ? 's' : ''}, ${h.conquests} conquête${h.conquests > 1 ? 's' : ''}`}>
              <i style={{ height: `${(h.battles / peak) * 100}%` }} className={h.conquests ? 'conquest' : ''} />
              {data.hourly.length <= 26 && <span>{new Date(h.hour).getHours()}</span>}
            </div>
          ))}
        </div>
        <p className="muted small">Une barre par heure ; dorée quand une conquête a eu lieu. Pic : {peak} bataille{peak > 1 ? 's' : ''} en une heure.</p>
      </Panel>

      <Panel title="Journal">
        {timeline.length === 0 ? (
          <p className="muted">Rien à signaler sur cette période.</p>
        ) : (
          <div className="admin-scroll">
            <table className="admin-table">
              <tbody>
                {(all ? timeline : timeline.slice(0, 30)).map((l, i) =>
                  l.reportId ? (
                    <tr
                      key={i}
                      className="war-line-link"
                      role="button"
                      tabIndex={0}
                      title="Ouvrir le rapport de la bataille"
                      onClick={() => openReport(l.reportId!)}
                      onKeyDown={(e) => {
                        if (e.key === 'Enter' || e.key === ' ') {
                          e.preventDefault();
                          openReport(l.reportId!);
                        }
                      }}
                    >
                      <td className="t">{shortTime(l.at)}</td>
                      <td>
                        {l.node}
                        <span className="war-line-more" aria-hidden="true">
                          Rapport ›
                        </span>
                      </td>
                    </tr>
                  ) : (
                    <tr key={i}>
                      <td className="t">{shortTime(l.at)}</td>
                      <td>{l.node}</td>
                    </tr>
                  ),
                )}
              </tbody>
            </table>
            {timeline.length > 30 && (
              <button className="btn ghost small" onClick={() => setAll(!all)}>
                {all ? 'Réduire' : `Afficher les ${timeline.length - 30} autres`}
              </button>
            )}
          </div>
        )}
      </Panel>

      {report && <ReportDialog report={report} onClose={() => setReport(null)} />}

      <Panel title="Tribus en trêve">
        {data.truce.length === 0 ? (
          <p className="muted">Toutes les tribus de PNJ sont en guerre.</p>
        ) : (
          <ul className="war-truce">
            {data.truce.map((t) => (
              <li key={t.tribe.id}>
                <b>[{t.tribe.tag}]</b> {t.tribe.name} · {t.tribe.villages} village{t.tribe.villages > 1 ? 's' : ''} · {fmt(t.tribe.points)} pts
                <span className="muted small"> · {t.nextWarAt && Date.parse(t.nextWarAt) > Date.parse(data.now) ? <>prochaine guerre possible dans <Countdown to={t.nextWarAt} /></> : 'prête à déclarer une guerre'}</span>
              </li>
            ))}
          </ul>
        )}
      </Panel>
    </>
  );
}

/** Rapport d'une bataille du journal, tel que son joueur le voit (lecture seule : il reste non lu pour lui). */
function ReportDialog({ report, onClose }: { report: AdminReport; onClose: () => void }) {
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => e.key === 'Escape' && onClose();
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [onClose]);
  return (
    <div className="modal-backdrop" onClick={onClose}>
      <div className="pg reports war-report-dialog" role="dialog" aria-modal="true" aria-label={report.title} onClick={(e) => e.stopPropagation()}>
        <div className="row between">
          <div>
            <p className="muted small">
              Rapport de {report.player} · {shortTime(report.createdAt)}
            </p>
            <h2>{report.title}</h2>
          </div>
          <button className="btn small" onClick={onClose} autoFocus>
            Fermer
          </button>
        </div>
        <div className="rp-body">
          <ReportBody report={report} />
        </div>
      </div>
    </div>
  );
}
