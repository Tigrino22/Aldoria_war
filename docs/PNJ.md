# Joueurs PNJ

Les PNJ sont de vrais comptes joueurs (`players.is_npc`) sans mot de passe valide, pilotés par le serveur. Leur pseudo est tiré d'une longue liste de prénoms dans l'esprit du Seigneur des Anneaux et de La Roue du Temps (`npc-names.ts`), sans mention « PNJ » : ils se fondent parmi les joueurs. Un nom déjà pris reçoit un surnom (« Aragorn le Sage »), et les premiers PNJ nommés « … (PNJ) » sont renommés au démarrage. Ils utilisent exactement les mêmes fonctions que les joueurs (`enqueueBuild`, `enqueueRecruit`, `sendCommand`), donc les mêmes règles, la même protection débutant et les mêmes alertes d'attaque.

## Réglages (variables d'environnement)

| Variable | Défaut | Effet |
|---|---|---|
| `NPC_COUNT` | 40 | Nombre de PNJ. Le serveur en crée jusqu'à ce nombre au démarrage, sans jamais en supprimer. `0` désactive les PNJ. |
| `NPC_TRIBES` / `NPC_TRIBE_SIZE` | 4 / 5 | Nombre de tribus de PNJ et de membres par tribu (en plus des `NPC_COUNT` solitaires). `NPC_TRIBES=0` les désactive. |
| `NPC_DAILY` / `NPC_MAX` | 3 / 200 | Nouveaux PNJ solitaires par jour (un toutes les 8 heures réelles) et nombre maximal de PNJ en tout. `NPC_DAILY=0` coupe les arrivées. |
| `NPC_TIMEZONE` | Europe/Paris | Fuseau des heures calmes. |
| `NPC_QUIET_START` / `NPC_QUIET_END` | 22 / 8 | Heures calmes : les PNJ ne visent aucun joueur (ni attaque ni espionnage), et rien ne doit arriver chez un joueur pendant ces heures. Ils continuent à construire et à recruter, et peuvent piller les barbares. |

## Comportement

- Un PNJ réfléchit toutes les 10 à 20 minutes (moins quand le monde va vite) : un second worker, toutes les 30 secondes, réveille ceux dont l'heure est venue.
- **Deux types** : défensif et offensif. Chaque village suit à la lettre le modèle « Défensif » ou « Offensif » du gestionnaire de compte (constructions et troupes), avec 30 % pour les troupes, plus la caserne du pillage dès le début et les bâtiments du noble (hôtel de ville et caserne 10) dès que l'économie de base tourne. Un seul village : le type du PNJ ; dès le deuxième, moitié offensifs, moitié défensifs. Détail dans `docs/PARAMETRES.md`, « Moteur des PNJ ».
- **Nobles et conquête** : le noble passe avant tout le reste ; dès qu'il est au village, le PNJ part conquérir un barbare ou un PNJ hostile proche.
- **Pillage intensif** : 50 lanciers (défensif) ou 50 épéistes (offensif) par pillage, autant que les troupes le permettent.
- **Attaquer** : le PNJ espionne d'abord sa cible (le joueur voit passer les éclaireurs), puis attaque avec toute son armée offensive si elle dépasse 1,3 fois la défense estimée (le minimum seulement contre un village sans troupes). Rayon de 20 cases. Les défensifs pillent surtout les barbares pour se développer et ne s'en prennent qu'occasionnellement à un joueur ; les offensifs visent plus souvent les joueurs.
- **Plafonds** : aucune limite journalière d'attaques sur les joueurs : seuls comptent le ratio de points (70 à 150 %, sauf riposte) et les heures calmes. Aucun délai fixe entre deux attaques : un PNJ calcule le butin. Il espionne la cible (4 heures de jeu au plus entre deux espionnages) et ne pille que s'il y a de quoi remplir ses sacs (au moins 200 ressources) ; face à un village qui a des troupes, il envoie toute son armée offensive s'il est sûr de gagner (un petit détachement perdrait trop de soldats) ; face à un village sans aucune troupe, il n'envoie que le nombre d'unités nécessaire pour emporter l'essentiel du stock. Après un pillage, le rapport d'espionnage est périmé : il faut espionner de nouveau. Les joueurs sous protection débutant ne sont jamais visés.
- Un PNJ qui perd tous ses villages repart ailleurs sur la carte après 2 heures de jeu.

Le code est dans `server/src/game/npc.ts` (base de données), `npc-roles.ts` (types, plans, nobles, pillage) et `npc-rules.ts` (règles pures), testés dans `server/test/npc.test.ts` et `server/test/npc-conquete.test.ts`.

## Tribus de PNJ

Ce sont de vraies tribus (`tribes.is_npc`) : elles apparaissent au classement et sur la carte avec leur tag. Les joueurs ne peuvent pas les rejoindre (seul le chef invite, et personne ne peut inviter un PNJ). Chaque tribu compte un chef offensif, puis des défensifs et des offensifs en alternance.

- **Alliances et rivalités** : les tribus s'allient deux par deux, chaque paire est rivale des paires voisines. Les villages des tribus rivales sont des cibles permises à toute heure (les heures calmes ne protègent que les joueurs).
- **Défense mutuelle** : quand un village d'une tribu (ou d'une tribu alliée) est attaqué, ses membres se réveillent aussitôt et envoient en renfort 60 % de leurs lanciers et 30 % de leurs épéistes, seulement s'ils arrivent avant l'attaque. Un espionnage ne déclenche rien.
- **Opérations coordonnées** : seul le chef d'une tribu attaque les joueurs. Quand il lance un assaut, il ouvre une opération : les autres membres peuvent s'y joindre si leur troupe arrive dans une fenêtre d'un quart d'heure autour de la sienne (moins quand le monde va vite). Une opération par tribu toutes les 12 heures de jeu.
- Les heures calmes (22 h à 8 h) valent aussi pour les tribus : aucune attaque ni espionnage ne doit arriver chez un joueur pendant ces heures.

Le code est dans `npc-tribes.ts` (défense, alertes, opérations) et `npc.ts`, les règles pures dans `npc-rules.ts`, les tests dans `server/test/npc-tribes.test.ts`.

## Agressivité, conquêtes et arrivées

- **Représailles** : un PNJ (ou un membre de sa tribu ou d'une tribu alliée) attaqué par un joueur lui en veut pendant 3 jours. Il frappe fort (au moins 70 % de son armée offensive), enchaîne jusqu'à trois attaques par réflexion sur des villages différents de l'agresseur, et repense quatre fois plus vite tant qu'il lui en veut. Toute sa tribu et ses alliées font de même. Il est réveillé aussitôt, riposte sans calcul de butin, tous types confondus (même un défensif) et peut frapper le même joueur autant de fois que nécessaire. La riposte respecte les heures calmes de 22 h à 8 h.
- **Le type règle l'évolution et l'armée** (défensif : lanciers et hallebardiers ; offensif : épéistes, cavaliers, béliers). Tous les PNJ peuvent s'en prendre aux joueurs sans provocation (dans une tribu, le chef lance les attaques).
- **Conquêtes** : tous les PNJ recrutent des nobles dès l'hôtel de ville et la caserne 10 (2 par village offensif, 1 par village défensif) et prennent des villages de barbares, de PNJ rivaux ou de joueurs, y compris le dernier village d'un joueur. Aucune limite de tentatives par jour ; jamais d'arrivée pendant les heures calmes.
- **Arrivées** : un nouveau PNJ solitaire apparaît toutes les 8 heures (3 par jour), jusqu'à `NPC_MAX`.

### Train de nobles, PNJ forts et ratio de points

- **Train de nobles** : un PNJ qui a des nobles au village (6 au plus par train, un seul suffit) lance un assaut qui nettoie la défense, puis ses nobles un par un, à une seconde d'écart, juste derrière, chacun avec 2 fantassins d'escorte. Le train est annulé si le dernier noble arriverait pendant les heures calmes.
- **Force de frappe** : plus de notion de « PNJ fort » ni de délai : seule compte la taille de l'armée disponible face au butin.
- **Ratio de points** : sans provocation, un PNJ ne s'en prend qu'à un joueur dont les points valent de 70 % à 150 % des siens. La riposte contre un joueur qui l'a attaqué (lui, sa tribu ou une alliée) ignore ce ratio.

### Tous les PNJ ont une tribu

- `NPC_TRIBE_MAX` (7 par défaut, 0 pour que les PNJ restent solitaires) : effectif maximal d'une tribu de PNJ.
- Au démarrage, tout PNJ sans tribu (les anciens solitaires comme les nouveaux arrivants) entre dans la tribu de PNJ la moins peuplée qui a de la place ; si toutes sont pleines, une nouvelle tribu est fondée avec un nom tiré d'une liste (« Ordre du Cormoran », etc.) et le premier membre en devient le chef. Alliances et rivalités sont redistribuées à chaque nouvelle tribu.
- Équilibrage : des tribus de 5 à 7 membres, des renforts mutuels, des opérations coordonnées menées par le chef, et toujours le ratio de points et les heures calmes. Une attaque contre un membre mobilise donc toute la tribu et ses alliées.
- Les tribus de PNJ ne portent aucune mention « PNJ » côté joueur (description neutre).

## PNJ stratèges : croisades, conquêtes et rapports

Les PNJ ne font plus rien « à l'aveugle » qui ne servirait qu'à remplir les rapports.

- **Croisades** (`server/src/game/npc-crusade.ts`) : dès l'annonce d'une croisade, le chef de chaque tribu de PNJ espionne la Citadelle avec 5 éclaireurs et décide si la tribu s'engage (son armée offensive doit valoir au moins 40 % de la garnison, béliers suffisants pour la muraille). Une tribu engagée garde les troupes de ses villages offensifs en réserve (ni pillage ni attaque dans les 2 heures qui précèdent l'ouverture), puis programme au point de ralliement un assaut par village offensif : vagues échelonnées de 20 secondes à partir de la première minute, train de nobles 10 minutes après l'ouverture. Si la tribu tient la bannière, ses villages défensifs envoient des renforts ; sinon elle contre-attaque (au plus une fois tous les quarts d'heure par village). L'état de la tribu est gardé dans `tribes.npc_state.crusade`.
- **Conquête réfléchie** : dès qu'un noble est au village, le PNJ choisit un village à prendre dans un rayon de 12 cases (barbare ou PNJ hostile), le plus gros au plus près, et s'y tient d'une réflexion à l'autre (`players.npc_state.conquest`) ; un village trop bien défendu pour son armée est écarté.
- **Conquête des joueurs** : voulue. En plus de la conquête réfléchie, les attaques ordinaires avec nobles (pillages de joueurs, guerres et riposte) peuvent prendre un village de joueur, y compris son dernier village.
- **Interceptions** (`server/src/game/npc-intercept.ts`) : à chaque réflexion, chaque village de PNJ peut attaquer en chemin une armée hostile repérée à 10 cases ou moins de lui (et la poursuivre hors de la zone, comme un joueur) : une attaque qui vise ses villages, ceux de sa tribu ou d'une alliée, ou une armée (attaque, renfort, retour) d'une tribu rivale ou en guerre, d'un joueur ou d'un PNJ à qui il en veut. Il envoie la moitié de ses fantassins et cavaliers, ou tous s'il le faut, seulement s'il gagne en rase campagne avec la marge de sécurité des attaques ; au plus une interception par village et par réflexion, jamais contre un joueur sous protection débutant ni pendant les heures calmes. Interrupteur `NPC_INTERCEPT`.
- **Offensives** : une offensive part seulement si sa part d'armée bat la défense espionnée, sinon toute l'armée offensive si elle suffit, sinon le PNJ renonce et retente plus tard.
- **Après un espionnage raté** : l'intimidation et la frappe à l'aveugle sont réservées aux guerres et aux ripostes. Hors de ces cas, le PNJ réespionne ou passe son tour.
- **Barbares** : un barbare n'est réespionné qu'au bout de 48 heures de jeu (au lieu de 24).
- **Rapports des PNJ** : sur un village barbare, seuls restent le dernier renseignement et les pillages qui l'ont suivi ; les rapports plus anciens sont effacés à chaque réflexion. Le tout reste limité à 72 heures.
