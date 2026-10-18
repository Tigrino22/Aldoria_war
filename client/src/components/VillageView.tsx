import { useState } from 'react';
import './village.css';
import {
  BUILDINGS,
  BUILDING_KEYS,
  BUILD_QUEUE_LIMIT,
  type BuildingKey,
  type VillageState,
  buildingCost,
  buildingTime,
  canAfford,
  meetsRequirements,
} from '@aldoria/shared';
import { api } from '../api';
import { buildingImg, SPOT_WIDTH, VILLAGE_SPOTS as SPOTS, villageBg, wallRingImg } from '../assets';
import { clockTime, duration, fmt } from '../format';
import { useGame, useNow, useRoute } from '../game';
import { NavIcon } from './NavIcon';
import { CancelButton, Cost, Countdown, liveResources } from '../ui';
import Quests from './Quests';
import { effect, effectiveLevels, queueProgress } from './buildingInfo';


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
          </>
        )}
        {/* Les raccourcis (Recruter, Envoyer des ressources) restent là même au niveau maximum. */}
        <div className="row">
          {!maxed && (
            <button className="btn primary" disabled={!reqOk || queueFull || !affordable} onClick={upgrade}>
              {current === 0 && levels[k] === 0 ? 'Construire' : `Améliorer au niveau ${next}`}
            </button>
          )}
          {k === 'market' && current > 0 && (
            <button className="btn" onClick={() => go('marche')}>
              Envoyer des ressources
            </button>
          )}
          {k === 'barracks' && current > 0 && (
            <button className="btn" onClick={() => go('caserne')}>
              Recruter
            </button>
          )}
          <button className="btn ghost" onClick={onClose}>
            Fermer
          </button>
        </div>
        {!maxed && queueFull && <p className="muted">La file de construction est pleine.</p>}
        {!maxed && !affordable && reqOk && !queueFull && <p className="muted">Pas encore assez de ressources.</p>}
      </div>
    </div>
  );
}

import IncomingDetail from './IncomingDetail';
import { CrusadeBanner } from './CrusadeBanner';

/** Bas de l'étiquette sous le centre d'un emplacement, en % de la hauteur du décor (emplacement carré, décor en 800 × 560). */
const LABEL_DY = SPOT_WIDTH * (800 / 560) * (0.5 - 0.12);

function Scene({
  v,
  selected,
  onPick,
  progress,
  children,
}: {
  v: VillageState;
  selected: BuildingKey | null;
  onPick: (k: BuildingKey) => void;
  progress: Partial<Record<BuildingKey, number>>;
  children?: React.ReactNode;
}) {
  const levels = effectiveLevels(v);
  return (
    <div className="scene" style={{ backgroundImage: `url("${villageBg}")` }}>
      {v.buildings.wall > 0 && (
        <>
          <img className="ring" src={wallRingImg(v.buildings.wall, 'back')!} alt="" style={{ zIndex: 0 }} />
          {/* L'avant de l'enceinte passe devant les bâtiments, mais sous la porte. */}
          <img className="ring" src={wallRingImg(v.buildings.wall, 'front')!} alt="" style={{ zIndex: Math.round(SPOTS.wall.y) - 1 }} />
        </>
      )}
      {BUILDING_KEYS.map((k) => {
        const working = levels[k] > v.buildings[k];
        return (
          <button
            key={k}
            className={`spot ${selected === k ? 'selected' : ''} ${working ? 'building' : ''}`}
            style={{ left: `${SPOTS[k].x}%`, top: `${SPOTS[k].y}%`, width: `${SPOT_WIDTH}%`, zIndex: Math.round(SPOTS[k].y) }}
            onClick={() => onPick(k)}
            aria-label={`${BUILDINGS[k].name}, niveau ${v.buildings[k]}`}
          >
            <img src={buildingImg(k, v.buildings[k])} alt="" />
            <span className="spot-hit" />
          </button>
        );
      })}
      {/* Étiquettes sur leur propre calque : jamais cachées par une tour ou un bâtiment voisin. */}
      <div className="spot-labels">
          {BUILDING_KEYS.map((k) => {
            const working = levels[k] > v.buildings[k];
            return (
              <button
                key={k}
                tabIndex={-1}
                aria-hidden
                className={`spot-label ${selected === k ? 'selected' : ''} ${working ? 'building' : ''}`}
                style={{ left: `${SPOTS[k].x}%`, top: `${SPOTS[k].y + LABEL_DY}%` }}
                onClick={() => onPick(k)}
              >
                <b>{v.buildings[k]}</b>
                <span className="spot-name">{BUILDINGS[k].name}</span>
                {working && (
                  <span className="spot-bar">
                    <i style={{ width: `${Math.round((progress[k] ?? 0) * 100)}%` }} />
                  </span>
                )}
              </button>
            );
          })}
      </div>
      {children}
    </div>
  );
}

/** File de construction avec barres d'avancement (styles proposés). */
function QueueCard({ v, progress, className = '' }: { v: VillageState; progress: number[]; className?: string }) {
  const { run, setVillage } = useGame();
  return (
    <section className={`vv-card vv-queue ${className}`}>
      <header className="vv-card-head">
        <h2 className="vv-h">
          <NavIcon name="hotel" size={16} /> Constructions
        </h2>
        <span className="vv-count">
          {v.buildQueue.length}/{BUILD_QUEUE_LIMIT}
        </span>
      </header>
      {v.buildQueue.length === 0 ? (
        <p className="muted">Aucune construction. Touchez un bâtiment pour l'améliorer.</p>
      ) : (
        <ul className="vv-queue-list">
          {v.buildQueue.map((q, i) => (
            <li key={q.id}>
              <img src={buildingImg(q.building, q.level)} alt="" width={44} height={44} />
              <div className="vv-q-body">
                <div className="vv-q-top">
                  <span>
                    {BUILDINGS[q.building].name} <span className="vv-q-lvl">→ niveau {q.level}</span>
                  </span>
                  <b>
                    <Countdown to={q.finishAt} />
                  </b>
                </div>
                <div className="vv-progress">
                  <i style={{ width: `${Math.round((progress[i] ?? 0) * 100)}%` }} />
                </div>
                {i === v.buildQueue.length - 1 && (
                  <CancelButton
                    since={q.queuedAt}
                    onCancel={() => run(async () => setVillage(await api(`/api/villages/${v.id}/build/${q.id}`, { method: 'DELETE' })))}
                  />
                )}
              </div>
            </li>
          ))}
        </ul>
      )}
    </section>
  );
}

/** Liste compacte des bâtiments en tuiles (styles proposés). */
function BuildingTiles({ v, onPick, selected }: { v: VillageState; onPick: (k: BuildingKey) => void; selected: BuildingKey | null }) {
  const { world } = useGame();
  const levels = effectiveLevels(v);
  return (
    <section className="vv-card">
      <header className="vv-card-head">
        <h2 className="vv-h">
          <NavIcon name="village" size={16} /> Bâtiments
        </h2>
      </header>
      <ul className="vv-tiles">
        {BUILDING_KEYS.map((k) => (
          <li key={k}>
            <button className={`vv-tile ${selected === k ? 'on' : ''}`} onClick={() => onPick(k)} title={effect(k, v.buildings[k], world.speed)}>
              <img src={buildingImg(k, v.buildings[k])} alt="" width={48} height={48} />
              <span className="vv-tile-name">{BUILDINGS[k].name}</span>
              <span className="vv-tile-lvl">
                {v.buildings[k]}
                {levels[k] > v.buildings[k] && <em> → {levels[k]}</em>}
              </span>
              <span className="vv-tile-fx">{effect(k, v.buildings[k], world.speed)}</span>
            </button>
          </li>
        ))}
      </ul>
    </section>
  );
}

export default function VillageView() {
  const { village: v, world, me, run, refreshMe } = useGame();
  const [, go] = useRoute();
  const now = useNow();
  const [selected, setSelected] = useState<BuildingKey | null>(null);
  const [renaming, setRenaming] = useState(false);
  const [name, setName] = useState('');
  if (!v) return <p className="muted">Chargement du village…</p>;
  const protectedUntil = me.player.protectionUntil && Date.parse(me.player.protectionUntil) > Date.now() ? me.player.protectionUntil : null;
  const enemyIncoming = v.incoming.filter((c) => c.type === 'attack');
  const pick = (k: BuildingKey) => (k === 'townhall' ? go('hotel') : setSelected(selected === k ? null : k));
  const qp = queueProgress(v, now, world.speed);
  const progress: Partial<Record<BuildingKey, number>> = {};
  v.buildQueue.forEach((q, i) => {
    if (!(q.building in progress)) progress[q.building] = qp[i];
  });
  const tribe = me.player.tribe;

  return (
    <div className="village vv">
      <div className="vv-stage">
        <Scene v={v} selected={selected} onPick={pick} progress={progress}>
          <span className="vv-light" aria-hidden />
          <span className="vv-clouds" aria-hidden />
        </Scene>
        <div className="vv-hud">
          <div className="vv-plaque">
            <span className="vv-kicker">
              Village de {me.player.username}
              {tribe && (
                <>
                  {' '}
                  · <span className="vv-tag">[{tribe.tag}]</span> {tribe.name}
                </>
              )}
            </span>
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
              <h1 className="vv-name">
                {v.name} <span className="vv-coords">({v.x}|{v.y})</span>
                <button className="link" onClick={() => (setName(v.name), setRenaming(true))}>
                  renommer
                </button>
              </h1>
            )}
            <div className="vv-pills">
              <span className="vv-pill">{fmt(v.points)} points</span>
              <span className={`vv-pill ${v.loyalty < 100 ? 'warn' : ''}`}>Loyauté {Math.round(v.loyalty)}</span>
              <span className="vv-pill">Vitesse x{world.speed}</span>
              {protectedUntil && <span className="vv-pill ok">Protégé jusqu'au {clockTime(protectedUntil)}</span>}
              {(v.relicBonus ?? 0) > 0 && (
                <span className="vv-pill gold" title="Votre camp a remporté une croisade : la relique augmente la production de vos villages">
                  Relique +{Math.round((v.relicBonus ?? 0) * 100)} %
                </span>
              )}
              {provinceChips(v).map((c) => (
                <a key={c} className="vv-pill gold" href="#/provinces" title="Bonus des provinces que contrôle votre tribu">
                  {c}
                </a>
              ))}
            </div>
          </div>
          <CrusadeBanner className="vv-crusade" />
          {enemyIncoming.length > 0 && (
            <div className="vv-war" role="alert">
              <span className="vv-war-icon">
                <NavIcon name="guerres" size={18} />
              </span>
              <span>
                <b>
                  {enemyIncoming.length} attaque{enemyIncoming.length > 1 ? 's' : ''} en approche
                </b>
                <span className="vv-war-sub">
                  Prochaine arrivée dans <Countdown to={enemyIncoming[0].arriveAt} /> · <a href="#/attaques">Tout voir</a>
                </span>
              </span>
            </div>
          )}
        </div>
        <QueueCard v={v} progress={qp} className="vv-hud-queue" />
      </div>
      <IncomingDetail incoming={v.incoming} />
      {selected && <BuildingPanel v={v} k={selected} onClose={() => setSelected(null)} />}
      <Quests />
      <BuildingTiles v={v} onPick={setSelected} selected={selected} />
    </div>
  );
}

/** Bonus des provinces contrôlées par la tribu, en pastilles : « Bois +10 % », « Recrutement +10 % ». */
function provinceChips(v: { provinceBonus?: Record<'wood' | 'clay' | 'iron' | 'wheat', number>; recruitBonus?: number; speedBonus?: number }): string[] {
  const out: string[] = [];
  const labels = { wood: 'Bois', clay: 'Argile', iron: 'Fer', wheat: 'Blé' } as const;
  for (const r of ['wood', 'clay', 'iron', 'wheat'] as const) {
    const b = v.provinceBonus?.[r] ?? 0;
    if (b > 0) out.push(`${labels[r]} +${Math.round(b * 100)} %`);
  }
  if ((v.recruitBonus ?? 0) > 0) out.push(`Recrutement +${Math.round((v.recruitBonus ?? 0) * 100)} %`);
  if ((v.speedBonus ?? 0) > 0) out.push(`Vitesse des troupes +${Math.round((v.speedBonus ?? 0) * 100)} %`);
  return out;
}
