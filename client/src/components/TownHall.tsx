import { useEffect } from 'react';
import {
  BUILDINGS,
  BUILDING_KEYS,
  BUILD_QUEUE_LIMIT,
  RESOURCES,
  type BuildingKey,
  type VillageState,
  buildingCost,
  buildingTime,
  canAfford,
  meetsRequirements,
} from '@aldoria/shared';
import { api } from '../api';
import { buildingImg } from '../assets';
import { duration, fmt } from '../format';
import { useGame, useNow } from '../game';
import { CancelButton, Cost, Countdown, ResIcon, liveResources } from '../ui';
import { effect, effectiveLevels } from './buildingInfo';

/** Fenêtre de l'hôtel de ville : tous les bâtiments du village d'un coup d'œil, avec coûts, durées et amélioration directe. */
export default function TownHall({ v, onClose }: { v: VillageState; onClose: () => void }) {
  const { world, setVillage, run } = useGame();
  const now = useNow();
  const levels = effectiveLevels(v);
  const res = liveResources(v, now);
  const queueFull = v.buildQueue.length >= BUILD_QUEUE_LIMIT;

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => e.key === 'Escape' && onClose();
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [onClose]);

  const upgrade = (k: BuildingKey) => run(async () => setVillage(await api(`/api/villages/${v.id}/build`, { body: { building: k } })));

  return (
    <div className="modal-backdrop" onClick={onClose}>
      <div className="townhall" role="dialog" aria-modal="true" aria-label={`Hôtel de ville de ${v.name}`} onClick={(e) => e.stopPropagation()}>
        <header className="th-head">
          <img src={buildingImg('townhall', Math.max(v.buildings.townhall, 1))} alt="" width={84} height={84} />
          <div className="th-title">
            <h2>Hôtel de ville</h2>
            <p className="muted">
              {v.name} · niveau {v.buildings.townhall} · {effect('townhall', v.buildings.townhall, world.speed)} · {fmt(v.points)} points
            </p>
          </div>
          <button className="btn ghost" onClick={onClose} aria-label="Fermer">
            ✕
          </button>
        </header>

        <div className="th-stock">
          {RESOURCES.map((r) => (
            <span key={r} className={`inline-res ${res[r] >= v.capacity ? 'full' : ''}`} title={`${fmt(v.rates[r])} par heure`}>
              <ResIcon r={r} size={18} /> <b>{fmt(Math.floor(res[r]))}</b>
              <span className="muted small">/{fmt(v.capacity)}</span>
            </span>
          ))}
        </div>

        <section>
          <h3>
            Constructions en cours ({v.buildQueue.length}/{BUILD_QUEUE_LIMIT})
          </h3>
          {v.buildQueue.length === 0 ? (
            <p className="muted small">Aucune construction : choisissez un bâtiment à améliorer ci-dessous.</p>
          ) : (
            <ul className="queue">
              {v.buildQueue.map((q, i) => (
                <li key={q.id}>
                  <img src={buildingImg(q.building, q.level)} alt="" width={32} height={32} />
                  <span>
                    {BUILDINGS[q.building].name} → niveau {q.level}
                  </span>
                  <Countdown to={q.finishAt} />
                  {i === v.buildQueue.length - 1 && (
                    <CancelButton
                      since={q.queuedAt}
                      onCancel={() => run(async () => setVillage(await api(`/api/villages/${v.id}/build/${q.id}`, { method: 'DELETE' })))}
                    />
                  )}
                </li>
              ))}
            </ul>
          )}
        </section>

        <section>
          <h3>Bâtiments</h3>
          <div className="th-grid">
            {BUILDING_KEYS.map((k) => {
              const def = BUILDINGS[k];
              const current = v.buildings[k];
              const next = levels[k] + 1;
              const maxed = next > def.maxLevel;
              const cost = maxed ? null : buildingCost(k, next);
              const time = maxed ? 0 : buildingTime(k, next, levels.townhall, world.speed);
              const reqOk = meetsRequirements(levels, def.requires);
              const affordable = cost ? canAfford(res, cost) : false;
              const building = levels[k] > current;
              const missing = Object.entries(def.requires)
                .filter(([rk, lvl]) => levels[rk as BuildingKey] < (lvl as number))
                .map(([rk, lvl]) => `${BUILDINGS[rk as BuildingKey].name} niv. ${lvl}`)
                .join(', ');
              return (
                <article key={k} className={`th-card ${building ? 'building' : ''}`}>
                  <img src={buildingImg(k, Math.max(current, 1))} alt="" width={56} height={56} />
                  <div className="th-card-body">
                    <h4>
                      {def.name} <span className="lvl">niv. {current}</span>
                      {building && <span className="lvl"> → {levels[k]} ⚒</span>}
                    </h4>
                    <p className="muted small">{effect(k, current, world.speed)}</p>
                    {maxed ? (
                      <p className="ok small">Niveau maximum</p>
                    ) : (
                      <>
                        <p className="small">
                          <b>Niv. {next} :</b> {effect(k, next, world.speed)}
                        </p>
                        <div className="bp-cost">
                          <Cost cost={cost!} have={res} />
                          <span className="muted small">⏱ {duration(time)}</span>
                        </div>
                        {!reqOk && <p className="warn small">Nécessite {missing}</p>}
                        <button className="btn primary small" disabled={!reqOk || queueFull || !affordable} onClick={() => upgrade(k)}>
                          {levels[k] === 0 ? 'Construire' : `Améliorer au niveau ${next}`}
                        </button>
                        {reqOk && !affordable && !queueFull && <span className="muted small"> Ressources insuffisantes</span>}
                      </>
                    )}
                  </div>
                </article>
              );
            })}
          </div>
          {queueFull && <p className="muted small">La file de construction est pleine.</p>}
        </section>
      </div>
    </div>
  );
}
