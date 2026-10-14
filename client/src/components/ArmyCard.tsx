import { useEffect, useState } from 'react';
import {
  ARMY_SIGHT,
  UNITS,
  UNIT_KEYS,
  attackWheatCost,
  normalizeUnits,
  totalUnits,
  type ArmyKind,
  type MapArmy,
  type UnitKey,
} from '@aldoria/shared';
import { api } from '../api';
import { clockTime, duration, fmt } from '../format';
import { liveResources, ResIcon, UnitIcon } from '../ui';
import { useGame, useNow } from '../game';
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

type Preview = { ok: true; meet: { x: number; y: number }; arriveAt: string; chase: boolean } | { ok: false; error: string };

/** Fiche d'une armée en marche choisie sur la carte, avec l'interception quand elle est repérée et ennemie. */
export default function ArmyCard({ army, onSent }: { army: MapArmy; onSent: () => void }) {
  const { village: v, setVillage, run, toast } = useGame();
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
  // Le serveur calcule la rencontre : il connaît tout le trajet, y compris la partie hors de vue où l'on peut la poursuivre.
  const chasing = spotFrom !== null && spotFrom <= now;
  const key = valid && open && v ? `${v.id}:${army.id}:${UNIT_KEYS.map((k) => units[k]).join(',')}` : '';
  const [preview, setPreview] = useState<{ key: string; p: Preview } | null>(null);
  useEffect(() => {
    if (!key || !v) return;
    let live = true;
    const t = setTimeout(() => {
      api<Preview>(`/api/villages/${v.id}/intercept/preview`, { body: { commandId: army.id, units } })
        .then((p) => live && setPreview({ key, p }))
        .catch(() => live && setPreview(null));
    }, 250);
    return () => {
      live = false;
      clearTimeout(t);
    };
  }, [key]);
  const plan = preview && preview.key === key ? preview.p : null;
  const meet = plan?.ok ? { ...plan.meet, at: Date.parse(plan.arriveAt) } : null;
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
            {chasing
              ? `Elle est à ${ARMY_SIGHT} cases ou moins de vos villages : vos troupes la poursuivent jusqu'à la rattraper, même si elle sort de la zone.`
              : `Lancée avant qu'elle n'approche, la rencontre doit avoir lieu à ${ARMY_SIGHT} cases ou moins de vos villages ; une fois repérée, vous pourrez la poursuivre.`}
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
            plan &&
            (meet ? (
              <p className="small">
                Rencontre près de{' '}
                <b>
                  ({Math.floor(at1(meet.x))}|{Math.floor(at1(meet.y))})
                </b>{' '}
                dans {duration(Math.max(0, Math.round((meet.at - now) / 1000)))}, à {clockTime(new Date(meet.at))}
              </p>
            ) : (
              <p className="warn small">{!plan.ok && /temps/.test(plan.error) ? (chasing ? 'Trop lentes : vos troupes ne la rattraperaient pas avant qu’elle n’arrive.' : 'Trop lentes : vos troupes n’arriveraient pas avant qu’elle ne quitte la zone.') : !plan.ok ? plan.error : ''}</p>
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
