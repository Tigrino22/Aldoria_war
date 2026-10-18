import { useEffect, useMemo, useState } from 'react';
import type { ArmyKind, IncomingAttack } from '@aldoria/shared';
import { api } from '../api';
import { clockTime, duration } from '../format';
import { useGame, useNow } from '../game';
import { Countdown, PlayerLink, VillageLink } from '../ui';
import { CardTitle, PageBanner } from './PageBanner';
import { NavIcon } from './NavIcon';
import './incoming.css';

const KIND_NAMES: Record<ArmyKind, string> = { foot: 'Infanterie', horse: 'Cavalerie', scout: 'Éclaireurs', ram: 'Béliers', noble: 'Noble' };
const SIZE_NAMES = { 1: 'petite troupe', 2: 'armée', 3: 'grande armée' } as const;

/** Nature de l'attaque, telle qu'on peut la deviner : conquête si un noble est repéré, espionnage si seuls des éclaireurs marchent. */
const kindOf = (a: IncomingAttack) => (a.kinds?.includes('noble') ? 'conquest' : a.scouts ? 'scout' : 'attack');
const KIND_LABEL = { attack: 'Attaque', conquest: 'Conquête', scout: 'Espionnage' } as const;

/** Toutes les attaques qui visent vos villages, PNJ compris : origine, destination, trajet et, une fois repérée, ce qui marche. */
export default function IncomingAttacks() {
  const { run, setVillageId } = useGame();
  const now = useNow();
  const [list, setList] = useState<IncomingAttack[] | null>(null);
  const [filter, setFilter] = useState<number | null>(null);

  useEffect(() => {
    const load = () => run(async () => setList(await api<IncomingAttack[]>('/api/incoming')));
    load();
    const t = setInterval(load, 30_000);
    return () => clearInterval(t);
  }, [run]);

  // Une attaque arrivée disparaît sans attendre le prochain rechargement.
  const live = useMemo(() => (list ?? []).filter((a) => Date.parse(a.arriveAt) > now), [list, now]);
  const targets = useMemo(() => {
    const m = new Map<number, { id: number; name: string; x: number; y: number; count: number }>();
    for (const a of live) {
      const t = m.get(a.target.id) ?? { ...a.target, count: 0 };
      t.count++;
      m.set(a.target.id, t);
    }
    return [...m.values()].sort((a, b) => b.count - a.count || a.name.localeCompare(b.name));
  }, [live]);

  if (!list) return <p className="muted">Chargement…</p>;
  const shown = filter !== null && targets.some((t) => t.id === filter) ? live.filter((a) => a.target.id === filter) : live;
  const nobles = live.filter((a) => kindOf(a) === 'conquest').length;
  const attackers = new Set(live.map((a) => a.origin.ownerName ?? `barbares-${a.origin.id}`)).size;

  const openVillage = (id: number) => {
    setVillageId(id);
    location.hash = '#/village';
  };

  return (
    <div className="pg incoming">
      <PageBanner
        icon="bouclier"
        kicker="Armée"
        title="Attaques entrantes"
        lead="Toutes les attaques en route vers vos villages : d’où elles partent, ce qu’elles visent et quand elles arrivent. Leur contenu apparaît une fois repérées, à 10 cases de vos villages."
        stats={[
          { value: live.length, label: live.length > 1 ? 'attaques' : 'attaque', tone: live.length ? 'red' : '' },
          { value: targets.length, label: targets.length > 1 ? 'villages visés' : 'village visé' },
          { value: attackers, label: attackers > 1 ? 'attaquants' : 'attaquant' },
          { value: live.length ? <Countdown to={live[0].arriveAt} /> : '—', label: 'prochaine arrivée', tone: live.length ? 'gold' : '' },
          { value: nobles, label: nobles > 1 ? 'nobles repérés' : 'noble repéré', tone: nobles ? 'red' : '' },
        ]}
      />

      {live.length === 0 ? (
        <div className="pg-card">
          <div className="pg-empty">
            <NavIcon name="bouclier" size={28} />
            <b>Aucune attaque en approche</b>
            <span>Vos villages sont tranquilles pour l’instant. La page se met à jour toute seule.</span>
          </div>
        </div>
      ) : (
        <section className="pg-card">
          <div className="pg-card-head">
            <CardTitle icon="guerres" count={shown.length}>
              Arrivées
            </CardTitle>
          </div>
          {targets.length > 1 && (
            <div className="in-filter" role="group" aria-label="Filtrer par village visé">
              <button className={`chip chip-btn ${filter === null ? 'on' : ''}`} onClick={() => setFilter(null)}>
                Tous ({live.length})
              </button>
              {targets.map((t) => (
                <button key={t.id} className={`chip chip-btn ${filter === t.id ? 'on' : ''}`} onClick={() => setFilter(t.id)}>
                  {t.name} ({t.count})
                </button>
              ))}
            </div>
          )}
          <ul className="in-list">
            {shown.map((a) => {
              const kind = kindOf(a);
              const travel = (Date.parse(a.arriveAt) - Date.parse(a.sentAt)) / 1000;
              return (
                <li key={a.id} className={`in-card kind-${kind}`}>
                  <div className="in-top">
                    <span className="in-kind">{KIND_LABEL[kind]}</span>
                    <span className="in-arrive">
                      <Countdown to={a.arriveAt} />
                      <span className="muted small">{clockTime(a.arriveAt)}</span>
                    </span>
                  </div>
                  <div className="in-route">
                    <div className="in-end">
                      <span className="in-label">Origine</span>
                      <VillageLink v={a.origin} />
                      <span className="small">
                        {a.origin.ownerName ? (
                          <>
                            {a.origin.ownerTag && <span className="muted">[{a.origin.ownerTag}] </span>}
                            <PlayerLink name={a.origin.ownerName} />
                            {a.origin.npc && !a.origin.ownerName.includes('PNJ') && <span className="pg-pill in-npc">PNJ</span>}
                          </>
                        ) : (
                          <span className="muted">Barbares</span>
                        )}
                      </span>
                    </div>
                    <span className="in-arrow" aria-hidden>
                      →
                    </span>
                    <div className="in-end">
                      <span className="in-label">Destination</span>
                      <button className="link in-target" onClick={() => openVillage(a.target.id)} title="Ouvrir ce village">
                        {a.target.name} ({a.target.x}|{a.target.y})
                      </button>
                      <span className="small">
                        <a href={`#/carte/${a.target.x},${a.target.y}`}>Carte</a>
                        {' · '}
                        <a href={`#/ralliement/${a.target.x},${a.target.y}`}>Envoyer du soutien</a>
                      </span>
                    </div>
                  </div>
                  <dl className="in-facts">
                    <div>
                      <dt>Distance</dt>
                      <dd>{a.distance.toLocaleString('fr-FR', { maximumFractionDigits: 1 })} cases</dd>
                    </div>
                    <div>
                      <dt>Partie</dt>
                      <dd>{clockTime(a.sentAt)}</dd>
                    </div>
                    <div>
                      <dt>Trajet</dt>
                      <dd>{duration(travel)}</dd>
                    </div>
                    <div className="wide">
                      <dt>Composition</dt>
                      <dd>
                        {a.kinds ? (
                          <>
                            {a.kinds.map((k) => KIND_NAMES[k]).join(', ')}
                            {a.size && <span className="muted"> · {SIZE_NAMES[a.size]}</span>}
                          </>
                        ) : a.spotFrom ? (
                          <span className="muted">
                            inconnue, repérée dans <Countdown to={a.spotFrom} />
                          </span>
                        ) : (
                          <span className="muted">inconnue</span>
                        )}
                      </dd>
                    </div>
                  </dl>
                  <div className="in-bar" aria-hidden="true">
                    <div className="in-fill" style={{ width: `${Math.min(100, Math.max(0, ((now - Date.parse(a.sentAt)) / Math.max(1, travel * 1000)) * 100))}%` }} />
                  </div>
                </li>
              );
            })}
          </ul>
        </section>
      )}
    </div>
  );
}
