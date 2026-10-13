# Paramètres du jeu Aldoria War

Valeurs à vitesse x1 (le monde local tourne en x10 : production x10, durées /10). Toutes modifiables dans shared/src/config.ts.

## Production et stockage par niveau (vitesse x1, par heure)

| Niveau | Production (bois, argile, fer, blé) | Entrepôt : capacité max | Cachette anti-pillage |
|---|---|---|---|
| 0 | 5 | – | – |
| 1 | 30 | 1 000 | 100 |
| 2 | 36 | 1 230 | 123 |
| 3 | 43 | 1 513 | 151 |
| 4 | 52 | 1 861 | 186 |
| 5 | 62 | 2 289 | 229 |
| 6 | 75 | 2 815 | 282 |
| 7 | 90 | 3 463 | 346 |
| 8 | 107 | 4 259 | 426 |
| 9 | 129 | 5 239 | 524 |
| 10 | 155 | 6 444 | 644 |
| 12 | 223 | 9 749 | 975 |
| 15 | 385 | 18 141 | 1 814 |
| 18 | 666 | 33 759 | 3 376 |
| 20 | 958 | 51 074 | 5 107 |

## Bâtiments : coût (bois / argile / fer / blé) et durée, vitesse x1, hôtel de ville niveau 1

### Hôtel de ville
Accélère toutes les constructions et débloque de nouveaux bâtiments. Prérequis : aucun. Coût x1.26 et durée x1.2 par niveau.

| Niveau | Coût | Durée |
|---|---|---|
| 1 | 90 / 80 / 70 / 40 | 10 min 00 |
| 2 | 113 / 101 / 88 / 50 | 12 min 00 |
| 3 | 143 / 127 / 111 / 64 | 14 min 24 |
| 5 | 227 / 202 / 176 / 101 | 20 min 44 |
| 10 | 720 / 640 / 560 / 320 | 51 min 36 |
| 15 | 2288 / 2034 / 1779 / 1017 | 2 h 08 |
| 20 | 7266 / 6458 / 5651 / 3229 | 5 h 19 |

### Bûcheron
Produit du bois. Prérequis : aucun. Coût x1.25 et durée x1.2 par niveau.

| Niveau | Coût | Durée |
|---|---|---|
| 1 | 50 / 60 / 40 / 20 | 5 min 00 |
| 2 | 63 / 75 / 50 / 25 | 6 min 00 |
| 3 | 78 / 94 / 63 / 31 | 7 min 12 |
| 5 | 122 / 146 / 98 / 49 | 10 min 22 |
| 10 | 373 / 447 / 298 / 149 | 25 min 48 |
| 15 | 1137 / 1364 / 909 / 455 | 1 h 04 |
| 20 | 3469 / 4163 / 2776 / 1388 | 2 h 39 |

### Argilière
Produit de l'argile. Prérequis : aucun. Coût x1.25 et durée x1.2 par niveau.

| Niveau | Coût | Durée |
|---|---|---|
| 1 | 65 / 50 / 40 / 20 | 5 min 00 |
| 2 | 81 / 63 / 50 / 25 | 6 min 00 |
| 3 | 102 / 78 / 63 / 31 | 7 min 12 |
| 5 | 159 / 122 / 98 / 49 | 10 min 22 |
| 10 | 484 / 373 / 298 / 149 | 25 min 48 |
| 15 | 1478 / 1137 / 909 / 455 | 1 h 04 |
| 20 | 4510 / 3469 / 2776 / 1388 | 2 h 39 |

### Mine de fer
Produit du fer. Prérequis : aucun. Coût x1.25 et durée x1.2 par niveau.

| Niveau | Coût | Durée |
|---|---|---|
| 1 | 75 / 65 / 70 / 25 | 6 min 00 |
| 2 | 94 / 81 / 88 / 31 | 7 min 12 |
| 3 | 117 / 102 / 109 / 39 | 8 min 38 |
| 5 | 183 / 159 / 171 / 61 | 12 min 26 |
| 10 | 559 / 484 / 522 / 186 | 30 min 58 |
| 15 | 1705 / 1478 / 1592 / 568 | 1 h 17 |
| 20 | 5204 / 4510 / 4857 / 1735 | 3 h 11 |

### Ferme
Produit du blé et loge votre armée (population). Prérequis : aucun. Coût x1.26 et durée x1.2 par niveau.

| Niveau | Coût | Durée |
|---|---|---|
| 1 | 45 / 40 / 30 / 0 | 5 min 00 |
| 2 | 57 / 50 / 38 / 0 | 6 min 00 |
| 3 | 71 / 64 / 48 / 0 | 7 min 12 |
| 5 | 113 / 101 / 76 / 0 | 10 min 22 |
| 10 | 360 / 320 / 240 / 0 | 25 min 48 |
| 15 | 1144 / 1017 / 763 / 0 | 1 h 04 |
| 20 | 3633 / 3229 / 2422 / 0 | 2 h 39 |

### Entrepôt
Augmente le stockage et cache une partie des ressources aux pillards. Prérequis : aucun. Coût x1.26 et durée x1.2 par niveau.

| Niveau | Coût | Durée |
|---|---|---|
| 1 | 60 / 50 / 40 / 20 | 6 min 40 |
| 2 | 76 / 63 / 50 / 25 | 8 min 00 |
| 3 | 95 / 79 / 64 / 32 | 9 min 36 |
| 5 | 151 / 126 / 101 / 50 | 13 min 49 |
| 10 | 480 / 400 / 320 / 160 | 34 min 24 |
| 15 | 1525 / 1271 / 1017 / 508 | 1 h 25 |
| 20 | 4844 / 4037 / 3229 / 1615 | 3 h 32 |

### Marché
Ses marchands transportent vos ressources vers vos autres villages ou ceux de vos alliés. Prérequis : Hôtel de ville 3, Entrepôt 2. Coût x1.26 et durée x1.2 par niveau.

| Niveau | Coût | Durée |
|---|---|---|
| 1 | 100 / 100 / 100 / 30 | 13 min 20 |
| 2 | 126 / 126 / 126 / 38 | 16 min 00 |
| 3 | 159 / 159 / 159 / 48 | 19 min 12 |
| 5 | 252 / 252 / 252 / 76 | 27 min 39 |
| 10 | 800 / 800 / 800 / 240 | 1 h 08 |
| 15 | 2542 / 2542 / 2542 / 763 | 2 h 51 |
| 20 | 8073 / 8073 / 8073 / 2422 | 7 h 05 |

### Caserne
Recrute les unités. Plus elle est haute, plus le recrutement est rapide. Prérequis : Hôtel de ville 3. Coût x1.26 et durée x1.2 par niveau.

| Niveau | Coût | Durée |
|---|---|---|
| 1 | 200 / 170 / 90 / 60 | 15 min 00 |
| 2 | 252 / 214 / 113 / 76 | 18 min 00 |
| 3 | 318 / 270 / 143 / 95 | 21 min 36 |
| 5 | 504 / 428 / 227 / 151 | 31 min 06 |
| 10 | 1601 / 1361 / 720 / 480 | 1 h 17 |
| 15 | 5084 / 4322 / 2288 / 1525 | 3 h 12 |
| 20 | 16146 / 13724 / 7266 / 4844 | 7 h 59 |

### Muraille
Renforce la défense de toutes les troupes présentes dans le village. Prérequis : Caserne 1. Coût x1.26 et durée x1.2 par niveau.

| Niveau | Coût | Durée |
|---|---|---|
| 1 | 50 / 100 / 20 / 30 | 16 min 40 |
| 2 | 63 / 126 / 25 / 38 | 20 min 00 |
| 3 | 79 / 159 / 32 / 48 | 24 min 00 |
| 5 | 126 / 252 / 50 / 76 | 34 min 34 |
| 10 | 400 / 800 / 160 / 240 | 1 h 26 |
| 15 | 1271 / 2542 / 508 / 763 | 3 h 33 |
| 20 | 4037 / 8073 / 1615 / 2422 | 8 h 52 |

Chaque niveau d'hôtel de ville réduit toutes les durées de 5 % (niveau 20 : durées x0,38).

## Unités (vitesse x1)

| Unité | Coût (bois / argile / fer / blé) | Population | Recrutement caserne 1 | caserne 10 | caserne 20 | Attaque | Déf. inf. | Déf. cav. | Vitesse (min/case) | Butin |
|---|---|---|---|---|---|---|---|---|---|---|
| Lancier | 50 / 30 / 10 / 20 | 1 | 3 min 00 | 1 min 43 | 56 s | 10 | 15 | 45 | 18 | 25 |
| Hallebardier (caserne 4) | 40 / 30 / 50 / 20 | 1 | 4 min 00 | 2 min 17 | 1 min 14 | 15 | 45 | 25 | 20 | 10 |
| Épéiste | 30 / 30 / 70 / 20 | 1 | 4 min 20 | 2 min 29 | 1 min 20 | 40 | 20 | 10 | 22 | 15 |
| Éclaireur | 50 / 50 / 20 / 10 | 2 | 5 min 00 | 2 min 52 | 1 min 33 | 0 | 2 | 1 | 9 | 0 |
| Cavalier | 125 / 100 / 250 / 40 | 4 | 10 min 00 | 5 min 44 | 3 min 05 | 120 | 30 | 40 | 10 | 80 |
| Bélier | 300 / 200 / 200 / 40 | 5 | 15 min 00 | 8 min 36 | 4 min 38 | 2 | 20 | 50 | 30 | 0 |
| Noble | 4000 / 5000 / 5000 / 2000 | 100 | 1 h 00 | 34 min 23 | 18 min 31 | 30 | 100 | 50 | 35 | 0 |

Chaque niveau de caserne réduit le temps de recrutement de 6 %.

**Population** : chaque unité occupe des places de population (colonne ci-dessus), recrues et troupes parties au combat comprises. La ferme en offre 240 au niveau 1, +26,2 % par niveau (environ 20 000 au niveau 20). Le blé ne nourrit pas l'armée au village, mais chaque attaque emporte ses rations : 1 blé par place de population envoyée (`ATTACK_WHEAT_PER_POPULATION`, `attackWheatCost`), payé au départ (à la commande pour un ordre planifié) et rendu si l'attaque ou l'ordre est annulé. Exemples : 100 lanciers = 100 blé, 1 000 épéistes = 1 000 blé, un noble = 100 blé. Les renforts et les marchands ne coûtent rien, les PNJ ne paient pas.

**Béliers** : abaissement progressif de la muraille, le niveau N demande N béliers en partant du niveau le plus haut. Abattre une muraille de niveau N demande N × (N + 1) / 2 béliers (niveau 10 : 55, niveau 20 : 210). La règle vaut pendant le combat et, avec les survivants, après une victoire.

## Marché

| Niveau | 1 | 5 | 10 | 15 | 20 |
|---|---|---|---|---|---|
| Marchands | 1 | 8 | 20 | 38 | 60 |

Chaque marchand porte 1 000 ressources, à 6 min par case.


## Offres de marché (joueurs et PNJ)

Valeurs dans `server/src/game/market-rules.ts`, à ajuster librement.

| Paramètre | Valeur |
|---|---|
| Durée de vie d'une offre | 24 h de jeu (divisée par la vitesse du monde) |
| Taux demandé / donné accepté | entre 0,5 et 2 |
| Minimum par côté | 50 ressources |
| Offres ouvertes par joueur | 5 (aucune limite pour un PNJ) |
| PNJ : excédent / manque | plus de 70 % / moins de 25 % de l'entrepôt |
| PNJ : montant offert | 30 % du stock en excédent (au plus ce que portent ses marchands libres), taux 0,9 (bâtisseur) ou 1 |
| PNJ : rayon pour accepter | aucun (tout le monde) |
| PNJ : échanges par réflexion | jusqu'à 10 par village, tant qu'il reste des marchands libres |

Les ressources offertes sont retirées du village à la publication et rendues à l'annulation ou à l'expiration. À l'acceptation, deux convois de marchands partent, un dans chaque sens ; chaque côté doit avoir assez de marchands libres.

## Administration

Page `#/admin` (menu « Aide » > « Administration »), en lecture seule : activité des PNJ (attaques, espionnages, offres, avec un repère 🌙 pour les heures calmes), onglet « Guerres » (voir plus bas), joueurs et PNJ, totaux et paramètres du monde.

Elle n'est visible que pour les pseudos listés dans la variable d'environnement `ADMIN_USERNAMES` (séparés par des virgules, sans tenir compte des majuscules). Le serveur revérifie l'identité à chaque requête (`/api/admin/*` répond 403 aux autres).

### Réglages modifiables depuis l'administration

Onglet « Monde » : interrupteurs de la riposte des PNJ et des guerres entre tribus de PNJ, difficulté des PNJ, nouveaux PNJ par jour, maximum de PNJ, taille maximale des tribus de PNJ, heures calmes et fuseau. Les valeurs sont enregistrées en base (`world_settings`), s'appliquent tout de suite et remplacent les variables d'environnement au redémarrage ; « Rétablir » revient à la valeur d'origine. La vitesse du monde et la taille de la carte restent des variables Render (les changer en cours de partie fausserait les constructions, les trajets et les coordonnées).

## Guerres entre PNJ

| Règle | Valeur |
|---|---|
| Riposte contre les joueurs | Un PNJ attaqué par un joueur lui en veut 3 jours (interrupteur « Riposte des PNJ ») |
| Riposte entre PNJ | Un PNJ attaqué par un PNJ d'une autre tribu lui en veut 3 jours ; toujours active, l'interrupteur de riposte ne la coupe pas |
| Guerre de tribus | Une tribu déclare la guerre à une autre, rivale de préférence, jamais à une alliée ; la guerre est réciproque et dure 4 jours réels |
| Trêve | Au moins 2 jours réels (plus un délai aléatoire) avant qu'une tribu ne redéclare la guerre |
| Cibles en guerre | Villages de la tribu ennemie jusqu'à 40 cases (20 pour un pillage ordinaire), choisis en priorité (9 fois sur 10) avant joueurs et barbares |
| Style de frappe | Au moins 70 % de l'armée offensive, sans seuil de butin ; le train de nobles part comme d'habitude, d'où les conquêtes entre PNJ |
| Interrupteur | « Guerres entre tribus de PNJ » (variable `NPC_WARS`, 1 par défaut) : coupé, plus de nouvelle guerre ni de frappe de guerre |

Code : `server/src/game/npc-wars.ts` (règles pures `planWars`, déclaration en base, rancunes entre PNJ), consommé par `attackStep` dans `npc.ts`.

### Guerres entre PNJ et tribus de joueurs

Table `tribe_wars` (migration 013), code dans `server/src/game/tribe-wars.ts`, page « Tribu » > onglet « Guerres » (`client/src/components/TribeWars.tsx`). Elles sont indépendantes de la riposte (interrupteur « Riposte des PNJ ») : une guerre n'a pas besoin d'une attaque préalable du joueur.

| Règle | Valeur |
|---|---|
| Déclaration par un PNJ | Une tribu de PNJ déclare la guerre à une tribu de joueurs libre (aucune guerre en cours contre un PNJ, au moins un village hors protection des débutants), sans provocation ; une tribu de joueurs n'a qu'un agresseur PNJ à la fois |
| Déclaration par provocation | Si la riposte, les guerres entre PNJ et les guerres contre les joueurs sont activées, un joueur membre d'une tribu qui attaque un PNJ d'une tribu de PNJ (3 derniers jours) fait déclarer la guerre à sa tribu par cette tribu, 4 jours, avec message aux membres ; pas de doublon tant qu'une guerre est en cours entre elles, ni après une fin à la main. Sans tribu, seule la riposte individuelle joue |
| Rythme | Une tribu de PNJ neuve attend 0 à 24 h, puis une guerre dure 4 jours, suivie d'au moins 3 jours de trêve avant la suivante contre des joueurs ; sans cible libre elle réessaie 1 h plus tard |
| Déclaration par un chef | Seul le chef de tribu, vers une tribu de joueurs ou de PNJ ayant au moins un village ; 4 jours ; 3 guerres déclarées à la fois au plus ; une seule guerre à la fois entre deux mêmes tribus ; le chef y met fin quand il veut |
| Effet | Contre ou depuis une tribu de PNJ, tous les membres PNJ frappent les villages ennemis (jusqu'à 40 cases, 70 % de l'armée offensive, sans condition de taille), jamais pendant les heures calmes ni sur un joueur sous protection ; entre deux tribus de joueurs, c'est un état déclaré sans effet mécanique |
| Messages | Les membres de la tribu visée reçoivent un message à la déclaration, à la fin anticipée et à l'expiration |
| Interrupteurs | « Guerres contre les tribus de joueurs » (variable `NPC_PLAYER_WARS`, 1 par défaut) : coupé, aucune nouvelle guerre contre des joueurs, les guerres en cours cessent d'avoir un effet et on ne peut plus déclarer la guerre à un PNJ. Nécessite aussi « Guerres entre tribus de PNJ » |

Statistiques de guerre de tribu (migration 015) : `tribe_wars` garde, pour la tribu qui déclare et pour la tribu visée, les batailles gagnées en attaque et en défense, les villages conquis et les adversaires battus (valeur en blé). `recordBattle` (`war-stats.ts`) les incrémente à chaque bataille entre deux joueurs dont les tribus ont une guerre en cours (PNJ compris). Rien n'est reconstitué avant la migration. La vue `tribeWarsView` ajoute le bilan de chaque guerre (`stats.mine` / `stats.theirs`) et les cinq meilleurs guerriers de la tribu (score du classement de guerre) ; le panneau « Statistiques de guerre » de l'onglet Guerres les affiche.

### Suivi des guerres (Administration > Guerres)

La même vue est publique sous « Guerres du monde » (`#/guerres`, `WorldWars.tsx`, `GET /api/world/wars?hours=1..72`, réservé aux joueurs connectés) : `warOverview` est renvoyé tel quel sauf `inFlight`, vidé (cibles et heures d'arrivée des attaques en route restent réservées à l'administration). Limitée à 30 requêtes par minute, actualisation toutes les 15 s.

Onglet en lecture seule, actualisé toutes les 5 s, avec une période au choix (1, 6, 24 ou 72 h). Code : `server/src/game/npc-war-report.ts` (route `GET /api/admin/wars`), `client/src/components/AdminWars.tsx`.

| Bloc | Contenu |
|---|---|
| Fronts | Une ligne par paire de tribus en guerre ou ayant combattu sur la période : temps restant, villages de chaque camp, victoires, conquêtes, unités perdues, attaques en route |
| Attaques en route | Les attaques entre tribus de PNJ qui n'ont pas encore atterri, avec compte à rebours, troupes et nobles |
| Rythme des batailles | Batailles par heure (barre dorée si conquête) |
| Journal | Batailles (attaquant, cible, résultat, pertes, « riposte » hors guerre déclarée, « conquête ») et déclarations / fins de guerre |
| Tribus en trêve | Date de la prochaine guerre possible |

Les batailles viennent des rapports de défense des PNJ (ils contiennent les pertes des deux camps) : un combat entre deux PNJ de tribus différentes ; pour une guerre contre une tribu de joueurs, du rapport de l'attaquant PNJ (les pertes du défenseur y manquent quand l'attaque est anéantie). Les guerres de joueurs apparaissent aussi dans les fronts, avec la mention « joueurs ». Les déclarations et fins de guerre sont écrites dans la table `npc_war_log` (migration 012) par `refreshWars`. Les rapports des PNJ sont conservés 3 jours : c'est la limite de l'historique.

### Pillage intensif des PNJ

Avant, un PNJ lançait au plus une attaque par réflexion (toutes les 10 à 20 minutes), avec toute son armée, vers une seule cible dans 20 cases, et seulement si le butin dépassait 200 : le pillage restait marginal. Désormais (`server/src/game/npc-raids.ts`), après ses constructions et son recrutement, chaque village de PNJ (pas seulement les trois premiers) envoie jusqu'à 6 petits pillages par réflexion, comme un joueur avec l'assistant de pillage.

| Règle | Valeur |
|---|---|
| Cibles | Barbares et villages des PNJ rivaux, en guerre ou rancuniers, dans 25 cases ; jamais un joueur (les attaques habituelles s'en chargent) |
| Renseignement | Barbare inconnu ou rapport de plus de 24 h de jeu : 1 éclaireur (2 par réflexion au plus, sur la moitié des éclaireurs du village). Village de PNJ : seulement s'il a été vu vide il y a moins de 6 h de jeu |
| Butin | Estimé comme l'assistant des joueurs (`estimateLoot`) ; pas de pillage sous 100 |
| Troupes | Le plus petit groupe qui porte le butin (cavaliers, lanciers, épéistes, hallebardiers : toutes les unités qui portent du butin, dans tout village offensif ou défensif) et bat la défense de base (sans marge, comme toutes les attaques de PNJ) |
| Cible en cours | Un village déjà visé par une attaque en route est sauté |
| Rythme | Réflexion toutes les 5 à 15 minutes (`NPC_THINK_MINUTES`, 10 par défaut ; avant : 10 à 20) |

Réglages à chaud (Administration > Monde) : « Pillage intensif des PNJ » (`NPC_RAIDS`), « Pillages par village et par réflexion » (`NPC_RAIDS_PER_THINK`), « Rayon du pillage intensif » (`NPC_RAID_RADIUS`), « Rythme de réflexion des PNJ » (`NPC_THINK_MINUTES`).

## Recrutement des PNJ : villages offensifs et défensifs

Rythme : le niveau visé par les PNJ gagne 1 par jour de monde (`NPC_LEVELS_PER_DAY`, 20 au bout de 18 jours à difficulté ×1). La ferme, qui loge l'armée, monte `FARM_LEAD` = 3 niveaux plus haut que le reste et pèse davantage (poids 1,6 à 1,7). L'armée visée de chaque village remplit toute la ferme visée (niveau de ferme = plafond + 3, 20 au plus, soit jusqu'à 19 968 habitants), éclaireurs et nobles compris (`armyTarget` dans `npc-roles.ts`) ; les proportions ci-dessous se répartissent le reste. Une difficulté inférieure à 1 ne remplit qu'une part de la ferme. Un lot de recrutement peut aller jusqu'à 40 unités, réduit de moitié tant qu'il est trop cher ou trop lourd pour la ferme.

Chaque village d'un PNJ a un rôle (code : `server/src/game/npc-roles.ts`), qui fixe les seules unités qu'on y recrute.

| Rôle | Unités recrutées (par niveau visé) |
|---|---|
| Offensif | (proportions) épéistes ×7, cavaliers ×2, jusqu'à 60 éclaireurs (min(60, (6 + niveau × 2,5) × max(1, difficulté)), voir « Espionnage »), garde de lanciers ×1 ; béliers ×1 (conquérant) ; 4 nobles dès le niveau 10 (pillard et conquérant) |
| Défensif | (proportions) lanciers ×5, hallebardiers ×5, épéistes ×1 (petite troupe de pillage et de riposte), un tiers des éclaireurs d'un village offensif (5 au moins, `defenseScouts`) |

Espionnage des PNJ : avant de piller, un PNJ envoie d'emblée 50 éclaireurs. Si tous sont tués (la défense en avait autant ou plus), il réagit selon un tirage (`afterScoutFailure`) : 35 % il attend, 25 % il réespionne avec la vague suivante, 100 puis 200 (dans la limite de ceux du village), 25 % il envoie une petite troupe d'intimidation (un dixième de ses épéistes et cavaliers, entre 10 et 40, `harassUnits`), 15 % il frappe à l'aveugle avec une vraie attaque (la part d'offensive) ; un joueur déjà frappé par un PNJ pendant la période ne reçoit que l'intimidation. Une seule réaction par délai d'espionnage ; l'échec est retenu pour tout le joueur, pas seulement pour le village visé. S'il a déjà vu des éclaireurs chez la cible (espionnage ou attaque), il en envoie au moins le double plus 5. En guerre (guerre de tribu, riposte, offensive), la vague est doublée et engage au moins les trois quarts des éclaireurs du village (`WAR_SCOUT_SHARE`). Jamais de mission à moins de 5 éclaireurs (`MIN_SCOUT_WAVE`) : le village attend d'en avoir assez. Délai entre deux espionnages d'un même PNJ chez un joueur ou un PNJ : 4 heures de jeu, 1 heure en guerre ; les éclaireurs envoyés aux barbares ne comptent pas. Le pillage intensif n'utilise que la moitié des éclaireurs d'un village. Après trois échecs de suite sur la même cible, il la laisse tranquille 12 heures de jeu après le dernier échec (`SCOUT_PAUSE_GAME_HOURS`), puis reprend directement avec 200 éclaireurs tant que le dernier échec date de moins de 36 heures de jeu (`SCOUT_MEMORY_GAME_HOURS`) ; au-delà, retour à 50. Un espionnage réussi efface les échecs. Constantes : `SCOUT_WAVES`, `scoutWave`, `scoutPaused`, `SCOUT_MAX_FAILURES` dans `npc-rules.ts`, `offenseScouts` et `defenseScouts` dans `npc-roles.ts`.

Un village dont le rôle va à l'encontre du tempérament du PNJ (un bâtisseur qui attaque, un pillard qui défend) recrute ses unités principales à 60 %.

| Profil | Part de villages offensifs | Avec un seul village |
|---|---|---|
| Bâtisseur | 30 % | défensif |
| Pillard | 70 % | offensif |
| Conquérant | 60 % | offensif |

Dès qu'un PNJ a plusieurs villages, il y a toujours au moins un village de chaque rôle ; les offensifs sont répartis régulièrement (ex. 2 villages : le premier défensif, le second offensif). Dans une tribu, les profils sont déjà mélangés (chef pillard, un conquérant, des bâtisseurs et des pillards), donc certains membres sont offensifs et d'autres défensifs. Les renforts qu'un PNJ envoie à sa tribu menacée comptent aussi les hallebardiers.

### Marge de sécurité des attaques des PNJ

Un PNJ attaque dès que son armée bat l'armée qu'il a espionnée (force d'attaque strictement supérieure à la défense estimée, muraille comprise). Avant, il exigeait 30 % de plus. Réglage à chaud « Marge de sécurité des attaques des PNJ (%) » (`NPC_ATTACK_MARGIN`, 0 par défaut) dans Administration > Monde. Elle s'applique aux pillages, aux guerres, aux ripostes et aux opérations de tribu. Les offensives occasionnelles n'en tiennent pas compte : elles partent toujours avec leur part d'armée (« Part de l'armée engagée dans une offensive »), même si elle ne bat pas la défense espionnée, car leur but est de déstabiliser les joueurs.

### Recrutement accéléré des PNJ

Avant : un village de PNJ ne recrutait que lorsque sa file était vide, un seul lot d'au plus 40 unités par réflexion, après avoir dépensé ses ressources en construction. À x10, la caserne restait donc inactive entre deux réflexions et l'armée montait lentement.

Désormais (`recruitStep` dans `npc.ts`) : la file se remplit dès qu'il lui reste moins de deux réflexions de travail ; jusqu'à 3 lots de types d'unités différents par réflexion (`NPC_RECRUIT_BATCHES`), chacun d'au plus 150 unités (`NPC_RECRUIT_BATCH`, réduit de moitié tant que c'est trop cher ou trop lourd pour la ferme) ; les unités déjà en file comptent dans les effectifs, donc pas de doublon ; le recrutement passe avant la construction pour l'usage des ressources (`NPC_ARMY_FIRST`, 1 par défaut ; 0 remet la construction en premier). Les trois réglages sont modifiables à chaud dans Administration > Monde. Contrepartie : plus de ressources vont à l'armée, donc les bâtiments montent un peu moins vite.

## Point de ralliement : ordres planifiés et train de nobles

Page « Point de ralliement » du menu, distincte de « Troupes » (`#/ralliement`, ou `#/ralliement/x,y` depuis la carte). Code : `server/src/game/orders.ts` (base de données), `shared/src/orders.ts` (découpe des ordres, aussi utilisée par le client pour afficher le plan avant l'envoi), `client/src/components/RallyOrders.tsx`.

| Règle | Valeur |
|---|---|
| Ordre | Attaque ou soutien vers un village (coordonnées), depuis le village actif ; tout de suite ou à une heure d'arrivée précise |
| Heure d'arrivée précise | Les troupes sont retirées du village à la planification (réservées, comptées dans la population) et partent à `arrivée - trajet` ; 14 jours au plus à l'avance ; annulables avant le départ (les troupes reviennent) |
| Cible devenue inattaquable | Au départ, si la cible est sous protection ou devenue la nôtre, l'ordre est annulé et les troupes rentrent |
| Départ en retard (serveur arrêté) | Plus de 5 s après l'heure prévue : l'heure d'arrivée précise est abandonnée, les troupes partent aussitôt |
| Village d'origine conquis | Les ordres planifiés depuis ce village disparaissent avec lui |
| Loyauté | Une attaque victorieuse avec au moins un noble survivant fait baisser la loyauté de 20 à 35, **une seule fois**, quel que soit le nombre de nobles |
| Vitesses différentes | Chaque mouvement part à `arrivée - son propre trajet` (selon son unité la plus lente) : cavaliers plus tard, nobles plus tôt, pour que tous arrivent à l'heure voulue |
| Train de nobles | L'assaut, puis un mouvement par noble (avec l'escorte choisie par le joueur, 2 épéistes par défaut ; nombre de nobles plafonné par les nobles et escortes disponibles : 3 attaques au lieu de 4 si l'escorte manque), chacun arrivant 1 s (1 à 10 s) après le précédent. Un noble seul ne survit pas à la défense de base d'un village |
| PNJ | Leur train de nobles suit la même règle : 2 épéistes d'escorte par noble |

## Remplir les entrepôts des PNJ (administration)

Administration > PNJ : un curseur (0 à 100 %, par 5) et un bouton « Remplir » montent chaque ressource de tous les villages de PNJ jusqu'à cette part de la capacité de leur entrepôt (`POST /api/admin/npc/fill`, `server/src/game/npc-fill.ts`). Les villages sont mis à jour à l'instant présent avant le remplissage, et une ressource déjà au-dessus du seuil n'est jamais réduite.

## Classement de guerre et statistiques du monde

Migration 014 : compteurs `conquests`, `villages_lost`, `attack_wins`, `defense_wins` sur `players` et journal public `conquest_log` (qui a pris quel village à qui). Enregistrés à chaque bataille contre un village possédé (`server/src/game/war-stats.ts`, appelé par `handleAttack`) ; un village barbare ne compte pas. Les compteurs démarrent à zéro, sans reconstitution des batailles passées.

| Élément | Règle |
|---|---|
| Score de guerre | 250 par village conquis + 5 par bataille gagnée (attaque ou défense) + 1 par 50 d'adversaires battus (`WAR_POINTS`) |
| Classement | Onglet « Guerre » de la page Classement (`GET /api/ranking/war/players`, `/tribes`, `/feed`) : podium, tableau, dernières conquêtes, guerres de tribus en cours. Seuls les scores > 0 figurent au tableau |
| Statistiques du monde | Page `#/monde` (`GET /api/world/stats`, `server/src/game/world-stats.ts`, partagée avec l'onglet Statistiques de l'administration) : totaux et moyennes uniquement, aucun nom de joueur ni village précis |

