import { useEffect, useState } from 'react';
import type { PlayerProfile } from '@aldoria/shared';
import { api } from '../api';
import { clockTime, fmt } from '../format';
import { useGame } from '../game';
import { Panel } from '../ui';

export default function Profile({ name }: { name: string }) {
  const { me, run, toast } = useGame();
  const [profile, setProfile] = useState<PlayerProfile | null>(null);
  const [missing, setMissing] = useState(false);

  useEffect(() => {
    setProfile(null);
    setMissing(false);
    run(async () => {
      try {
        setProfile(await api<PlayerProfile>(`/api/players/${encodeURIComponent(name)}`));
      } catch {
        setMissing(true);
      }
    });
  }, [name, run]);

  if (missing) {
    return (
      <Panel title="Profil">
        <p className="muted">Joueur introuvable.</p>
      </Panel>
    );
  }
  if (!profile) return <p className="muted">Chargement du profil…</p>;
  const mine = profile.id === me.player.id;

  return (
    <Panel
      title={profile.username}
      actions={
        !mine && (
          <div className="row">
            {profile.invite === 'can' && (
              <button
                className="btn small"
                onClick={() =>
                  run(async () => {
                    await api('/api/tribes/invite', { body: { username: profile.username } });
                    toast(`Invitation envoyée à ${profile.username}`);
                    setProfile({ ...profile, invite: 'pending' });
                  })
                }
              >
                Inviter dans ma tribu
              </button>
            )}
            {profile.invite === 'pending' && <span className="chip">Invitation envoyée</span>}
            <a className="btn small primary" href={`#/messages/ecrire/${encodeURIComponent(profile.username)}`}>
              Écrire
            </a>
          </div>
        )
      }
    >
      <p className="muted small">
        {profile.tribe ? (
          <>
            Tribu <a href={`#/tribu/${profile.tribe.id}`}>[{profile.tribe.tag}] {profile.tribe.name}</a>
          </>
        ) : (
          'Sans tribu'
        )}
        {' · '}rang {profile.rank} · {fmt(profile.points)} points · inscrit le {clockTime(profile.createdAt)}
        {profile.protected && ' · sous protection débutant'}
      </p>
      <h3>Villages ({profile.villages.length})</h3>
      {profile.villages.length === 0 ? (
        <p className="muted">Aucun village pour le moment.</p>
      ) : (
        <div className="table-wrap">
          <table className="rank-table">
            <thead>
              <tr><th>Village</th><th>Coordonnées</th><th>Points</th></tr>
            </thead>
            <tbody>
              {profile.villages.map((v) => (
                <tr key={v.id}>
                  <td><a href={`#/carte/${v.x},${v.y}`}>{v.name}</a></td>
                  <td>({v.x}|{v.y})</td>
                  <td>{fmt(v.points)}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </Panel>
  );
}
