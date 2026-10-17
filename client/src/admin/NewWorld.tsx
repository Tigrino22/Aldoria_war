import { useEffect, useState, type FormEvent } from 'react';
import type { AdminWorldSummary, WorldTemplate } from '@aldoria/shared';
import { api } from '../api';
import { PageBanner } from '../components/PageBanner';
import { useGame } from '../game';
import { Panel } from '../ui';

/** Formulaire d'un nouveau monde : nom, réglages de création, puis tous les réglages du jeu (préremplis avec leur valeur d'origine). */
export default function NewWorld({ onCreated }: { onCreated: (w: AdminWorldSummary) => void }) {
  const { run } = useGame();
  const [template, setTemplate] = useState<WorldTemplate | null>(null);
  const [name, setName] = useState('');
  const [open, setOpen] = useState(true);
  const [config, setConfig] = useState<Record<string, string>>({});
  const [settings, setSettings] = useState<Record<string, string | number>>({});
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    run(async () => {
      const t = await api<WorldTemplate>('/api/admin/worlds/template');
      setTemplate(t);
      setConfig(Object.fromEntries(t.config.map((c) => [c.key, String(c.default)])));
    });
  }, [run]);

  async function submit(e: FormEvent) {
    e.preventDefault();
    if (!template) return;
    setBusy(true);
    // Seuls les réglages changés sont envoyés : les autres gardent leur valeur d'origine.
    const changed = Object.fromEntries(
      Object.entries(settings).filter(([k, v]) => String(v) !== String(template.settings.find((s) => s.key === k)?.default)),
    );
    const w = await run(() => api<AdminWorldSummary>('/api/admin/worlds', { method: 'POST', body: { name, open, config, settings: changed } }));
    setBusy(false);
    if (w) onCreated(w);
  }

  const valueOf = (key: string, fallback: string | number) => settings[key] ?? fallback;

  return (
    <form className="pg" onSubmit={submit}>
      <PageBanner
        icon="banniere"
        kicker="Administration"
        title="Nouveau monde"
        lead="Choisissez son nom et ses réglages. La carte, les villages barbares, les provinces et les PNJ sont créés aussitôt ; les joueurs le verront dans la liste des mondes."
      />
      <Panel title="Identité">
        <div className="admin-settings">
          <label className="admin-setting">
            <span>
              <b>Nom du monde</b>
              <i className="muted small">2 à 30 caractères, différent des autres mondes.</i>
            </span>
            <input value={name} onChange={(e) => setName(e.target.value)} required minLength={2} maxLength={30} placeholder="Ex. Terres du Nord" />
          </label>
          <div className="admin-setting">
            <span>
              <b>Inscriptions</b>
              <i className="muted small">Fermé : le monde n’apparaît qu’à ses joueurs, personne ne peut le rejoindre.</i>
            </span>
            <Switch on={open} label={open ? 'Ouvertes' : 'Fermées'} onClick={() => setOpen(!open)} />
          </div>
        </div>
      </Panel>
      <Panel title="Réglages fixés à la création">
        {!template ? (
          <p className="muted">Chargement…</p>
        ) : (
          <div className="admin-settings">
            {template.config.map((c) => (
              <label key={c.key} className="admin-setting">
                <span>
                  <b>{c.label}</b>
                  <i className="muted small">{c.help} · {c.min} à {c.max}</i>
                </span>
                <input
                  type="number"
                  step={c.integer ? 1 : 0.1}
                  min={c.min}
                  max={c.max}
                  required
                  value={config[c.key] ?? ''}
                  onChange={(e) => setConfig({ ...config, [c.key]: e.target.value })}
                />
              </label>
            ))}
          </div>
        )}
      </Panel>
      <Panel title="Réglages du jeu">
        <p className="muted small">Préremplis avec les valeurs d’origine. Ils se changent aussi plus tard, à chaud, depuis la page du monde.</p>
        {template && (
          <div className="admin-settings">
            {template.settings.map((s) =>
              s.type === 'boolean' ? (
                <div key={s.key} className="admin-setting">
                  <span>
                    <b>{s.label}</b>
                    <i className="muted small">{s.help}</i>
                  </span>
                  <Switch
                    on={Number(valueOf(s.key, s.default)) > 0}
                    label={Number(valueOf(s.key, s.default)) > 0 ? 'Activée' : 'Désactivée'}
                    onClick={() => setSettings({ ...settings, [s.key]: Number(valueOf(s.key, s.default)) > 0 ? 0 : 1 })}
                  />
                </div>
              ) : (
                <label key={s.key} className="admin-setting">
                  <span>
                    <b>{s.label}</b>
                    <i className="muted small">
                      {s.help}
                      {s.min !== null && s.max !== null && ` · ${s.min} à ${s.max}`}
                    </i>
                  </span>
                  <input
                    type={s.type === 'text' ? 'text' : 'number'}
                    step={s.type === 'integer' ? 1 : 0.05}
                    min={s.min ?? undefined}
                    max={s.max ?? undefined}
                    value={String(valueOf(s.key, s.default))}
                    onChange={(e) => setSettings({ ...settings, [s.key]: e.target.value })}
                  />
                </label>
              ),
            )}
          </div>
        )}
      </Panel>
      <div className="row dash-submit">
        <button className="btn primary" disabled={busy || !template}>
          {busy ? 'Création du monde…' : 'Créer le monde'}
        </button>
        <a className="btn" href="#/mondes">Annuler</a>
      </div>
    </form>
  );
}

function Switch({ on, label, onClick }: { on: boolean; label: string; onClick: () => void }) {
  return (
    <button type="button" role="switch" aria-checked={on} className={`switch ${on ? 'on' : ''}`} onClick={onClick}>
      <span className="switch-track"><span className="switch-knob" /></span>
      <span className="switch-label">{label}</span>
    </button>
  );
}
