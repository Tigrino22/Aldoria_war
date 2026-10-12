import { useCallback, useEffect, useState } from 'react';
import { api } from '../api';
import { fmt } from '../format';
import { useGame } from '../game';
import TribeCrest from './TribeCrest';

interface AllianceTribe {
  id: number;
  tag: string;
  name: string;
  members: number;
  villages: number;
  points: number;
}
interface AllianceLine {
  id: number;
  tribe: AllianceTribe;
  by: string | null;
  at: string;
}
export interface TribeAlliancesView {
  isLeader: boolean;
  allies: AllianceLine[];
  received: AllianceLine[];
  sent: AllianceLine[];
  candidates: AllianceTribe[];
  maxAllies: number;
}

const day = (iso: string) => new Date(iso).toLocaleDateString('fr-FR', { day: 'numeric', month: 'long' });
const plural = (n: number, word: string) => `${fmt(n)} ${word}${n > 1 ? 's' : ''}`;

function TribeFacts({ t }: { t: AllianceTribe }) {
  return (
    <span className="tr-facts">
      {plural(t.members, 'membre')} · {plural(t.villages, 'village')} · {fmt(t.points)} pts
    </span>
  );
}

/** Onglet « Alliances » de la tribu : propositions reçues, alliés, propositions envoyées et nouvelle proposition (chef). */
export default function TribeAlliances({ onCount }: { onCount?: (allies: number, pending: number) => void }) {
  const { run, toast } = useGame();
  const [view, setView] = useState<TribeAlliancesView | null>(null);
  const [target, setTarget] = useState('');
  const load = useCallback(() => run(async () => setView(await api<TribeAlliancesView>('/api/tribes/mine/alliances'))), [run]);
  useEffect(() => {
    load();
    const t = setInterval(load, 30_000);
    return () => clearInterval(t);
  }, [load]);
  useEffect(() => {
    if (view) onCount?.(view.allies.length, view.received.length);
  }, [view, onCount]);

  if (!view) return <p className="muted">Chargement…</p>;
  const chosen = view.candidates.find((t) => String(t.id) === target);
  const full = view.allies.length >= view.maxAllies;
  const call = (path: string, init: Parameters<typeof api>[1], done: string) =>
    run(async () => {
      setView(await api<TribeAlliancesView>(path, init));
      toast(done);
    });

  return (
    <div className="tr-alliances">
      {view.received.length > 0 && (
        <section className="tr-card tr-callout">
          <h3 className="tr-h">Propositions reçues</h3>
          <ul className="tr-invites">
            {view.received.map((l) => (
              <li key={l.id}>
                <TribeCrest id={l.tribe.id} tag={l.tribe.tag} size={44} />
                <div className="tr-grow">
                  <a className="tr-name" href={`#/tribu/${l.tribe.id}`}>
                    [{l.tribe.tag}] {l.tribe.name}
                  </a>
                  <TribeFacts t={l.tribe} />
                  <span className="muted small">
                    Proposée le {day(l.at)}
                    {l.by ? ` par ${l.by}` : ''}
                  </span>
                </div>
                {view.isLeader ? (
                  <div className="tr-actions">
                    <button className="btn small ally" onClick={() => call(`/api/tribes/mine/alliances/invites/${l.id}/accept`, { method: 'POST' }, `Alliance conclue avec [${l.tribe.tag}]`)}>
                      Accepter
                    </button>
                    <button className="btn small ghost" onClick={() => call(`/api/tribes/mine/alliances/invites/${l.id}/decline`, { method: 'POST' }, 'Proposition refusée')}>
                      Refuser
                    </button>
                  </div>
                ) : (
                  <span className="chip">en attente du chef</span>
                )}
              </li>
            ))}
          </ul>
        </section>
      )}

      <section className="tr-card">
        <header className="tr-card-head">
          <h3 className="tr-h">
            Tribus alliées <span className="tr-count">{view.allies.length} / {view.maxAllies}</span>
          </h3>
          <span className="tr-legend">
            <i className="tr-sky" /> en bleu ciel sur la carte
          </span>
        </header>
        {view.allies.length === 0 ? (
          <div className="tr-empty">
            <span className="tr-empty-icon" aria-hidden="true">🤝</span>
            <p>Votre tribu n’a pas encore d’alliée.</p>
            <p className="muted small">Une alliance se conclut entre chefs : proposez-la, la tribu d’en face l’accepte ou la refuse. Vos alliés ne peuvent pas être visés par une déclaration de guerre.</p>
          </div>
        ) : (
          <ul className="tr-allies">
            {view.allies.map((l) => (
              <li key={l.id} className="tr-ally">
                <TribeCrest id={l.tribe.id} tag={l.tribe.tag} size={52} ally />
                <div className="tr-grow">
                  <a className="tr-name" href={`#/tribu/${l.tribe.id}`}>
                    [{l.tribe.tag}] {l.tribe.name}
                  </a>
                  <TribeFacts t={l.tribe} />
                  <span className="muted small">Alliée depuis le {day(l.at)}</span>
                </div>
                {view.isLeader && (
                  <button
                    className="btn small ghost tr-break"
                    onClick={() => window.confirm(`Rompre l’alliance avec [${l.tribe.tag}] ${l.tribe.name} ? Les membres des deux tribus seront prévenus.`) && call(`/api/tribes/mine/alliances/${l.tribe.id}`, { method: 'DELETE' }, 'Alliance rompue')}
                  >
                    Rompre
                  </button>
                )}
              </li>
            ))}
          </ul>
        )}
      </section>

      <section className="tr-card">
        <h3 className="tr-h">Proposer une alliance</h3>
        {!view.isLeader ? (
          <p className="muted">Seul le chef de tribu propose, accepte ou rompt une alliance. Parlez-en avec lui.</p>
        ) : (
          <>
            <p className="muted small">L’alliance est conclue dès que le chef de l’autre tribu l’accepte. Une seule proposition à la fois par tribu, et pas d’alliance avec une tribu en guerre contre vous.</p>
            <div className="tr-propose">
              <label htmlFor="ally-target" className="sr-only">
                Tribu
              </label>
              <select id="ally-target" value={target} onChange={(e) => setTarget(e.target.value)} disabled={full}>
                <option value="">Choisir une tribu…</option>
                {view.candidates.map((t) => (
                  <option key={t.id} value={t.id}>
                    [{t.tag}] {t.name} · {plural(t.members, 'membre')} · {fmt(t.points)} pts
                  </option>
                ))}
              </select>
              <button
                className="btn ally"
                disabled={!chosen || full}
                onClick={() =>
                  chosen &&
                  run(async () => {
                    setView(await api<TribeAlliancesView>('/api/tribes/mine/alliances', { body: { targetId: chosen.id } }));
                    setTarget('');
                    toast(`Proposition envoyée à [${chosen.tag}]`);
                  })
                }
              >
                Proposer l’alliance
              </button>
            </div>
            {full && <p className="muted small">Limite atteinte : rompez une alliance pour en proposer une autre.</p>}
          </>
        )}
        {view.sent.length > 0 && (
          <>
            <h4 className="tr-sub">En attente de réponse</h4>
            <ul className="tr-invites compact">
              {view.sent.map((l) => (
                <li key={l.id}>
                  <TribeCrest id={l.tribe.id} tag={l.tribe.tag} size={34} />
                  <div className="tr-grow">
                    <a className="tr-name" href={`#/tribu/${l.tribe.id}`}>
                      [{l.tribe.tag}] {l.tribe.name}
                    </a>
                    <span className="muted small">Envoyée le {day(l.at)}</span>
                  </div>
                  {view.isLeader && (
                    <button className="btn small ghost" onClick={() => call(`/api/tribes/mine/alliances/invites/${l.id}`, { method: 'DELETE' }, 'Proposition retirée')}>
                      Retirer
                    </button>
                  )}
                </li>
              ))}
            </ul>
          </>
        )}
      </section>
    </div>
  );
}
