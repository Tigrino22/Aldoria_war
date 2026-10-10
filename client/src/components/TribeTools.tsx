import { useEffect, useMemo, useState } from 'react';
import { UNITS, UNIT_KEYS, type UnitKey, emptyUnits, travelTime, distance } from '@aldoria/shared';
import { api } from '../api';
import { clockTime, duration } from '../format';
import { useGame } from '../game';
import { Countdown, Panel, PlayerLink } from '../ui';

interface Threat {
  id: number;
  arriveAt: string;
  target: { id: number; name: string; x: number; y: number; ownerName: string };
  origin: { name: string; x: number; y: number; ownerName: string | null };
}
interface MemberVillage {
  id: number;
  name: string;
  x: number;
  y: number;
  ownerName: string;
}

function Threats() {
  const { run } = useGame();
  const [threats, setThreats] = useState<Threat[] | null>(null);
  useEffect(() => {
    const load = () => run(async () => setThreats(await api<Threat[]>('/api/tribes/mine/threats')));
    load();
    const t = setInterval(load, 30_000);
    return () => clearInterval(t);
  }, [run]);
  if (!threats) return null;
  return (
    <Panel title={`Menaces sur la tribu (${threats.length})`}>
      {threats.length === 0 ? (
        <p className="muted">Aucune attaque extérieure en approche sur vos membres.</p>
      ) : (
        <ul className="movements">
          {threats.map((t) => (
            <li key={t.id} className="movement hostile">
              <span>
                {t.origin.ownerName ? <PlayerLink name={t.origin.ownerName} /> : 'Barbares'} ({t.origin.x}|{t.origin.y}) vise <PlayerLink name={t.target.ownerName} /> ·{' '}
                <a href={`#/carte/${t.target.x},${t.target.y}`}>
                  {t.target.name} ({t.target.x}|{t.target.y})
                </a>
              </span>
              <span className="mv-time">
                <Countdown to={t.arriveAt} />
                <span className="muted small">{clockTime(t.arriveAt)}</span>
              </span>
            </li>
          ))}
        </ul>
      )}
    </Panel>
  );
}

function Broadcast() {
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

/** Pour une attaque groupée : à quelle heure chaque village doit partir pour que tout arrive au même moment. */
function Planner() {
  const { world, run } = useGame();
  const [villages, setVillages] = useState<MemberVillage[]>([]);
  const [target, setTarget] = useState('');
  const [arrival, setArrival] = useState('');
  const [unit, setUnit] = useState<UnitKey>('swordsman');
  useEffect(() => {
    run(async () => setVillages(await api<MemberVillage[]>('/api/tribes/mine/villages')));
  }, [run]);

  const coords = useMemo(() => {
    const m = target.match(/^\s*(\d+)\s*[|,;/ ]\s*(\d+)\s*$/);
    return m ? { x: Number(m[1]), y: Number(m[2]) } : null;
  }, [target]);
  const arrivalMs = arrival ? Date.parse(arrival) : NaN;
  const rows =
    coords && Number.isFinite(arrivalMs)
      ? villages.map((v) => {
          const travel = travelTime({ ...emptyUnits(), [unit]: 1 }, v, coords, world.speed);
          return { v, dist: distance(v, coords), travel, depart: arrivalMs - travel * 1000 };
        })
      : [];

  return (
    <Panel title="Planificateur d'attaque groupée">
      <div className="form">
        <label htmlFor="pl-target">Cible (x|y)</label>
        <input id="pl-target" placeholder="52|47" value={target} onChange={(e) => setTarget(e.target.value)} />
        <label htmlFor="pl-arrival">Heure d'arrivée souhaitée</label>
        <input id="pl-arrival" type="datetime-local" step={1} value={arrival} onChange={(e) => setArrival(e.target.value)} />
        <label htmlFor="pl-unit">Unité la plus lente de l'armée</label>
        <select id="pl-unit" value={unit} onChange={(e) => setUnit(e.target.value as UnitKey)}>
          {UNIT_KEYS.map((k) => (
            <option key={k} value={k}>
              {UNITS[k].name}
            </option>
          ))}
        </select>
      </div>
      {rows.length > 0 && (
        <div className="table-wrap">
          <table className="rank-table">
            <thead>
              <tr><th>Joueur</th><th>Village</th><th>Distance</th><th>Trajet</th><th>Départ à</th></tr>
            </thead>
            <tbody>
              {rows
                .sort((a, b) => a.depart - b.depart)
                .map(({ v, dist, travel, depart }) => (
                  <tr key={v.id} className={depart < Date.now() ? 'late' : ''}>
                    <td><PlayerLink name={v.ownerName} /></td>
                    <td>{v.name} ({v.x}|{v.y})</td>
                    <td>{dist.toFixed(1)}</td>
                    <td>{duration(travel)}</td>
                    <td>{depart < Date.now() ? 'trop tard' : clockTime(new Date(depart))}</td>
                  </tr>
                ))}
            </tbody>
          </table>
        </div>
      )}
      <p className="muted small">L'heure s'entend dans le fuseau de votre appareil. Tout village marqué « trop tard » ne peut plus arriver à temps.</p>
    </Panel>
  );
}

export default function TribeTools() {
  return (
    <>
      <Threats />
      <Planner />
      <Broadcast />
    </>
  );
}
