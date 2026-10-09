import { useState } from 'react';
import { UNITS, UNIT_KEYS, type MapVillage, type UnitKey, normalizeUnits, totalUnits, travelTime, distance } from '@aldoria/shared';
import { api } from '../api';
import { clockTime, duration, fmt } from '../format';
import { useGame, useNow } from '../game';
import { UnitIcon } from '../ui';

export default function SendTroops({ target, protectedTarget, onSent }: { target: MapVillage; protectedTarget: boolean; onSent: () => void }) {
  const { village: v, me, world, setVillage, run, toast } = useGame();
  const now = useNow();
  const [counts, setCounts] = useState<Partial<Record<UnitKey, string>>>({});
  if (!v) return null;

  const units = normalizeUnits(Object.fromEntries(UNIT_KEYS.map((k) => [k, Number(counts[k] || 0)])));
  const total = totalUnits(units);
  const valid = total > 0 && UNIT_KEYS.every((k) => units[k] <= v.troopsHome[k]);
  const travel = total > 0 ? travelTime(units, v, target, world.speed) : 0;
  const ownTarget = target.ownerId === me.player.id;

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
      {protectedTarget && !ownTarget && <p className="warn small">Ce joueur est encore sous protection débutant.</p>}
      {units.noble > 0 && <p className="muted small">Les nobles font baisser la loyauté du village si l'attaque est victorieuse.</p>}
      {units.scout > 0 && units.scout === total && <p className="muted small">Envoyés seuls, les éclaireurs espionnent le village sans combattre.</p>}
      {units.ram > 0 && <p className="muted small">Les béliers abaissent la muraille pendant le combat et l'abîment après une victoire.</p>}
    </div>
  );
}

