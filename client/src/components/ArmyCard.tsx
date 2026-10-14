import { useState } from 'react';
import {
  ARMY_SIGHT,
  UNITS,
  UNIT_KEYS,
  attackWheatCost,
  interceptPoint,
  normalizeUnits,
  slowestSpeed,
  totalUnits,
  type ArmyKind,
  type MapArmy,
  type UnitKey,
} from '@aldoria/shared';
import { api } from '../api';
import { clockTime, duration, fmt } from '../format';
import { liveResources, ResIcon, UnitIcon } from '../ui';
import { serverNow, useGame, useNow } from '../game';
import { ARMY_COLORS, ARMY_LABELS } from './mapArmies';

/** Silhouette de la carte → unité dont l'icône la représente. */
const KIND_UNIT: Record<ArmyKind, UnitKey> = {
  foot: 'swordsman',
  horse: 'cavalry',
  scout: 'scout',
  noble: 'noble',
  ram: 'ram',
};
const KIND_LABEL: Record<ArmyKind, string> = {
  foot: 'Fantassins',
  horse: 'Cavaliers',
  scout: 'Éclaireurs',
  noble: 'Noble',
  ram: 'Béliers',
};
const SIZE_LABEL = {
  1: 'Petite troupe',
  2: 'Armée',
  3: 'Grande armée',
} as const;
const TYPE_LABEL: Record<MapArmy['type'], string> = {
  attack: 'En route pour attaquer',
  support: 'Renfort en route',
  return: 'Retour au village',
  intercept: 'Interception en route',
  unknown: 'Destination inconnue',
};

const at1 = (n: number) => Math.round(n * 10) / 10;

/** Durée maximale d'une poursuite calculée sur la carte (au-delà, l'armée sera de toute façon arrivée). */
const PURSUIT_HORIZON = 48 * 3600 * 1000;

/** Prolonge un trajet en ligne droite, à la même vitesse, de `ms` millisecondes. */
function extendPath(p: { from: { x: number; y: number }; to: { x: number; y: number }; t0: number; t1: number }, ms: number) {
  const span = Math.max(1, p.t1 - p.t0);
  const k = (span + ms) / span;
  return { ...p, to: { x: p.from.x + (p.to.x - p.from.x) * k, y: p.from.y + (p.to.y - p.from.y) * k }, t1: p.t0 + span + ms };
}

/** Fiche d'une armée en marche choisie sur la carte, avec l'interception quand elle est repérée et ennemie. */
export default function ArmyCard({ army, onSent }: { army: MapArmy; onSent: () => void }) {
  const { village: v, world, setVillage, run, toast } = useGame();
  const now = useNow();
  const [counts, setCounts] = useState<Partial<Record<UnitKey, string>>>({});
  const spotFrom = army.spotFrom ? Date.parse(army.spotFrom) : null;
  const spotTo = army.spotTo ? Date.parse(army.spotTo) : null;
  const hidden = army.rel !== 'own' && army.rel !== 'tribe' && army.rel !== 'ally' && spotFrom !== null && spotFrom > now;
  const unseen = army.rel === 'threat' && spotFrom === null;
  const open = army.interceptable && spotTo !== null && spotTo > now;

  const units = normalizeUnits(Object.fromEntries(UNIT_KEYS.map((k) => [k, Number(counts[k] || 0)])));
  const total = totalUnits(units);
  const valid = !!v && total > 0 && units.scout !== total && UNIT_KEYS.every((k) => units[k] <= v.troopsHome[k]);
  // Lancée pendant que l'armée est dans la zone, l'interception la poursuit jusqu'à son arrivée, même hors de la zone.
  const pursuit = open && spotFrom !== null && spotFrom <= now;
  const seenPath = {
    from: { x: army.from.x - 0.5, y: army.from.y - 0.5 },
    to: { x: army.to.x - 0.5, y: army.to.y - 0.5 },
    t0: Date.parse(army.fromAt),
    t1: Date.parse(army.toAt),
  };
  // D'une armée simplement aperçue on ne connaît que la portion visible : on prolonge sa ligne droite, le serveur vérifie
  // qu'elle n'est pas arrivée avant la rencontre.
  const path = army.rel === 'seen' && pursuit ? extendPath(seenPath, PURSUIT_HORIZON) : seenPath;
  const within: [number, number] | null = pursuit ? [serverNow(), path.t1] : spotFrom !== null && spotTo !== null ? [spotFrom, spotTo] : null;
  const meet = v && valid && within ? interceptPoint(v, (slowestSpeed(units) * 60) / world.speed, path, serverNow(), within) : null;
  const beyond = !!meet && army.rel === 'seen' && meet.at > seenPath.t1;
  const wheat = attackWheatCost(units);
  const wheatHave = v ? Math.floor(liveResources(v, now).wheat) : 0;

  const send = () =>
    run(async () => {
      if (!v) return;
      const r = await api<{
        arriveAt: string;
        meet: { x: number; y: number };
        village: Parameters<typeof setVillage>[0];
      }>(`/api/villages/${v.id}/intercept`, {
        body: { commandId: army.id, units },
      });
      setVillage(r.village);
      toast(`Vos troupes partent l'intercepter près de (${Math.floor(r.meet.x)}|${Math.floor(r.meet.y)})`);
      setCounts({});
      onSent();
    });

  return (
    <div className="mvc army-card">
      <div className="mvc-head">
        <span
          className="mvc-dot"
          style={{
            color: ARMY_COLORS[army.rel],
            background: ARMY_COLORS[army.rel],
          }}
        />
        <div className="mvc-title">
          <b>{hidden || unseen ? 'Armée' : SIZE_LABEL[army.size]}</b>
          <span className="mvc-sub">
            {ARMY_LABELS[army.rel]}
            {army.owner ? ` · ${army.owner}` : ''}
          </span>
        </div>
      </div>
      <div className="mvc-facts">
        <span className="mvc-chip">{TYPE_LABEL[army.type]}</span>
        {army.rel !== 'seen' && <span className="mvc-chip">Arrivée {clockTime(army.toAt)}</span>}
        {army.rel === 'seen' && <span className="mvc-chip">À portée jusqu'à {clockTime(army.toAt)}</span>}
      </div>
      {hidden || unseen ? (
        <p className="muted small">
          Composition inconnue : elle se dévoilera à {ARMY_SIGHT} cases de l'un de vos villages
          {spotFrom ? `, vers ${clockTime(new Date(spotFrom))}` : ''}.
        </p>
      ) : (
        <div className="army-kinds">
          {army.kinds.map((k) => (
            <span key={k} className="mvc-time">
              <UnitIcon unit={KIND_UNIT[k]} size={24} />
              {KIND_LABEL[k]}
            </span>
          ))}
        </div>
      )}

      {army.interceptable && !open && spotFrom === null && (
        <p className="muted small">Elle ne passera pas à {ARMY_SIGHT} cases de vos villages : impossible de l'intercepter.</p>
      )}
      {open && v && (
        <div className="send">
          <p className="small">
            <b>Intercepter</b> depuis {v.name} : la bataille a lieu en rase campagne, sans muraille.{' '}
            {pursuit
              ? `Elle est dans votre zone de ${ARMY_SIGHT} cases : vos troupes la poursuivront même si elle en sort, jusqu'à son arrivée.`
              : `Lancez-la avant qu'elle ne quitte votre zone de ${ARMY_SIGHT} cases ; une fois qu'elle y est, vos troupes peuvent la poursuivre au-delà.`}
          </p>
          <div className="send-grid">
            {UNIT_KEYS.map((k) => (
              <label key={k} className={v.troopsHome[k] === 0 ? 'dim' : ''} htmlFor={`icp-${k}`}>
                <UnitIcon unit={k} size={28} />
                <input
                  id={`icp-${k}`}
                  type="number"
                  min={0}
                  max={v.troopsHome[k]}
                  inputMode="numeric"
                  placeholder="0"
                  value={counts[k] ?? ''}
                  disabled={v.troopsHome[k] === 0}
                  onChange={(e) => setCounts((c) => ({ ...c, [k]: e.target.value }))}
                />
                <button type="button" className="link small" onClick={() => setCounts((c) => ({ ...c, [k]: String(v.troopsHome[k]) }))}>
                  ({fmt(v.troopsHome[k])})
                </button>
                <span className="sr-only">{UNITS[k].name}</span>
              </label>
            ))}
          </div>
          {valid &&
            (meet ? (
              <p className="small">
                Rencontre près de{' '}
                <b>
                  ({Math.floor(at1(meet.x))}|{Math.floor(at1(meet.y))})
                </b>{' '}
                dans {duration(Math.max(0, Math.round((meet.at - now) / 1000)))}, à {clockTime(new Date(meet.at))}
                {beyond && " (hors de vue : si elle arrive à destination avant, l'interception sera refusée)"}
              </p>
            ) : (
              <p className="warn small">
                {pursuit ? "Trop lentes : vos troupes ne la rattraperaient pas avant son arrivée." : "Trop lentes : vos troupes n'arriveraient pas avant qu'elle ne quitte la zone."}
              </p>
            ))}
          {total > 0 && units.scout === total && <p className="muted small">Les éclaireurs seuls ne livrent pas bataille.</p>}
          {total > 0 && (
            <p className={`small${wheat > wheatHave ? ' warn' : ''}`}>
              <ResIcon r="wheat" /> Rations : <b>{fmt(wheat)}</b> blé ({fmt(wheatHave)} au village)
            </p>
          )}
          <div className="row">
            <button className="btn danger" disabled={!valid || !meet || wheat > wheatHave} onClick={send}>
              Intercepter
            </button>
            <button
              type="button"
              className="btn ghost small"
              onClick={() => setCounts(Object.fromEntries(UNIT_KEYS.filter((k) => k !== 'scout').map((k) => [k, String(v.troopsHome[k])])))}
            >
              Tout sélectionner
            </button>
          </div>
        </div>
      )}
    </div>
  );
}
