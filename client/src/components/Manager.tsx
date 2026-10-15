import { useCallback, useEffect, useState } from 'react';
import { BUILDINGS, BUILDING_KEYS, UNITS, UNIT_KEYS, type BuildingKey, type UnitKey } from '@aldoria/shared';
import { api } from '../api';
import { useGame } from '../game';
import { Panel } from '../ui';
import { NavIcon } from './NavIcon';
import { PageBanner } from './PageBanner';
import './admin.css';
import './manager.css';

export interface ManagerPlan {
  buildings: { building: BuildingKey; level: number }[];
  troops: Partial<Record<UnitKey, number>>;
  troopsShare: number;
}
interface Template extends ManagerPlan {
  id: number;
  name: string;
}
export interface ManagerVillage {
  id: number;
  name: string;
  x: number;
  y: number;
  enabled: boolean;
  templateId: number | null;
  custom: ManagerPlan | null;
  blocked: string | null;
  log: { at: string; text: string }[];
  /** Le village participe à l'équilibrage des ressources. */
  balance: boolean;
}
export interface BalanceSettings {
  enabled: boolean;
  low: number;
  high: number;
}
export interface ManagerData {
  available: boolean;
  maxTemplates: number;
  templates: Template[];
  villages: ManagerVillage[];
  balance: BalanceSettings;
}

/** Données du gestionnaire, rechargées toutes les 30 secondes. */
export function useManager() {
  const { run } = useGame();
  const [data, setData] = useState<ManagerData | null>(null);
  const reload = useCallback(() => run(async () => setData(await api<ManagerData>('/api/manager'))), [run]);
  useEffect(() => {
    reload();
    const t = setInterval(reload, 30_000);
    return () => clearInterval(t);
  }, [reload]);
  return { data, reload };
}

export function useManagerActions(reload: () => unknown) {
  const { run, toast } = useGame();
  return {
    setVillage: (id: number, body: object, ok?: string) =>
      run(async () => {
        await api(`/api/manager/villages/${id}`, { method: 'PUT', body });
        if (ok) toast(ok);
        await reload();
      }),
  };
}

/** Éditeur d'un plan : liste ordonnée de bâtiments, effectifs de troupes et part réservée aux troupes. */
function PlanEditor({ plan, onChange }: { plan: ManagerPlan; onChange: (p: ManagerPlan) => void }) {
  const move = (i: number, d: number) => {
    const list = [...plan.buildings];
    const j = i + d;
    if (j < 0 || j >= list.length) return;
    [list[i], list[j]] = [list[j], list[i]];
    onChange({ ...plan, buildings: list });
  };
  const edit = (i: number, patch: Partial<ManagerPlan['buildings'][number]>) =>
    onChange({ ...plan, buildings: plan.buildings.map((b, k) => (k === i ? { ...b, ...patch } : b)) });
  return (
    <div className="stack">
      <div>
        <b>Bâtiments, par ordre de priorité</b>
        <p className="muted small">Le premier bâtiment qui n'a pas atteint son niveau est monté. Son coût est mis de côté avant les troupes. Un prérequis manquant, ou un entrepôt trop petit pour ce niveau, est construit automatiquement.</p>
        {plan.buildings.map((b, i) => (
          <div className="mgr-row" key={i}>
            <span className="muted">{i + 1}.</span>
            <select value={b.building} onChange={(e) => edit(i, { building: e.target.value as BuildingKey, level: Math.min(b.level, BUILDINGS[e.target.value as BuildingKey].maxLevel) })}>
              {BUILDING_KEYS.map((k) => <option key={k} value={k}>{BUILDINGS[k].name}</option>)}
            </select>
            <label className="row small">niveau
              <input type="number" min={1} max={BUILDINGS[b.building].maxLevel} value={b.level} onChange={(e) => edit(i, { level: Math.max(1, Math.min(BUILDINGS[b.building].maxLevel, Number(e.target.value) || 1)) })} />
            </label>
            <button className="btn small" onClick={() => move(i, -1)} disabled={i === 0} aria-label="Monter">↑</button>
            <button className="btn small" onClick={() => move(i, 1)} disabled={i === plan.buildings.length - 1} aria-label="Descendre">↓</button>
            <button className="btn small danger" onClick={() => onChange({ ...plan, buildings: plan.buildings.filter((_, k) => k !== i) })} aria-label="Retirer">×</button>
          </div>
        ))}
        <button className="btn small" disabled={plan.buildings.length >= 60} onClick={() => onChange({ ...plan, buildings: [...plan.buildings, { building: 'farm', level: 10 }] })}>+ Ajouter un bâtiment</button>
      </div>
      <div>
        <b>Troupes voulues</b>
        <p className="muted small">Effectif à atteindre, troupes en déplacement et en recrutement comprises. Le gestionnaire ajoute des troupes, il n'en retire jamais.</p>
        <div className="mgr-troops">
          {UNIT_KEYS.map((u) => (
            <label key={u}>
              <span className="mgr-grow">{UNITS[u].name}</span>
              <input type="number" min={0} max={1000000} value={plan.troops[u] ?? 0} onChange={(e) => onChange({ ...plan, troops: { ...plan.troops, [u]: Math.max(0, Math.floor(Number(e.target.value) || 0)) } })} />
            </label>
          ))}
        </div>
      </div>
      <label className="stack">
        <b>Part de la production pour les troupes : {plan.troopsShare} %</b>
        <input type="range" min={0} max={100} step={5} value={plan.troopsShare} onChange={(e) => onChange({ ...plan, troopsShare: Number(e.target.value) })} />
        <span className="muted small">0 % : bâtiments d'abord, les troupes n'utilisent que l'excédent. 100 % : troupes d'abord. Entre les deux, les troupes prennent cette part de la production pendant que le bâtiment attend ses ressources : il avance toujours, juste un peu moins vite.</span>
      </label>
    </div>
  );
}

const clean = (p: ManagerPlan): ManagerPlan => ({
  buildings: p.buildings,
  troops: Object.fromEntries(Object.entries(p.troops).filter(([, n]) => (n ?? 0) > 0)) as ManagerPlan['troops'],
  troopsShare: p.troopsShare,
});

function TemplateCard({ t, reload }: { t: Template; reload: () => unknown }) {
  const { run, toast } = useGame();
  const [name, setName] = useState(t.name);
  const [plan, setPlan] = useState<ManagerPlan>(t);
  const [open, setOpen] = useState(false);
  return (
    <Panel
      title={t.name}
      actions={<button className="btn small" onClick={() => setOpen(!open)}>{open ? 'Fermer' : 'Modifier'}</button>}
    >
      {!open ? (
        <p className="muted small">
          {t.buildings.length} ligne{t.buildings.length > 1 ? 's' : ''} de bâtiments · {Object.values(t.troops).reduce((a, b) => a + (b ?? 0), 0)} troupes voulues · troupes : {t.troopsShare} %
        </p>
      ) : (
        <div className="stack">
          <input value={name} maxLength={40} onChange={(e) => setName(e.target.value)} aria-label="Nom du modèle" />
          <PlanEditor plan={plan} onChange={setPlan} />
          <div className="row">
            <button className="btn primary" onClick={() => run(async () => {
              await api(`/api/manager/templates/${t.id}`, { method: 'PUT', body: { name, plan: clean(plan) } });
              toast('Modèle enregistré');
              await reload();
            })}>Enregistrer</button>
            <button className="btn danger" onClick={() => confirm(`Supprimer le modèle « ${t.name} » ?`) && run(async () => {
              await api(`/api/manager/templates/${t.id}`, { method: 'DELETE' });
              await reload();
            })}>Supprimer</button>
          </div>
        </div>
      )}
    </Panel>
  );
}

function VillageCard({ v, data, reload }: { v: ManagerVillage; data: ManagerData; reload: () => unknown }) {
  const { setVillage } = useManagerActions(reload);
  const [editing, setEditing] = useState(false);
  const base = data.templates.find((t) => t.id === v.templateId);
  const [plan, setPlan] = useState<ManagerPlan>(v.custom ?? base ?? { buildings: [], troops: {}, troopsShare: 0 });
  return (
    <Panel title={`${v.name} (${v.x}|${v.y})`} actions={<ManagerSwitch v={v} data={data} reload={reload} />}>
      <div className="mgr-row">
        <label className="row">Modèle
          <select value={v.templateId ?? ''} onChange={(e) => setVillage(v.id, { templateId: e.target.value ? Number(e.target.value) : null, custom: null }, 'Modèle appliqué')}>
            <option value="">Aucun</option>
            {data.templates.map((t) => <option key={t.id} value={t.id}>{t.name}</option>)}
          </select>
        </label>
        {v.custom && <span className="muted small">Réglage propre à ce village</span>}
        <button className="btn small" onClick={() => setEditing(!editing)}>{editing ? 'Fermer' : 'Personnaliser ce village'}</button>
        {v.custom && <button className="btn small" onClick={() => setVillage(v.id, { custom: null }, 'Retour au modèle')}>Suivre le modèle</button>}
      </div>
      {editing && (
        <div className="stack">
          <PlanEditor plan={plan} onChange={setPlan} />
          <button className="btn primary" onClick={async () => { await setVillage(v.id, { custom: clean(plan) }, 'Réglage du village enregistré'); setEditing(false); }}>Enregistrer pour ce village</button>
        </div>
      )}
      {data.balance.enabled && (
        <label className="row small mgr-balance-village">
          <input type="checkbox" checked={v.balance} onChange={(e) => setVillage(v.id, { balance: e.target.checked }, e.target.checked ? 'Le village participe à l’équilibrage' : 'Le village est tenu à l’écart de l’équilibrage')} />
          Participe à l'équilibrage des ressources
        </label>
      )}
      {v.blocked && v.enabled && <p className="warn small">En attente : {v.blocked}</p>}
      {v.log.length > 0 && (
        <ul className="mgr-log small muted">
          {v.log.slice(0, 5).map((l, i) => <li key={i}>{new Date(l.at).toLocaleString('fr-FR', { dateStyle: 'short', timeStyle: 'short' })} · {l.text}</li>)}
        </ul>
      )}
    </Panel>
  );
}

/** Ce qui manque ou déborde passe d'un village à l'autre par les marchands, sans rapport de livraison. */
function BalancePanel({ data, reload }: { data: ManagerData; reload: () => unknown }) {
  const { run, toast } = useGame();
  const [draft, setDraft] = useState<BalanceSettings>(data.balance);
  const save = (next: BalanceSettings, ok: string) =>
    run(async () => {
      await api('/api/manager/balance', { method: 'PUT', body: next });
      setDraft(next);
      toast(ok);
      await reload();
    });
  const changed = draft.low !== data.balance.low || draft.high !== data.balance.high;
  const villageCount = data.villages.length;
  return (
    <Panel
      title="Équilibrage des ressources"
      actions={
        <button
          type="button"
          role="switch"
          aria-checked={data.balance.enabled}
          aria-label="Équilibrage des ressources"
          className={`switch ${data.balance.enabled ? 'on' : ''}`}
          onClick={() => save({ ...draft, enabled: !data.balance.enabled }, data.balance.enabled ? 'Équilibrage arrêté' : 'Équilibrage activé')}
        >
          <span className="switch-track"><span className="switch-knob" /></span>
          <span className="switch-label">{data.balance.enabled ? 'Actif' : 'Arrêté'}</span>
        </button>
      }
    >
      <p className="muted small">
        Chaque minute, les marchands des villages qui débordent livrent ceux qui manquent, au plus près d'abord. Un village piloté reçoit en priorité ce qui manque à son prochain bâtiment, et ne donne jamais ce qu'il garde pour lui. Les livraisons apparaissent dans le journal de chaque village, sans rapport.
      </p>
      {villageCount < 2 && <p className="warn small">Il faut au moins deux villages, et un marché dans ceux qui donnent.</p>}
      <div className="mgr-balance">
        <label className="stack">
          <b>Reçoit sous {draft.low} % de l'entrepôt</b>
          <input type="range" min={0} max={90} step={5} value={draft.low} onChange={(e) => setDraft({ ...draft, low: Math.min(Number(e.target.value), draft.high - 10) })} />
        </label>
        <label className="stack">
          <b>Donne au-dessus de {draft.high} % de l'entrepôt</b>
          <input type="range" min={10} max={100} step={5} value={draft.high} onChange={(e) => setDraft({ ...draft, high: Math.max(Number(e.target.value), draft.low + 10) })} />
        </label>
      </div>
      {changed && (
        <button className="btn primary" onClick={() => save({ ...draft, enabled: data.balance.enabled }, 'Seuils enregistrés')}>
          Enregistrer les seuils
        </button>
      )}
    </Panel>
  );
}

/** Interrupteur de village : activer le pilote automatique demande un modèle ou un réglage propre. */
export function ManagerSwitch({ v, data, reload }: { v: ManagerVillage; data: ManagerData; reload: () => unknown }) {
  const { setVillage } = useManagerActions(reload);
  const { toast } = useGame();
  const has = v.templateId !== null || v.custom !== null;
  return (
    <button
      type="button"
      role="switch"
      aria-checked={v.enabled}
      aria-label={`Gestionnaire du village ${v.name}`}
      className={`switch ${v.enabled ? 'on' : ''}`}
      onClick={() => {
        if (!v.enabled && !has) {
          // Sans modèle choisi, on prend le premier (Offensif par défaut) pour que l'interrupteur fasse quelque chose.
          const first = data.templates[0];
          if (!first) return toast('Créez d\'abord un modèle', 'error');
          return setVillage(v.id, { enabled: true, templateId: first.id }, `Gestionnaire activé avec le modèle « ${first.name} »`);
        }
        return setVillage(v.id, { enabled: !v.enabled }, v.enabled ? 'Gestionnaire arrêté' : 'Gestionnaire activé');
      }}
    >
      <span className="switch-track"><span className="switch-knob" /></span>
      <span className="switch-label">{v.enabled ? 'Actif' : 'Arrêté'}</span>
    </button>
  );
}

export default function Manager() {
  const { data, reload } = useManager();
  const { run, toast } = useGame();
  if (!data) return <p className="muted">Chargement…</p>;
  return (
    <div className="pg manager">
      <PageBanner
        icon="gestionnaire"
        kicker="Village · pilote automatique"
        title="Gestionnaire de compte"
        lead="Un pilote automatique pour vos villages : il monte les bâtiments dans l'ordre que vous fixez et recrute les troupes voulues, dès que les ressources le permettent, même quand vous n'êtes pas connecté. Il passe par les mêmes règles que vous : mêmes coûts, mêmes prérequis, même file de construction."
        chips={!data.available ? <span className="pg-pill war">Désactivé sur ce monde</span> : <span className="pg-pill gold">Disponible sur ce monde</span>}
        stats={[
          { value: `${data.villages.filter((v) => v.enabled).length} / ${data.villages.length}`, label: 'villages pilotés', tone: 'gold' },
          { value: `${data.templates.length} / ${data.maxTemplates}`, label: 'modèles' },
        ]}
      />
      {!data.available && <p className="warn">Le gestionnaire est désactivé sur ce monde par l'administrateur : rien ne s'exécute pour le moment. Vos réglages sont conservés.</p>}
      <BalancePanel data={data} reload={reload} />
      <h3 className="pg-section">
        <NavIcon name="apercu" size={16} /> Mes villages
      </h3>
      {data.villages.map((v) => <VillageCard key={v.id} v={v} data={data} reload={reload} />)}
      <h3 className="pg-section">
        <NavIcon name="gestionnaire" size={16} /> Modèles <span className="pg-count">{data.templates.length}/{data.maxTemplates}</span>
      </h3>
      {data.templates.map((t) => <TemplateCard key={t.id} t={t} reload={reload} />)}
      <button className="btn mgr-new" disabled={data.templates.length >= data.maxTemplates} onClick={() => run(async () => {
        await api('/api/manager/templates', { method: 'POST', body: { name: `Modèle ${data.templates.length + 1}`, plan: { buildings: [{ building: 'farm', level: 10 }], troops: {}, troopsShare: 0 } } });
        toast('Modèle créé');
        await reload();
      })}>+ Nouveau modèle</button>
    </div>
  );
}
