import { useState } from 'react';
import {
  BUILDINGS,
  BUILDING_KEYS,
  BUILD_QUEUE_LIMIT,
  type BuildingKey,
  type Buildings,
  type VillageState,
  buildingCost,
  buildingTime,
  canAfford,
  hiddenResources,
  meetsRequirements,
  resourceProduction,
  warehouseCapacity,
  WALL_BONUS_PER_LEVEL,
} from '@aldoria/shared';
import { api } from '../api';
import { buildingImg, SPOT_WIDTH, VILLAGE_SPOTS as SPOTS, villageBg } from '../assets';
import { clockTime, duration, fmt } from '../format';
import { useGame, useNow, useRoute } from '../game';
import { Cost, Countdown, liveResources, Panel } from '../ui';


function effectiveLevels(v: VillageState): Buildings {
  const out = { ...v.buildings };
  for (const q of v.buildQueue) out[q.building] = Math.max(out[q.building], q.level);
  return out;
}

function effect(key: BuildingKey, level: number, speed: number): string {
  switch (key) {
    case 'townhall':
      return `Constructions ${Math.round((1 - Math.pow(0.95, Math.max(0, level - 1))) * 100)} % plus rapides`;
    case 'woodcutter':
    case 'claypit':
    case 'ironmine':
    case 'farm':
      return `${fmt(resourceProduction(level) * speed)} par heure`;
    case 'warehouse':
      return `Stocke ${fmt(warehouseCapacity(level))}, cache ${fmt(hiddenResources(level))}`;
    case 'barracks':
      return level ? `Recrutement ${Math.round((1 - Math.pow(0.94, level - 1)) * 100)} % plus rapide` : 'Pas encore construite';
    case 'wall':
      return `+${Math.round(level * WALL_BONUS_PER_LEVEL * 100)} % de défense`;
  }
}

function BuildingPanel({ v, k, onClose }: { v: VillageState; k: BuildingKey; onClose: () => void }) {
  const { world, setVillage, run } = useGame();
  const [, go] = useRoute();
  const now = useNow();
  const def = BUILDINGS[k];
  const levels = effectiveLevels(v);
  const current = v.buildings[k];
  const next = levels[k] + 1;
  const res = liveResources(v, now);
  const maxed = next > def.maxLevel;
  const cost = maxed ? null : buildingCost(k, next);
  const time = maxed ? 0 : buildingTime(k, next, levels.townhall, world.speed);
  const reqOk = meetsRequirements(levels, def.requires);
  const queueFull = v.buildQueue.length >= BUILD_QUEUE_LIMIT;
  const affordable = cost ? canAfford(res, cost) : false;

  const upgrade = () =>
    run(async () => {
      setVillage(await api(`/api/villages/${v.id}/build`, { body: { building: k } }));
    });

  return (
    <div className="building-panel">
      <img src={buildingImg(k, Math.max(current, 1))} alt="" width={96} height={96} />
      <div className="bp-body">
        <h3>
          {def.name} <span className="lvl">niveau {current}</span>
        </h3>
        <p className="muted">{def.description}</p>
        <p>
          <b>Actuellement :</b> {effect(k, current, world.speed)}
        </p>
        {maxed ? (
          <p className="ok">Niveau maximum atteint.</p>
        ) : (
          <>
            <p>
              <b>Niveau {next} :</b> {effect(k, next, world.speed)}
            </p>
            <div className="bp-cost">
              <Cost cost={cost!} have={res} />
              <span className="muted">⏱ {duration(time)}</span>
            </div>
            {!reqOk && (
              <p className="warn">
                Nécessite{' '}
                {Object.entries(def.requires)
                  .map(([rk, lvl]) => `${BUILDINGS[rk as BuildingKey].name} niveau ${lvl}`)
                  .join(', ')}
              </p>
            )}
            <div className="row">
              <button className="btn primary" disabled={!reqOk || queueFull || !affordable} onClick={upgrade}>
                {current === 0 && levels[k] === 0 ? 'Construire' : `Améliorer au niveau ${next}`}
              </button>
              {k === 'barracks' && current > 0 && (
                <button className="btn" onClick={() => go('caserne')}>
                  Recruter
                </button>
              )}
              <button className="btn ghost" onClick={onClose}>
                Fermer
              </button>
            </div>
            {queueFull && <p className="muted">La file de construction est pleine.</p>}
            {!affordable && reqOk && !queueFull && <p className="muted">Pas encore assez de ressources.</p>}
          </>
        )}
      </div>
    </div>
  );
}

export default function VillageView() {
  const { village: v, world, me, run, refreshMe } = useGame();
  const [selected, setSelected] = useState<BuildingKey | null>(null);
  const [renaming, setRenaming] = useState(false);
  const [name, setName] = useState('');
  if (!v) return <p className="muted">Chargement du village…</p>;
  const levels = effectiveLevels(v);
  const protectedUntil = me.player.protectionUntil && Date.parse(me.player.protectionUntil) > Date.now() ? me.player.protectionUntil : null;
  const enemyIncoming = v.incoming.filter((c) => c.type === 'attack');

  return (
    <div className="village">
      <div className="village-title">
        {renaming ? (
          <form
            onSubmit={(e) => {
              e.preventDefault();
              run(async () => {
                await api(`/api/villages/${v.id}/rename`, { body: { name } });
                setRenaming(false);
                await refreshMe();
              });
            }}
          >
            <input id="village-name" value={name} onChange={(e) => setName(e.target.value)} minLength={2} maxLength={32} autoFocus />
            <button className="btn small">Valider</button>
          </form>
        ) : (
          <h1>
            {v.name} <span className="muted">({v.x}|{v.y})</span>
            <button className="link" onClick={() => (setName(v.name), setRenaming(true))}>
              renommer
            </button>
          </h1>
        )}
        <div className="chips">
          <span className="chip">{fmt(v.points)} points</span>
          <span className={`chip ${v.loyalty < 100 ? 'chip-warn' : ''}`}>Loyauté {v.loyalty}</span>
          <span className="chip">Vitesse x{world.speed}</span>
          {protectedUntil && <span className="chip chip-ok">Protégé jusqu'au {clockTime(protectedUntil)}</span>}
        </div>
      </div>

      {enemyIncoming.length > 0 && (
        <div className="alert">
          ⚠ {enemyIncoming.length} attaque{enemyIncoming.length > 1 ? 's' : ''} en approche. Prochaine arrivée dans <Countdown to={enemyIncoming[0].arriveAt} />.
        </div>
      )}

      <div className="scene" style={{ backgroundImage: `url("${villageBg}")` }}>
        {BUILDING_KEYS.map((k) => (
          <button
            key={k}
            className={`spot ${selected === k ? 'selected' : ''} ${levels[k] > v.buildings[k] ? 'building' : ''}`}
            style={{ left: `${SPOTS[k].x}%`, top: `${SPOTS[k].y}%`, width: `${SPOT_WIDTH}%`, zIndex: Math.round(SPOTS[k].y) }}
            onClick={() => setSelected(selected === k ? null : k)}
            aria-label={`${BUILDINGS[k].name}, niveau ${v.buildings[k]}`}
          >
            <img src={buildingImg(k, v.buildings[k])} alt="" />
            <span className="spot-hit" />
            <span className="spot-label">
              {BUILDINGS[k].name} <b>{v.buildings[k]}</b>
            </span>
          </button>
        ))}
      </div>

      {selected && <BuildingPanel v={v} k={selected} onClose={() => setSelected(null)} />}

      <Panel title={`Constructions en cours (${v.buildQueue.length}/${BUILD_QUEUE_LIMIT})`}>
        {v.buildQueue.length === 0 ? (
          <p className="muted">Aucune construction. Touchez un bâtiment pour l'améliorer.</p>
        ) : (
          <ul className="queue">
            {v.buildQueue.map((q) => (
              <li key={q.id}>
                <img src={buildingImg(q.building, q.level)} alt="" width={36} height={36} />
                <span>
                  {BUILDINGS[q.building].name} → niveau {q.level}
                </span>
                <Countdown to={q.finishAt} />
              </li>
            ))}
          </ul>
        )}
      </Panel>

      <Panel title="Bâtiments">
        <ul className="building-list">
          {BUILDING_KEYS.map((k) => (
            <li key={k}>
              <button className="link-row" onClick={() => setSelected(k)}>
                <img src={buildingImg(k, v.buildings[k])} alt="" width={40} height={40} />
                <span>{BUILDINGS[k].name}</span>
                <span className="lvl">niv. {v.buildings[k]}</span>
                <span className="muted small">{effect(k, v.buildings[k], world.speed)}</span>
              </button>
            </li>
          ))}
        </ul>
      </Panel>
    </div>
  );
}
