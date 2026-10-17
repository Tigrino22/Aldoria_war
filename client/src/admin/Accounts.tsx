import { useEffect, useState } from 'react';
import type { AdminAccount } from '@aldoria/shared';
import { api } from '../api';
import { PageBanner } from '../components/PageBanner';
import { ago, fmt } from '../format';
import { useGame } from '../game';
import { Panel } from '../ui';

/** Tous les comptes du serveur, avec les mondes où ils jouent. */
export default function Accounts() {
  const { run } = useGame();
  const [accounts, setAccounts] = useState<AdminAccount[] | null>(null);
  const [q, setQ] = useState('');
  const [world, setWorld] = useState<number | 'all' | 'none'>('all');

  useEffect(() => {
    run(async () => setAccounts(await api<AdminAccount[]>('/api/admin/accounts')));
  }, [run]);

  const worlds = [...new Map((accounts ?? []).flatMap((a) => a.worlds.map((w) => [w.worldId, w.worldName] as const))).entries()].sort((a, b) => a[0] - b[0]);
  const shown = (accounts ?? []).filter(
    (a) =>
      a.username.toLowerCase().includes(q.trim().toLowerCase()) &&
      (world === 'all' ? true : world === 'none' ? a.worlds.length === 0 : a.worlds.some((w) => w.worldId === world)),
  );
  const day = Date.now() - 86_400_000;

  return (
    <div className="pg">
      <PageBanner
        icon="compte"
        kicker="Administration"
        title="Tous les joueurs"
        lead="Chaque compte et les mondes où il joue. Pour la fiche détaillée d’un joueur, ouvrez son monde, onglet « Joueurs »."
        stats={[
          { value: accounts?.length ?? '…', label: 'Comptes', tone: 'gold' },
          { value: accounts ? accounts.filter((a) => a.lastSeen && Date.parse(a.lastSeen) > day).length : '…', label: 'Actifs sur 24 h', tone: 'ok' },
          { value: accounts ? accounts.filter((a) => a.worlds.length > 1).length : '…', label: 'Dans plusieurs mondes' },
        ]}
      />
      <Panel title="Comptes">
        <div className="row dash-filters">
          <input type="search" placeholder="Rechercher un pseudo" value={q} onChange={(e) => setQ(e.target.value)} aria-label="Rechercher un pseudo" />
          <select value={String(world)} onChange={(e) => setWorld(e.target.value === 'all' || e.target.value === 'none' ? e.target.value : Number(e.target.value))} aria-label="Monde">
            <option value="all">Tous les mondes</option>
            {worlds.map(([id, name]) => (
              <option key={id} value={id}>{name}</option>
            ))}
            <option value="none">Sans monde</option>
          </select>
          <span className="muted small">{shown.length} compte{shown.length > 1 ? 's' : ''}</span>
        </div>
        {!accounts ? (
          <p className="muted">Chargement…</p>
        ) : (
          <div className="admin-scroll">
            <table className="admin-table dash-accounts">
              <thead>
                <tr>
                  <th>Pseudo</th>
                  <th>Mondes</th>
                  <th className="hide-m">Inscrit</th>
                  <th>Vu</th>
                </tr>
              </thead>
              <tbody>
                {shown.map((a) => (
                  <tr key={a.id}>
                    <td>
                      <b>{a.username}</b>
                      {a.admin && <span className="chip chip-ok">admin</span>}
                    </td>
                    <td>
                      {a.worlds.length === 0 ? (
                        <span className="muted small">aucun monde choisi</span>
                      ) : (
                        <span className="dash-worldchips">
                          {a.worlds.map((w) => (
                            <a key={w.worldId} className="chip" href={`#/monde/${w.worldId}`} title={`Joué ${ago(w.lastPlayed)}`}>
                              {w.worldName} · {fmt(w.points)} pts · {w.villages} v.{w.tribe ? ` · [${w.tribe}]` : ''}
                            </a>
                          ))}
                        </span>
                      )}
                    </td>
                    <td className="t hide-m">{new Date(a.createdAt).toLocaleDateString('fr-FR')}</td>
                    <td className="t">{a.lastSeen ? ago(a.lastSeen) : 'jamais'}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </Panel>
    </div>
  );
}
