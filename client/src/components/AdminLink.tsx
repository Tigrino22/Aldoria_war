import { API_BASE } from '../config';
import { useGame } from '../game';
import { Panel } from '../ui';
import { PageBanner } from './PageBanner';

/**
 * Entrée « Administration » du jeu, visible des seuls administrateurs : l'administration se fait dans le tableau de bord
 * séparé (/admin), qui gère tous les mondes.
 */
export default function AdminLink() {
  const { me, world } = useGame();
  const pending = (me.openModerationReports ?? 0) + (me.openBugReports ?? 0);
  return (
    <div className="pg">
      <PageBanner
        icon="admin"
        kicker="Administration"
        title="Tableau de bord"
        lead="Mondes, réglages, joueurs, signalements et bugs se gèrent dans le tableau de bord d’administration, à part du jeu."
        actions={
          <a className="btn primary" href={`${API_BASE}/admin#/monde/${world.id}`} target="_blank" rel="noreferrer">
            Ouvrir le tableau de bord
          </a>
        }
        stats={[
          { value: me.openModerationReports ?? 0, label: 'Signalements à traiter', tone: me.openModerationReports ? 'red' : '' },
          { value: me.openBugReports ?? 0, label: 'Bugs à traiter', tone: me.openBugReports ? 'red' : '' },
        ]}
      />
      <Panel title="Accès">
        <p className="small">
          {pending > 0 ? `${pending} élément${pending > 1 ? 's' : ''} attend${pending > 1 ? 'ent' : ''} dans le monde ${world.name}. ` : ''}
          Le tableau de bord demande de se connecter avec un compte administrateur ; les autres comptes n’y ont pas accès.
        </p>
      </Panel>
    </div>
  );
}
