# Joueurs PNJ

Les PNJ sont de vrais comptes joueurs (`players.is_npc`) sans mot de passe valide, pilotés par le serveur. Leur pseudo se termine par « (PNJ) » : on les reconnaît partout (carte, classement, rapports, profil). Ils utilisent exactement les mêmes fonctions que les joueurs (`enqueueBuild`, `enqueueRecruit`, `sendCommand`), donc les mêmes règles, la même protection débutant et les mêmes alertes d'attaque.

## Réglages (variables d'environnement)

| Variable | Défaut | Effet |
|---|---|---|
| `NPC_COUNT` | 40 | Nombre de PNJ. Le serveur en crée jusqu'à ce nombre au démarrage, sans jamais en supprimer. `0` désactive les PNJ. |
| `NPC_DIFFICULTY` | 1 | Modérée. 0,5 = facile, 1,5 = difficile (monte plus vite, armées plus grosses). |
| `NPC_TIMEZONE` | Europe/Paris | Fuseau des heures calmes. |
| `NPC_QUIET_START` / `NPC_QUIET_END` | 22 / 8 | Heures calmes : les PNJ ne visent aucun joueur (ni attaque ni espionnage), et rien ne doit arriver chez un joueur pendant ces heures. Ils continuent à construire et à recruter, et peuvent piller les barbares. |

## Comportement

- Un PNJ réfléchit toutes les 10 à 20 minutes (moins quand le monde va vite) : un second worker, toutes les 30 secondes, réveille ceux dont l'heure est venue.
- **Construire** : deux profils, Bâtisseur (économie, muraille) et Pillard (fer, caserne). Le niveau visé suit l'âge du monde : niveau 2 au départ, +1 tous les 2 jours de jeu (×difficulté), plafonné à 20.
- **Recruter** : armée visée proportionnelle à ce niveau, dans la limite du blé produit.
- **Attaquer** : le PNJ espionne d'abord sa cible (le joueur voit passer les éclaireurs), puis envoie la plus petite armée qui dépasse 1,3 fois la défense estimée. Rayon de 20 cases. Les Bâtisseurs ne visent que les barbares ; les Pillards visent aussi les joueurs.
- **Plafonds** : au plus 2 attaques sur des joueurs par PNJ et par jour, 1 attaque par jour sur un même joueur (tous PNJ confondus), 6 heures de jeu entre deux attaques armées d'un même PNJ, 4 heures de jeu entre deux espionnages. Les joueurs sous protection débutant ne sont jamais visés.
- Un PNJ qui perd tous ses villages repart ailleurs sur la carte après 2 heures de jeu.

Le code est dans `server/src/game/npc.ts` (base de données) et `npc-rules.ts` (règles pures, testées dans `server/test/npc.test.ts`).
