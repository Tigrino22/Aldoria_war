import './tribe-provinces.css';
import { useEffect, useState } from 'react';
import { PROVINCE_BONUS_LABEL, type ProvinceBonus, type TribeHeldProvince, type TribeProvincesView, type TribeRelation } from '@aldoria/shared';
import { api } from '../api';
import { clockTime, fmt } from '../format';
import { useGame } from '../game';
import { Countdown, PlayerLink } from '../ui';
import { REL_COLORS } from './mapStyle';
import { NavIcon } from './NavIcon';
import { progress } from './TribeTools';

/** Couleurs fixes de la carte : bleu pour la tribu, bleu ciel pour les alliés, rouge vif pour les ennemis, rouge foncé pour les autres. */
const REL: Record<TribeRelation, string> = { mine: REL_COLORS.tribe, ally: REL_COLORS.ally, war: REL_COLORS.war, other: REL_COLORS.other };
const NEUTRAL = '#5b4a32';

const date = (iso: string) => new Date(iso).toLocaleDateString('fr-FR', { day: 'numeric', month: 'short', hour: '2-digit', minute: '2-digit' });

/** « depuis 3 j 4 h » : temps de tenue d'une bannière. */
function heldFor(iso: string) {
  const h = Math.max(0, Math.floor((Date.now() - Date.parse(iso)) / 3_600_000));
  if (h < 1) return "moins d'une heure";
  if (h < 24) return `${h} h`;
  return `${Math.floor(h / 24)} j${h % 24 ? ` ${h % 24} h` : ''}`;
}

function Tier({ tier }: { tier: number }) {
  return tier ? <span className={`tp-tier t${tier}`}>Niv. {tier}</span> : <span className="tp-tier holy">Terre sainte</span>;
}

/** Bonus actifs de la tribu (provinces contrôlées) et ceux qui arrivent (bannières encore en tenue). */
function Bonuses({ held }: { held: TribeHeldProvince[] }) {
  const sum = (ctrl: boolean) => {
    const out = new Map<ProvinceBonus, number>();
    for (const p of held) if (p.bonus && p.controlled === ctrl) out.set(p.bonus, (out.get(p.bonus) ?? 0) + p.bonusPercent);
    return [...out.entries()];
  };
  const active = sum(true);
  const coming = sum(false);
  if (!active.length && !coming.length) return <p className="muted small">Aucun bonus pour l'instant : contrôlez une province pour en profiter dans tous les villages de la tribu.</p>;
  return (
    <ul className="tp-bonuses">
      {active.map(([b, v]) => (
        <li key={`a${b}`} className="tp-bonus">
          {PROVINCE_BONUS_LABEL[b]} <b>+{v} %</b>
        </li>
      ))}
      {coming.map(([b, v]) => (
        <li key={`c${b}`} className="tp-bonus coming" title="Bonus obtenu quand la tenue aboutira">
          {PROVINCE_BONUS_LABEL[b]} <b>+{v} %</b> <span>à venir</span>
        </li>
      ))}
    </ul>
  );
}

/** Un bastion de la tribu : tenue, garnison et attaques en approche. */
function HeldProvince({ p, holdHours }: { p: TribeHeldProvince; holdHours: number }) {
  const pct = p.controlled ? 100 : progress(p.holderSince, p.controlAt);
  return (
    <li className={`tp-prov ${p.controlled ? 'done' : 'pending'} ${p.kind === 'holy' ? 'holy' : ''} ${p.incoming.count ? 'threat' : ''}`}>
      <div className="tp-prov-head">
        <Tier tier={p.tier} />
        <b className="tp-prov-name">{p.name}</b>
        {p.bastion && (
          <a className="btn small ghost tp-coords" href={`#/carte/${p.bastion.x},${p.bastion.y}`} title={`Voir ${p.bastion.name} sur la carte`}>
            {p.bastion.x}|{p.bastion.y}
          </a>
        )}
      </div>
      <div className="tp-prov-facts">
        {p.bonus && (
          <span className="tp-fact gold">
            {PROVINCE_BONUS_LABEL[p.bonus]} +{p.bonusPercent} %
          </span>
        )}
        {p.kind === 'holy' && <span className="tp-fact gold">Victoire du monde</span>}
        {p.holyNeighbour && <span className="tp-fact">Borde la Terre sainte</span>}
      </div>
      {p.controlled ? (
        <p className="tp-status ok">
          <NavIcon name="banniere" size={16} /> Contrôlée depuis le {date(p.controlAt)} · bannière tenue depuis {heldFor(p.holderSince)}
        </p>
      ) : (
        <div className="tp-hold">
          <div className="tp-hold-line">
            <span>
              <NavIcon name="banniere" size={16} /> Bannière plantée le {date(p.holderSince)}
            </span>
            <span>
              {p.kind === 'holy' ? 'Victoire' : 'Contrôle'} dans <Countdown to={p.controlAt} />
            </span>
          </div>
          <div className="tp-gauge" role="progressbar" aria-valuenow={Math.round(pct)} aria-valuemin={0} aria-valuemax={100} aria-label="Tenue de la bannière">
            <i style={{ width: `${pct}%` }} />
          </div>
          <span className="muted small">
            {p.kind === 'holy' ? 'Tenue de la Terre sainte' : `${holdHours} h de tenue`}, jusqu'au {date(p.controlAt)}. Si la bannière tombe avant, tout est à refaire.
          </span>
        </div>
      )}
      <div className="tp-garrison">
        <span className="tp-garrison-sum">
          <NavIcon name="bouclier" size={16} /> Garnison <b>{fmt(p.garrison.population)}</b> pop.
          {p.bastion && <span className="muted"> · muraille {p.bastion.wall}</span>}
        </span>
        {p.garrison.defenders.length > 0 ? (
          <ul className="tp-defenders">
            {p.garrison.defenders.map((d) => (
              <li key={d.name}>
                {d.tag && <span className="muted">[{d.tag}] </span>}
                {d.name === 'Garde neutre' ? d.name : <PlayerLink name={d.name} />} <b>{fmt(d.population)}</b>
              </li>
            ))}
          </ul>
        ) : (
          <span className="tp-warn small">Bastion vide : renforcez-le vite.</span>
        )}
      </div>
      {p.incoming.count > 0 && (
        <p className="tp-incoming">
          ⚔ {p.incoming.count} attaque{p.incoming.count > 1 ? 's' : ''} en approche · la première dans <Countdown to={p.incoming.next!} />
          <span className="small"> ({clockTime(p.incoming.next!)})</span>
        </p>
      )}
    </li>
  );
}

/** La route vers le Sanctuaire : provinces qui bordent la Terre sainte et qui les tient. */
function HolyRoad({ holy, holyAccess }: { holy: NonNullable<TribeProvincesView['holy']>; holyAccess: number }) {
  return (
    <section className="tr-card tp-holy">
      <header className="tr-card-head">
        <h3 className="tr-h">Route de la Terre sainte</h3>
        {holy.bastion && (
          <a className="link small" href={`#/carte/${holy.bastion.x},${holy.bastion.y}`}>
            Sanctuaire {holy.bastion.x}|{holy.bastion.y}
          </a>
        )}
      </header>
      <div className="tp-steps" aria-label={`${holy.neighboursHeld} provinces sur ${holyAccess}`}>
        {Array.from({ length: holyAccess }, (_, i) => (
          <i key={i} className={i < holy.neighboursHeld ? 'on' : ''} />
        ))}
      </div>
      <p className="small">
        {holy.canAttack ? (
          <b className="tp-ok">Le Sanctuaire est ouvert à votre tribu.</b>
        ) : (
          <>
            <b>
              {holy.neighboursHeld}/{holyAccess}
            </b>{' '}
            provinces voisines contrôlées : il en faut {holyAccess} pour attaquer le Sanctuaire.
          </>
        )}{' '}
        {holy.holder ? (
          <>
            Terre sainte tenue par{' '}
            <b style={{ color: holy.holder.relation === 'mine' ? undefined : REL[holy.holder.relation] }}>
              {holy.holder.relation === 'mine' ? 'votre tribu' : `[${holy.holder.tag}] ${holy.holder.name}`}
            </b>
            .
          </>
        ) : (
          'Aucune tribu ne tient encore la Terre sainte.'
        )}
      </p>
      <ul className="tp-around">
        {holy.around.map((a) => (
          <li key={a.id}>
            <span className={`tp-dot ${a.holder && !a.controlled ? 'pale' : ''}`} style={{ background: a.holder ? REL[a.holder.relation] : NEUTRAL }} />
            <span className="tr-grow">
              <span className="tp-around-name">{a.name}</span>
              <span className="muted small">
                {!a.holder ? 'Sans maître' : a.holder.relation === 'mine' ? (a.controlled ? 'Contrôlée par votre tribu' : 'Votre bannière, tenue en cours') : `[${a.holder.tag}] ${a.controlled ? 'la contrôle' : 'tient la bannière'}`}
              </span>
            </span>
            {a.bastion && (
              <a className="btn small ghost" href={`#/carte/${a.bastion.x},${a.bastion.y}`}>
                {a.bastion.x}|{a.bastion.y}
              </a>
            )}
          </li>
        ))}
      </ul>
    </section>
  );
}

/** Onglet « Provinces » de la tribu : où en est la conquête, pour tous les membres. */
export default function TribeProvinces({ onCount }: { onCount?: (n: number) => void }) {
  const { run } = useGame();
  const [view, setView] = useState<TribeProvincesView | null>(null);
  useEffect(() => {
    const load = () => api<TribeProvincesView>('/api/tribes/mine/provinces').then(setView);
    run(load);
    const t = window.setInterval(() => load().catch(() => {}), 30_000);
    return () => window.clearInterval(t);
  }, [run]);
  useEffect(() => {
    if (view) onCount?.(view.held.length);
  }, [view, onCount]);
  if (!view) return <p className="muted">Chargement des provinces…</p>;

  const controlled = view.held.filter((p) => p.controlled).length;
  const pending = view.held.length - controlled;
  const threatened = view.held.reduce((n, p) => n + p.incoming.count, 0);

  return (
    <div className="tr-grid tp-page">
      <div className="tr-main">
        {!view.enabled && <p className="warn">Les provinces sont désactivées sur ce monde.</p>}
        <section className="tr-card tp-summary">
          <div className="tp-tiles">
            <div className="tp-tile">
              <b>{controlled}</b>
              <span>contrôlée{controlled > 1 ? 's' : ''}</span>
            </div>
            <div className="tp-tile gold">
              <b>{pending}</b>
              <span>en cours de tenue</span>
            </div>
            <div className="tp-tile sky">
              <b>{view.assaults.length}</b>
              <span>assaut{view.assaults.length > 1 ? 's' : ''} en route</span>
            </div>
            <div className={`tp-tile ${threatened ? 'red' : ''}`}>
              <b>{threatened}</b>
              <span>attaque{threatened > 1 ? 's' : ''} sur nos bastions</span>
            </div>
          </div>
          <div>
            <h4 className="tr-sub">Bonus de la tribu</h4>
            <Bonuses held={view.held} />
          </div>
        </section>

        <section className="tr-card">
          <header className="tr-card-head">
            <h3 className="tr-h">
              Bastions de la tribu <span className="tr-count">{view.held.length}</span>
            </h3>
            <a className="link small" href="#/provinces">
              Toutes les provinces
            </a>
          </header>
          {view.held.length === 0 ? (
            <div className="tr-empty">
              <span className="tr-empty-icon" aria-hidden="true">
                <NavIcon name="banniere" size={30} />
              </span>
              <b>Aucune bannière de la tribu ne flotte pour l'instant</b>
              <p className="muted small">
                Videz un bastion avec une attaque qui emmène un noble : s'il survit, il plante la bannière de la tribu. Tenez ensuite {view.holdHours} heures pour contrôler la province et gagner son bonus.
              </p>
              <a className="btn small" href="#/provinces">
                Choisir une province
              </a>
            </div>
          ) : (
            <ul className="tp-list">
              {view.held.map((p) => (
                <HeldProvince key={p.id} p={p} holdHours={view.holdHours} />
              ))}
            </ul>
          )}
        </section>

        {view.assaults.length > 0 && (
          <section className="tr-card">
            <header className="tr-card-head">
              <h3 className="tr-h">
                Assauts en route <span className="tr-count">{view.assaults.length}</span>
              </h3>
            </header>
            <ul className="tp-assaults">
              {view.assaults.map((a) => (
                <li key={a.id}>
                  <div className="tp-assault-main">
                    <span>
                      <PlayerLink name={a.attacker} /> <span className="muted">→</span>{' '}
                      <a href={`#/carte/${a.bastion.x},${a.bastion.y}`}>
                        {a.bastion.name} ({a.bastion.x}|{a.bastion.y})
                      </a>
                    </span>
                    <span className="small">
                      <Tier tier={a.tier} /> {a.province}
                      {a.holder ? (
                        <>
                          {' '}
                          · tenue par <b style={{ color: REL[a.holder.relation] }}>[{a.holder.tag}]</b>
                        </>
                      ) : (
                        <span className="muted"> · garde neutre</span>
                      )}
                    </span>
                    <span className={`tp-noble ${a.withNoble ? 'yes' : ''}`}>{a.withNoble ? 'Avec un noble : peut planter la bannière' : 'Sans noble : peut seulement abattre la bannière'}</span>
                  </div>
                  <div className="mv-time">
                    <Countdown to={a.arriveAt} />
                    <span className="muted small">{clockTime(a.arriveAt)}</span>
                  </div>
                  <div className="tp-gauge thin" aria-hidden="true">
                    <i style={{ width: `${progress(a.sentAt, a.arriveAt)}%` }} />
                  </div>
                </li>
              ))}
            </ul>
          </section>
        )}
      </div>

      <aside className="tr-side">
        {view.holy && <HolyRoad holy={view.holy} holyAccess={view.holyAccess} />}
        <section className="tr-card">
          <header className="tr-card-head">
            <h3 className="tr-h">
              Trésors de bastion <span className="tr-count">{view.treasures.length}</span>
            </h3>
          </header>
          {view.myUnusedTreasures > 0 && (
            <a className="tp-unused" href="#/inventaire">
              <NavIcon name="tresor" size={20} />
              <span>
                Vous avez <b>{view.myUnusedTreasures}</b> trésor{view.myUnusedTreasures > 1 ? 's' : ''} à utiliser dans votre inventaire
              </span>
            </a>
          )}
          {view.treasures.length === 0 ? (
            <p className="muted small">À la prise de contrôle d'une province, chaque membre reçoit un trésor qui remplit une part de l'entrepôt d'un village (une fois par province).</p>
          ) : (
            <ul className="tp-treasures">
              {view.treasures.map((t) => (
                <li key={`${t.province}${t.at}`}>
                  <Tier tier={t.tier} />
                  <span className="tr-grow">{t.province}</span>
                  <span className="muted small">{new Date(t.at).toLocaleDateString('fr-FR', { day: 'numeric', month: 'short' })}</span>
                </li>
              ))}
            </ul>
          )}
        </section>
      </aside>
    </div>
  );
}
