import { useEffect, useState } from 'react';
import type { CrusadeState, MapVillage } from '@aldoria/shared';
import { api } from '../api';
import { useNow } from '../game';
import { Countdown } from '../ui';
import { NavIcon } from './NavIcon';

/** Croisade annoncée ou en cours, partagée entre les écrans qui l'affichent (lue au plus une fois par minute). */
let cached: { at: number; state: CrusadeState | null } | null = null;
export function useCrusade(refreshMs = 60_000): CrusadeState | null {
  const [state, setState] = useState<CrusadeState | null>(cached?.state ?? null);
  useEffect(() => {
    let alive = true;
    const load = () => {
      if (cached && Date.now() - cached.at < refreshMs - 1000) return setState(cached.state);
      api<CrusadeState>('/api/crusade')
        .then((s) => {
          cached = { at: Date.now(), state: s };
          if (alive) setState(s);
        })
        .catch(() => {});
    };
    load();
    const timer = window.setInterval(load, refreshMs);
    return () => {
      alive = false;
      window.clearInterval(timer);
    };
  }, [refreshMs]);
  return state;
}

/** Bandeau doré de la croisade : compte à rebours jusqu'à l'ouverture, puis jusqu'à la fermeture des portes. */
export function CrusadeBanner({ className = '' }: { className?: string }) {
  const state = useCrusade();
  const now = useNow();
  const cr = state?.current;
  if (!state?.enabled || !cr || cr.phase === 'ended' || now >= Date.parse(cr.closesAt)) return null;
  const open = now >= Date.parse(cr.opensAt);
  return (
    <a className={`crusade-banner ${open ? 'open' : ''} ${className}`} href="#/croisade">
      <span className="cb-icon">
        <NavIcon name="croisade" size={18} />
      </span>
      <span className="cb-txt">
        <b>{open ? `Assaut sur ${cr.name}` : `${cr.name} annoncée`}</b>
        <span className="cb-sub">
          {open ? 'Les portes se ferment dans ' : 'Ouverture dans '}
          <Countdown to={open ? cr.closesAt : cr.opensAt} />
          {cr.holder && open && <> · bannière {cr.holder.tribeTag ?? cr.holder.playerName}</>}
        </span>
      </span>
    </a>
  );
}

/**
 * Panneau de la croisade sur la carte : compte à rebours, muraille, camp qui tient la bannière, armées en marche
 * et dernier fait d'armes, mis à jour toutes les 10 secondes pendant l'assaut. « Voir » centre la carte sur la Citadelle.
 */
export function CrusadeMapHud({ citadel, holderColor, onShow }: { citadel: MapVillage; holderColor: string | null; onShow: () => void }) {
  const cz = citadel.crusade!;
  const now = useNow();
  const open = now >= Date.parse(cz.opensAt);
  const state = useCrusade(open ? 10_000 : 60_000);
  if (now >= Date.parse(cz.closesAt)) return null;
  const last = state?.current?.id && state.log[0];
  return (
    <div className={`crusade-hud ${open ? 'open' : ''}`} role="status" aria-live="polite">
      <div className="ch-top">
        <span className="cb-icon">
          <NavIcon name="croisade" size={16} />
        </span>
        <span className="ch-title">
          <b>{citadel.name}</b>
          <span>
            {open ? 'Portes fermées dans ' : 'Ouverture dans '}
            <Countdown to={open ? cz.closesAt : cz.opensAt} />
          </span>
        </span>
        <button className="map-btn" onClick={onShow}>
          Voir
        </button>
      </div>
      <div className="ch-facts">
        <span className="ch-chip">
          Muraille <b>{cz.wall}/20</b>
        </span>
        <span className="ch-chip">
          {citadel.holderTag ? (
            <>
              <i style={{ background: holderColor ?? '#f1cc63' }} /> Bannière <b>{citadel.holderTag}</b>
            </>
          ) : (
            'Bannière à prendre'
          )}
        </span>
        {(cz.attacks > 0 || cz.supports > 0) && (
          <span className="ch-chip" title="Armées en route vers la Citadelle (leur origine reste secrète)">
            <b className="ch-atk">{cz.attacks}</b> attaque{cz.attacks > 1 ? 's' : ''} · <b className="ch-sup">{cz.supports}</b> renfort{cz.supports > 1 ? 's' : ''} en marche
          </span>
        )}
      </div>
      {last && <p className="ch-last">{last.text}</p>}
      <a className="ch-link" href="#/croisade">
        Chronique et gloire
      </a>
    </div>
  );
}
