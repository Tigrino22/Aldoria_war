import { useEffect, useState } from 'react';
import { BUILDINGS, RESOURCES, RESOURCE_NAMES, totalUnits, type VillageState } from '@aldoria/shared';
import { api } from '../api';
import { fmt } from '../format';
import { useGame, useNow } from '../game';
import { Countdown, Panel, ResIcon, UnitList, liveResources } from '../ui';

export default function Overview() {
  const { me, run, setVillageId, villageId } = useGame();
  const now = useNow();
  const [villages, setVillages] = useState<VillageState[] | null>(null);

  useEffect(() => {
    run(async () => setVillages(await api<VillageState[]>('/api/overview')));
    const t = setInterval(() => run(async () => setVillages(await api<VillageState[]>('/api/overview'))), 30_000);
    return () => clearInterval(t);
  }, [run, me.villages.length]);

  if (!villages) return <p className="muted">Chargement…</p>;

  const total = RESOURCES.map((r) => villages.reduce((sum, v) => sum + liveResources(v, now)[r], 0));
  const open = (id: number, page: string) => {
    setVillageId(id);
    location.hash = `#/${page}`;
  };

  return (
    <div className="stack">
      <Panel title={`Vue d'ensemble (${villages.length} village${villages.length > 1 ? 's' : ''})`}>
        <p className="muted small">
          Total en stock :{' '}
          {RESOURCES.map((r, i) => (
            <span key={r} className="inline-res">
              <ResIcon r={r} size={16} /> {fmt(Math.floor(total[i]))}{' '}
            </span>
          ))}
        </p>
      </Panel>
      {villages.map((v) => {
        const res = liveResources(v, now);
        const attacks = v.incoming.filter((c) => c.type === 'attack');
        const next = v.buildQueue[0];
        return (
          <Panel
            key={v.id}
            title={`${v.name} (${v.x}|${v.y})${v.id === villageId ? ' · actif' : ''}`}
            actions={
              <div className="row">
                <button className="btn small" onClick={() => open(v.id, 'village')}>Village</button>
                <button className="btn small" onClick={() => open(v.id, 'caserne')}>Caserne</button>
                <button className="btn small" onClick={() => open(v.id, 'troupes')}>Troupes</button>
              </div>
            }
          >
            {attacks.length > 0 && (
              <p className="warn">
                {attacks.length} attaque{attacks.length > 1 ? 's' : ''} en approche : la première arrive dans <Countdown to={attacks[0].arriveAt} />
              </p>
            )}
            <p>
              {RESOURCES.map((r) => (
                <span key={r} className={`inline-res ${res[r] >= v.capacity ? 'full' : ''}`} title={RESOURCE_NAMES[r]}>
                  <ResIcon r={r} size={16} /> {fmt(Math.floor(res[r]))}/{fmt(v.capacity)}{' '}
                </span>
              ))}
            </p>
            <p className="muted small">
              {fmt(v.points)} points · loyauté {v.loyalty} %
              {v.market.merchants > 0 && ` · marchands ${v.market.available}/${v.market.merchants}`}
            </p>
            <p>
              <b>Construction :</b>{' '}
              {next ? (
                <>
                  {BUILDINGS[next.building].name} → niveau {next.level} <Countdown to={next.finishAt} />
                  {v.buildQueue.length > 1 && <span className="muted"> (+{v.buildQueue.length - 1} en file)</span>}
                </>
              ) : (
                <span className="muted">file vide</span>
              )}
            </p>
            <p>
              <b>Recrutement :</b>{' '}
              {v.recruitQueue.length ? (
                <>
                  {v.recruitQueue.length} commande{v.recruitQueue.length > 1 ? 's' : ''} en cours
                </>
              ) : (
                <span className="muted">aucun</span>
              )}
            </p>
            <p>
              <b>Troupes ({fmt(totalUnits(v.troopsHome))}) :</b> <UnitList units={v.troopsHome} />
            </p>
          </Panel>
        );
      })}
    </div>
  );
}
