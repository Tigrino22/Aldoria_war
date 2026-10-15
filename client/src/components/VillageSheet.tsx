import { useEffect, useState } from 'react';
import { RESOURCES, UNITS, UNIT_KEYS, distance, emptyUnits, travelTime, type VillageRelation, type VillageSheet } from '@aldoria/shared';
import { api } from '../api';
import { clockTime, duration, fmt } from '../format';
import { useGame } from '../game';
import { Countdown, PlayerLink, ResIcon, UnitIcon, UnitList } from '../ui';
import { CardTitle, PageBanner } from './PageBanner';
import './village-sheet.css';

const RELATION: Record<VillageRelation, string> = {
  mine: 'Votre village',
  tribe: 'Village de votre tribu',
  ally: 'Village allié',
  war: 'Village ennemi (guerre)',
  other: 'Village d’un autre joueur',
  barbarian: 'Village barbare',
  neutral: 'Lieu neutre',
};
const MOVE_LABEL: Record<string, string> = { attack: 'Attaque', support: 'Renfort', trade: 'Livraison' };

/**
 * Fiche d'un village (`#/fiche/x,y`) : qui le tient, où il est, ce que vos rapports en disent,
 * vos troupes en route et les actions possibles depuis votre village actif.
 */
export default function VillageSheetPage({ coords }: { coords: string }) {
  const { run, village, world, setVillageId } = useGame();
  const [sheet, setSheet] = useState<VillageSheet | null>(null);
  const [missing, setMissing] = useState(false);
  const [x, y] = coords.split(',').map(Number);

  useEffect(() => {
    setSheet(null);
    setMissing(false);
    run(async () => {
      try {
        setSheet(await api<VillageSheet>(`/api/village-sheet/${x}/${y}`));
      } catch {
        setMissing(true);
      }
    });
  }, [x, y, run]);

  if (missing || !Number.isInteger(x) || !Number.isInteger(y)) return <p className="muted">Aucun village en ({coords.replace(',', '|')}).</p>;
  if (!sheet) return <p className="muted">Chargement du village…</p>;

  const mine = sheet.relation === 'mine';
  const from = village && village.id !== sheet.id ? village : null;
  const dist = from ? distance(from, sheet) : 0;

  const actions = (
    <>
      {mine ? (
        <a className="btn primary" href="#/village" onClick={() => setVillageId(sheet.id)}>
          Aller au village
        </a>
      ) : (
        <a className="btn primary" href={`#/ralliement/${sheet.x},${sheet.y}`}>
          Attaquer ou soutenir
        </a>
      )}
      {sheet.owner && !mine && village && village.buildings.market > 0 && (
        <a className="btn" href={`#/marche/${sheet.x},${sheet.y}`}>
          Envoyer des ressources
        </a>
      )}
      <a className="btn" href={`#/carte/${sheet.x},${sheet.y}`}>
        Voir sur la carte
      </a>
    </>
  );

  return (
    <div className="pg vsheet">
      <PageBanner
        icon={sheet.kind === 'village' ? 'village' : sheet.kind === 'bastion' ? 'province' : 'croisade'}
        kicker={sheet.kind === 'bastion' ? 'Bastion de province' : sheet.kind === 'citadel' ? 'Citadelle des croisades' : RELATION[sheet.relation]}
        title={sheet.name}
        lead={
          <>
            ({sheet.x}|{sheet.y})
            {sheet.owner && (
              <>
                {' · '}
                <PlayerLink name={sheet.owner.name} />
              </>
            )}
            {sheet.tribe && (
              <>
                {' · '}
                <a href={`#/tribu/${sheet.tribe.id}`}>
                  [{sheet.tribe.tag}] {sheet.tribe.name}
                </a>
              </>
            )}
            {sheet.province && <> · {sheet.province.holy ? 'Terre sainte' : `Province de ${sheet.province.name}`}</>}
          </>
        }
        chips={
          <>
            <span className={`pg-pill ${sheet.relation === 'war' ? 'war' : sheet.relation === 'ally' || sheet.relation === 'tribe' ? 'ally' : sheet.relation === 'mine' ? 'gold' : ''}`}>
              {RELATION[sheet.relation]}
            </span>
            {sheet.protected && <span className="pg-pill ally">Protection débutant</span>}
          </>
        }
        actions={actions}
        stats={[
          { value: fmt(sheet.points), label: 'Points', tone: 'gold' },
          ...(from ? [{ value: `${dist.toFixed(1)}`, label: `cases depuis ${from.name}` }] : []),
          ...(sheet.loyalty !== null ? [{ value: `${sheet.loyalty} %`, label: 'Loyauté' }] : []),
          { value: sheet.reports.length, label: 'rapports récents' },
        ]}
      />

      <div className="vsheet-grid">
        {!mine && (
          <section className="pg-card">
            <CardTitle icon="pillage">Ce que vous savez</CardTitle>
            {!sheet.intel && !sheet.lootable ? (
              <p className="pg-empty">Aucun renseignement : envoyez des éclaireurs depuis le point de ralliement.</p>
            ) : (
              <div className="stack">
                {sheet.intel && (
                  <>
                    <p className="muted small">
                      D’après votre {sheet.intel.source === 'scout' ? 'espionnage' : 'attaque'} du {clockTime(sheet.intel.at)}
                    </p>
                    <div className="vsheet-row">
                      <span className="muted">Troupes</span>
                      <UnitList units={sheet.intel.troops} empty="Aucune troupe" />
                    </div>
                    <div className="vsheet-row">
                      <span className="muted">Muraille</span>
                      <b>niveau {sheet.intel.wall}</b>
                    </div>
                  </>
                )}
                {sheet.lootable && (
                  <div className="vsheet-row">
                    <span className="muted">Butin estimé</span>
                    <span className="vsheet-res">
                      {RESOURCES.map((r) => (
                        <span key={r}>
                          <ResIcon r={r} size={18} />
                          {fmt(sheet.lootable!.resources[r])}
                        </span>
                      ))}
                    </span>
                  </div>
                )}
              </div>
            )}
          </section>
        )}

        {from && (
          <section className="pg-card">
            <CardTitle icon="ralliement">Temps de trajet depuis {from.name}</CardTitle>
            <div className="vsheet-times">
              {UNIT_KEYS.map((k) => (
                <span key={k}>
                  <UnitIcon unit={k} size={24} />
                  <span className="muted small">{UNITS[k].name}</span>
                  <b>{duration(travelTime({ ...emptyUnits(), [k]: 1 }, from, sheet, world.speed, from.speedBonus))}</b>
                </span>
              ))}
            </div>
          </section>
        )}

        <section className="pg-card">
          <CardTitle icon="rapports" count={sheet.reports.length}>Vos derniers rapports</CardTitle>
          {sheet.reports.length === 0 ? (
            <p className="pg-empty">Aucun rapport sur ce village.</p>
          ) : (
            <ul className="list">
              {sheet.reports.map((r) => (
                <li key={r.id}>
                  <a href={`#/rapports/${r.id}`} className={r.read ? '' : 'unread'}>
                    <span className={`dot tone-${r.tone}`} />
                    <span>{r.title}</span>
                    <span className="muted small">{clockTime(r.createdAt)}</span>
                  </a>
                </li>
              ))}
            </ul>
          )}
        </section>

        {sheet.movements.length > 0 && (
          <section className="pg-card">
            <CardTitle icon="troupes" count={sheet.movements.length}>Vos mouvements en route</CardTitle>
            <ul className="vsheet-moves">
              {sheet.movements.map((m) => (
                <li key={m.id}>
                  <span className={`dot type-${m.type}`} />
                  <span>
                    {MOVE_LABEL[m.type] ?? m.type} depuis {m.fromName}
                  </span>
                  <span className="muted small">
                    arrivée {clockTime(m.arriveAt)} · <Countdown to={m.arriveAt} />
                  </span>
                </li>
              ))}
            </ul>
          </section>
        )}

        {sheet.conquests.length > 0 && (
          <section className="pg-card">
            <CardTitle icon="banniere" count={sheet.conquests.length}>Conquêtes de ce village</CardTitle>
            <ul className="vsheet-moves">
              {sheet.conquests.map((k, i) => (
                <li key={i}>
                  <span>
                    <PlayerLink name={k.conqueror} /> l’a pris à <PlayerLink name={k.loser} />
                  </span>
                  <span className="muted small">{clockTime(k.at)}</span>
                </li>
              ))}
            </ul>
          </section>
        )}
      </div>
    </div>
  );
}
