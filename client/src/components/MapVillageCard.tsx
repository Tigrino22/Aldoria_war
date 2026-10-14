import { UNITS, UNIT_KEYS, distance, emptyUnits, travelTime, type MapVillage } from '@aldoria/shared';
import { duration, fmt } from '../format';
import { UnitIcon } from '../ui';
import { REL_LABELS, type Mark, type Relation } from './mapStyle';

/** Fiche d'un village de la carte : la même au survol et au clic, avec les temps de trajet depuis le village actif. */
export default function MapVillageCard({
  v,
  rel,
  color,
  mark,
  from,
  worldSpeed,
  ownerSlot,
}: {
  v: MapVillage;
  rel: Relation;
  color: string;
  mark: Mark | null;
  from: { x: number; y: number } | null;
  worldSpeed: number;
  /** Nom du propriétaire, cliquable dans la fenêtre ; simple texte au survol. */
  ownerSlot?: React.ReactNode;
}) {
  const dist = from ? distance(from, v) : 0;
  const tag = mark ? `Repère : ${mark.name}` : REL_LABELS[rel];
  return (
    <div className="mvc">
      <div className="mvc-head">
        <span className="mvc-dot" style={{ background: color }} />
        <div className="mvc-title">
          <b>
            {v.tribeTag && <span className="mvc-tag">[{v.tribeTag}]</span>} {v.name}
          </b>
          <span className="mvc-sub">
            {v.kind === 'citadel' ? 'Citadelle des Croisades' : (ownerSlot ?? v.ownerName ?? 'Village barbare')} · {v.x}|{v.y}
          </span>
        </div>
      </div>
      <div className="mvc-facts">
        {v.kind === 'citadel' ? (
          <>
            <span className="mvc-chip gold">{v.holderTag ? `Bannière : ${v.holderTag}` : 'Bannière à prendre'}</span>
            <a className="mvc-chip gold" href="#/croisade">Voir la croisade</a>
          </>
        ) : (
          <>
            <span className="mvc-chip" style={{ borderColor: color }}>
              {tag}
            </span>
            <span className="mvc-chip">{fmt(v.points)} pts</span>
            {v.relic && <span className="mvc-chip gold">Relique de croisade</span>}
          </>
        )}
        {from && dist > 0 && <span className="mvc-chip">{dist.toFixed(1)} cases</span>}
        {v.protected && <span className="mvc-chip warn">Protection débutant</span>}
      </div>
      {from && dist > 0 && (
        <div className="mvc-times">
          {UNIT_KEYS.map((k) => (
            <span key={k} className="mvc-time">
              <UnitIcon unit={k} size={22} />
              <span className="mvc-unit">{UNITS[k].name}</span>
              <span>{duration(travelTime({ ...emptyUnits(), [k]: 1 }, from, v, worldSpeed))}</span>
            </span>
          ))}
        </div>
      )}
    </div>
  );
}
