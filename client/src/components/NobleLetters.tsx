import { useState } from 'react';
import { LETTER_TOWNHALL, lettersAffordable, lettersCost, type Resources, type VillageState } from '@aldoria/shared';
import { api } from '../api';
import { fmt } from '../format';
import { useGame } from '../game';
import { Cost, ResIcon } from '../ui';
import { CardTitle } from './PageBanner';

const TREASURY = ['wood', 'clay', 'iron'] as const;
type Gift = Record<(typeof TREASURY)[number], string>;
const NO_GIFT: Gift = { wood: '', clay: '', iron: '' };
const ordinal = (k: number) => (k === 1 ? '1er' : `${k}e`);

/**
 * Carte de l'hôtel de ville : la cagnotte de noblesse, commune à tous les villages du compte, et la frappe des lettres,
 * qui doivent couvrir villages + nobles ; chacune renchérit la suivante d'une part du prix de base.
 */
export default function NobleLetters({ v, res }: { v: VillageState; res: Resources }) {
  const { run, setVillage } = useGame();
  const [gift, setGift] = useState<Gift>(NO_GIFT);
  const [count, setCount] = useState('');
  const n = v.nobility;
  if (!n.enabled) return null;
  const locked = v.buildings.townhall < LETTER_TOWNHALL;
  const max = lettersAffordable(n.treasury, n.base, n.increase, n.minted);
  const rank = n.minted + 1;
  // Nobles installés dans les villages conquis (le premier village n'en a pas demandé) : ils gardent leur lettre.
  const settled = Math.max(0, n.villages - 1);
  const next = settled + n.nobles + 1;
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
        <CardTitle icon="couronne" count={`${fmt(n.minted)} frappée${n.minted > 1 ? 's' : ''}`}>
          Lettres de noblesse
        </CardTitle>
      </header>

      <div className="th-letters-body">
        <div className="th-letters-stock">
          <b>{fmt(n.free)}</b>
          <span className="muted small">noble{n.free > 1 ? 's' : ''} sans nouvelle lettre</span>
        </div>
        <div className="th-letters-rule">
          <p>
            Chaque noble a sa lettre : le 1er noble demande 1 lettre, le 2e une lettre au prix de 2, le 3e une lettre au prix de 3, et
            ainsi de suite.
          </p>
          <p>
            Votre prochain noble sera votre <b>{ordinal(next)}</b>
            {settled > 0 && (
              <>
                {' '}
                ({settled} installé{settled > 1 ? 's' : ''} dans vos villages conquis
                {n.nobles > 0 && <>, {n.nobles} dans votre armée</>})
              </>
            )}
            {settled === 0 && n.nobles > 0 && <> ({n.nobles} dans votre armée)</>}
            {n.free > 0 ? (
              <> : sa lettre est déjà frappée.</>
            ) : next - n.minted > 1 ? (
              <>
                {' '}: frappez les lettres n° {rank} à {next}.
              </>
            ) : (
              <>
                {' '}: frappez sa lettre, la n° {rank}, pour <Cost cost={n.price} />.
              </>
            )}
          </p>
          <p className="muted small">
            Un noble mort se remplace sans nouvelle lettre. Un noble qui prend un village garde sa lettre.
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
            de quoi frapper {fmt(max)} lettre{max > 1 ? 's' : ''}
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
              Payé par la cagnotte : <Cost cost={lettersCost(n.base, n.increase, n.minted, wanted)} have={n.treasury} />
            </span>
          )}
        </div>
      )}
    </section>
  );
}
