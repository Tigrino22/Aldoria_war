import { useState } from 'react';
import { LETTER_BATCH_MAX, LETTER_TOWNHALL, RESOURCES, lettersForNobles, scaleResources, type Resources, type VillageState } from '@aldoria/shared';
import { api } from '../api';
import { fmt } from '../format';
import { useGame } from '../game';
import { Cost } from '../ui';
import { CardTitle } from './PageBanner';

/** Lettres que le village peut frapper avec ses ressources du moment. */
function affordable(res: Resources, price: Resources): number {
  let max = LETTER_BATCH_MAX;
  for (const r of RESOURCES) if (price[r] > 0) max = Math.min(max, Math.floor(res[r] / price[r]));
  return Math.max(0, max);
}

/** Carte de l'hôtel de ville : frapper des lettres de noblesse, que chaque noble consomme (une de plus à chaque noble). */
export default function NobleLetters({ v, res }: { v: VillageState; res: Resources }) {
  const { run, setVillage } = useGame();
  const [count, setCount] = useState('');
  const n = v.nobility;
  if (!n.enabled) return null;
  const locked = v.buildings.townhall < LETTER_TOWNHALL;
  const max = affordable(res, n.price);
  const wanted = Number(count || 0);
  const nextFour = [0, 1, 2, 3].map((i) => lettersForNobles(n.villages, n.nobles + i, 1, n.step));

  const mint = () =>
    run(async () => {
      setVillage(await api(`/api/villages/${v.id}/letters`, { body: { count: wanted } }));
      setCount('');
    });

  return (
    <section className="pg-card th-letters">
      <header className="pg-card-head">
        <CardTitle icon="couronne" count={fmt(n.letters)}>
          Lettres de noblesse
        </CardTitle>
      </header>
      <div className="th-letters-body">
        <div className="th-letters-stock">
          <b>{fmt(n.letters)}</b>
          <span className="muted small">lettre{n.letters > 1 ? 's' : ''} en réserve (tout le compte)</span>
        </div>
        <div className="th-letters-rule">
          <p>
            Votre prochain noble demande <b>{n.next} lettre{n.next > 1 ? 's' : ''}</b>
            {n.letters >= n.next ? ' : vous les avez.' : `, il en manque ${n.next - n.letters}.`}
          </p>
          <p className="muted small">
            {n.villages} village{n.villages > 1 ? 's' : ''} et {n.nobles} noble{n.nobles > 1 ? 's' : ''} en vie : chaque noble suivant demande {n.step === 0 ? 'toujours une lettre' : `${n.step} lettre${n.step > 1 ? 's' : ''} de plus`} ({nextFour.join(', ')}…). Un noble mort en route ne rend pas ses lettres.
          </p>
        </div>
      </div>
      <div className="bp-cost">
        <span className="muted small">Une lettre :</span> <Cost cost={n.price} have={res} />
      </div>
      {locked ? (
        <p className="warn small">Hôtel de ville niveau {LETTER_TOWNHALL} nécessaire pour frapper des lettres.</p>
      ) : (
        <div className="row wrap">
          <input
            aria-label="Nombre de lettres"
            type="number"
            min={1}
            max={max}
            inputMode="numeric"
            placeholder="Nombre"
            value={count}
            onChange={(e) => setCount(e.target.value)}
          />
          <button className="btn small ghost" onClick={() => setCount(String(Math.max(1, Math.min(max, Math.max(1, n.next - n.letters)))))}>
            pour le prochain noble
          </button>
          <button className="btn small ghost" onClick={() => setCount(String(max))}>
            max {fmt(max)}
          </button>
          <button className="btn primary" disabled={wanted < 1 || wanted > max} onClick={mint}>
            Frapper
          </button>
          {wanted > 0 && (
            <span className="muted small">
              Total : <Cost cost={scaleResources(n.price, wanted)} have={res} />
            </span>
          )}
        </div>
      )}
    </section>
  );
}
