import { useState } from 'react';
import { useGame, useRoute } from '../game';

/** Identifiant de la nouveauté annoncée : une nouvelle annonce aura un nouvel identifiant et s'affichera à nouveau. */
const ANNOUNCEMENT = 'assistant-pillage';
const key = (playerId: number) => `aldoria.annonce.${ANNOUNCEMENT}.${playerId}`;

const seen = (playerId: number) => {
  try {
    return localStorage.getItem(key(playerId)) === '1';
  } catch {
    return false;
  }
};

/** Grande fenêtre affichée une fois à la prochaine connexion de chaque joueur pour présenter l'assistant de pillage. */
export default function Announcement() {
  const { me } = useGame();
  const [, go] = useRoute();
  const [open, setOpen] = useState(() => !seen(me.player.id));
  if (!open) return null;

  const close = (to?: string) => {
    try {
      localStorage.setItem(key(me.player.id), '1');
    } catch {
      /* stockage indisponible : l'annonce reviendra à la prochaine session */
    }
    setOpen(false);
    if (to) go(to);
  };

  return (
    <div className="modal-backdrop" onClick={() => close()}>
      <div className="announce" role="dialog" aria-modal="true" aria-labelledby="announce-title" onClick={(e) => e.stopPropagation()}>
        <span className="announce-tag">Nouveauté</span>
        <h2 id="announce-title">L'assistant de pillage est arrivé !</h2>
        <p className="announce-lead">Pillez les villages barbares autour de vous en un clic, sans repasser par la carte ni ressaisir vos troupes.</p>
        <ol className="announce-steps">
          <li><b>Enregistrez deux modèles d'attaque, A et B</b> : le nombre de chaque unité à envoyer (par exemple A pour de la cavalerie légère, B pour un gros détachement).</li>
          <li><b>Cliquez sur A ou B</b> à côté d'un village pour l'attaquer avec ce modèle, ou cochez-en plusieurs et envoyez-les d'un coup.</li>
          <li><b>Regardez le butin estimé</b> : calculé d'après votre dernier rapport d'éclaireur. Un « ? » signifie qu'il faut d'abord espionner le village.</li>
          <li><b>Un village attaqué disparaît de la liste</b> jusqu'à l'arrivée de vos troupes, vous ne l'attaquez donc pas deux fois.</li>
        </ol>
        <p className="muted">Pour tous les détails (pastilles, « attaque suicidaire », calcul du butin), consultez le wiki.</p>
        <div className="announce-actions">
          <button className="btn primary" onClick={() => close('pillage')}>Essayer l'assistant de pillage</button>
          <button className="btn" onClick={() => close('wiki/pillage')}>Lire le wiki</button>
          <button className="btn ghost" onClick={() => close()}>Fermer</button>
        </div>
      </div>
    </div>
  );
}
