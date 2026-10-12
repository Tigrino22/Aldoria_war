import './tribe-attacks.css';
import { useEffect, useMemo, useState } from 'react';
import { api } from '../api';
import { clockTime } from '../format';
import { useGame } from '../game';
import { Countdown, Panel, PlayerLink } from '../ui';

interface Threat {
  id: number;
  sentAt: string;
  arriveAt: string;
  target: { id: number; name: string; x: number; y: number; ownerName: string };
  origin: { name: string; x: number; y: number; ownerName: string | null };
}

/** Part du trajet déjà parcourue, de 0 à 100. */
export function progress(sentAt: string, arriveAt: string): number {
  const total = Date.parse(arriveAt) - Date.parse(sentAt);
  return total > 0 ? Math.min(100, Math.max(0, ((Date.now() - Date.parse(sentAt)) / total) * 100)) : 100;
}

/** Attaques extérieures en approche, groupées par membre menacé. Les troupes restent secrètes. */
export function Threats() {
  const { run } = useGame();
  const [threats, setThreats] = useState<Threat[] | null>(null);
  useEffect(() => {
    const load = () => run(async () => setThreats(await api<Threat[]>('/api/tribes/mine/threats')));
    load();
    const t = setInterval(load, 30_000);
    return () => clearInterval(t);
  }, [run]);
  const byMember = useMemo(() => {
    const m = new Map<string, Threat[]>();
    for (const t of threats ?? []) m.set(t.target.ownerName, [...(m.get(t.target.ownerName) ?? []), t]);
    return [...m.entries()];
  }, [threats]);
  if (!threats) return null;
  return (
    <Panel title={`Menaces sur la tribu (${threats.length})`}>
      {threats.length === 0 ? (
        <p className="muted">Aucune attaque extérieure en approche sur vos membres.</p>
      ) : (
        <div className="tribe-attacks">
          {byMember.map(([name, list]) => (
            <section key={name} className="ta-member threat">
              <header className="ta-head">
                <span className="avatar">{name.slice(0, 1).toUpperCase()}</span>
                <PlayerLink name={name} />
                <span className="chip chip-warn">{list.length} menace{list.length > 1 ? 's' : ''}</span>
              </header>
              <ul className="ta-list">
                {list.map((t) => (
                  <li key={t.id} className="ta-card kind-attack">
                    <div className="ta-main">
                      <span className="ta-kind">Attaque ennemie</span>
                      <span className="ta-route">
                        {t.origin.ownerName ? <PlayerLink name={t.origin.ownerName} /> : 'Barbares'}
                        <span className="muted small"> · {t.origin.name} ({t.origin.x}|{t.origin.y}) →</span>{' '}
                        <a href={`#/carte/${t.target.x},${t.target.y}`}>
                          {t.target.name} ({t.target.x}|{t.target.y})
                        </a>
                      </span>
                    </div>
                    <div className="mv-time">
                      <Countdown to={t.arriveAt} />
                      <span className="muted small">{clockTime(t.arriveAt)}</span>
                    </div>
                    <div className="ta-bar" aria-hidden="true">
                      <div className="ta-fill" style={{ width: `${progress(t.sentAt, t.arriveAt)}%` }} />
                    </div>
                  </li>
                ))}
              </ul>
            </section>
          ))}
        </div>
      )}
    </Panel>
  );
}

export function Broadcast() {
  const { run, toast } = useGame();
  const [form, setForm] = useState({ subject: '', body: '' });
  return (
    <Panel title="Message à toute la tribu">
      <form
        className="form"
        onSubmit={(e) => {
          e.preventDefault();
          run(async () => {
            const r = await api<{ sent: number }>('/api/tribes/mine/broadcast', { body: form });
            toast(r.sent ? `Message envoyé à ${r.sent} membre${r.sent > 1 ? 's' : ''}` : "Vous êtes seul dans la tribu pour l'instant");
            setForm({ subject: '', body: '' });
          });
        }}
      >
        <label htmlFor="bc-subject">Objet</label>
        <input id="bc-subject" value={form.subject} maxLength={120} required onChange={(e) => setForm({ ...form, subject: e.target.value })} />
        <label htmlFor="bc-body">Message</label>
        <textarea id="bc-body" rows={4} value={form.body} maxLength={5000} required onChange={(e) => setForm({ ...form, body: e.target.value })} />
        <button className="btn primary">Envoyer à la tribu</button>
      </form>
    </Panel>
  );
}

interface MemberAttack {
  id: number;
  kind: 'attack' | 'conquest' | 'scout';
  sentAt: string;
  arriveAt: string;
  attacker: { id: number; name: string };
  origin: { name: string; x: number; y: number };
  target: { name: string; x: number; y: number; ownerName: string | null; ownerTag: string | null };
}
const KIND_LABEL = { attack: 'Attaque', conquest: 'Conquête', scout: 'Espionnage' } as const;

/** Attaques lancées par les membres de la tribu, groupées par joueur. Les effectifs ne sont jamais montrés. */
export function MemberAttacks() {
  const { run } = useGame();
  const [attacks, setAttacks] = useState<MemberAttack[] | null>(null);
  useEffect(() => {
    const load = () => run(async () => setAttacks(await api<MemberAttack[]>('/api/tribes/mine/attacks')));
    load();
    const t = setInterval(load, 30_000);
    return () => clearInterval(t);
  }, [run]);
  const byMember = useMemo(() => {
    const m = new Map<string, MemberAttack[]>();
    for (const a of attacks ?? []) m.set(a.attacker.name, [...(m.get(a.attacker.name) ?? []), a]);
    return [...m.entries()];
  }, [attacks]);
  if (!attacks) return null;
  return (
    <Panel title={`Attaques en cours des membres (${attacks.length})`}>
      {attacks.length === 0 ? (
        <p className="muted">Aucun membre n'a d'attaque en route pour l'instant.</p>
      ) : (
        <div className="tribe-attacks">
          {byMember.map(([name, list]) => (
            <section key={name} className="ta-member">
              <header className="ta-head">
                <span className="avatar">{name.slice(0, 1).toUpperCase()}</span>
                <PlayerLink name={name} />
                <span className="chip">{list.length} attaque{list.length > 1 ? 's' : ''}</span>
              </header>
              <ul className="ta-list">
                {list.map((a) => {
                  const pct = progress(a.sentAt, a.arriveAt);
                  return (
                    <li key={a.id} className={`ta-card kind-${a.kind}`}>
                      <div className="ta-main">
                        <span className="ta-kind">{KIND_LABEL[a.kind]}</span>
                        <span className="ta-route">
                          <span className="muted small">{a.origin.name} ({a.origin.x}|{a.origin.y}) →</span>{' '}
                          <a href={`#/carte/${a.target.x},${a.target.y}`}>
                            {a.target.name} ({a.target.x}|{a.target.y})
                          </a>
                          {a.target.ownerName ? (
                            <span className="muted small"> · {a.target.ownerTag && `[${a.target.ownerTag}] `}<PlayerLink name={a.target.ownerName} /></span>
                          ) : (
                            <span className="muted small"> · Barbares</span>
                          )}
                        </span>
                      </div>
                      <div className="mv-time">
                        <Countdown to={a.arriveAt} />
                        <span className="muted small">{clockTime(a.arriveAt)}</span>
                      </div>
                      <div className="ta-bar" aria-hidden="true">
                        <div className="ta-fill" style={{ width: `${pct}%` }} />
                      </div>
                    </li>
                  );
                })}
              </ul>
            </section>
          ))}
        </div>
      )}
    </Panel>
  );
}

export default function TribeTools() {
  return (
    <>
      <Threats />
      <MemberAttacks />
      <Broadcast />
    </>
  );
}
