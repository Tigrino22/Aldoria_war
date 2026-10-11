import { useState } from 'react';
import type { CommandView } from '@aldoria/shared';
import { clockTime } from '../format';
import { Countdown, PlayerLink } from '../ui';

/** Liste précise des attaques et soutiens en approche : origine, type et heure d'arrivée, sans jamais la composition des troupes. */
export default function IncomingDetail({ incoming }: { incoming: CommandView[] }) {
  const [open, setOpen] = useState(false);
  const list = incoming.filter((c) => c.type === 'attack' || c.type === 'support');
  if (!list.length) return null;
  return (
    <div className="incoming-detail">
      <button className="link" onClick={() => setOpen(!open)} aria-expanded={open}>
        {open ? 'Masquer le détail' : 'Voir le détail'}
      </button>
      {open && (
        <ul className="movements">
          {list.map((c) => (
            <li key={c.id} className={`movement ${c.type === 'attack' ? 'hostile' : ''} type-${c.type}`}>
              <span className="mv-type">{c.type === 'attack' ? 'Attaque' : 'Soutien'}</span>
              <span>
                de <a href={`#/carte/${c.origin.x},${c.origin.y}`}>{c.origin.name} ({c.origin.x}|{c.origin.y})</a>
                {c.origin.ownerName && <span className="muted"> · <PlayerLink name={c.origin.ownerName} /></span>}
                <span className="muted"> → {c.target.name} ({c.target.x}|{c.target.y})</span>
              </span>
              <span className="mv-time">
                <Countdown to={c.arriveAt} />
                <span className="muted small">{clockTime(c.arriveAt)}</span>
              </span>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}
