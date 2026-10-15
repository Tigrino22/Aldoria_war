import { useState } from 'react';
import { LETTER_BATCH_MAX, LETTER_TOWNHALL, lettersAffordable, scaleResources, type Resources, type VillageState } from '@aldoria/shared';
import { api } from '../api';
import { fmt } from '../format';
import { useGame } from '../game';
import { Cost, ResIcon } from '../ui';
import { CardTitle } from './PageBanner';

const TREASURY = ['wood', 'clay', 'iron'] as const;
type Gift = Record<(typeof TREASURY)[number], string>;
const NO_GIFT: Gift = { wood: '', clay: '', iron: '' };

/**
 * Carte de l'hôtel de ville : la cagnotte de noblesse, commune à tous les villages du compte, et la frappe des lettres
 * (une par noble) dont le prix monte à chaque village possédé.
 */
export default function NobleLetters({ v, res }: { v: VillageState; res: Resources }) {
  const { run, setVillage } = useGame();
  const [gift, setGift] = useState<Gift>(NO_GIFT);
  const [count, setCount] = useState('');
  const n = v.nobility;
  if (!n.enabled) return null;
  const locked = v.buildings.townhall < LETTER_TOWNHALL;
  const max = Math.min(LETTER_BATCH_MAX, lettersAffordable(n.treasury, n.price));
  const wanted = Number(count || 0);
  const giving = TREASURY.some((r) => Number(gift[r] || 0) > 0);

  const deposit = () =>
    run(async () => {
      const body = Object.fromEntries(TREASURY.map((r) => [r, Math.min(Math.floor(res[r]), Math.max(0, Math.floor(Number(gift[r] || 0))))]));
      setVillage(await api(`/api/villages/${v.id}/treasury`, { body }));
      setGift(NO_GIFT);
    });
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
          <span className="muted small">lettre{n.letters > 1 ? 's' : ''} en réserve</span>
        </div>
        <div className="th-letters-rule">
          <p>
            Chaque noble demande <b>une lettre</b>, frappée avec la cagnotte que tous vos villages remplissent.
          </p>
          <p className="muted small">
            Avec {n.villages} village{n.villages > 1 ? 's' : ''}, une lettre coûte <Cost cost={n.price} />. Après votre prochaine conquête, elle coûtera{' '}
            <Cost cost={n.nextPrice} /> (+{n.growth} % par village). Un noble mort en route ne rend pas sa lettre.
          </p>
        </div>
      </div>

      <div className="th-treasury">
        <h4>Cagnotte du compte</h4>
        <div className="th-treasury-sum">
          {TREASURY.map((r) => (
            <span key={r}>
              <ResIcon r={r} size={18} />
              <b>{fmt(n.treasury[r])}</b>
            </span>
          ))}
          <span className="muted small">
            de quoi frapper {fmt(lettersAffordable(n.treasury, n.price))} lettre{lettersAffordable(n.treasury, n.price) > 1 ? 's' : ''}
          </span>
        </div>
        <div className="th-treasury-give">
          {TREASURY.map((r) => (
            <label key={r} className="th-give">
              <ResIcon r={r} size={16} />
              <input
                aria-label={`Verser : ${r}`}
                type="number"
                min={0}
                max={Math.floor(res[r])}
                inputMode="numeric"
                placeholder="0"
                value={gift[r]}
                onChange={(e) => setGift({ ...gift, [r]: e.target.value })}
              />
              <button className="btn small ghost" onClick={() => setGift({ ...gift, [r]: String(Math.floor(res[r])) })}>
                tout
              </button>
            </label>
          ))}
          <button className="btn small ghost" onClick={() => setGift({ wood: String(Math.floor(res.wood / 2)), clay: String(Math.floor(res.clay / 2)), iron: String(Math.floor(res.iron / 2)) })}>
            la moitié du stock
          </button>
          <button className="btn primary" disabled={!giving} onClick={deposit}>
            Verser depuis {v.name}
          </button>
        </div>
      </div>

      {locked ? (
        <p className="warn small">Hôtel de ville niveau {LETTER_TOWNHALL} nécessaire pour frapper des lettres (les autres villages peuvent toujours verser à la cagnotte).</p>
      ) : (
        <div className="row wrap">
          <input
            aria-label="Nombre de lettres"
            type="number"
            min={1}
            max={max}
            inputMode="numeric"
            placeholder="Lettres"
            value={count}
            onChange={(e) => setCount(e.target.value)}
          />
          <button className="btn small ghost" disabled={max < 1} onClick={() => setCount(String(max))}>
            max {fmt(max)}
          </button>
          <button className="btn primary" disabled={wanted < 1 || wanted > max} onClick={mint}>
            Frapper
          </button>
          {wanted > 0 && (
            <span className="muted small">
              Payé par la cagnotte : <Cost cost={scaleResources(n.price, wanted)} have={n.treasury} />
            </span>
          )}
        </div>
      )}
    </section>
  );
}
