import { useState } from 'react';
import {
  BUILDINGS,
  RESOURCES,
  UNITS,
  UNIT_KEYS,
  type BuildingKey,
  type UnitCounts,
  type UnitKey,
  emptyUnits,
  meetsRequirements,
  lettersForNobles,
  noblesAffordable,
  recruitTime,
  scaleResources,
} from '@aldoria/shared';
import { api } from '../api';
import { duration, fmt } from '../format';
import { awayTroops } from '../troops';
import { useGame, useNow, useRoute } from '../game';
import { buildingImg } from '../assets';
import { CancelButton, Cost, Countdown, liveResources, UnitIcon } from '../ui';
import { effect } from './buildingInfo';
import { CardTitle, PageBanner } from './PageBanner';
import './barracks.css';

export default function Barracks() {
  const { village: v, world, setVillage, run } = useGame();
  const [, go] = useRoute();
  const now = useNow();
  const [counts, setCounts] = useState<Partial<Record<UnitKey, string>>>({});
  if (!v) return <p className="muted">Chargement…</p>;

  if (v.buildings.barracks === 0) {
    return (
      <div className="pg barracks">
        <PageBanner
          icon="caserne"
          kicker="Armée"
          title="Caserne"
          lead="Vous n'avez pas encore de caserne. Construisez-la depuis la vue du village (hôtel de ville niveau 3 requis)."
          actions={
            <button className="btn primary" onClick={() => go('village')}>
              Aller au village
            </button>
          }
        />
      </div>
    );
  }

  const res = liveResources(v, now);
  const freePopulation = Math.max(0, v.populationMax - v.population);

  const maxFor = (k: UnitKey) => {
    const def = UNITS[k];
    let max = Math.floor(freePopulation / def.population);
    for (const r of RESOURCES) if (def.cost[r] > 0) max = Math.min(max, Math.floor(res[r] / def.cost[r]));
    if (k === 'noble' && v.nobility.enabled) max = Math.min(max, noblesAffordable(v.nobility.villages, v.nobility.nobles, v.nobility.letters, v.nobility.step));
    return Math.max(0, max);
  };

  // Effectifs du village : présents, en formation, et partis (attaque, renfort en route, retour, stationnés ailleurs).
  const training = emptyUnits();
  for (const q of v.recruitQueue) training[q.unit] += q.count - q.delivered;
  const away = awayTroops(v);
  const total = (k: UnitKey) => v.troopsHome[k] + training[k] + away[k];
  const owned = UNIT_KEYS.filter((k) => total(k) > 0);

  const recruit = (k: UnitKey) =>
    run(async () => {
      const count = Number(counts[k]);
      setVillage(await api(`/api/villages/${v.id}/recruit`, { body: { unit: k, count } }));
      setCounts((c) => ({ ...c, [k]: '' }));
    });

  const inTraining = v.recruitQueue.reduce((n, q) => n + q.count - q.delivered, 0);
  const homeTotal = UNIT_KEYS.reduce((n, k) => n + v.troopsHome[k], 0);
  const awayTotal = UNIT_KEYS.reduce((n, k) => n + away[k], 0);

  return (
    <div className="pg barracks">
      <PageBanner
        media={<img src={buildingImg('barracks', v.buildings.barracks)} alt="" width={96} height={96} />}
        kicker={`Armée · caserne niveau ${v.buildings.barracks}`}
        title="Caserne"
        lead={
          <>
            {effect('barracks', v.buildings.barracks, world.speed)}. Les recrues en formation et les troupes parties au combat comptent dans la population. Améliorez la ferme pour loger une plus grande armée.
          </>
        }
        stats={[
          { value: freePopulation, label: 'places libres', tone: 'gold' },
          { value: `${fmt(v.population)} / ${fmt(v.populationMax)}`, label: 'population' },
          { value: homeTotal, label: 'au village' },
          { value: inTraining, label: 'en formation' },
          { value: awayTotal, label: 'hors du village' },
        ]}
      />

      <section className="pg-card">
        <header className="pg-card-head">
          <CardTitle icon="caserne" count={v.recruitQueue.length || undefined}>
            Recrutement en cours
          </CardTitle>
        </header>
        {v.recruitQueue.length === 0 ? (
          <p className="muted small">Aucun recrutement en cours : choisissez une unité ci-dessous.</p>
        ) : (
          <ul className="bk-queue">
            {v.recruitQueue.map((q, i) => {
              const end = Date.parse(q.startAt) + q.count * q.unitSeconds * 1000;
              const done = Math.min(q.count, Math.max(0, Math.floor((now - Date.parse(q.startAt)) / 1000 / q.unitSeconds)));
              return (
                <li key={q.id}>
                  <span className="bk-q-medal">
                    <UnitIcon unit={q.unit} size={36} />
                  </span>
                  <div className="bk-q-body">
                    <div className="bk-q-top">
                      <span>
                        {UNITS[q.unit].name} <span className="muted">{done}/{q.count}</span>
                      </span>
                      <b>
                        <Countdown to={end} />
                      </b>
                    </div>
                    <span className="pg-progress" role="progressbar" aria-valuemin={0} aria-valuemax={q.count} aria-valuenow={done}>
                      <i style={{ width: `${Math.round((done / Math.max(1, q.count)) * 100)}%` }} />
                    </span>
                  </div>
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
      </section>

      <section className="pg-card">
        <header className="pg-card-head">
          <CardTitle icon="troupes">Troupes du village</CardTitle>
        </header>
        {owned.length ? (
          <div className="table-wrap">
            <table className="troop-table barracks-troops">
              <thead>
                <tr>
                  <th>Unité</th>
                  <th>Au village</th>
                  <th>En formation</th>
                  <th title="En attaque, en renfort ou sur le chemin du retour">Dehors</th>
                  <th>Total</th>
                </tr>
              </thead>
              <tbody>
                {owned.map((k) => (
                  <tr key={k}>
                    <td>
                      <span className="row nowrap" title={UNITS[k].name}>
                        <UnitIcon unit={k} size={24} /> <span className="unit-name">{UNITS[k].name}</span>
                      </span>
                    </td>
                    <td>
                      <b>{fmt(v.troopsHome[k])}</b>
                    </td>
                    <td className={training[k] ? '' : 'muted'}>{fmt(training[k])}</td>
                    <td className={away[k] ? '' : 'muted'}>{fmt(away[k])}</td>
                    <td>{fmt(total(k))}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        ) : (
          <p className="muted">Le village n'a encore aucune troupe.</p>
        )}
      </section>

      <section className="pg-card">
        <header className="pg-card-head">
          <CardTitle icon="caserne">Recruter</CardTitle>
        </header>
        <div className="unit-cards">
          {UNIT_KEYS.map((k) => {
            const def = UNITS[k];
            const ok = meetsRequirements(v.buildings, def.requires);
            const n = Number(counts[k] || 0);
            const max = maxFor(k);
            return (
              <article key={k} className={`unit-card ${ok ? '' : 'locked'}`}>
                <header>
                  <span className="bk-medal">
                    <UnitIcon unit={k} size={52} />
                  </span>
                  <div>
                    <h3>{def.name}</h3>
                    <p className="muted small">{def.description}</p>
                  </div>
                  <div className="unit-owned" title="Troupes présentes au village">
                    <b>{fmt(v.troopsHome[k])}</b>
                    <span>au village</span>
                  </div>
                </header>
                {(training[k] > 0 || away[k] > 0) && (
                  <p className="muted small unit-owned-more">
                    {training[k] > 0 && <>+{fmt(training[k])} en formation</>}
                    {training[k] > 0 && away[k] > 0 && ' · '}
                    {away[k] > 0 && <>{fmt(away[k])} hors du village</>}
                  </p>
                )}
                <dl className="stats">
                  <div><dt>Attaque</dt><dd>{def.attack}</dd></div>
                  <div><dt>Déf. infanterie</dt><dd>{def.defenseInfantry}</dd></div>
                  <div><dt>Déf. cavalerie</dt><dd>{def.defenseCavalry}</dd></div>
                  <div><dt>Butin</dt><dd>{def.carry}</dd></div>
                  <div><dt>Vitesse</dt><dd>{duration((def.speed * 60) / world.speed)}/case</dd></div>
                  <div><dt>Population</dt><dd>{def.population}</dd></div>
                </dl>
                <div className="row wrap">
                  <Cost cost={def.cost} have={res} />
                  <span className="muted small">⏱ {duration(recruitTime(k, v.buildings.barracks, world.speed) / (1 + (v.recruitBonus ?? 0)))}</span>
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
                {k === 'noble' && v.nobility.enabled && (
                  <p className={`small ${v.nobility.letters >= v.nobility.next ? 'muted' : 'warn'}`}>
                    Demande aussi {n > 1 ? lettersForNobles(v.nobility.villages, v.nobility.nobles, n, v.nobility.step) : v.nobility.next} lettre
                    {(n > 1 || v.nobility.next > 1) && 's'} de noblesse (vous en avez {fmt(v.nobility.letters)}) :{' '}
                    <a href="#/hotel">les frapper à l’hôtel de ville</a>
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
      </section>
    </div>
  );
}
