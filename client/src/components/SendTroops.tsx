import { useEffect, useState } from 'react';
import {
  UNITS,
  UNIT_KEYS,
  type MapVillage,
  type TargetIntel,
  type UnitCounts,
  type UnitKey,
  distance,
  normalizeUnits,
  resolveCombat,
  totalUnits,
  travelTime,
  wallDuringCombat,
} from '@aldoria/shared';
import { api } from '../api';
import { clockTime, duration, fmt } from '../format';
import { useGame, useNow } from '../game';
import { UnitIcon } from '../ui';

const TEMPLATES_KEY = 'aldoria.templates';
interface Template {
  name: string;
  units: Partial<Record<UnitKey, number>>;
}
const readTemplates = (): Template[] => {
  try {
    const raw = JSON.parse(localStorage.getItem(TEMPLATES_KEY) ?? '[]');
    return Array.isArray(raw) ? raw : [];
  } catch {
    return [];
  }
};
const writeTemplates = (list: Template[]) => {
  try {
    localStorage.setItem(TEMPLATES_KEY, JSON.stringify(list));
  } catch {
    /* ignoré */
  }
};

/** Simulation d'une attaque contre ce qu'on sait de la cible. */
function Simulation({ units, intel }: { units: UnitCounts; intel: TargetIntel }) {
  const r = resolveCombat({ attackers: units, defenders: [intel.troops], wallLevel: wallDuringCombat(intel.wall, units.ram) });
  const lost = UNIT_KEYS.filter((k) => r.attackerLosses[k] > 0);
  return (
    <div className={`sim ${r.attackerWins ? 'win' : 'loss'}`}>
      <p>
        <b>{r.attackerWins ? 'Victoire probable' : 'Défaite probable'}</b> · attaque {fmt(Math.round(r.attackPower))} contre défense {fmt(Math.round(r.defensePower))}
      </p>
      {lost.length > 0 && (
        <p className="small">
          Pertes estimées : {lost.map((k) => `${fmt(r.attackerLosses[k])} ${UNITS[k].name.toLowerCase()}`).join(', ')}
        </p>
      )}
      <p className="muted small">
        D'après {intel.source === 'scout' ? 'votre espionnage' : 'votre dernière attaque'} du {clockTime(intel.at)} ; la situation a pu changer.
      </p>
    </div>
  );
}

export default function SendTroops({ target, protectedTarget, onSent }: { target: MapVillage; protectedTarget: boolean; onSent: () => void }) {
  const { village: v, me, world, setVillage, run, toast } = useGame();
  const now = useNow();
  const [counts, setCounts] = useState<Partial<Record<UnitKey, string>>>({});
  const [intel, setIntel] = useState<TargetIntel | null>(null);
  const [templates, setTemplates] = useState<Template[]>(readTemplates);
  const ownerOfTarget = target.ownerId === me.player.id;
  useEffect(() => {
    setIntel(null);
    if (ownerOfTarget) return;
    run(async () => {
      const r = await api<TargetIntel | { none: true }>(`/api/villages/${target.id}/intel`);
      if (!('none' in r)) setIntel(r);
    });
  }, [target.id, ownerOfTarget, run]);
  if (!v) return null;

  const units = normalizeUnits(Object.fromEntries(UNIT_KEYS.map((k) => [k, Number(counts[k] || 0)])));
  const total = totalUnits(units);
  const valid = total > 0 && UNIT_KEYS.every((k) => units[k] <= v.troopsHome[k]);
  const travel = total > 0 ? travelTime(units, v, target, world.speed) : 0;
  const ownTarget = target.ownerId === me.player.id;

  const saveTemplate = () => {
    if (total === 0) return;
    const name = window.prompt('Nom du modèle d’armée ?', '')?.trim();
    if (!name) return;
    const list = [...templates.filter((t) => t.name !== name), { name, units: Object.fromEntries(UNIT_KEYS.filter((k) => units[k] > 0).map((k) => [k, units[k]])) }];
    setTemplates(list);
    writeTemplates(list);
  };
  const applyTemplate = (t: Template) =>
    setCounts(Object.fromEntries(UNIT_KEYS.map((k) => [k, String(Math.min(t.units[k] ?? 0, v.troopsHome[k]))])));
  const deleteTemplate = (name: string) => {
    const list = templates.filter((t) => t.name !== name);
    setTemplates(list);
    writeTemplates(list);
  };

  const send = (type: 'attack' | 'support') =>
    run(async () => {
      const state = await api(`/api/villages/${v.id}/commands`, { body: { type, targetId: target.id, units } });
      setVillage(state);
      toast(type === 'attack' ? 'Vos troupes partent à l’attaque' : 'Vos renforts sont en route');
      setCounts({});
      onSent();
    });

  return (
    <div className="send">
      <p className="muted small">
        Depuis {v.name} · distance {distance(v, target).toFixed(1)} cases
      </p>
      <div className="send-grid">
        {UNIT_KEYS.map((k) => (
          <label key={k} className={v.troopsHome[k] === 0 ? 'dim' : ''} htmlFor={`send-${k}`}>
            <UnitIcon unit={k} size={28} />
            <input
              id={`send-${k}`}
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
      {total > 0 && (
        <p className="small">
          Trajet : <b>{duration(travel)}</b>, arrivée {clockTime(new Date(now + travel * 1000))}
        </p>
      )}
      {!ownTarget && total > 0 && units.scout !== total && (intel ? <Simulation units={units} intel={intel} /> : <p className="muted small">Aucun renseignement sur cette cible : envoyez d'abord des éclaireurs pour estimer le combat.</p>)}
      {totalUnits(v.troopsHome) === 0 && <p className="muted small">Aucune troupe disponible dans ce village.</p>}
      <div className="row">
        {!ownTarget && (
          <button className="btn danger" disabled={!valid || protectedTarget} onClick={() => send('attack')}>
            Attaquer
          </button>
        )}
        <button className="btn" disabled={!valid} onClick={() => send('support')}>
          Envoyer en renfort
        </button>
        <button type="button" className="btn ghost small" onClick={() => setCounts(Object.fromEntries(UNIT_KEYS.map((k) => [k, String(v.troopsHome[k])])))}>
          Tout sélectionner
        </button>
      </div>
      <div className="row templates">
        {templates.map((t) => (
          <span key={t.name} className="chip-btn">
            <button type="button" className="btn small ghost" onClick={() => applyTemplate(t)} title={UNIT_KEYS.filter((k) => t.units[k]).map((k) => `${t.units[k]} ${UNITS[k].name}`).join(', ')}>
              {t.name}
            </button>
            <button type="button" className="link small" aria-label={`Supprimer le modèle ${t.name}`} onClick={() => deleteTemplate(t.name)}>
              ✕
            </button>
          </span>
        ))}
        <button type="button" className="btn small ghost" disabled={total === 0} onClick={saveTemplate}>
          Enregistrer comme modèle
        </button>
      </div>
      {protectedTarget && !ownTarget && <p className="warn small">Ce joueur est encore sous protection débutant.</p>}
      {units.noble > 0 && <p className="muted small">Les nobles font baisser la loyauté du village si l'attaque est victorieuse.</p>}
      {units.scout > 0 && units.scout === total && <p className="muted small">Envoyés seuls, les éclaireurs espionnent le village sans combattre.</p>}
      {units.ram > 0 && <p className="muted small">Les béliers abaissent la muraille pendant le combat et l'abîment après une victoire.</p>}
    </div>
  );
}

