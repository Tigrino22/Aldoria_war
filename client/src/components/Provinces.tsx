import { useEffect, useMemo, useRef, useState } from 'react';
import { BASTION_GARRISON, HOLY_GARRISON, PROVINCE_BONUS_LABEL, provinceGrid, type MapRelations, type ProvinceView, type ProvincesState } from '@aldoria/shared';
import { api } from '../api';
import { fmt } from '../format';
import { useGame } from '../game';
import { Countdown } from '../ui';
import { CardTitle, PageBanner } from './PageBanner';
import { REL_COLORS } from './mapStyle';
import './provinces.css';

const NO_RELATIONS: MapRelations = { warTribeIds: [], allyTribeIds: [] };

/** Couleur fixe d'une tribu, comme sur la carte. */
function useTribeColor(relations: MapRelations) {
  const { me } = useGame();
  const mine = me.player.tribe?.id ?? null;
  return (tribeId: number | null | undefined) => {
    if (!tribeId) return null;
    if (tribeId === mine) return REL_COLORS.tribe;
    if (relations.allyTribeIds.includes(tribeId)) return REL_COLORS.ally;
    if (relations.warTribeIds.includes(tribeId)) return REL_COLORS.war;
    return REL_COLORS.other;
  };
}

/** Petite carte des provinces : chaque province à la couleur de la tribu qui la tient, la Terre sainte en or. */
function ProvinceMap({ state, colorOf }: { state: ProvincesState; colorOf: (id: number | null | undefined) => string | null }) {
  const ref = useRef<HTMLCanvasElement>(null);
  const size = state.mapSize;
  const key = state.provinces.map((p) => `${p.id},${p.x},${p.y},${p.weight}`).join(';');
  // eslint-disable-next-line react-hooks/exhaustive-deps
  const grid = useMemo(() => provinceGrid(size, state.provinces), [key, size]);
  useEffect(() => {
    const cv = ref.current;
    if (!cv) return;
    const k = 4;
    cv.width = cv.height = size * k;
    const g = cv.getContext('2d')!;
    const fills = state.provinces.map((p) => {
      const c = p.holder ? colorOf(p.holder.tribeId) : null;
      if (c) return p.controlled ? c : `${c}99`;
      return p.kind === 'holy' ? '#b8913a' : '#5b4a32';
    });
    for (let y = 0; y < size; y++)
      for (let x = 0; x < size; x++) {
        g.fillStyle = fills[grid[y * size + x]];
        g.fillRect(x * k, y * k, k, k);
      }
    g.fillStyle = 'rgba(20,14,8,.85)';
    for (let y = 0; y < size; y++)
      for (let x = 0; x < size; x++) {
        const a = grid[y * size + x];
        if (x + 1 < size && grid[y * size + x + 1] !== a) g.fillRect((x + 1) * k - 1, y * k, 2, k);
        if (y + 1 < size && grid[(y + 1) * size + x] !== a) g.fillRect(x * k, (y + 1) * k - 1, k, 2);
      }
    for (const p of state.provinces) {
      if (!p.bastion) continue;
      g.fillStyle = p.kind === 'holy' ? '#f7d778' : '#f3e2b3';
      g.strokeStyle = '#140e08';
      g.lineWidth = 2;
      const s = p.kind === 'holy' ? 10 : 7;
      g.fillRect(p.bastion.x * k + k / 2 - s / 2, p.bastion.y * k + k / 2 - s / 2, s, s);
      g.strokeRect(p.bastion.x * k + k / 2 - s / 2, p.bastion.y * k + k / 2 - s / 2, s, s);
    }
  }, [grid, state, colorOf, size]);
  return <canvas ref={ref} className="prov-map" aria-label="Carte des provinces" />;
}

function Status({ p, holdHours }: { p: ProvinceView; holdHours: number }) {
  if (!p.holder) return <span className="muted">Sans maître · Garde neutre</span>;
  if (p.controlled) return <span>Contrôlée</span>;
  return (
    <span>
      Bannière plantée · contrôle dans <Countdown to={p.controlAt!} />
      <span className="muted small"> ({holdHours} h de tenue)</span>
    </span>
  );
}

/** Provinces : qui tient quoi, le bonus de chaque province, l'accès à la Terre sainte et la victoire du monde. */
export default function Provinces() {
  const { me, run } = useGame();
  const [state, setState] = useState<ProvincesState | null>(null);
  const [relations, setRelations] = useState<MapRelations>(NO_RELATIONS);
  useEffect(() => {
    let alive = true;
    const load = async () => {
      const [s, r] = await Promise.all([api<ProvincesState>('/api/provinces'), api<MapRelations>('/api/map/relations').catch(() => NO_RELATIONS)]);
      if (!alive) return;
      setState(s);
      setRelations(r);
    };
    run(load);
    const timer = window.setInterval(() => load().catch(() => {}), 60_000);
    return () => {
      alive = false;
      window.clearInterval(timer);
    };
  }, [run]);
  const colorOf = useTribeColor(relations);
  if (!state) return <p className="muted">Chargement des provinces…</p>;

  const holy = state.provinces.find((p) => p.kind === 'holy');
  const myTribe = me.player.tribe?.id ?? null;
  const mine = state.provinces.filter((p) => p.kind === 'province' && p.holder?.tribeId === myTribe && p.controlled);
  const ordered = [...state.provinces].sort((a, b) => {
    const rank = (p: ProvinceView) => (p.kind === 'holy' ? 0 : p.holder?.tribeId === myTribe && myTribe ? 1 : p.holder ? 2 : 3);
    return rank(a) - rank(b) || a.name.localeCompare(b.name);
  });
  const around = new Set(holy?.neighbours ?? []);

  return (
    <div className="pg provinces">
      <PageBanner
        icon="province"
        kicker="Armée · conquête du monde"
        title="Provinces"
        lead={`Plantez la bannière de votre tribu sur un bastion et tenez-le ${state.holdHours} heures pour contrôler sa province. Contrôlez ${state.holyAccess} provinces bordant la Terre sainte pour attaquer son Sanctuaire, puis tenez-le ${state.holyHoldDays} jours pour gagner le monde.`}
        stats={[
          { value: mine.length, label: 'Provinces de votre tribu', tone: 'sky' },
          { value: state.mine ? `${state.mine.holyNeighbours}/${state.holyAccess}` : '–', label: 'Voisines de la Terre sainte', tone: state.mine?.canAttackHoly ? 'ok' : '' },
          { value: holy?.holder ? `[${holy.holder.tag}]` : 'Libre', label: 'Terre sainte', tone: 'gold' },
          { value: `+${state.bonusPercent} %`, label: 'Bonus par province' },
        ]}
      />
      {!state.enabled && <p className="warn">Les provinces sont désactivées sur ce monde.</p>}
      {state.victory && (
        <section className="pg-card prov-victory">
          <CardTitle icon="couronne">Le monde a son maître</CardTitle>
          <p>
            La tribu <b>[{state.victory.tribeTag}] {state.victory.tribeName}</b> a tenu la Terre sainte et gagné le monde le{' '}
            {new Date(state.victory.at).toLocaleDateString('fr-FR', { day: 'numeric', month: 'long', year: 'numeric' })}.
          </p>
        </section>
      )}
      <div className="pg-grid prov-grid">
        <div className="stack">
          <section className="pg-card">
            <CardTitle icon="province" count={state.provinces.length}>
              Toutes les provinces
            </CardTitle>
            <ul className="prov-list">
              {ordered.map((p) => {
                const color = p.holder ? colorOf(p.holder.tribeId) : null;
                return (
                  <li key={p.id} className={`prov-row ${p.kind === 'holy' ? 'holy' : ''}`}>
                    <span className="prov-swatch" style={{ background: color ?? (p.kind === 'holy' ? '#b8913a' : '#5b4a32') }} />
                    <div className="prov-main">
                      <b>{p.name}</b>
                      <span className="prov-sub">
                        {p.kind === 'holy' ? 'Terre sainte · victoire du monde' : p.bonus ? `${PROVINCE_BONUS_LABEL[p.bonus]} +${state.bonusPercent} %` : ''}
                        {around.has(p.id) && ' · borde la Terre sainte'}
                      </span>
                      <span className="prov-sub">
                        {p.holder && (
                          <b style={{ color: color ?? undefined }}>
                            [{p.holder.tag}] {p.holder.name} ·{' '}
                          </b>
                        )}
                        <Status p={p} holdHours={p.kind === 'holy' ? state.holyHoldDays * 24 : state.holdHours} />
                      </span>
                    </div>
                    {p.bastion && (
                      <a className="btn small ghost" href={`#/carte/${p.bastion.x},${p.bastion.y}`}>
                        {p.bastion.x}|{p.bastion.y}
                      </a>
                    )}
                  </li>
                );
              })}
            </ul>
          </section>
        </div>
        <div className="stack">
          <section className="pg-card">
            <CardTitle icon="carte">Carte des provinces</CardTitle>
            <ProvinceMap state={state} colorOf={colorOf} />
            <p className="muted small">Couleurs de la carte : bleu pour votre tribu, bleu ciel pour vos alliés, rouge vif pour vos ennemis, rouge foncé pour les autres. Plus pâle : bannière pas encore tenue assez longtemps.</p>
          </section>
          <section className="pg-card pg-callout">
            <CardTitle icon="banniere">Comment prendre un bastion</CardTitle>
            <ol className="prov-steps">
              <li>Chaque bastion est gardé au départ par {fmt(BASTION_GARRISON)} places de population derrière une muraille 10 (le Sanctuaire : {fmt(HOLY_GARRISON)} et muraille 20). Espionnez-le d'abord.</li>
              <li>Videz-le avec une attaque qui emmène un noble : s'il survit, il plante la bannière de votre tribu et vos survivants restent pour la garder.</li>
              <li>Votre tribu et ses alliés peuvent le renforcer. Tenez {state.holdHours} heures sans perdre la bannière pour contrôler la province.</li>
              <li>Une attaque victorieuse avec un noble remplace la bannière ; sans noble, elle l'abat. Dans les deux cas, le bonus est perdu tout de suite.</li>
            </ol>
          </section>
        </div>
      </div>
    </div>
  );
}
