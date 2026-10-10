# Joueurs PNJ

Les PNJ sont de vrais comptes joueurs (`players.is_npc`) sans mot de passe valide, pilotés par le serveur. Leur pseudo se termine par « (PNJ) » : on les reconnaît partout (carte, classement, rapports, profil). Ils utilisent exactement les mêmes fonctions que les joueurs (`enqueueBuild`, `enqueueRecruit`, `sendCommand`), donc les mêmes règles, la même protection débutant et les mêmes alertes d'attaque.

## Réglages (variables d'environnement)

| Variable | Défaut | Effet |
|---|---|---|
| `NPC_COUNT` | 40 | Nombre de PNJ. Le serveur en crée jusqu'à ce nombre au démarrage, sans jamais en supprimer. `0` désactive les PNJ. |
| `NPC_TRIBES` / `NPC_TRIBE_SIZE` | 4 / 5 | Nombre de tribus de PNJ et de membres par tribu (en plus des `NPC_COUNT` solitaires). `NPC_TRIBES=0` les désactive. |
| `NPC_DAILY` / `NPC_MAX` | 3 / 200 | Nouveaux PNJ solitaires par jour (un toutes les 8 heures réelles) et nombre maximal de PNJ en tout. `NPC_DAILY=0` coupe les arrivées. |
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

## Tribus de PNJ

Ce sont de vraies tribus (`tribes.is_npc`) : elles apparaissent au classement et sur la carte avec leur tag. Les joueurs ne peuvent pas les rejoindre (seul le chef invite, et personne ne peut inviter un PNJ). Chaque tribu compte un chef pillard, un conquérant, puis des bâtisseurs et des pillards (le type ne change que l'évolution).

- **Alliances et rivalités** : les tribus s'allient deux par deux, chaque paire est rivale des paires voisines. Les villages des tribus rivales sont des cibles permises à toute heure (les heures calmes ne protègent que les joueurs).
- **Défense mutuelle** : quand un village d'une tribu (ou d'une tribu alliée) est attaqué, ses membres se réveillent aussitôt et envoient en renfort 60 % de leurs lanciers et 30 % de leurs épéistes, seulement s'ils arrivent avant l'attaque. Un espionnage ne déclenche rien.
- **Opérations coordonnées** : seul le chef d'une tribu attaque les joueurs. Quand il lance un assaut, il ouvre une opération : les autres membres peuvent s'y joindre si leur troupe arrive dans une fenêtre d'un quart d'heure autour de la sienne (moins quand le monde va vite). Une opération par tribu toutes les 12 heures de jeu, et le plafond d'une attaque par jour sur un même joueur s'applique.
- **Conquérant** : à partir du niveau 10 (hôtel de ville et caserne), il recrute trois nobles et conquiert des barbares ou des villages de tribus rivales. Il ne conquiert jamais le village d'un joueur.
- Les heures calmes (22 h à 8 h) valent aussi pour les tribus : aucune attaque ni espionnage ne doit arriver chez un joueur pendant ces heures.

Le code est dans `npc-tribes.ts` (défense, alertes, opérations) et `npc.ts`, les règles pures dans `npc-rules.ts`, les tests dans `server/test/npc-tribes.test.ts`.

## Agressivité, conquêtes et arrivées

- **Représailles** : un PNJ (ou un membre de sa tribu ou d'une tribu alliée) attaqué par un joueur lui en veut pendant 3 jours. Il est réveillé aussitôt, riposte sans attendre le délai habituel entre deux attaques, tous types confondus (même un Bâtisseur), et peut frapper jusqu'à 4 fois par jour, 3 sur le même joueur. La riposte respecte les heures calmes de 22 h à 8 h.
- **Le type règle seulement l'évolution** (Bâtisseur : économie et défense ; Pillard : fer et armée ; Conquérant : hôtel de ville et caserne en priorité). Tous les PNJ peuvent s'en prendre aux joueurs sans provocation (dans une tribu, le chef et les conquérants lancent les attaques), avec les mêmes plafonds.
- **Conquêtes** : tous les PNJ recrutent 4 nobles à partir du niveau 10 (12 pour un Bâtisseur) et prennent des villages de barbares, de PNJ rivaux ou de joueurs, y compris le dernier village d'un joueur. Pour garder une difficulté modérée : au plus une tentative par joueur et par jour, et jamais d'arrivée pendant les heures calmes.
- **Arrivées** : un nouveau PNJ solitaire apparaît toutes les 8 heures (3 par jour), jusqu'à `NPC_MAX`.
