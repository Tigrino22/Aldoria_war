import type { CommandView } from '@fiefs/shared';
import { api } from '../api';
import { clockTime } from '../format';
import { useGame } from '../game';
import { Countdown, Panel, UnitList } from '../ui';

const TYPE_LABEL = { attack: 'Attaque', support: 'Renfort', return: 'Retour' } as const;

function Movement({ c, direction }: { c: CommandView; direction: 'in' | 'out' }) {
  const other = direction === 'in' ? c.origin : c.target;
  const hostile = direction === 'in' && c.type === 'attack';
  return (
    <li className={`movement ${hostile ? 'hostile' : ''} type-${c.type}`}>
      <span className="mv-type">{TYPE_LABEL[c.type]}</span>
      <span>
        {direction === 'in' ? 'de' : 'vers'} <a href={`#/carte/${other.x},${other.y}`}>{other.name} ({other.x}|{other.y})</a>
        {other.ownerName && <span className="muted"> · {other.ownerName}</span>}
      </span>
      <UnitList units={c.units} empty="" />
      <span className="mv-time">
        <Countdown to={c.arriveAt} />
        <span className="muted small">{clockTime(c.arriveAt)}</span>
      </span>
    </li>
  );
}

export default function RallyPoint() {
  const { village: v, run, refreshVillage } = useGame();
  if (!v) return <p className="muted">Chargement…</p>;

  const recall = (stationedId: number, homeId: number) =>
    run(async () => {
      await api('/api/troops/recall', { body: { stationedId, homeId } });
      await refreshVillage();
    });

  return (
    <div className="stack">
      <Panel title="Troupes au village">
        <UnitList units={v.troopsHome} empty="Aucune troupe au village. Recrutez à la caserne." />
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
          <ul className="movements">{v.outgoing.map((c) => <Movement key={c.id} c={c} direction="out" />)}</ul>
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
                  {g.villageName} ({g.x}|{g.y}) {g.ownerName && <span className="muted">· {g.ownerName}</span>}
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
                  {g.villageName} ({g.x}|{g.y}) {g.ownerName && <span className="muted">· {g.ownerName}</span>}
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
    </div>
  );
}
