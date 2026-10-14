import { useEffect, useState } from 'react';
import type { PlayerProfile } from '@aldoria/shared';
import { api } from '../api';
import { clockTime, fmt } from '../format';
import { useGame } from '../game';
import { Panel } from '../ui';
import { CardTitle, PageBanner } from './PageBanner';
import './account.css';

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

  const actions = !mine && (
    <>
      {profile.invite === 'can' && (
        <button
          className="btn"
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
      {profile.invite === 'pending' && <span className="pg-pill gold">Invitation envoyée</span>}
      <a className="btn primary" href={`#/messages/ecrire/${encodeURIComponent(profile.username)}`}>
        Écrire
      </a>
    </>
  );

  return (
    <div className="pg profile">
      <PageBanner
        icon="compte"
        kicker={mine ? 'Mon profil' : 'Profil de joueur'}
        title={profile.username}
        lead={
          <>
            {profile.tribe ? (
              <>
                Tribu <a href={`#/tribu/${profile.tribe.id}`}>[{profile.tribe.tag}] {profile.tribe.name}</a>
              </>
            ) : (
              'Sans tribu'
            )}
            {' · '}inscrit le {clockTime(profile.createdAt)}
          </>
        }
        chips={
          (profile.protected || profile.title || (profile.titles?.length ?? 0) > 0) && (
            <>
              {profile.title && <span className="pg-pill gold">{profile.title}</span>}
              {profile.titles
                ?.filter((t) => t !== profile.title)
                .map((t) => (
                  <span key={t} className="pg-pill">
                    {t}
                  </span>
                ))}
              {profile.protected && <span className="pg-pill ally">Sous protection débutant</span>}
            </>
          )
        }
        actions={actions}
        stats={[
          { value: `#${profile.rank}`, label: 'Rang', tone: 'gold' },
          { value: profile.points, label: 'Points' },
          { value: profile.killsAttack, label: 'Battus en attaque', tone: 'red' },
          { value: profile.killsDefense, label: 'Battus en défense', tone: 'sky' },
          ...(profile.glory ? [{ value: profile.glory, label: 'Gloire des croisades', tone: 'gold' as const }] : []),
        ]}
      />
      <section className="panel">
        <header className="panel-head">
          <CardTitle icon="village" count={profile.villages.length}>Villages</CardTitle>
        </header>
        {profile.villages.length === 0 ? (
          <p className="muted">Aucun village pour le moment.</p>
        ) : (
          <div className="table-wrap">
            <table className="rank-table pf-villages">
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
      </section>
    </div>
  );
}
