import { useState } from 'react';
import type { AdminWorldSummary } from '@aldoria/shared';
import { api } from '../api';
import { PageBanner } from '../components/PageBanner';
import { fmt } from '../format';
import { useGame } from '../game';
import { Panel } from '../ui';

const CONFIG_LABEL: Record<string, string> = {
  worldSpeed: 'Vitesse',
  mapSize: 'Carte',
  barbarianVillages: 'Barbares au départ',
  npcCount: 'PNJ au départ',
  npcTribes: 'Tribus de PNJ',
  npcTribeSize: 'PNJ par tribu',
};
const configText = (k: string, v: number) => (k === 'worldSpeed' ? `×${v}` : k === 'mapSize' ? `${v}×${v}` : fmt(v));
const created = (iso: string) => new Date(iso).toLocaleDateString('fr-FR', { day: 'numeric', month: 'long', year: 'numeric' });

/** Vue d'ensemble : une carte par monde, avec ses chiffres clés et l'ouverture des inscriptions. */
export default function Worlds({ worlds, onChanged }: { worlds: AdminWorldSummary[] | null; onChanged: () => void }) {
  const total = (k: keyof AdminWorldSummary['totals']) => (worlds ?? []).reduce((s, w) => s + w.totals[k], 0);
  return (
    <div className="pg dash-worlds">
      <PageBanner
        icon="monde"
        kicker="Administration"
        title="Tous les mondes"
        lead="Chaque monde a sa carte, ses joueurs, ses PNJ et ses réglages. Un même compte peut jouer dans plusieurs mondes."
        actions={<a className="btn primary" href="#/nouveau">Créer un monde</a>}
        stats={[
          { value: worlds?.length ?? '…', label: 'Mondes', tone: 'gold' },
          { value: worlds ? total('players') : '…', label: 'Joueurs inscrits' },
          { value: worlds ? total('active') : '…', label: 'Actifs sur 24 h', tone: 'ok' },
        ]}
      />
      {!worlds ? (
        <p className="muted">Chargement…</p>
      ) : (
        <div className="dash-cards">
          {worlds.map((w) => (
            <WorldCard key={w.id} world={w} onChanged={onChanged} />
          ))}
        </div>
      )}
    </div>
  );
}

function WorldCard({ world: w, onChanged }: { world: AdminWorldSummary; onChanged: () => void }) {
  return (
    <section className="panel dash-card">
      <header className="panel-head">
        <h2>{w.name}</h2>
        <span className={`chip ${w.open ? 'chip-ok' : 'chip-warn'}`}>{w.open ? 'Inscriptions ouvertes' : 'Inscriptions fermées'}</span>
      </header>
      <p className="muted small">Créé le {created(w.createdAt)} · vitesse ×{w.config.worldSpeed} · carte {w.config.mapSize}×{w.config.mapSize}</p>
      <dl className="dash-facts">
        <div><dt>Joueurs</dt><dd>{fmt(w.totals.players)}</dd></div>
        <div><dt>Actifs 24 h</dt><dd>{fmt(w.totals.active)}</dd></div>
        <div><dt>PNJ</dt><dd>{fmt(w.totals.npcs)}</dd></div>
        <div><dt>Tribus</dt><dd>{fmt(w.totals.tribes)}</dd></div>
        <div><dt>Villages</dt><dd>{fmt(w.totals.villages)}</dd></div>
        <div><dt>Barbares</dt><dd>{fmt(w.totals.barbarians)}</dd></div>
      </dl>
      <div className="row dash-card-actions">
        <a className="btn primary" href={`#/monde/${w.id}`}>Gérer ce monde</a>
        <OpenToggle world={w} onChanged={onChanged} />
      </div>
    </section>
  );
}

function OpenToggle({ world, onChanged }: { world: AdminWorldSummary; onChanged: () => void }) {
  const { run, toast } = useGame();
  const toggle = () =>
    run(async () => {
      await api(`/api/admin/worlds/${world.id}`, { method: 'PATCH', body: { open: !world.open } });
      toast(world.open ? `Inscriptions fermées dans ${world.name}` : `Inscriptions ouvertes dans ${world.name}`);
      onChanged();
    });
  return (
    <button className="btn" onClick={toggle}>
      {world.open ? 'Fermer les inscriptions' : 'Ouvrir les inscriptions'}
    </button>
  );
}

/** En-tête de la page d'un monde : nom modifiable, inscriptions et réglages fixés à la création. */
export function WorldHeader({ world, onChanged }: { world: AdminWorldSummary; onChanged: () => void }) {
  const { run, toast } = useGame();
  const [name, setName] = useState(world.name);
  const rename = () =>
    run(async () => {
      await api(`/api/admin/worlds/${world.id}`, { method: 'PATCH', body: { name } });
      toast('Monde renommé');
      onChanged();
    });
  return (
    <>
      <PageBanner
        icon="carte"
        kicker="Administration"
        title={`Monde ${world.name}`}
        lead="Signalements, bugs, PNJ, guerres, joueurs et réglages de ce monde · actualisé toutes les 20 s"
        chips={<span className={`chip ${world.open ? 'chip-ok' : 'chip-warn'}`}>{world.open ? 'Inscriptions ouvertes' : 'Inscriptions fermées'}</span>}
        stats={[
          { value: world.totals.players, label: 'Joueurs', tone: 'gold' },
          { value: world.totals.active, label: 'Actifs sur 24 h', tone: 'ok' },
          { value: world.totals.npcs, label: 'PNJ' },
        ]}
      />
      <Panel title="Identité du monde" actions={<OpenToggle world={world} onChanged={onChanged} />}>
        <div className="admin-setting">
          <span>
            <b>Nom du monde</b>
            <i className="muted small">Affiché aux joueurs dans la liste des mondes, à la connexion.</i>
          </span>
          <span className="row">
            <input value={name} maxLength={30} onChange={(e) => setName(e.target.value)} aria-label="Nom du monde" />
            <button className="btn small primary" disabled={name.trim() === world.name || name.trim().length < 2} onClick={rename}>
              Renommer
            </button>
          </span>
        </div>
        <dl className="dash-facts">
          {Object.entries(world.config).map(([k, v]) => (
            <div key={k}><dt>{CONFIG_LABEL[k] ?? k}</dt><dd>{configText(k, v)}</dd></div>
          ))}
        </dl>
        <p className="muted small">Ces réglages sont fixés à la création du monde. Tous les autres se changent ci-dessous, onglet « Monde ».</p>
      </Panel>
    </>
  );
}
