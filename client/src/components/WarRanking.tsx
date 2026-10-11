import { useEffect, useState } from 'react';
import { api } from '../api';
import { ago, fmt } from '../format';
import { useGame } from '../game';
import { Panel, PlayerLink } from '../ui';
import './ranking.css';

interface WarRow {
  rank: number;
  id: number;
  score: number;
  conquests: number;
  villagesLost: number;
  attackWins: number;
  defenseWins: number;
  killsAttack: number;
  killsDefense: number;
  // Joueurs
  username?: string;
  isNpc?: boolean;
  tag?: string | null;
  // Tribus
  name?: string;
  members?: number;
}
interface WarRanking {
  rows: WarRow[];
  me?: WarRow | null;
  points: { conquest: number; win: number; killsDivisor: number };
}
interface WarFeed {
  conquests: { at: string; conqueror: string; loser: string; village: string; x: number; y: number }[];
  wars: { startedAt: string; until: string; aId: number; aTag: string; aName: string; aNpc: boolean; bId: number; bTag: string; bName: string; bNpc: boolean }[];
}

const MEDALS = ['gold', 'silver', 'bronze'];

/** Classement de guerre : podium, tableau, dernières conquêtes et guerres de tribu en cours. */
export default function WarRankingView() {
  const { me, run } = useGame();
  const [kind, setKind] = useState<'players' | 'tribes'>('players');
  const [data, setData] = useState<WarRanking | null>(null);
  const [feed, setFeed] = useState<WarFeed | null>(null);

  useEffect(() => {
    setData(null);
    run(async () => setData(await api<WarRanking>(`/api/ranking/war/${kind}`)));
  }, [kind, run]);
  useEffect(() => {
    run(async () => setFeed(await api<WarFeed>('/api/ranking/war/feed')));
  }, [run]);

  const isMine = (r: WarRow) => (kind === 'players' ? r.id === me.player.id : r.id === me.player.tribe?.id);
  const label = (r: WarRow) =>
    kind === 'players' ? (
      <>
        <PlayerLink name={r.username} />
        {r.tag && <span className="wr-tag"> [{r.tag}]</span>}
        {r.isNpc && <span className="wr-npc">PNJ</span>}
      </>
    ) : (
      <a href={`#/tribu/${r.id}`}>
        [{r.tag}] {r.name}
      </a>
    );
  const rows = data?.rows ?? [];
  const podium = rows.slice(0, 3);

  return (
    <div className="stack">
      <Panel title="Classement de guerre">
        <div className="row admin-chips">
          {([['players', 'Joueurs'], ['tribes', 'Tribus']] as const).map(([k, l]) => (
            <button key={k} className={`chip chip-btn ${kind === k ? 'chip-ok' : ''}`} aria-pressed={kind === k} onClick={() => setKind(k)}>
              {l}
            </button>
          ))}
        </div>
        {data && (
          <p className="muted small">
            Score de guerre = {data.points.conquest} points par village conquis à un adversaire, {data.points.win} par bataille gagnée (en attaque ou en défense) et 1 point par {data.points.killsDivisor} d'adversaires
            battus. Les villages barbares ne comptent pas. Le décompte démarre à la mise en place du classement.
          </p>
        )}
        {!data ? (
          <p className="muted">Chargement…</p>
        ) : rows.length === 0 ? (
          <p className="muted">Personne n'a encore conquis de village ni gagné de bataille. Le premier à le faire ouvrira le classement.</p>
        ) : (
          <>
            <div className="wr-podium">
              {podium.map((r, i) => (
                <div key={r.id} className={`wr-card ${MEDALS[i]} ${isMine(r) ? 'me' : ''}`}>
                  <span className="wr-rank">{r.rank}</span>
                  <b className="wr-name">{label(r)}</b>
                  <span className="wr-score">{fmt(r.score)}</span>
                  <span className="wr-score-label">points de guerre</span>
                  <span className="wr-mini">
                    {r.conquests} conquête{r.conquests > 1 ? 's' : ''} · {r.attackWins + r.defenseWins} victoire{r.attackWins + r.defenseWins > 1 ? 's' : ''}
                  </span>
                </div>
              ))}
            </div>
            <WarTable rows={rows} kind={kind} label={label} isMine={isMine} />
            {data.me && !rows.some((r) => r.id === data.me!.id) && (
              <p className="small">
                Votre rang : <b>{data.me.rank}</b> · {fmt(data.me.score)} points de guerre
              </p>
            )}
          </>
        )}
      </Panel>

      <div className="wr-grid">
        <Panel title="Derniers faits d'armes">
          {!feed ? (
            <p className="muted">Chargement…</p>
          ) : feed.conquests.length === 0 ? (
            <p className="muted">Aucune conquête pour l'instant.</p>
          ) : (
            <ul className="wr-feed">
              {feed.conquests.map((c, i) => (
                <li key={i}>
                  <span>
                    <PlayerLink name={c.conqueror} /> a conquis <b>{c.village}</b>{' '}
                    <a href={`#/carte/${c.x},${c.y}`}>
                      ({c.x}|{c.y})
                    </a>{' '}
                    à <PlayerLink name={c.loser} />
                  </span>
                  <i className="muted small">{ago(c.at)}</i>
                </li>
              ))}
            </ul>
          )}
        </Panel>
        <Panel title="Guerres de tribus en cours">
          {!feed ? (
            <p className="muted">Chargement…</p>
          ) : feed.wars.length === 0 ? (
            <p className="muted">Aucune guerre déclarée en ce moment.</p>
          ) : (
            <ul className="wr-feed">
              {feed.wars.map((w, i) => (
                <li key={i}>
                  <span>
                    <a href={`#/tribu/${w.aId}`}>[{w.aTag}]</a> <span className="wr-vs">contre</span> <a href={`#/tribu/${w.bId}`}>[{w.bTag}]</a>
                    <br />
                    <i className="muted small">
                      {w.aName} · {w.bName}
                    </i>
                  </span>
                  <i className="muted small">encore {Math.max(1, Math.ceil((Date.parse(w.until) - Date.now()) / 3_600_000))} h</i>
                </li>
              ))}
            </ul>
          )}
        </Panel>
      </div>
    </div>
  );
}

/** Tableau complet : une vraie table sur ordinateur, des lignes à deux niveaux sur téléphone. */
function WarTable({ rows, kind, label, isMine }: { rows: WarRow[]; kind: 'players' | 'tribes'; label: (r: WarRow) => React.ReactNode; isMine: (r: WarRow) => boolean }) {
  return (
    <div className="table-wrap">
      <table className="rank-table wr-table">
        <thead>
          <tr>
            <th>#</th>
            <th>{kind === 'players' ? 'Joueur' : 'Tribu'}</th>
            <th className="num">Conquêtes</th>
            <th className="num">Perdus</th>
            <th className="num">Victoires</th>
            <th className="num">Battus</th>
            <th className="num">Score</th>
          </tr>
        </thead>
        <tbody>
          {rows.map((r) => (
            <tr key={r.id} className={isMine(r) ? 'me' : ''}>
              <td>{r.rank}</td>
              <td className="wr-who">{label(r)}</td>
              <td className="num" data-label="Conquêtes">{fmt(r.conquests)}</td>
              <td className="num" data-label="Perdus">{fmt(r.villagesLost)}</td>
              <td className="num" data-label="Victoires">
                {fmt(r.attackWins)}<span className="muted wr-hide-m"> att.</span> / {fmt(r.defenseWins)}<span className="muted wr-hide-m"> déf.</span>
              </td>
              <td className="num" data-label="Battus">{fmt(r.killsAttack + r.killsDefense)}</td>
              <td className="num wr-total">{fmt(r.score)}</td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}
