import { useEffect, useState } from 'react';
import { BUILDINGS, RESOURCES, RESOURCE_NAMES, totalUnits, type VillageState } from '@aldoria/shared';
import { api } from '../api';
import { fmt } from '../format';
import { useGame, useNow } from '../game';
import IncomingDetail from './IncomingDetail';
import { ManagerSwitch, useManager } from './Manager';
import { buildingImg } from '../assets';
import { Countdown, ResIcon, UnitList, liveResources } from '../ui';
import { PageBanner } from './PageBanner';
import { CrusadeBanner } from './CrusadeBanner';
import './overview.css';

export default function Overview() {
  const { me, run, setVillageId, villageId } = useGame();
  const now = useNow();
  const [villages, setVillages] = useState<VillageState[] | null>(null);
  const manager = useManager();

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
    <div className="pg overview">
      <PageBanner
        icon="apercu"
        kicker="Village"
        title="Mes villages"
        lead="Tous vos villages d'un coup d'œil : ressources, constructions, recrutements et troupes."
        actions={
          <button className="btn small" onClick={() => (location.hash = '#/gestionnaire')}>
            Gestionnaire de compte
          </button>
        }
        stats={[
          { value: villages.length, label: villages.length > 1 ? 'villages' : 'village', tone: 'gold' },
          ...RESOURCES.map((r, i) => ({
            value: (
              <span className="ov-res">
                <ResIcon r={r} size={18} /> {fmt(Math.floor(total[i]))}
              </span>
            ),
            label: `${RESOURCE_NAMES[r]} en stock`,
          })),
        ]}
      />
      <CrusadeBanner />
      <p className="muted small ov-hint">Le gestionnaire de compte construit et recrute automatiquement, par modèle (offensif, défensif…).</p>
      {villages.map((v) => {
        const res = liveResources(v, now);
        const attacks = v.incoming.filter((c) => c.type === 'attack');
        const next = v.buildQueue[0];
        return (
          <section key={v.id} className={`pg-card ov-village ${v.id === villageId ? 'active' : ''} ${attacks.length ? 'threat' : ''}`}>
            <header className="ov-head">
              <img src={buildingImg('townhall', Math.max(v.buildings.townhall, 1))} alt="" width={56} height={56} />
              <div className="ov-title">
                <h2>
                  {v.name} <em>({v.x}|{v.y})</em>
                </h2>
                <span className="muted small">
                  {fmt(v.points)} points · loyauté {v.loyalty} %
                  {v.market.merchants > 0 && ` · marchands ${v.market.available}/${v.market.merchants}`}
                </span>
              </div>
              {v.id === villageId && <span className="pg-pill gold">Village actif</span>}
              <div className="row ov-actions">
                <button className="btn small" onClick={() => open(v.id, 'village')}>Village</button>
                <button className="btn small" onClick={() => open(v.id, 'caserne')}>Caserne</button>
                <button className="btn small" onClick={() => open(v.id, 'troupes')}>Troupes</button>
              </div>
            </header>
            {attacks.length > 0 && (
              <p className="ov-war">
                {attacks.length} attaque{attacks.length > 1 ? 's' : ''} en approche : la première arrive dans <Countdown to={attacks[0].arriveAt} />
              </p>
            )}
            <IncomingDetail incoming={v.incoming} />
            {manager.data && manager.data.available && (() => {
              const mv = manager.data.villages.find((m) => m.id === v.id);
              if (!mv) return null;
              const tpl = manager.data.templates.find((t) => t.id === mv.templateId);
              return (
                <div className="row mgr-line">
                  <b>Gestionnaire :</b>
                  <ManagerSwitch v={mv} data={manager.data} reload={manager.reload} />
                  <span className="muted small">{mv.custom ? 'réglage propre' : tpl ? `modèle ${tpl.name}` : 'aucun modèle'}{mv.enabled && mv.blocked ? ` · en attente : ${mv.blocked}` : ''}</span>
                </div>
              );
            })()}
            <div className="ov-res-grid">
              {RESOURCES.map((r) => (
                <span key={r} className={`ov-res-tile ${res[r] >= v.capacity ? 'full' : ''}`} title={RESOURCE_NAMES[r]}>
                  <span className="ov-res">
                    <ResIcon r={r} size={18} /> <b>{fmt(Math.floor(res[r]))}</b>
                    <span className="muted small">/{fmt(v.capacity)}</span>
                  </span>
                  <span className="pg-progress">
                    <i style={{ width: `${Math.min(100, Math.round((res[r] / Math.max(1, v.capacity)) * 100))}%` }} />
                  </span>
                </span>
              ))}
            </div>
            <dl className="ov-facts">
              <div>
                <dt>Construction</dt>
                <dd>
                  {next ? (
                    <>
                      {BUILDINGS[next.building].name} → niveau {next.level} <Countdown to={next.finishAt} />
                      {v.buildQueue.length > 1 && <span className="muted"> (+{v.buildQueue.length - 1} en file)</span>}
                    </>
                  ) : (
                    <span className="muted">file vide</span>
                  )}
                </dd>
              </div>
              <div>
                <dt>Recrutement</dt>
                <dd>
                  {v.recruitQueue.length ? (
                    <>
                      {v.recruitQueue.length} commande{v.recruitQueue.length > 1 ? 's' : ''} en cours
                    </>
                  ) : (
                    <span className="muted">aucun</span>
                  )}
                </dd>
              </div>
              <div className="wide">
                <dt>Troupes ({fmt(totalUnits(v.troopsHome))})</dt>
                <dd>
                  <UnitList units={v.troopsHome} />
                </dd>
              </div>
            </dl>
          </section>
        );
      })}
    </div>
  );
}
