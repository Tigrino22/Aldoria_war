import { useEffect, useState } from 'react';
import { api } from '../api';
import { fmt } from '../format';
import { useGame } from '../game';
import { Panel, PlayerLink } from '../ui';
import WarRankingView from './WarRanking';

export default function Ranking() {
  const { me, run } = useGame();
  const [tab, setTab] = useState<'players' | 'tribes' | 'war'>('players');
  const [type, setType] = useState<'points' | 'attack' | 'defense'>('points');
  const [rows, setRows] = useState<any[]>([]);
  useEffect(() => {
    if (tab !== 'war') run(async () => setRows(await api(`/api/ranking/${tab}?type=${type}`)));
  }, [tab, type, run]);
  const last = type === 'points' ? { label: 'Points', value: (r: any) => r.points } : type === 'attack' ? { label: 'Adversaires battus (attaque)', value: (r: any) => r.killsAttack } : { label: 'Adversaires battus (défense)', value: (r: any) => r.killsDefense };

  const tabs = (
    <div className="tabs" role="tablist">
      <button role="tab" aria-selected={tab === 'players'} onClick={() => setTab('players')}>Joueurs</button>
      <button role="tab" aria-selected={tab === 'tribes'} onClick={() => setTab('tribes')}>Tribus</button>
      <button role="tab" aria-selected={tab === 'war'} onClick={() => setTab('war')}>Guerre</button>
    </div>
  );
  if (tab === 'war') {
    return (
      <div className="stack">
        <Panel title="Classement">{tabs}</Panel>
        <WarRankingView />
      </div>
    );
  }

  return (
    <Panel title="Classement">
      {tabs}
      <div className="tabs" role="tablist" aria-label="Type de classement">
        <button role="tab" aria-selected={type === 'points'} onClick={() => setType('points')}>Points</button>
        <button role="tab" aria-selected={type === 'attack'} onClick={() => setType('attack')}>Attaque</button>
        <button role="tab" aria-selected={type === 'defense'} onClick={() => setType('defense')}>Défense</button>
      </div>
      <div className="table-wrap">
        <table className="rank-table">
          <thead>
            {tab === 'players' ? (
              <tr><th>#</th><th>Joueur</th><th>Tribu</th><th>Villages</th><th>{last.label}</th></tr>
            ) : (
              <tr><th>#</th><th>Tribu</th><th>Membres</th><th>Villages</th><th>{last.label}</th></tr>
            )}
          </thead>
          <tbody>
            {rows.map((r) =>
              tab === 'players' ? (
                <tr key={r.id} className={r.id === me.player.id ? 'me' : ''}>
                  <td>{r.rank}</td><td><PlayerLink name={r.username} /></td><td>{r.tag ?? '–'}</td><td>{r.villages}</td><td>{fmt(last.value(r))}</td>
                </tr>
              ) : (
                <tr key={r.id} className={r.id === me.player.tribe?.id ? 'me' : ''}>
                  <td>{r.rank}</td><td><a href={`#/tribu/${r.id}`}>[{r.tag}] {r.name}</a></td><td>{r.members}</td><td>{r.villages}</td><td>{fmt(last.value(r))}</td>
                </tr>
              ),
            )}
          </tbody>
        </table>
      </div>
    </Panel>
  );
}
