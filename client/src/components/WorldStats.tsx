import { useEffect, useState } from 'react';
import { BUILDINGS, RESOURCES, RESOURCE_NAMES, UNITS, type BuildingKey, type Resource, type UnitKey } from '@aldoria/shared';
import { api } from '../api';
import { fmt } from '../format';
import { useGame } from '../game';
import { Panel, ResIcon, UnitIcon } from '../ui';
import { PageBanner } from './PageBanner';
import './world.css';

interface WorldStatsData {
  world: { speed: number; mapSize: number };
  totals: {
    players: number;
    npcs: number;
    tribes: number;
    villages: number;
    barbarians: number;
    points: number;
    attacksInFlight: number;
    attacks24h: number;
    conquests24h: number;
    conquests7d: number;
    tribeWars: number;
    villagesPerOwner: number;
    pointsPerVillage: number;
  };
  distribution: { label: string; villages: number }[];
  troops: { unit: UnitKey; total: number; players: number; npc: number; perVillage: number }[];
  resources: { resource: Resource; total: number; perVillage: number; perHour: number }[];
  buildings: { building: BuildingKey; average: number }[];
  activity: { day: number; week: number };
}

const dec = (n: number) => n.toLocaleString('fr-FR', { maximumFractionDigits: 1 });

function Bar({ value, max }: { value: number; max: number }) {
  return (
    <span className="ws-bar">
      <i style={{ width: `${max > 0 ? Math.min(100, (value / max) * 100) : 0}%` }} />
    </span>
  );
}

function Kpi({ label, value, hint }: { label: string; value: string | number | undefined; hint?: string }) {
  return (
    <div className="ws-kpi">
      <i>{label}</i>
      <b>{value ?? '…'}</b>
      {hint && <small>{hint}</small>}
    </div>
  );
}

/** Statistiques publiques du monde : totaux et moyennes uniquement, jamais de joueur ni de village précis. */
export default function WorldStats() {
  const { run } = useGame();
  const [s, setS] = useState<WorldStatsData | null>(null);
  useEffect(() => {
    const load = () => run(async () => setS(await api<WorldStatsData>('/api/world/stats')));
    load();
    const t = setInterval(load, 60_000);
    return () => clearInterval(t);
  }, [run]);

  const t = s?.totals;
  const troopTotal = s?.troops.reduce((sum, x) => sum + x.total, 0);
  const maxTroop = Math.max(1, ...(s?.troops.map((x) => x.perVillage) ?? []));
  const maxSize = Math.max(1, ...(s?.distribution.map((d) => d.villages) ?? []));

  return (
    <div className="pg worldstats">
      <PageBanner
        icon="monde"
        kicker={s ? `Monde en vitesse ×${s.world.speed} · carte de ${s.world.mapSize} × ${s.world.mapSize} cases` : 'Monde'}
        title="Statistiques du monde"
        lead="Des totaux et des moyennes pour toute la carte, joueurs et PNJ confondus. Aucune information sur un joueur ou un village en particulier. Actualisé chaque minute."
        stats={[
          { value: t ? fmt(t.players) : '…', label: t ? `joueurs · + ${fmt(t.npcs)} PNJ` : 'joueurs', tone: 'gold' },
          { value: t ? fmt(t.tribes) : '…', label: 'tribus' },
          { value: t ? fmt(t.villages) : '…', label: t ? `villages · ${fmt(t.barbarians)} barbares` : 'villages occupés' },
          { value: t ? dec(t.villagesPerOwner) : '…', label: 'villages par habitant' },
          { value: t ? fmt(t.pointsPerVillage) : '…', label: t ? `points par village` : 'points par village' },
          { value: troopTotal !== undefined ? fmt(troopTotal) : '…', label: t && t.villages ? `troupes · ${fmt((troopTotal ?? 0) / t.villages)} par village` : 'troupes au total' },
        ]}
      />

      <Panel title="Activité">
        <div className="ws-kpis">
          <Kpi label="Joueurs actifs (24 h)" value={s ? fmt(s.activity.day) : undefined} hint={s ? `${fmt(s.activity.week)} sur 7 jours` : undefined} />
          <Kpi label="Attaques (24 h)" value={t ? fmt(t.attacks24h) : undefined} hint={t ? `${fmt(t.attacksInFlight)} en route` : undefined} />
          <Kpi label="Conquêtes (24 h)" value={t ? fmt(t.conquests24h) : undefined} hint={t ? `${fmt(t.conquests7d)} sur 7 jours` : undefined} />
          <Kpi label="Guerres de tribus" value={t ? fmt(t.tribeWars) : undefined} hint="en cours" />
        </div>
      </Panel>

      <Panel title="Troupes dans le monde" actions={<span className="muted small">au village, en route et en recrutement</span>}>
        {!s ? (
          <p className="muted">Chargement…</p>
        ) : (
          <div className="table-wrap">
            <table className="ws-table">
              <thead>
                <tr>
                  <th>Type</th>
                  <th className="num">Total</th>
                  <th className="num ws-hide-m">Joueurs / PNJ</th>
                  <th className="num">Par village</th>
                  <th className="ws-hide-m" />
                </tr>
              </thead>
              <tbody>
                {s.troops.map((x) => (
                  <tr key={x.unit}>
                    <td>
                      <span className="ws-unit">
                        <UnitIcon unit={x.unit} size={24} />
                        {UNITS[x.unit].name}
                      </span>
                    </td>
                    <td className="num">{fmt(x.total)}</td>
                    <td className="num ws-hide-m">
                      {fmt(x.players)} / {fmt(x.npc)}
                    </td>
                    <td className="num">{dec(x.perVillage)}</td>
                    <td className="ws-hide-m">
                      <Bar value={x.perVillage} max={maxTroop} />
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </Panel>

      <div className="ws-grid">
        <Panel title="Ressources">
          {!s ? (
            <p className="muted">Chargement…</p>
          ) : (
            <table className="ws-table">
              <thead>
                <tr>
                  <th>Type</th>
                  <th className="num">Total</th>
                  <th className="num">Par village</th>
                  <th className="num">Prod. / h</th>
                </tr>
              </thead>
              <tbody>
                {RESOURCES.map((r) => {
                  const x = s.resources.find((y) => y.resource === r)!;
                  return (
                    <tr key={r}>
                      <td>
                        <span className="ws-unit">
                          <ResIcon r={r} size={20} />
                          {RESOURCE_NAMES[r]}
                        </span>
                      </td>
                      <td className="num">{fmt(x.total)}</td>
                      <td className="num">{fmt(x.perVillage)}</td>
                      <td className="num">+{fmt(x.perHour)}</td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          )}
        </Panel>
        <Panel title="Taille des villages">
          {!s ? (
            <p className="muted">Chargement…</p>
          ) : (
            <ul className="ws-dist">
              {s.distribution.map((d) => (
                <li key={d.label}>
                  <span>{d.label} pts</span>
                  <Bar value={d.villages} max={maxSize} />
                  <b>{fmt(d.villages)}</b>
                </li>
              ))}
            </ul>
          )}
        </Panel>
      </div>

      <Panel title="Bâtiments : niveau moyen">
        {!s ? (
          <p className="muted">Chargement…</p>
        ) : (
          <ul className="ws-buildings">
            {s.buildings.map((b) => (
              <li key={b.building}>
                <span>{BUILDINGS[b.building].name}</span>
                <Bar value={b.average} max={BUILDINGS[b.building].maxLevel} />
                <b>{dec(b.average)}</b>
              </li>
            ))}
          </ul>
        )}
      </Panel>
    </div>
  );
}
