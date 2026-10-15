import {
  BUILDINGS,
  BUILDING_KEYS,
  BUILD_QUEUE_LIMIT,
  RESOURCES,
  RESOURCE_NAMES,
  type BuildingKey,
  type Resources,
  type VillageState,
  buildingCost,
  buildingTime,
  canAfford,
  meetsRequirements,
} from '@aldoria/shared';
import { api } from '../api';
import { buildingImg } from '../assets';
import { clockTime, duration, fmt } from '../format';
import { useGame, useNow } from '../game';
import { CancelButton, Cost, Countdown, ResIcon, liveResources } from '../ui';
import { effect, effectiveLevels, queueProgress } from './buildingInfo';
import NobleLetters from './NobleLetters';
import { CardTitle, PageBanner } from './PageBanner';
import './townhall.css';

/** Moment où le village aura de quoi payer `cost` au rythme de production actuel ; null si c'est impossible (entrepôt trop petit ou production négative). */
function affordableAt(v: VillageState, res: Resources, cost: Resources, now: number): number | null {
  let wait = 0;
  for (const r of RESOURCES) {
    const missing = cost[r] - res[r];
    if (missing <= 0) continue;
    if (cost[r] > v.capacity || v.rates[r] <= 0) return null;
    wait = Math.max(wait, missing / v.rates[r]);
  }
  return now + wait * 3_600_000;
}

/** Page de l'hôtel de ville : tous les bâtiments du village d'un coup d'œil, avec coûts, durées, heure de disponibilité des ressources et amélioration directe. */
export default function TownHall({ v }: { v: VillageState }) {
  const { world, setVillage, run } = useGame();
  const now = useNow();
  const levels = effectiveLevels(v);
  const res = liveResources(v, now);
  const queueFull = v.buildQueue.length >= BUILD_QUEUE_LIMIT;

  const upgrade = (k: BuildingKey) => run(async () => setVillage(await api(`/api/villages/${v.id}/build`, { body: { building: k } })));

  const qp = queueProgress(v, now, world.speed);

  return (
    <div className="pg townhall">
      <PageBanner
        media={<img src={buildingImg('townhall', Math.max(v.buildings.townhall, 1))} alt="" width={96} height={96} />}
        kicker={`Hôtel de ville · niveau ${v.buildings.townhall}`}
        title={
          <>
            {v.name} <em>({v.x}|{v.y})</em>
          </>
        }
        lead={`${effect('townhall', v.buildings.townhall, world.speed)} · ${fmt(v.points)} points`}
        actions={<a className="btn small" href="#/village">← Retour au village</a>}
        statsClass="th-stats"
        stats={[
          ...RESOURCES.map((r) => ({
            value: (
              <span className={`th-res ${res[r] >= v.capacity ? 'full' : ''}`}>
                <ResIcon r={r} size={18} /> {fmt(Math.floor(res[r]))}
              </span>
            ),
            className: 'th-res-tile',
            label: `${RESOURCE_NAMES[r]} · ${v.rates[r] >= 0 ? '+' : ''}${fmt(v.rates[r])}/h`,
          })),
          { value: fmt(v.capacity), label: 'Entrepôt', tone: 'gold' as const },
        ]}
      />

      <section className="pg-card">
        <header className="pg-card-head">
          <CardTitle icon="hotel" count={`${v.buildQueue.length}/${BUILD_QUEUE_LIMIT}`}>
            Constructions en cours
          </CardTitle>
        </header>
        {v.buildQueue.length === 0 ? (
          <p className="muted small">Aucune construction : choisissez un bâtiment à améliorer ci-dessous.</p>
        ) : (
          <ul className="th-queue">
            {v.buildQueue.map((q, i) => (
              <li key={q.id}>
                <img src={buildingImg(q.building, q.level)} alt="" width={44} height={44} />
                <div className="th-q-body">
                  <div className="th-q-top">
                    <span>
                      {BUILDINGS[q.building].name} <span className="muted">→ niveau {q.level}</span>
                    </span>
                    <b>
                      <Countdown to={q.finishAt} />
                    </b>
                  </div>
                  <span className="pg-progress">
                    <i style={{ width: `${Math.round((qp[i] ?? 0) * 100)}%` }} />
                  </span>
                </div>
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

      <NobleLetters v={v} res={res} />

      <section className="pg-card">
        <header className="pg-card-head">
          <CardTitle icon="village" count={BUILDING_KEYS.length}>
            Bâtiments
          </CardTitle>
          {queueFull && <span className="muted small">La file de construction est pleine.</span>}
        </header>
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
            const readyAt = cost && !affordable ? affordableAt(v, res, cost, now) : null;
            const missing = Object.entries(def.requires)
              .filter(([rk, lvl]) => levels[rk as BuildingKey] < (lvl as number))
              .map(([rk, lvl]) => `${BUILDINGS[rk as BuildingKey].name} niv. ${lvl}`)
              .join(', ');
            return (
              <article key={k} className={`th-card ${building ? 'building' : ''} ${maxed ? 'maxed' : ''}`}>
                <div className="th-card-media">
                  <img src={buildingImg(k, Math.max(current, 1))} alt="" width={72} height={72} />
                  <span className="th-seal" title={`Niveau ${current}`}>
                    {current}
                  </span>
                </div>
                <div className="th-card-body">
                  <h4>
                    {def.name}
                    {building && <span className="th-up"> → {levels[k]}</span>}
                  </h4>
                  <p className="muted small">{effect(k, current, world.speed)}</p>
                  {maxed ? (
                    <p className="th-max small">Niveau maximum</p>
                  ) : (
                    <>
                      <p className="small th-next">
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
                      {reqOk && !affordable && (
                        <p className="muted small">
                          {readyAt === null ? 'Ressources indisponibles : entrepôt trop petit ou production insuffisante.' : <>Ressources disponibles {clockTime(new Date(readyAt))}</>}
                        </p>
                      )}
                    </>
                  )}
                </div>
              </article>
            );
          })}
        </div>
      </section>
    </div>
  );
}
