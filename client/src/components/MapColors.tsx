import { useMemo, useState } from 'react';
import type { MapVillage } from '@aldoria/shared';
import { MARK_PALETTE, REL_COLORS, REL_LABELS, type Mark, type Relation } from './mapStyle';

/** Panneau des couleurs : couleurs fixes (non modifiables) et repères personnels sur des joueurs ou des tribus. */
export default function MapColors({
  marks,
  villages,
  selfId,
  selfTribeId,
  onChange,
  onClose,
}: {
  marks: Mark[];
  villages: MapVillage[];
  selfId: number;
  selfTribeId: number | null;
  onChange: (marks: Mark[]) => void;
  onClose: () => void;
}) {
  const [kind, setKind] = useState<Mark['kind']>('player');
  const [query, setQuery] = useState('');
  const [color, setColor] = useState(MARK_PALETTE[0].color);
  const [error, setError] = useState('');

  const options = useMemo(() => {
    const players = new Map<number, string>();
    const tribes = new Map<number, string>();
    for (const v of villages) {
      if (v.ownerId && v.ownerName && v.ownerId !== selfId) players.set(v.ownerId, v.ownerName);
      if (v.tribeId && v.tribeTag && v.tribeId !== selfTribeId) tribes.set(v.tribeId, v.tribeTag);
    }
    const sort = (m: Map<number, string>) => [...m].map(([id, name]) => ({ id, name })).sort((a, b) => a.name.localeCompare(b.name, 'fr'));
    return { player: sort(players), tribe: sort(tribes) };
  }, [villages, selfId, selfTribeId]);

  const add = (e: React.FormEvent) => {
    e.preventDefault();
    const q = query.trim().replace(/^\[|\]$/g, '').toLowerCase();
    const found = options[kind].find((o) => o.name.toLowerCase() === q);
    if (!found) return setError(kind === 'player' ? 'Aucun joueur de ce nom sur la carte.' : 'Aucune tribu avec ce tag sur la carte.');
    const rest = marks.filter((m) => !(m.kind === kind && m.id === found.id));
    onChange([...rest, { kind, id: found.id, name: found.name, color }]);
    setQuery('');
    setError('');
  };

  const fixed: Relation[] = ['own', 'active', 'tribe', 'ally', 'war', 'other', 'barbarian'];
  return (
    <aside className="map-panel" aria-label="Couleurs de la carte">
      <header>
        <h3>Couleurs de la carte</h3>
        <button className="map-close" onClick={onClose} aria-label="Fermer">
          ✕
        </button>
      </header>

      <section>
        <h4>Couleurs fixes</h4>
        <ul className="mc-fixed">
          {fixed.map((r) => (
            <li key={r}>
              <i style={{ background: REL_COLORS[r] }} />
              {REL_LABELS[r]}
            </li>
          ))}
        </ul>
      </section>

      <section>
        <h4>Mes repères</h4>
        <p className="muted small">Choisissez un joueur ou une tribu pour le repérer d'une couleur à vous, sur la carte et la mini-map. Les couleurs fixes restent prioritaires.</p>
        {marks.length === 0 ? (
          <p className="muted small">Aucun repère pour l'instant.</p>
        ) : (
          <ul className="mc-marks">
            {marks.map((m) => (
              <li key={`${m.kind}${m.id}`}>
                <span className="mc-palette">
                  {MARK_PALETTE.map((p) => (
                    <button
                      key={p.color}
                      type="button"
                      className={p.color === m.color ? 'on' : ''}
                      style={{ background: p.color }}
                      aria-label={p.name}
                      onClick={() => onChange(marks.map((x) => (x === m ? { ...x, color: p.color } : x)))}
                    />
                  ))}
                </span>
                <span className="mc-name">
                  <small>{m.kind === 'tribe' ? 'Tribu' : 'Joueur'}</small> {m.kind === 'tribe' ? `[${m.name}]` : m.name}
                </span>
                <button type="button" className="map-close" aria-label="Retirer" onClick={() => onChange(marks.filter((x) => x !== m))}>
                  ✕
                </button>
              </li>
            ))}
          </ul>
        )}

        <form className="mc-add" onSubmit={add}>
          <div className="mc-kind" role="radiogroup">
            {(['player', 'tribe'] as const).map((k) => (
              <button key={k} type="button" role="radio" aria-checked={kind === k} className={kind === k ? 'on' : ''} onClick={() => setKind(k)}>
                {k === 'player' ? 'Joueur' : 'Tribu'}
              </button>
            ))}
          </div>
          <input list="mc-options" value={query} onChange={(e) => setQuery(e.target.value)} placeholder={kind === 'player' ? 'Pseudo du joueur' : 'Tag de la tribu'} />
          <datalist id="mc-options">
            {options[kind].map((o) => (
              <option key={o.id} value={o.name} />
            ))}
          </datalist>
          <span className="mc-palette">
            {MARK_PALETTE.map((p) => (
              <button key={p.color} type="button" className={p.color === color ? 'on' : ''} style={{ background: p.color }} aria-label={p.name} onClick={() => setColor(p.color)} />
            ))}
          </span>
          {error && <p className="small mc-error">{error}</p>}
          <button className="btn primary small">Ajouter le repère</button>
        </form>
      </section>
    </aside>
  );
}
