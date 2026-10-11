import { useCallback, useEffect, useState } from 'react';
import { api } from '../api';
import { fmt } from '../format';
import { useGame } from '../game';
import { Countdown, Panel } from '../ui';
import './ranking.css';

interface Other {
  id: number;
  tag: string;
  name: string;
  isNpc: boolean;
  members: number;
  villages: number;
  points: number;
}
interface Side {
  attackWins: number;
  defenseWins: number;
  conquests: number;
  kills: number;
}
interface WarLine {
  id: number;
  stats: { mine: Side; theirs: Side };
  other: Other;
  direction: 'declared' | 'received';
  declaredBy: string | null;
  startedAt: string;
  until: string;
  endedAt: string | null;
}
interface Target {
  id: number;
  tag: string;
  name: string;
  isNpc: boolean;
  members: number;
  points: number;
}
export interface TribeWarsView {
  isLeader: boolean;
  npcWarsEnabled: boolean;
  active: WarLine[];
  recent: WarLine[];
  targets: Target[];
  canDeclare: boolean;
  declaredCount: number;
  maxDeclared: number;
  durationDays: number;
  warriors: { username: string; score: number; conquests: number; wins: number }[];
}

const wins = (s: Side) => s.attackWins + s.defenseWins;
const sum = (lines: WarLine[], who: 'mine' | 'theirs'): Side =>
  lines.reduce(
    (t, w) => ({ attackWins: t.attackWins + w.stats[who].attackWins, defenseWins: t.defenseWins + w.stats[who].defenseWins, conquests: t.conquests + w.stats[who].conquests, kills: t.kills + w.stats[who].kills }),
    { attackWins: 0, defenseWins: 0, conquests: 0, kills: 0 },
  );

/** Tableau « nous / eux » : batailles gagnées, villages conquis et adversaires battus. */
function Versus({ mine, theirs, theirLabel }: { mine: Side; theirs: Side; theirLabel: string }) {
  const rows: [string, number, number][] = [
    ['Batailles gagnées', wins(mine), wins(theirs)],
    ['dont en attaque', mine.attackWins, theirs.attackWins],
    ['dont en défense', mine.defenseWins, theirs.defenseWins],
    ['Villages conquis', mine.conquests, theirs.conquests],
    ['Adversaires battus', mine.kills, theirs.kills],
  ];
  return (
    <table className="war-versus">
      <thead>
        <tr>
          <th />
          <th>Nous</th>
          <th>{theirLabel}</th>
        </tr>
      </thead>
      <tbody>
        {rows.map(([label, a, b]) => (
          <tr key={label} className={label.startsWith('dont') ? 'sub' : ''}>
            <td>{label}</td>
            <td className={a > b ? 'lead' : ''}>{fmt(a)}</td>
            <td className={b > a ? 'lead lost' : ''}>{fmt(b)}</td>
          </tr>
        ))}
      </tbody>
    </table>
  );
}

const day = (iso: string) => new Date(iso).toLocaleDateString('fr-FR', { day: 'numeric', month: 'short' });
const side = (o: Other) => (
  <>
    <b>[{o.tag}]</b> {o.name}
    {o.isNpc && <span className="chip">PNJ</span>}
  </>
);

/** Onglet « Guerres » de la tribu : guerres en cours (déclarées ou subies), déclaration (chef) et guerres récentes. */
export default function TribeWars({ onCount }: { onCount?: (n: number) => void }) {
  const { run, toast } = useGame();
  const [view, setView] = useState<TribeWarsView | null>(null);
  const [target, setTarget] = useState('');
  const load = useCallback(() => run(async () => setView(await api<TribeWarsView>('/api/tribes/mine/wars'))), [run]);
  useEffect(() => {
    load();
    const t = setInterval(load, 15_000);
    return () => clearInterval(t);
  }, [load]);
  useEffect(() => {
    if (view) onCount?.(view.active.length);
  }, [view, onCount]);

  if (!view) return <p className="muted">Chargement…</p>;
  const chosen = view.targets.find((t) => String(t.id) === target);

  const declare = () =>
    run(async () => {
      if (!chosen) return;
      if (!window.confirm(`Déclarer la guerre à [${chosen.tag}] ${chosen.name} pour ${view.durationDays} jours ?`)) return;
      setView(await api<TribeWarsView>('/api/tribes/mine/wars', { body: { targetId: chosen.id } }));
      setTarget('');
      toast(`Guerre déclarée à [${chosen.tag}]`);
    });
  const end = (w: WarLine) =>
    run(async () => {
      if (!window.confirm(`Mettre fin à la guerre contre [${w.other.tag}] ?`)) return;
      setView(await api<TribeWarsView>(`/api/tribes/mine/wars/${w.id}`, { method: 'DELETE' }));
      toast('Guerre terminée');
    });

  const row = (w: WarLine, live: boolean) => (
    <li key={w.id} className={`movement ${live && w.direction === 'received' ? 'hostile' : ''}`}>
      <span className="mv-type">{w.direction === 'declared' ? 'Déclarée' : 'Subie'}</span>
      <span>
        {side(w.other)}
        <span className="muted small">
          {' '}· {w.other.members} membre{w.other.members > 1 ? 's' : ''} · {w.other.villages} village{w.other.villages > 1 ? 's' : ''} · {fmt(w.other.points)} pts
        </span>
        <br />
        <span className="war-mini">
          <b>{fmt(wins(w.stats.mine))}</b> – {fmt(wins(w.stats.theirs))} batailles · <b>{fmt(w.stats.mine.conquests)}</b> – {fmt(w.stats.theirs.conquests)} villages conquis
        </span>
        <br />
        <span className="muted small">
          {w.direction === 'declared' ? 'Déclarée' : 'Déclarée contre vous'} le {day(w.startedAt)}
          {w.declaredBy ? ` par ${w.declaredBy}` : w.direction === 'received' ? ' sans provocation' : ''}
        </span>
      </span>
      <span className="mv-time">
        {live ? (
          <>
            <Countdown to={w.until} />
            <span className="muted small">jusqu’au {day(w.until)}</span>
          </>
        ) : (
          <span className="muted small">finie le {day(w.endedAt ?? w.until)}</span>
        )}
      </span>
      {live && w.direction === 'declared' && view.isLeader && (
        <button className="btn small ghost" onClick={() => end(w)}>
          Mettre fin
        </button>
      )}
    </li>
  );

  return (
    <div className="stack">
      <Panel title={`Guerres en cours (${view.active.length})`}>
        {view.active.length === 0 ? (
          <p className="muted">Votre tribu n’est en guerre contre personne, et personne ne vous a déclaré la guerre.</p>
        ) : (
          <ul className="movements">{view.active.map((w) => row(w, true))}</ul>
        )}
        <p className="muted small">
          Une tribu de PNJ en guerre contre vous frappe les villages de ses membres (jamais pendant les heures calmes). Contre une tribu de joueurs, la guerre est un état déclaré, visible par les deux camps.
        </p>
      </Panel>

      <Panel title="Statistiques de guerre">
        {view.active.length + view.recent.length === 0 ? (
          <p className="muted">Les statistiques apparaissent dès qu’une guerre est déclarée.</p>
        ) : (
          <>
            <p className="muted small">Bilan de toutes les guerres en cours et terminées depuis 7 jours, comptées depuis leur déclaration.</p>
            <Versus mine={sum([...view.active, ...view.recent], 'mine')} theirs={sum([...view.active, ...view.recent], 'theirs')} theirLabel="Adversaires" />
          </>
        )}
        {view.warriors.length > 0 && (
          <>
            <h4 className="war-sub">Meilleurs guerriers de la tribu</h4>
            <ol className="war-warriors">
              {view.warriors.map((m) => (
                <li key={m.username}>
                  <b>{m.username}</b>
                  <span className="muted small">
                    {' '}· {fmt(m.conquests)} conquête{m.conquests > 1 ? 's' : ''} · {fmt(m.wins)} victoire{m.wins > 1 ? 's' : ''}
                  </span>
                  <span className="war-warrior-score">{fmt(m.score)} pts</span>
                </li>
              ))}
            </ol>
            <p className="muted small">Classement de guerre du monde, toutes batailles confondues.</p>
          </>
        )}
      </Panel>

      <Panel title="Déclarer la guerre">
        {!view.isLeader ? (
          <p className="muted">Seul le chef de tribu peut déclarer la guerre. Parlez-en avec lui.</p>
        ) : (
          <>
            <p className="muted small">
              Une guerre dure {view.durationDays} jours. Votre tribu peut en déclarer {view.maxDeclared} à la fois ({view.declaredCount} en cours) ; vous pouvez y mettre fin quand vous voulez.
            </p>
            {!view.npcWarsEnabled && <p className="warn small">Les guerres contre les tribus de PNJ sont désactivées dans ce monde.</p>}
            <div className="row">
              <label htmlFor="war-target" className="sr-only">
                Tribu visée
              </label>
              <select id="war-target" value={target} onChange={(e) => setTarget(e.target.value)} disabled={!view.canDeclare}>
                <option value="">Choisir une tribu…</option>
                {view.targets
                  .filter((t) => !t.isNpc || view.npcWarsEnabled)
                  .map((t) => (
                    <option key={t.id} value={t.id}>
                      [{t.tag}] {t.name}
                      {t.isNpc ? ' (PNJ)' : ''} · {t.members} membre{t.members > 1 ? 's' : ''} · {fmt(t.points)} pts
                    </option>
                  ))}
              </select>
              <button className="btn danger" disabled={!chosen || !view.canDeclare} onClick={declare}>
                Déclarer la guerre
              </button>
            </div>
            {!view.canDeclare && <p className="muted small">Limite atteinte : mettez fin à une guerre déclarée pour en déclarer une autre.</p>}
          </>
        )}
      </Panel>

      {view.recent.length > 0 && (
        <Panel title="Guerres terminées (7 jours)">
          <ul className="movements">{view.recent.map((w) => row(w, false))}</ul>
        </Panel>
      )}
    </div>
  );
}
