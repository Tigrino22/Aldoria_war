import { useEffect, useState } from 'react';
import type { CrusadeState } from '@aldoria/shared';
import { api } from '../api';
import { useNow } from '../game';
import { Countdown } from '../ui';
import { NavIcon } from './NavIcon';

/** Croisade annoncée ou en cours, partagée entre les écrans qui l'affichent (lue au plus une fois par minute). */
let cached: { at: number; state: CrusadeState | null } | null = null;
export function useCrusade(): CrusadeState | null {
  const [state, setState] = useState<CrusadeState | null>(cached?.state ?? null);
  useEffect(() => {
    let alive = true;
    const load = () => {
      if (cached && Date.now() - cached.at < 60_000) return setState(cached.state);
      api<CrusadeState>('/api/crusade')
        .then((s) => {
          cached = { at: Date.now(), state: s };
          if (alive) setState(s);
        })
        .catch(() => {});
    };
    load();
    const timer = window.setInterval(load, 60_000);
    return () => {
      alive = false;
      window.clearInterval(timer);
    };
  }, []);
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
