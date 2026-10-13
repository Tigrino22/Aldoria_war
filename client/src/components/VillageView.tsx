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
import TribeCrest from './TribeCrest';
import { CancelButton, Cost, Countdown, liveResources, Panel } from '../ui';
import Quests from './Quests';
import { effect, effectiveLevels } from './buildingInfo';


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
            {queueFull && <p className="muted">La file de construction est pleine.</p>}
            {!affordable && reqOk && !queueFull && <p className="muted">Pas encore assez de ressources.</p>}
          </>
        )}
      </div>
    </div>
  );
}

import IncomingDetail from './IncomingDetail';

/**
 * Propositions de style pour la vue du village (à départager, puis on ne garde que la retenue).
 * Le décor et les bâtiments ne changent pas : seuls le cadre, la lumière, les étiquettes et les panneaux autour.
 */
type VillageStyle = 'actuel' | 'blason' | 'doree' | 'etatmajor';
const STYLES: { key: VillageStyle; name: string }[] = [
  { key: 'actuel', name: 'Actuel' },
  { key: 'blason', name: 'A · Blason' },
  { key: 'doree', name: 'B · Heure dorée' },
  { key: 'etatmajor', name: 'C · État-major' },
];
const STYLE_KEY = 'aldoria.villageStyle';
function readStyle(): VillageStyle {
  try {
    const s = localStorage.getItem(STYLE_KEY);
    return STYLES.some((x) => x.key === s) ? (s as VillageStyle) : 'actuel';
  } catch {
    return 'actuel';
  }
}

/** Avancement (0 à 1) de chaque construction de la file : la première a commencé à son arrivée en tête, les suivantes à la fin de la précédente. */
function queueProgress(v: VillageState, now: number, speed: number): number[] {
  let prevEnd = 0;
  return v.buildQueue.map((q, i) => {
    const end = Date.parse(q.finishAt);
    const start =
      i === 0 ? Math.max(Date.parse(q.queuedAt), end - buildingTime(q.building, q.level, v.buildings.townhall, speed) * 1000) : Math.max(prevEnd, Date.parse(q.queuedAt));
    prevEnd = end;
    if (now <= start) return 0;
    return Math.min(1, (now - start) / Math.max(1, end - start));
  });
}

/** Bas de l'étiquette sous le centre d'un emplacement, en % de la hauteur du décor (emplacement carré, décor en 800 × 560). */
const LABEL_DY = SPOT_WIDTH * (800 / 560) * (0.5 - 0.12);

function Scene({
  v,
  selected,
  onPick,
  progress,
  fancy,
  children,
}: {
  v: VillageState;
  selected: BuildingKey | null;
  onPick: (k: BuildingKey) => void;
  progress: Partial<Record<BuildingKey, number>>;
  fancy: boolean;
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
            {!fancy && (
              <span className="spot-label">
                {BUILDINGS[k].name} <b>{v.buildings[k]}</b>
              </span>
            )}
          </button>
        );
      })}
      {fancy && (
        // Étiquettes sur leur propre calque : jamais cachées par une tour ou un bâtiment voisin.
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
      )}
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
            <button className={`vv-tile ${selected === k ? 'on' : ''}`} onClick={() => onPick(k)}>
              <img src={buildingImg(k, v.buildings[k])} alt="" width={48} height={48} />
              <span className="vv-tile-name">{BUILDINGS[k].name}</span>
              <span className="vv-tile-lvl">
                {v.buildings[k]}
                {levels[k] > v.buildings[k] && <em> → {levels[k]}</em>}
              </span>
            </button>
          </li>
        ))}
      </ul>
    </section>
  );
}

/** Sélecteur provisoire des propositions (retiré une fois le style choisi). */
function StylePicker({ value, onChange }: { value: VillageStyle; onChange: (s: VillageStyle) => void }) {
  return (
    <div className="vv-picker" role="radiogroup" aria-label="Style de la vue du village (essai)">
      <span>Style (essai)</span>
      {STYLES.map((s) => (
        <button key={s.key} role="radio" aria-checked={value === s.key} className={value === s.key ? 'on' : ''} onClick={() => onChange(s.key)}>
          {s.name}
        </button>
      ))}
    </div>
  );
}

export default function VillageView() {
  const { village: v, world, me, run, refreshMe, setVillage } = useGame();
  const [, go] = useRoute();
  const now = useNow();
  const [selected, setSelected] = useState<BuildingKey | null>(null);
  const [renaming, setRenaming] = useState(false);
  const [name, setName] = useState('');
  const [style, setStyleState] = useState<VillageStyle>(readStyle);
  if (!v) return <p className="muted">Chargement du village…</p>;
  const setStyle = (s: VillageStyle) => {
    setStyleState(s);
    try {
      localStorage.setItem(STYLE_KEY, s);
    } catch {
      /* stockage indisponible : le choix vaut pour la session */
    }
  };
  const levels = effectiveLevels(v);
  const protectedUntil = me.player.protectionUntil && Date.parse(me.player.protectionUntil) > Date.now() ? me.player.protectionUntil : null;
  const enemyIncoming = v.incoming.filter((c) => c.type === 'attack');
  const pick = (k: BuildingKey) => (k === 'townhall' ? go('hotel') : setSelected(selected === k ? null : k));
  const qp = queueProgress(v, now, world.speed);
  const progress: Partial<Record<BuildingKey, number>> = {};
  v.buildQueue.forEach((q, i) => {
    if (!(q.building in progress)) progress[q.building] = qp[i];
  });

  const renameForm = (
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
  );
  const renameBtn = (
    <button className="link" onClick={() => (setName(v.name), setRenaming(true))}>
      renommer
    </button>
  );
  const alert = enemyIncoming.length > 0 && (
    <div className="alert">
      ⚠ {enemyIncoming.length} attaque{enemyIncoming.length > 1 ? 's' : ''} en approche. Prochaine arrivée dans <Countdown to={enemyIncoming[0].arriveAt} />.
    </div>
  );
  const panel = selected && <BuildingPanel v={v} k={selected} onClose={() => setSelected(null)} />;
  const picker = <StylePicker value={style} onChange={setStyle} />;

  if (style === 'actuel')
    return (
      <div className="village">
        <div className="village-title">
          {renaming ? (
            renameForm
          ) : (
            <h1>
              {v.name} <span className="muted">({v.x}|{v.y})</span>
              {renameBtn}
            </h1>
          )}
          <div className="chips">
            <span className="chip">{fmt(v.points)} points</span>
            <span className={`chip ${v.loyalty < 100 ? 'chip-warn' : ''}`}>Loyauté {v.loyalty}</span>
            <span className="chip">Vitesse x{world.speed}</span>
            {protectedUntil && <span className="chip chip-ok">Protégé jusqu'au {clockTime(protectedUntil)}</span>}
          </div>
        </div>

        {alert}
        <IncomingDetail incoming={v.incoming} />

        <Scene v={v} selected={selected} onPick={pick} progress={progress} fancy={false} />

        {panel}

        <Quests />

        <Panel title={`Constructions en cours (${v.buildQueue.length}/${BUILD_QUEUE_LIMIT})`}>
          {v.buildQueue.length === 0 ? (
            <p className="muted">Aucune construction. Touchez un bâtiment pour l'améliorer.</p>
          ) : (
            <ul className="queue">
              {v.buildQueue.map((q, i) => (
                <li key={q.id}>
                  <img src={buildingImg(q.building, q.level)} alt="" width={36} height={36} />
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
        {picker}
      </div>
    );

  const tribe = me.player.tribe;
  const crest = tribe ? (
    <TribeCrest id={tribe.id} tag={tribe.tag} size={style === 'etatmajor' ? 52 : 72} />
  ) : (
    <span className="vv-crest-plain">
      <NavIcon name="village" size={30} />
    </span>
  );
  const kicker = (
    <span className="vv-kicker">
      Village de {me.player.username}
      {tribe && (
        <>
          {' '}
          · <span className="vv-tag">[{tribe.tag}]</span> {tribe.name}
        </>
      )}
    </span>
  );
  const title = renaming ? (
    renameForm
  ) : (
    <h1 className="vv-name">
      {v.name} <span className="vv-coords">({v.x}|{v.y})</span>
      {renameBtn}
    </h1>
  );
  const stats = (
    <div className="vv-stats">
      <div className="vv-stat">
        <b>{fmt(v.points)}</b>
        <span>points</span>
      </div>
      <div className={`vv-stat ${v.loyalty < 100 ? 'warn' : ''}`}>
        <b>{Math.round(v.loyalty)}</b>
        <span>loyauté</span>
      </div>
      <div className="vv-stat">
        <b>
          {v.buildQueue.length}/{BUILD_QUEUE_LIMIT}
        </b>
        <span>constructions</span>
      </div>
      <div className="vv-stat">
        <b>x{world.speed}</b>
        <span>vitesse</span>
      </div>
      {protectedUntil && (
        <div className="vv-stat ok">
          <b>{clockTime(protectedUntil)}</b>
          <span>protégé jusqu'à</span>
        </div>
      )}
    </div>
  );
  const warBanner = enemyIncoming.length > 0 && (
    <div className="vv-war" role="alert">
      <span className="vv-war-icon">
        <NavIcon name="guerres" size={18} />
      </span>
      <span>
        <b>
          {enemyIncoming.length} attaque{enemyIncoming.length > 1 ? 's' : ''} en approche
        </b>
        <span className="vv-war-sub">
          Prochaine arrivée dans <Countdown to={enemyIncoming[0].arriveAt} />
        </span>
      </span>
    </div>
  );

  if (style === 'blason')
    return (
      <div className="village vv vv-blason">
        <header className="vv-banner">
          <div className="vv-banner-top">
            {crest}
            <div className="vv-title">
              {kicker}
              {title}
            </div>
            {warBanner}
          </div>
          {stats}
        </header>
        <IncomingDetail incoming={v.incoming} />
        <div className="vv-frame">
          <Scene v={v} selected={selected} onPick={pick} progress={progress} fancy />
        </div>
        {panel}
        <Quests />
        <div className="vv-grid2">
          <QueueCard v={v} progress={qp} />
          <BuildingTiles v={v} onPick={setSelected} selected={selected} />
        </div>
        {picker}
      </div>
    );

  if (style === 'doree')
    return (
      <div className="village vv vv-doree">
        <div className="vv-stage">
          <Scene v={v} selected={selected} onPick={pick} progress={progress} fancy>
            <span className="vv-light" aria-hidden />
            <span className="vv-clouds" aria-hidden />
          </Scene>
          <div className="vv-hud">
            <div className="vv-plaque">
              {kicker}
              {title}
              <div className="vv-pills">
                <span className="vv-pill">{fmt(v.points)} points</span>
                <span className={`vv-pill ${v.loyalty < 100 ? 'warn' : ''}`}>Loyauté {Math.round(v.loyalty)}</span>
                <span className="vv-pill">Vitesse x{world.speed}</span>
                {protectedUntil && <span className="vv-pill ok">Protégé jusqu'au {clockTime(protectedUntil)}</span>}
              </div>
            </div>
            {warBanner}
          </div>
          <QueueCard v={v} progress={qp} className="vv-hud-queue" />
        </div>
        <IncomingDetail incoming={v.incoming} />
        {panel}
        <Quests />
        <BuildingTiles v={v} onPick={setSelected} selected={selected} />
        {picker}
      </div>
    );

  return (
    <div className="village vv vv-etatmajor">
      <div className="vv-cols">
        <div className="vv-main">
          <header className="vv-head">
            {crest}
            <div className="vv-title">
              {kicker}
              {title}
            </div>
            {stats}
          </header>
          {warBanner}
          <IncomingDetail incoming={v.incoming} />
          <div className="vv-map-frame">
            <Scene v={v} selected={selected} onPick={pick} progress={progress} fancy />
          </div>
          <Quests />
        </div>
        <aside className="vv-side">
          {panel}
          <QueueCard v={v} progress={qp} />
          <BuildingTiles v={v} onPick={setSelected} selected={selected} />
        </aside>
      </div>
      {picker}
    </div>
  );
}
