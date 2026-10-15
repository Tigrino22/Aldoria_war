import { useEffect, useState } from 'react';
import { PROFILE_BIO_MAX, type PlayerProfile } from '@aldoria/shared';
import { api } from '../api';
import { clockTime, fmt } from '../format';
import { useGame } from '../game';
import { Panel, PlayerLink } from '../ui';
import { CardTitle, PageBanner } from './PageBanner';
import { Badge } from './Badge';
import ReportButton from './ReportButton';
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
      <ReportButton kind="player" target={profile.username} label={profile.username} />
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
      <div className="pf-grid">
        {(mine || profile.bio) && (
          <Bio
            bio={profile.bio}
            editable={mine}
            onSaved={(bio) => setProfile({ ...profile, bio })}
          />
        )}
        <WarRecordCard profile={profile} />
        {(profile.badges.length > 0 || mine) && (
          <section className="pg-card">
            <CardTitle icon="medaille" count={profile.badges.length}>
              Succès
            </CardTitle>
            {profile.badges.length === 0 ? (
              <p className="pg-empty">
                Aucun badge pour l’instant : voyez vos <a href="#/succes">succès</a> pour savoir comment en gagner.
              </p>
            ) : (
              <div className="ach-badges">
                {profile.badges.map((b) => (
                  <Badge key={b.key} title={b.title} tier={b.tier} />
                ))}
              </div>
            )}
            {mine && profile.badges.length > 0 && (
              <p className="small">
                <a href="#/succes">Voir tous mes succès</a>
              </p>
            )}
          </section>
        )}
      </div>
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
                    <td><a href={`#/fiche/${v.x},${v.y}`}>{v.name}</a></td>
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

/** Présentation écrite par le joueur ; il la modifie depuis son propre profil. */
function Bio({ bio, editable, onSaved }: { bio: string; editable: boolean; onSaved: (bio: string) => void }) {
  const { run, toast } = useGame();
  const [draft, setDraft] = useState<string | null>(null);

  const save = () =>
    run(async () => {
      const res = await api<{ bio: string }>('/api/me/bio', { method: 'PUT', body: { bio: draft ?? '' } });
      onSaved(res.bio);
      setDraft(null);
      toast('Présentation enregistrée');
    });

  return (
    <section className="pg-card pf-bio">
      <CardTitle icon="compte">Présentation</CardTitle>
      {draft !== null ? (
        <div className="stack">
          <textarea
            aria-label="Votre présentation"
            rows={7}
            maxLength={PROFILE_BIO_MAX}
            value={draft}
            placeholder="Votre histoire, vos ambitions, ce que vous cherchez dans une tribu…"
            onChange={(e) => setDraft(e.target.value)}
          />
          <div className="row wrap pf-bio-actions">
            <span className="muted small">
              {draft.length} / {PROFILE_BIO_MAX}
            </span>
            <button className="btn ghost small" onClick={() => setDraft(null)}>
              Annuler
            </button>
            <button className="btn primary small" onClick={save}>
              Enregistrer
            </button>
          </div>
        </div>
      ) : (
        <>
          {bio ? <p className="pf-bio-text">{bio}</p> : <p className="pg-empty">Présentez-vous aux autres seigneurs : ils la liront sur votre profil.</p>}
          {editable && (
            <button className="btn small" onClick={() => setDraft(bio)}>
              {bio ? 'Modifier' : 'Écrire ma présentation'}
            </button>
          )}
        </>
      )}
    </section>
  );
}

/** Faits d'armes : compteurs de batailles et dernières conquêtes ou pertes de villages. */
function WarRecordCard({ profile }: { profile: PlayerProfile }) {
  const w = profile.war;
  const tiles = [
    { value: w.conquests, label: 'Villages conquis', tone: 'gold' },
    { value: w.villagesLost, label: 'Villages perdus', tone: 'red' },
    { value: w.attackWins, label: 'Attaques gagnées', tone: '' },
    { value: w.defenseWins, label: 'Défenses tenues', tone: 'sky' },
  ];
  return (
    <section className="pg-card">
      <CardTitle icon="banniere">Faits d’armes</CardTitle>
      <div className="pf-war">
        {tiles.map((t) => (
          <div key={t.label} className={`pf-war-tile ${t.tone}`}>
            <b>{fmt(t.value)}</b>
            <span className="muted small">{t.label}</span>
          </div>
        ))}
      </div>
      {profile.conquests.length > 0 && (
        <ul className="pf-conquests">
          {profile.conquests.map((k, i) => (
            <li key={i} className={k.won ? 'won' : 'lost'}>
              <span className="dot" />
              <span>
                {k.won ? 'A pris ' : 'A perdu '}
                <a href={`#/fiche/${k.village.x},${k.village.y}`}>
                  {k.village.name} ({k.village.x}|{k.village.y})
                </a>
                {k.won ? ' à ' : ' contre '}
                <PlayerLink name={k.other} />
              </span>
              <span className="muted small">{clockTime(k.at)}</span>
            </li>
          ))}
        </ul>
      )}
    </section>
  );
}
