import { useState } from 'react';
import {
  BUILDINGS,
  RESOURCES,
  UNITS,
  UNIT_KEYS,
  type BuildingKey,
  type UnitKey,
  meetsRequirements,
  recruitTime,
  resourceProduction,
  scaleResources,
} from '@aldoria/shared';
import { api } from '../api';
import { duration, fmt } from '../format';
import { useGame, useNow, useRoute } from '../game';
import { CancelButton, Cost, Countdown, liveResources, Panel, UnitIcon } from '../ui';

export default function Barracks() {
  const { village: v, world, setVillage, run } = useGame();
  const [, go] = useRoute();
  const now = useNow();
  const [counts, setCounts] = useState<Partial<Record<UnitKey, string>>>({});
  if (!v) return <p className="muted">Chargement…</p>;

  if (v.buildings.barracks === 0) {
    return (
      <Panel title="Caserne">
        <p>Vous n'avez pas encore de caserne. Construisez-la depuis la vue du village (hôtel de ville niveau 3 requis).</p>
        <button className="btn primary" onClick={() => go('village')}>
          Aller au village
        </button>
      </Panel>
    );
  }

  const res = liveResources(v, now);
  const freeWheat = resourceProduction(v.buildings.farm) - v.upkeep;

  const maxFor = (k: UnitKey) => {
    const def = UNITS[k];
    let max = Math.floor(freeWheat / def.upkeep);
    for (const r of RESOURCES) if (def.cost[r] > 0) max = Math.min(max, Math.floor(res[r] / def.cost[r]));
    return Math.max(0, max);
  };

  const recruit = (k: UnitKey) =>
    run(async () => {
      const count = Number(counts[k]);
      setVillage(await api(`/api/villages/${v.id}/recruit`, { body: { unit: k, count } }));
      setCounts((c) => ({ ...c, [k]: '' }));
    });

  return (
    <div className="stack">
      <Panel title={`Caserne (niveau ${v.buildings.barracks})`}>
        <p className="muted small">
          Blé disponible pour de nouvelles troupes : <b>{fmt(freeWheat)}</b> par heure (à vitesse x1). Améliorez la ferme pour nourrir une plus grande armée.
        </p>
        <div className="unit-cards">
          {UNIT_KEYS.map((k) => {
            const def = UNITS[k];
            const ok = meetsRequirements(v.buildings, def.requires);
            const n = Number(counts[k] || 0);
            const max = maxFor(k);
            return (
              <article key={k} className={`unit-card ${ok ? '' : 'locked'}`}>
                <header>
                  <UnitIcon unit={k} size={48} />
                  <div>
                    <h3>{def.name}</h3>
                    <p className="muted small">{def.description}</p>
                  </div>
                </header>
                <dl className="stats">
                  <div><dt>Attaque</dt><dd>{def.attack}</dd></div>
                  <div><dt>Déf. infanterie</dt><dd>{def.defenseInfantry}</dd></div>
                  <div><dt>Déf. cavalerie</dt><dd>{def.defenseCavalry}</dd></div>
                  <div><dt>Butin</dt><dd>{def.carry}</dd></div>
                  <div><dt>Vitesse</dt><dd>{duration((def.speed * 60) / world.speed)}/case</dd></div>
                  <div><dt>Entretien</dt><dd>{def.upkeep} blé/h</dd></div>
                </dl>
                <div className="row wrap">
                  <Cost cost={def.cost} have={res} />
                  <span className="muted small">⏱ {duration(recruitTime(k, v.buildings.barracks, world.speed))}</span>
                </div>
                {ok ? (
                  <div className="row">
                    <input
                      id={`recruit-${k}`}
                      type="number"
                      min={1}
                      max={max}
                      inputMode="numeric"
                      placeholder="Nombre"
                      value={counts[k] ?? ''}
                      onChange={(e) => setCounts((c) => ({ ...c, [k]: e.target.value }))}
                    />
                    <button className="btn small ghost" onClick={() => setCounts((c) => ({ ...c, [k]: String(max) }))}>
                      max {fmt(max)}
                    </button>
                    <button className="btn primary" disabled={n < 1 || n > max} onClick={() => recruit(k)}>
                      Recruter
                    </button>
                  </div>
                ) : (
                  <p className="warn small">
                    Nécessite{' '}
                    {Object.entries(def.requires)
                      .map(([rk, lvl]) => `${BUILDINGS[rk as BuildingKey].name} niveau ${lvl}`)
                      .join(', ')}
                  </p>
                )}
                {n > 0 && ok && (
                  <p className="muted small">
                    Total : <Cost cost={scaleResources(def.cost, n)} have={res} />
                  </p>
                )}
              </article>
            );
          })}
        </div>
      </Panel>

      <Panel title="Recrutement en cours">
        {v.recruitQueue.length === 0 ? (
          <p className="muted">Aucun recrutement en cours.</p>
        ) : (
          <ul className="queue">
            {v.recruitQueue.map((q, i) => {
              const end = Date.parse(q.startAt) + q.count * q.unitSeconds * 1000;
              const done = Math.min(q.count, Math.max(0, Math.floor((now - Date.parse(q.startAt)) / 1000 / q.unitSeconds)));
              return (
                <li key={q.id}>
                  <UnitIcon unit={q.unit} size={32} />
                  <span>
                    {UNITS[q.unit].name} : {done}/{q.count}
                  </span>
                  <progress max={q.count} value={done} />
                  <Countdown to={end} />
                  {i === v.recruitQueue.length - 1 && (
                    <CancelButton
                      since={q.queuedAt}
                      onCancel={() => run(async () => setVillage(await api(`/api/villages/${v.id}/recruit/${q.id}`, { method: 'DELETE' })))}
                    />
                  )}
                </li>
              );
            })}
          </ul>
        )}
      </Panel>
    </div>
  );
}
