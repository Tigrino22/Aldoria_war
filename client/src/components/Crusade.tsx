import { useEffect, useState } from 'react';
import { CITADEL_WALL, CRUSADE_GLORY, RELIC_DAYS, WEEKDAY_NAMES, type CrusadeLogEntry, type CrusadeState, type CrusadeSummary } from '@aldoria/shared';
import { api } from '../api';
import { CITADEL_IMG } from '../assets';
import { fmt } from '../format';
import { useGame, useNow } from '../game';
import { Countdown, PlayerLink } from '../ui';
import { NavIcon, type NavIconName } from './NavIcon';
import { CardTitle, PageBanner } from './PageBanner';
import './crusade.css';

/** Date lisible d'une ouverture : « mercredi 8 mai à 20:30 ». */
const when = (iso: string) => {
  const d = new Date(iso);
  return `${d.toLocaleDateString('fr-FR', { weekday: 'long', day: 'numeric', month: 'long' })} à ${d.toLocaleTimeString('fr-FR', { hour: '2-digit', minute: '2-digit' })}`;
};
const hour = (iso: string) => new Date(iso).toLocaleTimeString('fr-FR', { hour: '2-digit', minute: '2-digit' });

const side = (s: CrusadeSummary['winner']) => (s ? (s.tribeTag ? `[${s.tribeTag}] ${s.tribeName}` : (s.tribeName ?? s.playerName ?? '–')) : null);
const ordinal = (n: number) => (n === 1 ? '1er' : `${n}e`);

const LOG_ICON: Record<CrusadeLogEntry['kind'], NavIconName> = {
  announce: 'rapports',
  open: 'porte',
  breach: 'muraille',
  capture: 'banniere',
  fall: 'caserne',
  win: 'couronne',
  hold: 'bouclier',
};

/**
 * Croisades : la Citadelle annoncée, la fenêtre d'assaut, la bannière, la chronique et la gloire.
 * Rafraîchie toutes les 15 secondes pendant l'assaut, toutes les minutes sinon.
 */
export default function Crusade() {
  const { me, run } = useGame();
  const now = useNow();
  const [state, setState] = useState<CrusadeState | null>(null);
  const phase = state?.current?.phase;
  useEffect(() => {
    let alive = true;
    const load = () => api<CrusadeState>('/api/crusade').then((s) => alive && setState(s)).catch(() => {});
    run(load);
    const timer = window.setInterval(load, phase === 'open' ? 15_000 : 60_000);
    return () => {
      alive = false;
      window.clearInterval(timer);
    };
  }, [run, phase]);

  if (!state) return <p className="muted">Chargement de la croisade…</p>;
  const cr = state.current;
  const live = cr && cr.phase !== 'ended';
  // Le compte à rebours bascule de lui-même à l'ouverture, avant la prochaine actualisation.
  const opened = cr ? now >= Date.parse(cr.opensAt) : false;
  const days = state.schedule.weekdays.map((d) => WEEKDAY_NAMES[d]).join(' et ');
  const myGlory = state.me?.glory ?? 0;
  const myRank = state.scores.find((s) => s.playerId === me.player.id)?.rank;

  return (
    <div className="pg crusade">
      <PageBanner
        media={<img src={CITADEL_IMG} alt="" width={96} height={74} />}
        kicker="Armée · grand raid"
        title={live ? <>Croisade : <em>{cr!.name}</em></> : 'Croisades'}
        lead={
          <>
            Deux soirs par semaine, <b>{days}</b> à <b>{state.schedule.time}</b>, une Citadelle surgit sur la carte. Ses portes restent ouvertes {state.schedule.minutes} minutes : faites tomber sa muraille,
            plantez la bannière de votre tribu avec un noble et tenez-la jusqu'à la fermeture.
          </>
        }
        chips={
          !state.enabled ? (
            <span className="pg-pill">Croisades suspendues par l'administration</span>
          ) : live ? (
            <span className={`pg-pill ${opened ? 'war' : 'gold'}`}>{opened ? 'Assaut en cours' : 'Citadelle annoncée'}</span>
          ) : null
        }
        stats={
          cr
            ? [
                { value: `${cr.wall} / ${CITADEL_WALL}`, label: 'muraille', tone: cr.wall === 0 ? 'red' : '' },
                { value: cr.holder ? (cr.holder.tribeTag ?? cr.holder.playerName) : cr.winner ? (cr.winner.tribeTag ?? cr.winner.tribeName ?? cr.winner.playerName) : 'aucune', label: cr.phase === 'ended' ? 'vainqueur' : 'bannière', tone: 'gold' },
                { value: fmt(myGlory), label: myRank ? `votre gloire · ${ordinal(myRank)}` : 'votre gloire', tone: 'sky' },
                { value: fmt(cr.treasure), label: 'trésor par ressource' },
              ]
            : undefined
        }
      />

      <section className="pg-card cz-hero">
        <div className="cz-art">
          <img src={CITADEL_IMG} alt="La Citadelle" />
          {cr?.holder && live && (
            <span className="cz-flag">
              <NavIcon name="croisade" size={16} />
              {cr.holder.tribeTag ? `[${cr.holder.tribeTag}]` : cr.holder.playerName}
            </span>
          )}
        </div>
        <div className="cz-hero-txt">
          {live ? (
            <>
              <span className="cz-label">{opened ? 'Les portes se ferment dans' : 'Les portes s’ouvrent dans'}</span>
              <span className="cz-clock">
                <Countdown to={opened ? cr!.closesAt : cr!.opensAt} />
              </span>
              <p className="cz-window">
                Fenêtre d'assaut : {when(cr!.opensAt)} jusqu'à {hour(cr!.closesAt)}. Vos troupes doivent <b>arriver</b> pendant cette heure ; les éclaireurs peuvent partir dès maintenant.
              </p>
              <div className="cz-wall" aria-label={`Muraille ${cr!.wall} sur ${CITADEL_WALL}`}>
                <span className="pg-progress">
                  <i style={{ width: `${(cr!.wall / CITADEL_WALL) * 100}%` }} />
                </span>
                <span className="muted">{cr!.breachedAt ? `Brèche ouverte à ${hour(cr!.breachedAt)}` : `Muraille niveau ${cr!.wall} : il faut des béliers`}</span>
              </div>
              <div className="cz-actions">
                <a className="btn gold" href={`#/ralliement/${cr!.x},${cr!.y}`}>
                  Programmer l'assaut
                </a>
                <a className="btn" href={`#/carte/${cr!.x},${cr!.y}`}>
                  Voir sur la carte ({cr!.x}|{cr!.y})
                </a>
              </div>
            </>
          ) : (
            <>
              <span className="cz-label">Prochaine croisade</span>
              {state.nextOpening ? (
                <>
                  <span className="cz-clock">
                    <Countdown to={state.nextOpening} />
                  </span>
                  <p className="cz-window">
                    Ouverture {when(state.nextOpening)}. La Citadelle sera annoncée {state.schedule.noticeHours} heures avant : vous aurez le temps d'espionner et de préparer vos ordres au point de ralliement.
                  </p>
                </>
              ) : (
                <p className="cz-window">Aucune croisade n'est prévue pour l'instant.</p>
              )}
              {cr?.winner && (
                <p className="cz-window">
                  Dernière croisade : <b>{side(cr.winner)}</b> a tenu {cr.name}.
                </p>
              )}
            </>
          )}
        </div>
      </section>

      <div className="pg-grid">
        <div className="pg-col">
          <section className="pg-card">
            <div className="pg-card-head">
              <CardTitle icon="classement" count={state.scores.length || undefined}>
                Gloire de la croisade
              </CardTitle>
              <a href="#/classement/gloire">Classement de la saison</a>
            </div>
            {state.scores.length === 0 ? (
              <div className="pg-empty">
                <NavIcon name="croisade" size={28} />
                Personne n'a encore combattu à la Citadelle.
              </div>
            ) : (
              <div className="table-wrap">
                <table className="rank-table">
                  <thead>
                    <tr>
                      <th>#</th>
                      <th>Joueur</th>
                      <th>Gloire</th>
                      <th className="cz-hide-sm">Tués</th>
                      <th className="cz-hide-sm">Exploits</th>
                    </tr>
                  </thead>
                  <tbody>
                    {state.scores.map((s) => (
                      <tr key={s.playerId} className={s.playerId === me.player.id ? 'me' : ''}>
                        <td>
                          <span className={`rk-rank r${s.rank}`}>{s.rank}</span>
                        </td>
                        <td>
                          <PlayerLink name={s.username} /> {s.tribeTag && <span className="muted">[{s.tribeTag}]</span>}
                          {s.title && <span className="cz-title">{s.title}</span>}
                        </td>
                        <td>
                          <b>{fmt(s.glory)}</b>
                        </td>
                        <td className="cz-hide-sm">{fmt(s.kills)}</td>
                        <td className="cz-hide-sm">
                          <span className="cz-feats">
                            {s.breaches > 0 && (
                              <span title="A ouvert la brèche">
                                <NavIcon name="muraille" size={15} />
                              </span>
                            )}
                            {s.captures > 0 && (
                              <span title="Bannières plantées">
                                <NavIcon name="banniere" size={15} />×{s.captures}
                              </span>
                            )}
                          </span>
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            )}
          </section>

          <section className="pg-card">
            <CardTitle icon="rapports">Chronique</CardTitle>
            {state.log.length === 0 ? (
              <p className="muted">Rien à raconter pour l'instant.</p>
            ) : (
              <ol className="cz-log">
                {state.log.map((l, i) => (
                  <li key={i} className={`k-${l.kind}`}>
                    <span className="cz-log-ico" aria-hidden>
                      <NavIcon name={LOG_ICON[l.kind]} size={16} />
                    </span>
                    <span className="cz-log-txt">{l.text}</span>
                    <time>{hour(l.at)}</time>
                  </li>
                ))}
              </ol>
            )}
          </section>
        </div>

        <div className="pg-col">
          <section className="pg-card pg-callout">
            <CardTitle icon="croisade">Comment gagner</CardTitle>
            <ol className="cz-steps">
              <li>
                <b>Espionnez</b> la Citadelle : sa garnison (lanciers, hallebardiers, épéistes) se règle sur la plus forte tribu du monde.
              </li>
              <li>
                <b>Programmez</b> vos assauts au point de ralliement pour qu'ils arrivent pendant la fenêtre, avec des béliers pour la muraille.
              </li>
              <li>
                <b>Plantez la bannière</b> : l'attaque qui vide la Citadelle doit compter un noble survivant. Vos troupes restent alors en garnison.
              </li>
              <li>
                <b>Tenez</b> jusqu'à la fermeture : seuls votre tribu et ses alliés peuvent envoyer des renforts. Les autres tenteront de vous déloger.
              </li>
            </ol>
          </section>

          <section className="pg-card">
            <CardTitle icon="tresor">Récompenses</CardTitle>
            <ul className="cz-rewards">
              <li>
                <span className="cz-rw-ico">
                  <NavIcon name="relique" size={18} />
                </span>
                <span>
                  <b>Relique</b> : +{state.relicBonus} % de production dans tous les villages du camp vainqueur pendant {RELIC_DAYS} jours.
                </span>
              </li>
              <li>
                <span className="cz-rw-ico">
                  <NavIcon name="tresor" size={18} />
                </span>
                <span>
                  <b>Trésor</b> de la Citadelle, partagé entre tous les combattants selon leur gloire.
                </span>
              </li>
              <li>
                <span className="cz-rw-ico">
                  <NavIcon name="medaille" size={18} />
                </span>
                <span>
                  <b>Titres</b> à afficher à côté de votre nom : Croisé, Briseur de murailles, Porte-étendard, Champion, Gardien de la Citadelle, Héros de la saison. <a href="#/compte">Choisir mon titre</a>
                </span>
              </li>
              <li>
                <span className="cz-rw-ico">
                  <NavIcon name="classement" size={18} />
                </span>
                <span>
                  <b>Gloire</b> : 1 par {CRUSADE_GLORY.killsPerGlory} places ennemies tuées, +{CRUSADE_GLORY.breach} pour la brèche, +{CRUSADE_GLORY.capture} par bannière plantée, +{CRUSADE_GLORY.victory} pour chaque
                  vainqueur.
                </span>
              </li>
            </ul>
          </section>

          <section className="pg-card">
            <CardTitle icon="couronne">Dernières croisades</CardTitle>
            {state.history.length === 0 ? (
              <p className="muted">Aucune croisade n'a encore eu lieu.</p>
            ) : (
              <ul className="cz-history">
                {state.history.map((h) => (
                  <li key={h.id}>
                    <span>
                      <b>{h.name}</b>
                      <span className="muted"> · {new Date(h.opensAt).toLocaleDateString('fr-FR', { day: 'numeric', month: 'short' })}</span>
                    </span>
                    <span className={h.winner ? 'cz-winner' : 'muted'}>{side(h.winner) ?? 'La Citadelle a tenu'}</span>
                  </li>
                ))}
              </ul>
            )}
          </section>
        </div>
      </div>
    </div>
  );
}
