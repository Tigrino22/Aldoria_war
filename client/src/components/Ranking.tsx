import { useEffect, useState } from 'react';
import { api } from '../api';
import { fmt } from '../format';
import { useGame } from '../game';
import { Panel, PlayerLink } from '../ui';

export default function Ranking() {
  const { me, run } = useGame();
  const [tab, setTab] = useState<'players' | 'tribes'>('players');
  const [rows, setRows] = useState<any[]>([]);
  useEffect(() => {
    run(async () => setRows(await api(`/api/ranking/${tab}`)));
  }, [tab, run]);

  return (
    <Panel title="Classement">
      <div className="tabs" role="tablist">
        <button role="tab" aria-selected={tab === 'players'} onClick={() => setTab('players')}>Joueurs</button>
        <button role="tab" aria-selected={tab === 'tribes'} onClick={() => setTab('tribes')}>Tribus</button>
      </div>
      <div className="table-wrap">
        <table className="rank-table">
          <thead>
            {tab === 'players' ? (
              <tr><th>#</th><th>Joueur</th><th>Tribu</th><th>Villages</th><th>Points</th></tr>
            ) : (
              <tr><th>#</th><th>Tribu</th><th>Membres</th><th>Villages</th><th>Points</th></tr>
            )}
          </thead>
          <tbody>
            {rows.map((r) =>
              tab === 'players' ? (
                <tr key={r.id} className={r.id === me.player.id ? 'me' : ''}>
                  <td>{r.rank}</td><td><PlayerLink name={r.username} /></td><td>{r.tag ?? '–'}</td><td>{r.villages}</td><td>{fmt(r.points)}</td>
                </tr>
              ) : (
                <tr key={r.id} className={r.id === me.player.tribe?.id ? 'me' : ''}>
                  <td>{r.rank}</td><td><a href={`#/tribu/${r.id}`}>[{r.tag}] {r.name}</a></td><td>{r.members}</td><td>{r.villages}</td><td>{fmt(r.points)}</td>
                </tr>
              ),
            )}
          </tbody>
        </table>
      </div>
    </Panel>
  );
}
