import { useCallback, useEffect, useMemo, useState } from 'react';
import { UNITS, UNIT_KEYS, normalizeUnits, resolveCombat, wallDuringCombat, type RaidStatus, type RaidTarget, type UnitKey } from '@aldoria/shared';
import { api } from '../api';
import { clockTime, coords, fmt } from '../format';
import { useGame, useRoute } from '../game';
import { Panel, UnitIcon } from '../ui';
import './raid.css';

const MODEL_KEY = 'aldoria.raidModel';
type Model = Partial<Record<UnitKey, number>>;

const readModel = (): Model => {
  try {
    const raw = JSON.parse(localStorage.getItem(MODEL_KEY) ?? '{}');
    return Object.fromEntries(UNIT_KEYS.filter((k) => Number(raw[k]) > 0).map((k) => [k, Math.floor(Number(raw[k]))]));
  } catch {
    return {};
  }
};

/** Pastille du résultat de la dernière attaque sur ce village. */
export const STATUS: Record<RaidStatus, { label: string; cls: string }> = {
  never: { label: 'Jamais attaqué', cls: 'never' },
  scouted: { label: 'Espionné', cls: 'scouted' },
  lost: { label: 'Dernière attaque perdue', cls: 'lost' },
  losses: { label: 'Victoire avec pertes', cls: 'losses' },
  clean: { label: 'Victoire sans perte', cls: 'clean' },
};

const RADII = [10, 20, 30];
type Sort = 'distance' | 'points' | 'loot';

export default function Raid() {
  const { village: v, setVillage, run, toast } = useGame();
  const [, go] = useRoute();
  const [model, setModel] = useState<Model>(readModel);
  const [draft, setDraft] = useState<Partial<Record<UnitKey, string>>>(() => Object.fromEntries(Object.entries(readModel()).map(([k, n]) => [k, String(n)])));
  const [radius, setRadius] = useState(10);
  const [sort, setSort] = useState<Sort>('distance');
  const [targets, setTargets] = useState<RaidTarget[] | null>(null);
  const [selected, setSelected] = useState<Set<number>>(new Set());

  const villageId = v?.id;
  const load = useCallback(() => {
    if (!villageId) return;
    run(async () => setTargets(await api<RaidTarget[]>(`/api/villages/${villageId}/raid-targets?radius=${radius}`)));
  }, [villageId, radius, run]);
  useEffect(() => {
    setSelected(new Set());
    load();
  }, [load]);

  const list = useMemo(() => {
    const t = [...(targets ?? [])];
    if (sort === 'points') t.sort((a, b) => b.points - a.points);
    else if (sort === 'loot') t.sort((a, b) => b.lastLoot - a.lastLoot);
    return t;
  }, [targets, sort]);

  if (!v) return null;

  const used = UNIT_KEYS.filter((k) => (model[k] ?? 0) > 0);
  const capacity = used.reduce((n, k) => n + (model[k] ?? 0) * UNITS[k].carry, 0);
  const possible = used.length ? Math.min(...used.map((k) => Math.floor(v.troopsHome[k] / model[k]!))) : 0;
  const draftModel: Model = Object.fromEntries(UNIT_KEYS.filter((k) => Number(draft[k]) > 0).map((k) => [k, Math.floor(Number(draft[k]))]));
  const dirty = JSON.stringify(draftModel) !== JSON.stringify(model);

  const save = () => {
    setModel(draftModel);
    try {
      localStorage.setItem(MODEL_KEY, JSON.stringify(draftModel));
    } catch {
      /* stockage indisponible : le modèle reste en mémoire pour cette session */
    }
    toast('Modèle de pillage enregistré');
  };

  const toggle = (id: number) =>
    setSelected((s) => {
      const n = new Set(s);
      if (n.has(id)) n.delete(id);
      else n.add(id);
      return n;
    });
  const free = list.filter((t) => !t.underAttack);
  const selectNearest = () => setSelected(new Set([...free].sort((a, b) => a.distance - b.distance).slice(0, Math.min(5, possible || 5)).map((t) => t.id)));

  const sendTo = async (ids: number[]) => {
    if (!used.length) return toast('Enregistrez d’abord un modèle de troupes');
    let sent = 0;
    await run(async () => {
      for (const id of ids) {
        try {
          setVillage(await api(`/api/villages/${v.id}/commands`, { body: { type: 'attack', targetId: id, units: model } }));
          sent++;
        } catch (err) {
          if (sent === 0) throw err;
          toast(`${sent} envoi${sent > 1 ? 's' : ''} parti${sent > 1 ? 's' : ''}, les troupes manquent pour les suivants`);
          return;
        }
      }
    });
    if (sent > 0) toast(`${sent} attaque${sent > 1 ? 's' : ''} envoyée${sent > 1 ? 's' : ''}`);
    setSelected(new Set());
    load();
  };

  // Attaque suicidaire : la défense est connue et le modèle ne la battrait pas.
  const suicidal = (t: RaidTarget) => {
    if (!t.intel || !used.length) return false;
    const attackers = normalizeUnits(model);
    return !resolveCombat({ attackers, defenders: [t.intel.troops], wallLevel: wallDuringCombat(t.intel.wall, attackers.ram) }).attackerWins;
  };
  const picked = list.filter((t) => selected.has(t.id));

  return (
    <>
      <Panel title="Mon modèle de pillage">
        <div className="raid-units">
          {UNIT_KEYS.map((k) => (
            <label key={k} className="raid-unit" htmlFor={`raid-${k}`}>
              <b><UnitIcon unit={k} size={24} /> {UNITS[k].name}</b>
              <span className="muted small">butin {UNITS[k].carry} · dispo {fmt(v.troopsHome[k])}</span>
              <input id={`raid-${k}`} type="number" min={0} inputMode="numeric" placeholder="0" value={draft[k] ?? ''} onChange={(e) => setDraft((d) => ({ ...d, [k]: e.target.value }))} />
            </label>
          ))}
          <button className="btn primary small" disabled={!dirty} onClick={save}>Enregistrer</button>
        </div>
        <p className="raid-sum">
          <span>Capacité de butin : <b>{fmt(capacity)}</b></span>
          <span>Dans ce village : <b className={possible > 0 ? 'ok' : 'bad'}>{possible} envoi{possible > 1 ? 's' : ''} possible{possible > 1 ? 's' : ''}</b></span>
        </p>
        <p className="muted small">Le modèle est mémorisé sur cet appareil.</p>
      </Panel>

      <Panel title={`Villages barbares autour de ${v.name}`}>
        <div className="raid-bar">
          <span className="muted">Rayon :</span>
          {RADII.map((r) => <button key={r} className={`chip-btn ${radius === r ? 'on' : ''}`} onClick={() => setRadius(r)}>{r} cases</button>)}
          <span className="muted">Trier par :</span>
          {([['distance', 'Distance'], ['points', 'Points'], ['loot', 'Dernier butin']] as const).map(([s, label]) => (
            <button key={s} className={`chip-btn ${sort === s ? 'on' : ''}`} onClick={() => setSort(s)}>{label}</button>
          ))}
          <button className="btn small ghost" onClick={selectNearest}>Sélectionner les 5 plus proches</button>
        </div>
        <p className="raid-legend small">
          {(Object.keys(STATUS) as RaidStatus[]).map((s) => <span key={s}><i className={`dot ${STATUS[s].cls}`} /> {STATUS[s].label}</span>)}
        </p>
        {targets === null ? <p className="muted">Chargement…</p> : list.length === 0 ? <p className="muted">Aucun village barbare dans ce rayon.</p> : (
          <ul className="raid-list">
            {list.map((t) => (
              <li key={t.id} className={selected.has(t.id) ? 'sel' : ''}>
                <input type="checkbox" aria-label={`Sélectionner ${t.name}`} checked={selected.has(t.id)} disabled={t.underAttack} onChange={() => toggle(t.id)} />
                <div className="raid-who">
                  <b><i className={`dot ${STATUS[t.status].cls}`} title={STATUS[t.status].label} /> <a href="#/carte" onClick={(e) => { e.preventDefault(); go(`carte/${t.x},${t.y}`); }}>{t.name}</a> <span className="chip">{coords(t)}</span>{suicidal(t) && <span className="raid-danger" title="D'après votre dernier renseignement, ce modèle perdrait">Attaque suicidaire</span>}</b>
                  <span className="muted small">
                    {t.distance.toLocaleString('fr-FR')} cases · {fmt(t.points)} pts · {t.lastAt ? `${STATUS[t.status].label}, ${clockTime(t.lastAt)}${t.lastLoot ? ` · ${fmt(t.lastLoot)} pillés` : ''}` : 'Jamais attaqué'}
                  </span>
                </div>
                {t.underAttack ? <span className="btn small" aria-disabled>Troupes en route</span> : <button className="btn primary small" disabled={!used.length || possible < 1} onClick={() => sendTo([t.id])}>Envoyer le modèle</button>}
              </li>
            ))}
          </ul>
        )}
        {picked.length > 0 && (
          <div className="raid-foot">
            <span><b>{picked.length} village{picked.length > 1 ? 's' : ''} sélectionné{picked.length > 1 ? 's' : ''}</b> · butin max. {fmt(capacity * picked.length)}</span>
            {picked.length > possible && <span className="warn small">Troupes pour {possible} envoi{possible > 1 ? 's' : ''} seulement</span>}
            <button className="btn gold" disabled={!used.length || possible < 1} onClick={() => sendTo(picked.slice(0, possible).map((t) => t.id))}>
              Envoyer le modèle à {Math.min(picked.length, possible)} village{Math.min(picked.length, possible) > 1 ? 's' : ''}
            </button>
          </div>
        )}
      </Panel>
    </>
  );
}
