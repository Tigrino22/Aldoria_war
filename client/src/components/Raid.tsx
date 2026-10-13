import { useCallback, useEffect, useMemo, useState } from 'react';
import { RESOURCES, RESOURCE_NAMES, UNITS, UNIT_KEYS, attackWheatCost, normalizeUnits, resolveCombat, wallDuringCombat, type RaidStatus, type RaidTarget, type UnitKey, type VillageState } from '@aldoria/shared';
import { api } from '../api';
import { clockTime, coords, fmt } from '../format';
import { useGame, useRoute } from '../game';
import { Panel, UnitIcon } from '../ui';
import './raid.css';

type Slot = 'A' | 'B';
const SLOTS: Slot[] = ['A', 'B'];
/** Le modèle A garde l'ancienne clé pour retrouver le modèle déjà enregistré. */
const MODEL_KEY: Record<Slot, string> = { A: 'aldoria.raidModel', B: 'aldoria.raidModelB' };
type Model = Partial<Record<UnitKey, number>>;
type Draft = Partial<Record<UnitKey, string>>;

const cleanModel = (raw: Record<string, unknown>): Model =>
  Object.fromEntries(UNIT_KEYS.filter((k) => Number(raw[k]) > 0).map((k) => [k, Math.floor(Number(raw[k]))]));

const readModel = (slot: Slot): Model => {
  try {
    return cleanModel(JSON.parse(localStorage.getItem(MODEL_KEY[slot]) ?? '{}'));
  } catch {
    return {};
  }
};
const toDraft = (m: Model): Draft => Object.fromEntries(Object.entries(m).map(([k, n]) => [k, String(n)]));

/** Pastille du résultat de la dernière attaque sur ce village. */
export const STATUS: Record<RaidStatus, { label: string; cls: string }> = {
  never: { label: 'Jamais attaqué', cls: 'never' },
  scouted: { label: 'Espionné', cls: 'scouted' },
  lost: { label: 'Dernière attaque perdue', cls: 'lost' },
  losses: { label: 'Victoire avec pertes', cls: 'losses' },
  clean: { label: 'Victoire sans perte', cls: 'clean' },
};

const RADII = [10, 20, 30];
type Sort = 'distance' | 'points' | 'lootable' | 'loot';

const unitsOf = (m: Model) => UNIT_KEYS.filter((k) => (m[k] ?? 0) > 0);
const capacityOf = (m: Model) => unitsOf(m).reduce((n, k) => n + (m[k] ?? 0) * UNITS[k].carry, 0);
const wheatOf = (m: Model) => attackWheatCost(normalizeUnits(m));
/** Envois possibles d'un modèle : limités par les troupes au village et par le blé des rations. */
const possibleOf = (m: Model, v: VillageState) => {
  const used = unitsOf(m);
  if (!used.length) return 0;
  const byTroops = Math.min(...used.map((k) => Math.floor(v.troopsHome[k] / m[k]!)));
  const wheat = wheatOf(m);
  return wheat > 0 ? Math.min(byTroops, Math.floor(v.resources.wheat / wheat)) : byTroops;
};

function ModelEditor({ slot, model, village, onSave }: { slot: Slot; model: Model; village: VillageState; onSave: (m: Model) => void }) {
  const [draft, setDraft] = useState<Draft>(() => toDraft(model));
  const draftModel = cleanModel(draft);
  const dirty = JSON.stringify(draftModel) !== JSON.stringify(model);
  const possible = possibleOf(model, village);
  return (
    <div className="raid-model">
      <h3><span className={`raid-slot slot-${slot}`}>{slot}</span> Modèle {slot}</h3>
      <div className="raid-units">
        {UNIT_KEYS.map((k) => (
          <label key={k} className="raid-unit" htmlFor={`raid-${slot}-${k}`}>
            <b><UnitIcon unit={k} size={24} /> {UNITS[k].name}</b>
            <span className="muted small">butin {UNITS[k].carry} · dispo {fmt(village.troopsHome[k])}</span>
            <input id={`raid-${slot}-${k}`} type="number" min={0} inputMode="numeric" placeholder="0" value={draft[k] ?? ''} onChange={(e) => setDraft((d) => ({ ...d, [k]: e.target.value }))} />
          </label>
        ))}
        <button className="btn primary small" disabled={!dirty} onClick={() => onSave(draftModel)}>Enregistrer {slot}</button>
      </div>
      <p className="raid-sum">
        <span>Capacité de butin : <b>{fmt(capacityOf(model))}</b></span>
        <span>Rations : <b>{fmt(wheatOf(model))}</b> blé par envoi</span>
        <span>Dans ce village : <b className={possible > 0 ? 'ok' : 'bad'}>{possible} envoi{possible > 1 ? 's' : ''} possible{possible > 1 ? 's' : ''}</b></span>
      </p>
    </div>
  );
}

export default function Raid() {
  const { village: v, setVillage, run, toast } = useGame();
  const [, go] = useRoute();
  const [models, setModels] = useState<Record<Slot, Model>>(() => ({ A: readModel('A'), B: readModel('B') }));
  const [radius, setRadius] = useState(10);
  const [sort, setSort] = useState<Sort>('distance');
  const [targets, setTargets] = useState<RaidTarget[] | null>(null);
  const [selected, setSelected] = useState<Set<number>>(new Set());
  const [sending, setSending] = useState(false);

  const villageId = v?.id;
  const load = useCallback(() => {
    if (!villageId) return;
    run(async () => setTargets(await api<RaidTarget[]>(`/api/villages/${villageId}/raid-targets?radius=${radius}`)));
  }, [villageId, radius, run]);
  useEffect(() => {
    setSelected(new Set());
    load();
  }, [load]);

  // Les villages vers lesquels une attaque est déjà en route sont masqués.
  const hidden = (targets ?? []).filter((t) => t.underAttack).length;
  const list = useMemo(() => {
    const t = (targets ?? []).filter((x) => !x.underAttack);
    if (sort === 'points') t.sort((a, b) => b.points - a.points);
    else if (sort === 'lootable') t.sort((a, b) => (b.lootable?.total ?? -1) - (a.lootable?.total ?? -1));
    else if (sort === 'loot') t.sort((a, b) => b.lastLoot - a.lastLoot);
    return t;
  }, [targets, sort]);

  if (!v) return null;

  const possible: Record<Slot, number> = { A: possibleOf(models.A, v), B: possibleOf(models.B, v) };

  const save = (slot: Slot, m: Model) => {
    setModels((all) => ({ ...all, [slot]: m }));
    try {
      localStorage.setItem(MODEL_KEY[slot], JSON.stringify(m));
    } catch {
      /* stockage indisponible : le modèle reste en mémoire pour cette session */
    }
    toast(`Modèle ${slot} enregistré`);
  };

  const toggle = (id: number) =>
    setSelected((s) => {
      const n = new Set(s);
      if (n.has(id)) n.delete(id);
      else n.add(id);
      return n;
    });
  const selectNearest = () => setSelected(new Set([...list].sort((a, b) => a.distance - b.distance).slice(0, 5).map((t) => t.id)));

  const sendTo = async (slot: Slot, ids: number[]) => {
    const model = models[slot];
    if (!unitsOf(model).length) return toast(`Enregistrez d’abord le modèle ${slot}`);
    if (sending) return;
    setSending(true);
    // Tous les envois partent en une seule requête : le serveur les enchaîne et s'arrête quand les troupes manquent.
    const res = await run(() => api<{ sent: number; error: string | null; village: VillageState }>(`/api/villages/${v.id}/commands/batch`, { body: { targetIds: ids, units: model } }));
    setSending(false);
    if (!res) return;
    setVillage(res.village);
    const sent = res.sent;
    if (res.error) toast(`${sent} envoi${sent > 1 ? 's' : ''} parti${sent > 1 ? 's' : ''}, les troupes manquent pour les suivants`);
    else toast(`${sent} attaque${sent > 1 ? 's' : ''} envoyée${sent > 1 ? 's' : ''} avec le modèle ${slot}`);
    // Les villages visés disparaissent tout de suite de la liste (attaque en route), sans attendre le rechargement.
    const gone = new Set(ids.slice(0, sent));
    setTargets((t) => t?.map((x) => (gone.has(x.id) ? { ...x, underAttack: true } : x)) ?? t);
    setSelected(new Set());
    load();
  };

  // Attaque suicidaire : la défense est connue et le modèle ne la battrait pas.
  const suicidal = (t: RaidTarget, slot: Slot) => {
    if (!t.intel || !unitsOf(models[slot]).length) return false;
    const attackers = normalizeUnits(models[slot]);
    return !resolveCombat({ attackers, defenders: [t.intel.troops], wallLevel: wallDuringCombat(t.intel.wall, attackers.ram) }).attackerWins;
  };
  const picked = list.filter((t) => selected.has(t.id));

  return (
    <>
      <Panel title="Mes modèles de pillage">
        {SLOTS.map((slot) => <ModelEditor key={slot} slot={slot} model={models[slot]} village={v} onSave={(m) => save(slot, m)} />)}
        <p className="muted small">Les modèles sont mémorisés sur cet appareil. Cliquez sur A ou B à côté d’un village pour l’attaquer avec ce modèle.</p>
      </Panel>

      <Panel title={`Villages barbares autour de ${v.name}`}>
        <div className="raid-bar">
          <span className="muted">Rayon :</span>
          {RADII.map((r) => <button key={r} className={`chip-btn ${radius === r ? 'on' : ''}`} onClick={() => setRadius(r)}>{r} cases</button>)}
          <span className="muted">Trier par :</span>
          {([['distance', 'Distance'], ['points', 'Points'], ['lootable', 'Butin estimé'], ['loot', 'Dernier butin']] as const).map(([s, label]) => (
            <button key={s} className={`chip-btn ${sort === s ? 'on' : ''}`} onClick={() => setSort(s)}>{label}</button>
          ))}
          <button className="btn small ghost" onClick={selectNearest}>Sélectionner les 5 plus proches</button>
        </div>
        <p className="raid-legend small">
          {(Object.keys(STATUS) as RaidStatus[]).map((s) => <span key={s}><i className={`dot ${STATUS[s].cls}`} /> {STATUS[s].label}</span>)}
        </p>
        {hidden > 0 && <p className="muted small">{hidden} village{hidden > 1 ? 's' : ''} masqué{hidden > 1 ? 's' : ''} : une attaque y est déjà en route.</p>}
        {targets === null ? <p className="muted">Chargement…</p> : list.length === 0 ? <p className="muted">{hidden > 0 ? 'Tous les villages barbares de ce rayon ont déjà une attaque en route.' : 'Aucun village barbare dans ce rayon.'}</p> : (
          <ul className="raid-list">
            {list.map((t) => {
              const danger = SLOTS.filter((s) => suicidal(t, s));
              return (
                <li key={t.id} className={selected.has(t.id) ? 'sel' : ''}>
                  <input type="checkbox" aria-label={`Sélectionner ${t.name}`} checked={selected.has(t.id)} onChange={() => toggle(t.id)} />
                  <div className="raid-who">
                    <b><i className={`dot ${STATUS[t.status].cls}`} title={STATUS[t.status].label} /> <a href="#/carte" onClick={(e) => { e.preventDefault(); go(`carte/${t.x},${t.y}`); }}>{t.name}</a> <span className="chip">{coords(t)}</span>{danger.length > 0 && <span className="raid-danger" title="D'après votre dernier renseignement, ce modèle perdrait">Attaque suicidaire ({danger.join(', ')})</span>}</b>
                    <span className="muted small">
                      {t.distance.toLocaleString('fr-FR')} cases · {fmt(t.points)} pts · {t.lastAt ? `${STATUS[t.status].label}, ${clockTime(t.lastAt)}${t.lastLoot ? ` · ${fmt(t.lastLoot)} pillés` : ''}` : 'Jamais attaqué'}
                    </span>
                  </div>
                  {t.lootable ? (
                    <span className="raid-loot" title={`Estimé d'après l'éclaireur du ${clockTime(t.lootable.seenAt)} : ${RESOURCES.map((r) => `${RESOURCE_NAMES[r]} ${fmt(t.lootable!.resources[r])}`).join(', ')}`}>
                      <b>≈ {fmt(t.lootable.total)}</b>
                      <span className="muted small">pillables</span>
                    </span>
                  ) : (
                    <span className="raid-loot unknown" title="Aucun rapport d'éclaireur sur ce village : envoyez un espion pour estimer le butin">
                      <b>?</b>
                      <span className="muted small">à espionner</span>
                    </span>
                  )}
                  <span className="raid-send">
                    {SLOTS.map((slot) => (
                      <button
                        key={slot}
                        className={`btn small raid-slot-btn slot-${slot} ${danger.includes(slot) ? 'danger' : ''}`}
                        disabled={sending || possible[slot] < 1}
                        title={unitsOf(models[slot]).length ? `Envoyer le modèle ${slot} (butin max. ${fmt(capacityOf(models[slot]))})` : `Modèle ${slot} vide`}
                        onClick={() => sendTo(slot, [t.id])}
                      >
                        {slot}
                      </button>
                    ))}
                  </span>
                </li>
              );
            })}
          </ul>
        )}
        {picked.length > 0 && (
          <div className="raid-foot">
            <span><b>{picked.length} village{picked.length > 1 ? 's' : ''} sélectionné{picked.length > 1 ? 's' : ''}</b>{picked.some((t) => t.lootable) && <> · butin estimé {fmt(picked.reduce((n, t) => n + (t.lootable?.total ?? 0), 0))}</>}</span>
            {SLOTS.map((slot) => {
              const n = Math.min(picked.length, possible[slot]);
              return (
                <button key={slot} className="btn gold" disabled={sending || n < 1} title={picked.length > possible[slot] ? `Troupes ou blé pour ${possible[slot]} envoi${possible[slot] > 1 ? 's' : ''} seulement` : undefined} onClick={() => sendTo(slot, picked.slice(0, n).map((t) => t.id))}>
                  Envoyer {slot} à {n} village{n > 1 ? 's' : ''}
                </button>
              );
            })}
          </div>
        )}
      </Panel>
    </>
  );
}
