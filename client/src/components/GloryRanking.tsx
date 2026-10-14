import { useEffect, useState } from 'react';
import type { GloryRankingRow } from '@aldoria/shared';
import { api } from '../api';
import { fmt } from '../format';
import { useGame } from '../game';
import { Panel, PlayerLink } from '../ui';
import './ranking.css';

interface GloryRanking {
  season: number;
  seasons: number[];
  seasonDays?: number;
  rows: GloryRankingRow[];
  me?: GloryRankingRow | null;
}

const MEDALS = ['gold', 'silver', 'bronze'];

/** Classement de gloire des Croisades, par saison : podium et tableau, joueurs ou tribus. */
export default function GloryRankingView() {
  const { me, run } = useGame();
  const [kind, setKind] = useState<'players' | 'tribes'>('players');
  const [season, setSeason] = useState<number | null>(null);
  const [data, setData] = useState<GloryRanking | null>(null);

  useEffect(() => {
    setData(null);
    run(async () => setData(await api<GloryRanking>(`/api/ranking/glory/${kind}${season ? `?season=${season}` : ''}`)));
  }, [kind, season, run]);

  const isMine = (r: GloryRankingRow) => (kind === 'players' ? r.id === me.player.id : r.id === me.player.tribe?.id);
  const label = (r: GloryRankingRow) =>
    kind === 'players' ? (
      <>
        <PlayerLink name={r.name} />
        {r.tag && <span className="wr-tag"> [{r.tag}]</span>}
        {r.title && <span className="gl-title">{r.title}</span>}
      </>
    ) : (
      <a href={`#/tribu/${r.id}`}>
        [{r.tag}] {r.name}
      </a>
    );
  const rows = data?.rows ?? [];
  const seasons = data?.seasons ?? [];

  return (
    <div className="stack">
      <Panel title="Gloire des Croisades">
        <div className="row admin-chips">
          {([['players', 'Joueurs'], ['tribes', 'Tribus']] as const).map(([k, l]) => (
            <button key={k} className={`chip chip-btn ${kind === k ? 'chip-ok' : ''}`} aria-pressed={kind === k} onClick={() => setKind(k)}>
              {l}
            </button>
          ))}
          {seasons.length > 1 && (
            <select aria-label="Saison" value={data?.season ?? ''} onChange={(e) => setSeason(Number(e.target.value))}>
              {seasons.map((s) => (
                <option key={s} value={s}>
                  Saison {s}
                </option>
              ))}
            </select>
          )}
        </div>
        <p className="small muted">
          Saison {data?.season ?? '…'} : la gloire se gagne à la Citadelle (ennemis tués, brèche, bannière, victoire) et repart de zéro toutes les quatre semaines. Le premier de la saison reçoit le titre de
          Héros de la saison. <a href="#/croisade">Voir la croisade</a>
        </p>
        {!data ? (
          <p className="muted">Chargement…</p>
        ) : rows.length === 0 ? (
          <p className="muted">Personne n'a encore gagné de gloire cette saison. La prochaine croisade ouvrira le classement.</p>
        ) : (
          <>
            <div className="wr-podium">
              {rows.slice(0, 3).map((r, i) => (
                <div key={r.id} className={`wr-card ${MEDALS[i]} ${isMine(r) ? 'me' : ''}`}>
                  <span className="wr-rank">{r.rank}</span>
                  <b className="wr-name">{label(r)}</b>
                  <span className="wr-score">{fmt(r.glory)}</span>
                  <span className="wr-score-label">gloire</span>
                  <span className="wr-mini">
                    {r.crusades} croisade{r.crusades > 1 ? 's' : ''}
                    {r.wins ? ` · ${r.wins} victoire${r.wins > 1 ? 's' : ''}` : ''}
                  </span>
                </div>
              ))}
            </div>
            <div className="table-wrap">
              <table className="rank-table gl-table">
                <thead>
                  <tr>
                    <th>#</th>
                    <th>{kind === 'players' ? 'Joueur' : 'Tribu'}</th>
                    <th className="num">Croisades</th>
                    {kind === 'tribes' && <th className="num">Victoires</th>}
                    <th className="num">Gloire</th>
                  </tr>
                </thead>
                <tbody>
                  {rows.map((r) => (
                    <tr key={r.id} className={isMine(r) ? 'me' : ''}>
                      <td>
                        <span className={`rk-rank r${r.rank}`}>{r.rank}</span>
                      </td>
                      <td>{label(r)}</td>
                      <td className="num">{r.crusades}</td>
                      {kind === 'tribes' && <td className="num">{r.wins ?? 0}</td>}
                      <td className="num">
                        <b>{fmt(r.glory)}</b>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
            {data.me && !rows.some((r) => r.id === data.me!.id) && (
              <p className="small">
                Votre rang : <b>{data.me.rank}</b> · {fmt(data.me.glory)} de gloire
              </p>
            )}
          </>
        )}
      </Panel>
    </div>
  );
}
