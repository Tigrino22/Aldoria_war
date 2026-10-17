# Paramètres du jeu Aldoria War

Valeurs à vitesse x1 (le monde local tourne en x10 : production x10, durées /10). Toutes modifiables dans shared/src/config.ts.

## Production et stockage par niveau (vitesse x1, par heure)

| Niveau | Production des mines (bois, argile, fer) | Entrepôt : capacité max | Cachette anti-pillage |
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
| 20 | 958 | 51 074 | 5 000 |
| 21 | 1 074 (mines) | 64 161 | 5 000 |
| 22 | 1 204 (mines) | 80 603 | 5 000 |
| 23 | 1 350 (mines) | 101 258 | 5 000 |
| 24 | 1 513 (mines) | 127 206 | 5 000 |
| 25 | 1 696 (mines) | 159 802 | 5 000 |
| 26 | 1 901 (mines) | 200 752 | 5 000 |
| 27 | 2 130 (mines) | 252 196 | 5 000 |
| 28 | 2 388 (mines) | 316 822 | 5 000 |
| 29 | 2 676 (mines) | 398 009 | 5 000 |
| 30 | 3 000 (mines) | 500 000 | 5 000 |

La ferme a sa propre courbe de blé : 30 au niveau 1, environ +25 % par niveau, 2 000 par heure au niveau 20 (`FARM_WHEAT_MAX`) ; le tableau ci-dessus donne la production des mines. Le bûcheron, l'argilière et la mine de fer montent jusqu'au niveau 30 : +20 % par niveau jusqu'au 20, puis +12 % environ jusqu'à 3 000 par heure au niveau 30. L'entrepôt monte aussi au niveau 30 (500 000) ; la cachette vaut 10 % de sa capacité, 5 000 au plus. La ferme et les autres bâtiments s'arrêtent au niveau 20, la caserne au niveau 25.

## Points des villages

Un point pour 200 ressources (bois + argile + fer + blé) dépensées dans les bâtiments du village (`RESOURCES_PER_POINT`). Village de départ : 6 points ; tout au niveau 13 : 793 ; tout au niveau 20 : 4 113 ; village maximal (mines et entrepôt 30, caserne 25) : 17 051. Les points sont recalculés au démarrage du serveur.

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
| 25 | 10588 / 12705 / 8470 / 4235 | 6 h 37 |
| 30 | 32312 / 38774 / 25849 / 12925 | 16 h 29 |

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
| 25 | 13764 / 10588 / 8470 / 4235 | 6 h 37 |
| 30 | 42005 / 32312 / 25849 / 12925 | 16 h 29 |

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
| 25 | 15882 / 13764 / 14823 / 5294 | 7 h 56 |
| 30 | 48468 / 42005 / 45236 / 16156 | 19 h 46 |

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
| 1 | 195 / 170 / 90 / 60 | 15 min 00 |
| 2 | 246 / 214 / 113 / 76 | 18 min 00 |
| 3 | 310 / 270 / 143 / 95 | 21 min 36 |
| 5 | 491 / 428 / 227 / 151 | 31 min 06 |
| 10 | 1561 / 1361 / 720 / 480 | 1 h 17 |
| 15 | 4957 / 4322 / 2288 / 1525 | 3 h 12 |
| 20 | 15743 / 13724 / 7266 / 4844 | 7 h 59 |
| 25 | 49995 / 43585 / 23075 / 15383 | 19 h 52 |

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
| Noble | 10000 / 12000 / 12000 / 3000 | 100 | 1 h 00 | 34 min 23 | 18 min 31 | 30 | 100 | 50 | 35 | 0 |

Chaque niveau de caserne réduit le temps de recrutement de 6 %.

**Population** : chaque unité occupe des places de population (colonne ci-dessus), recrues et troupes parties au combat comprises. La ferme en offre 240 au niveau 1, +26,2 % par niveau (environ 20 000 au niveau 20). Le blé ne nourrit pas l'armée au village, mais chaque attaque emporte ses rations : 1 blé par place de population envoyée (`ATTACK_WHEAT_PER_POPULATION`, `attackWheatCost`), payé au départ (à la commande pour un ordre planifié) et rendu si l'attaque ou l'ordre est annulé. Exemples : 100 lanciers = 100 blé, 1 000 épéistes = 1 000 blé, un noble = 100 blé. Les renforts et les marchands ne coûtent rien, les PNJ ne paient pas.

**Béliers** : abaissement progressif de la muraille, le niveau N demande N béliers en partant du niveau le plus haut. Abattre une muraille de niveau N demande N × (N + 1) / 2 béliers (niveau 10 : 55, niveau 20 : 210). La règle vaut pendant le combat et, avec les survivants, après une victoire.

## Marché

| Niveau | 1 | 5 | 10 | 15 | 20 |
|---|---|---|---|---|---|
| Marchands | 1 | 8 | 20 | 38 | 60 |

Chaque marchand porte 1 000 ressources, à 6 min par case.


## Équilibrage automatique des ressources (gestionnaire de compte)

Page « Gestionnaire de compte », panneau « Équilibrage des ressources ». Règles pures dans `server/src/manager/balance.ts` (`planBalance`), exécution dans `runBalance` (`server/src/manager/engine.ts`), juste après la passe des constructions de chaque minute. Coupé avec le reste du gestionnaire par l'interrupteur « Gestionnaire de compte » de l'administration.

| Règle | Valeur |
|---|---|
| Seuils (par joueur) | Un village reçoit sous `low` % de son entrepôt (30 par défaut) et donne au-dessus de `high` % (70 par défaut), ressource par ressource ; 10 points d'écart au moins |
| Prochain bâtiment | Un village piloté garde le coût de son prochain bâtiment (il ne le donne jamais) et le réclame s'il lui manque, même au-dessus du seuil bas ; un coût plus grand que l'entrepôt ne compte pas |
| Ordre | Les villages les plus en manque d'abord, servis par les donneurs les plus proches ; un convoi par paire de villages, plusieurs ressources à la fois |
| Marchands | Ceux du donneur, libres à ce moment ; le chargement est réduit à ce qu'ils portent |
| En route | Les convois déjà en route vers un village comptent dans son stock : pas de doublon d'une minute à l'autre |
| Petits envois | Pas de convoi sous 200 ressources (`MIN_SHIPMENT`) |
| Participation | Tous les villages du joueur, sauf ceux qu'il tient à l'écart (case « Participe à l'équilibrage ») |
| Rapports | Aucun rapport de livraison (colonne `commands.automatic`) ; une ligne dans le journal du gestionnaire du donneur et du receveur |

Tables : `manager_balance` et `manager_villages.balance` (migration 030). Routes : `PUT /api/manager/balance`, champ `balance` de `PUT /api/manager/villages/:id`.

## Lettres de noblesse

Chaque noble coûte 10 000 bois, 12 000 argile, 12 000 fer et 3 000 blé (`shared/src/config.ts`) et demande des lettres de noblesse frappées. Règle dans `shared/src/nobility.ts` (`lettersRequired`, `freeLetters`, `letterPriceAt`), serveur dans `server/src/game/nobility.ts`. Carte « Lettres de noblesse » de l'hôtel de ville : versement à la cagnotte (`POST /api/villages/:id/treasury`) et frappe (`POST /api/villages/:id/letters`).

| Règle | Valeur |
|---|---|
| Lettres nécessaires | Chaque noble a sa lettre : le 1er noble demande la lettre n° 1, le 2e la n° 2, etc. Un noble qui prend un village garde sa lettre (il s'y installe). Dans le code : lettres frappées ≥ villages + nobles pour un noble de plus, les nobles comptés étant ceux en vie, en route, en renfort, planifiés ou en formation (`lettersRequired`) |
| Les lettres ne s'usent pas | `players.letters_minted` ne fait que monter. Une conquête ne change rien (le noble s'installe, un village s'ajoute) ; un noble mort ou un recrutement annulé libère sa place |
| Prix d'une lettre | La lettre n° k coûte le prix de base × (1 + `letterIncrease` % × (k − 1)) : à 100 %, 1, 2, 3, 4… fois le prix de base |
| Cagnotte | Commune à tout le compte (`players.treasury_wood`, `treasury_clay`, `treasury_iron`), sans plafond. Tout village du joueur peut y verser du bois, de l'argile et du fer, au plus son stock ; un versement ne revient pas au village |
| Frappe | À l'hôtel de ville niveau 10 (`LETTER_TOWNHALL`), instantanée, 20 lettres au plus d'un coup (`LETTER_BATCH_MAX`), payée par la cagnotte |
| PNJ | Même règle : avant de recruter des nobles, un PNJ verse à la cagnotte ce qui manque depuis le village puis frappe (`ensureLetters`). S'il ne peut pas tout payer d'un coup, il verse la moitié de son stock utile et recrute moins de nobles |
| Gestionnaire de compte | Ne verse pas et ne frappe pas : sans lettre libre, le noble prévu attend (« Recrutement impossible » au journal) |

Coût d'un noble qui demande une nouvelle lettre (réglages par défaut) : 53 000 ressources avec la 1re lettre, 69 000 avec la 2e, 117 000 avec la 5e, 197 000 avec la 10e, 357 000 avec la 20e (un joueur à 15 villages et 5 nobles en est là). Un noble mort se remplace au seul prix du noble (37 000). Pour comparer, un village aux mines de niveau 20 produit environ 69 000 ressources par jour à vitesse ×1, 122 000 au niveau 25.

Réglages de l'administration (onglet Monde) :

| Réglage | Défaut | Effet |
|---|---|---|
| Lettres de noblesse (`nobleLetters`) | activées | Désactivées : les nobles ne coûtent que leurs ressources, les lettres et la cagnotte sont gardées |
| Prix de base d'une lettre (`letterWood`, `letterClay`, `letterIron`) | 5 000 / 6 000 / 5 000 | Prix de la 1re lettre du joueur, payé par la cagnotte (pas de blé) |
| Hausse à chaque lettre (`letterIncrease`) | 100 % | Part du prix de base ajoutée à chaque lettre : 100 = 1, 2, 3… fois ; 50 = 1, 1,5, 2… fois ; 0 = prix fixe |

Migrations 034, 035, 036 (`letters_minted`, qui reprend les lettres déjà en stock) et 037 (les nobles déjà recrutés et les villages conquis comptent comme des lettres frappées).

## Succès et badges

Page `#/succes` (menu Mon compte > Mon profil, onglet Succès). Définitions dans `shared/src/achievements.ts` (`ACHIEVEMENTS`), attribution dans `server/src/game/achievements.ts` : toutes les 5 minutes pour tous les joueurs (hors PNJ), et tout de suite quand le joueur ouvre la page ou récupère une quête.

| Succès | Compteur | Bronze | Argent | Or |
|---|---|---|---|---|
| Bâtisseur | Points (tous villages) | 1 000 | 15 000 | 60 000 |
| Seigneur de domaines | Villages possédés | 2 | 5 | 12 |
| Conquérant | Villages pris à des joueurs | 1 | 10 | 40 |
| Pillard | Ressources rapportées des attaques (`players.loot_total`, compté depuis la migration 033) | 10 000 | 250 000 | 2 000 000 |
| Chef de guerre | Attaques gagnées contre des joueurs | 10 | 100 | 500 |
| Gardien | Attaques repoussées | 10 | 100 | 500 |
| Fléau des armées | Adversaires battus en attaque (population tuée) | 500 | 5 000 | 50 000 |
| Rempart | Adversaires battus en défense | 500 | 5 000 | 50 000 |
| Croisé | Titres de croisade | 1 | 3 | 8 |
| Premiers pas | Quêtes de départ récupérées | 3 | 6 | 10 |

Réglages de l'administration (onglet Monde) :

| Réglage | Défaut | Effet |
|---|---|---|
| Succès (`achievements`) | activés | Désactivés : plus aucun nouveau palier, les badges restent |
| Difficulté des succès (`achievementScale`) | 100 % | Multiplie tous les seuils du tableau (50 = deux fois plus faciles) |
| Coffre bronze / argent / or (`achievementRewardBronze`, `Silver`, `Gold`) | 5 / 15 / 30 % | Part de l'entrepôt que remplit le coffre reçu à chaque palier (objet « Coffre de succès » de l'inventaire, utilisé sur le village choisi) ; 0 = pas de coffre |

Chaque passage qui donne des paliers envoie un seul rapport « Succès » au joueur. Le profil montre en badge le plus haut palier de chaque succès. Tables : `player_achievements` (migration 033).

## Profil joueur

Page `#/joueur/<pseudo>`. Serveur : `playerProfile` et `setBio` (`server/src/game/profile.ts`), route `GET /api/players/:name`. Constantes dans `shared/src/profile.ts`.

| Bloc | Règle |
|---|---|
| Présentation | Écrite par le joueur depuis son propre profil (`PUT /api/me/bio`) : 500 caractères (`PROFILE_BIO_MAX`) et 8 lignes (`PROFILE_BIO_LINES`) au plus, espaces et lignes vides en trop retirés |
| Modération | Un signalement d'un joueur recopie sa présentation (colonne `moderation_reports.target_bio`) ; Administration > Signalements peut l'effacer du profil (`DELETE /api/admin/players/:id/bio`), la copie reste dans le signalement |
| Faits d'armes | Villages conquis, villages perdus, attaques gagnées, défenses tenues (colonnes de `players`, tenues par `recordBattle`) ; batailles entre joueurs seulement, les barbares ne comptent pas |
| Conquêtes | Les 10 dernières conquêtes ou pertes de villages du joueur (`PROFILE_CONQUESTS`, journal `conquest_log`) |

Migration 032.

## Fiche d'un village

Page `#/fiche/x,y`, ouverte depuis la carte (« Fiche du village »), les rapports ou le profil d’un joueur. Serveur : `villageSheet` (`server/src/game/village-sheet.ts`), route `GET /api/village-sheet/:x/:y`. Aucun réglage dans l'administration : la fiche ne montre que ce que le joueur sait déjà.

| Bloc | Contenu |
|---|---|
| Public | Nom, coordonnées, propriétaire, tribu, points, province (ou Terre sainte), protection débutant, conquêtes du village (10 dernières, `conquest_log`) |
| Relation | Votre village, tribu, allié, ennemi en guerre, autre joueur, barbare ou lieu neutre (mêmes catégories que la carte) |
| Loyauté | Seulement pour ses propres villages |
| Renseignements | Troupes et muraille du dernier espionnage ou de la dernière attaque du joueur, butin estimé (comme l'assistant de pillage) |
| Rapports | Les 15 derniers rapports du joueur où ce village apparaît (`SHEET_REPORTS`) : attaque, défense, espionnage, livraison |
| Mouvements | Attaques, renforts et convois du joueur en route vers ce village |
| Temps de trajet | Par unité, depuis le village actif, bonus de vitesse des provinces compris |

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

Les ressources offertes sont retirées du village à la publication et rendues à l'annulation ou à l'expiration. Une offre ouverte réserve les marchands qui la livreront (ils ne comptent plus comme libres pour une autre offre ou un envoi). À l'acceptation, deux convois de marchands partent, un dans chaque sens ; l'acceptant doit avoir assez de marchands libres, le vendeur a déjà les siens. Un PNJ retire en plus ses offres les plus récentes si ses convois ne lui laissent plus de quoi les livrer.

## Administration

Tableau de bord séparé du jeu, à l'adresse `/admin` (page `client/admin.html`, code dans `client/src/admin/`). Il a sa propre connexion et ne montre rien d'autre que le formulaire tant que le compte n'est pas administrateur ; un compte ordinaire qui s'y connecte est refusé et déconnecté. Dans le jeu, l'entrée « Administration » du menu (et le bouton « Administration » de la liste des mondes) n'apparaissent qu'aux administrateurs et mènent au tableau de bord.

- **Tous les mondes** : une carte par monde (vitesse, carte, joueurs, actifs sur 24 h, PNJ, tribus, villages, barbares), ouverture ou fermeture des inscriptions.
- **Tous les joueurs** : chaque compte, les mondes où il joue (points, villages, tribu), date d'inscription et dernière visite ; recherche et filtre par monde.
- **Nouveau monde** : nom, inscriptions, réglages fixés à la création (vitesse, taille de la carte, villages barbares, PNJ solitaires, tribus de PNJ et leur taille) et tous les réglages du jeu, préremplis avec leur valeur d'origine. La carte, les provinces et les PNJ sont créés aussitôt et les tâches de fond du monde démarrent sans redémarrage.
- **Page d'un monde** : nom modifiable, inscriptions, réglages de création (en lecture seule), puis les onglets signalements, bugs, PNJ, guerres, joueurs (fiche détaillée), statistiques et « Monde » (tous les réglages à chaud, croisade d'essai, remplissage des entrepôts des PNJ). Les routes `/api/admin/*` visent le monde choisi par l'en-tête `x-world`.

Routes : `GET/POST /api/admin/worlds`, `GET /api/admin/worlds/template`, `PATCH /api/admin/worlds/:id`, `GET /api/admin/accounts` (`server/src/routes/admin-worlds.ts`). Les messages privés des joueurs ne sont jamais lisibles par l'administration.

Les administrateurs sont les pseudos listés dans la variable d'environnement `ADMIN_USERNAMES` (séparés par des virgules, sans tenir compte des majuscules). Le serveur revérifie le compte à chaque requête (`/api/admin/*` répond 403 aux autres).

### Signalements (Administration > Signalements)

Un bouton rouge « Signaler » figure sur le profil d'un joueur, sur un message reçu et sur la page d'une autre tribu. Le joueur choisit un motif (insultes ou harcèlement, triche ou multicompte, nom ou description inappropriés, spam, autre) et peut préciser. L'administration ne lit jamais les messageries : seul un message que son destinataire signale est recopié dans le signalement, tel qu'il était à ce moment.

| Règle | Valeur |
|---|---|
| Qui peut signaler quoi | Un joueur (pas soi-même), un message reçu (seulement par son destinataire), une tribu |
| Limites | 20 signalements par joueur et par jour (`REPORTS_PER_DAY`), pas de doublon tant que le premier attend ; 1 000 caractères de précisions |
| Anonymat | Le joueur visé n'est pas prévenu ; seul l'administrateur voit qui a signalé |
| Administration | Onglet « Signalements », ouvert d'office quand il y en a en attente, compteur rouge sur l'entrée « Administration » du menu. « À traiter » (les plus anciens d'abord) et « Historique » ; chaque signalement se clôt en « Traité » ou « Rejeté » avec une note facultative, et peut être rouvert. Le nombre de signalements reçus par la même cible est affiché |

Code : table `moderation_reports` (migration 029), `server/src/game/moderation.ts`, routes `POST /api/moderation/reports`, `GET/PUT /api/admin/moderation`, client `ReportButton.tsx` et `AdminModeration.tsx`.

### Bugs (Administration > Bugs)

Onglet « Signaler un bug » de la rubrique Aide (menu Mon compte, `#/bug`, `BugReport.tsx`) : le joueur décrit le problème (10 à 2 000 caractères) ; la page d'où il vient, son navigateur et la taille de son écran sont joints tout seuls. En dessous, il retrouve ses derniers bugs, leur état (En attente, Corrigé, Non retenu) et la réponse de l'administrateur. 10 bugs par joueur et par jour au plus (`BUGS_PER_DAY`).

Onglet « Bugs » de l'administration (`AdminBugs.tsx`), compteur compris dans celui du menu : « À traiter » et « Historique », boutons « Corrigé » et « Non retenu » avec une réponse facultative montrée au joueur, « Rouvrir ». Code : table `bug_reports` (migration 031), `server/src/game/bugs.ts`, routes `POST /api/bugs`, `GET /api/bugs/mine`, `GET/PUT /api/admin/bugs`.

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

Un PNJ attaque dès que son armée bat l'armée qu'il a espionnée (force d'attaque strictement supérieure à la défense estimée, muraille comprise). Avant, il exigeait 30 % de plus. Réglage à chaud « Marge de sécurité des attaques des PNJ (%) » (`NPC_ATTACK_MARGIN`, 0 par défaut) dans Administration > Monde. Elle s'applique aux pillages, aux guerres, aux ripostes et aux opérations de tribu. Les offensives occasionnelles partent avec leur part d'armée (« Part de l'armée engagée dans une offensive ») si cette part bat la défense espionnée ; sinon avec toute l'armée offensive si elle suffit ; sinon le PNJ renonce et retente plus tard. Une attaque perdue d'avance ne faisait que remplir les rapports.

### Recrutement accéléré des PNJ

Avant : un village de PNJ ne recrutait que lorsque sa file était vide, un seul lot d'au plus 40 unités par réflexion, après avoir dépensé ses ressources en construction. À x10, la caserne restait donc inactive entre deux réflexions et l'armée montait lentement.

Désormais (`recruitStep` dans `npc.ts`) : la file se remplit dès qu'il lui reste moins de deux réflexions de travail ; jusqu'à 3 lots de types d'unités différents par réflexion (`NPC_RECRUIT_BATCHES`), chacun d'au plus 150 unités (`NPC_RECRUIT_BATCH`, réduit de moitié tant que c'est trop cher ou trop lourd pour la ferme) ; les unités déjà en file comptent dans les effectifs, donc pas de doublon ; le recrutement passe avant la construction pour l'usage des ressources (`NPC_ARMY_FIRST`, 1 par défaut ; 0 remet la construction en premier). Les trois réglages sont modifiables à chaud dans Administration > Monde. Contrepartie : plus de ressources vont à l'armée, donc les bâtiments montent un peu moins vite.

## Point de ralliement : ordres planifiés et train de nobles

Onglet « Ralliement » de la rubrique Troupes, distinct de la page « Troupes » (`#/ralliement`, ou `#/ralliement/x,y` depuis la carte). Code : `server/src/game/orders.ts` (base de données), `shared/src/orders.ts` (découpe des ordres, aussi utilisée par le client pour afficher le plan avant l'envoi), `client/src/components/RallyOrders.tsx`.

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


## Croisades : la Citadelle

Migration 020, règles pures dans `shared/src/crusade.ts`, serveur dans `server/src/game/crusades.ts`, route `server/src/routes/crusade.ts`, tests dans `server/test/croisades.test.ts`.

| Élément | Règle |
|---|---|
| Calendrier | Deux soirs par semaine (mercredi et samedi par défaut), à 20 h 30, pendant 60 minutes, dans le fuseau `NPC_TIMEZONE`. La Citadelle est annoncée 48 heures avant l'ouverture |
| Emplacement | Un quart de la carte différent à chaque croisade, sur une case libre. La Citadelle est un village sans propriétaire (`villages.kind = 'citadel'`), muraille 20, que ni les pillages ni la repousse des barbares ne touchent |
| Garnison | 150 % de l'armée offensive de la tribu la plus forte (entre 4 000 et 250 000 places) : 40 % lanciers, 40 % hallebardiers, 20 % épéistes. En place dès l'annonce |
| Garde | Toutes les 15 minutes de l'assaut, tant qu'aucune bannière ne flotte, 15 % de la garnison de départ (même composition) rejoint la Citadelle. Une vague tombée pendant qu'un camp tient la bannière est perdue. Code : `guardWaves` dans `server/src/game/crusades.ts` |
| Fenêtre d'assaut | Attaques et renforts doivent arriver entre l'ouverture et la fermeture ; les éclaireurs peuvent partir dès l'annonce. Une arrivée hors de la fenêtre fait demi-tour |
| Bannière | Une attaque qui vide la Citadelle avec un noble survivant plante la bannière de son camp (tribu et tribus alliées, ou joueur seul) ; ses survivants restent en garnison. Seul ce camp peut envoyer des renforts ; une attaque de ce camp devient un renfort |
| Victoire | Le camp qui tient la bannière à la fermeture des portes gagne. Les troupes rentrent, les ordres programmés non partis sont annulés et remboursés |
| Gloire | 1 par 10 places ennemies tuées, +100 pour la brèche, +150 par prise de bannière, +300 pour chaque membre du camp vainqueur qui a combattu (×0,75 par victoire consécutive de la même tribu). Saison de 28 jours |
| Relique | Le camp vainqueur gagne +5 % de production pendant 7 jours |
| Trésor | 2 × la population de la garnison par ressource, partagé au prorata de la gloire, livré au plus ancien village de chacun |
| Titres | Croisé, Briseur de murailles, Porte-étendard, Champion de la Croisade, Gardien de la Citadelle, Héros de la saison : à afficher à côté de son nom (Profil) |

Sur la carte, la Citadelle se suit en direct : pendant l'annonce et l'assaut, un étendard flotte aux couleurs du détenteur (les mêmes que la légende de la carte : vous, tribu, alliés, guerre, autres), une jauge de 20 crans montre la muraille, deux pastilles comptent les attaques et les renforts en route (sans révéler leur origine), et un panneau donne le compte à rebours et le dernier événement de la chronique. La carte se recharge toutes les 10 secondes pendant l'assaut. Code : `server/src/routes/map.ts` (champ `crusade` de la Citadelle), `client/src/components/MapView.tsx` (`drawCitadelLive`), `CrusadeMapHud` dans `client/src/components/CrusadeBanner.tsx`.

Réglages à chaud (Administration > Monde) : `CRUSADES` (0 pour couper), `CRUSADE_DAYS` (« 3,6 », 0 = dimanche), `CRUSADE_TIME` (« 20:30 »), `CRUSADE_MINUTES`, `CRUSADE_NOTICE_HOURS`, `CRUSADE_GARRISON` (%), `CRUSADE_RELIC_BONUS` (%). L'administration peut lancer une croisade de test ou terminer la croisade en cours.

## Armées en marche sur la carte

Les mouvements de troupes se voient sur la carte : une petite colonne de soldats rendus en 3D (fantassins, cavaliers, éclaireurs, noble, bélier, selon ce que contient l'armée) marche au pas derrière le fanion de son camp, en soulevant un peu de poussière, le long d'un chemin en pointillés. Le fanion ondule et dit le genre du mouvement (queue d'aronde : attaque, carré : renfort, triangle : retour ou inconnu) ; le nombre de soldats dit sa taille (1 : moins de 100 places, 3 : jusqu'à 2 000, 5 : au-delà) ; une attaque qui vous vise est cerclée de rouge. Les images de marche sont rendues par `node tools/render/render.mjs march-` (quatre temps de foulée par unité, `client/src/assets/map/march-*.png` et `march.json`).

| Qui voit quoi | |
|---|---|
| Ses propres mouvements, ceux de sa tribu et des tribus alliées | Trajet complet, taille, nom du joueur |
| Une attaque ou un renfort qui vise l'un de ses villages | Trajet complet et nom de l'envoyeur ; composition cachée (taille moyenne affichée) tant qu'elle n'est pas repérée, à 10 cases ou moins de l'un de ses villages |
| Toute autre armée | Seulement pendant qu'elle passe à 10 cases ou moins de l'un de ses villages (`ARMY_SIGHT`) : sa taille et sa composition, ni origine, ni destination, ni propriétaire |

### Interception

Une armée ennemie repérée (attaque, renfort ou retour d'un joueur hors de sa tribu et de ses alliés, PNJ compris) peut être attaquée en chemin : on la touche sur la carte, on choisit ses troupes et la fiche annonce le point et l'heure de rencontre (`interceptPoint`, calculé par le serveur : `POST /api/villages/:id/intercept/preview`). Règles :

| Règle | Valeur |
|---|---|
| Où | L'interception se lance pendant que l'armée est repérée (10 cases ou moins de l'un de vos villages, `ARMY_SIGHT`) : vos troupes la poursuivent alors jusqu'à la rattraper, même hors de la zone, pourvu qu'elles la rejoignent avant son arrivée. Lancée avant qu'elle n'entre dans la zone, la rencontre doit avoir lieu dans la zone. Sinon l'envoi est refusé |
| Départ | Le village actif, à la vitesse de l'unité la plus lente ; pas d'éclaireurs seuls ; rations comme une attaque ; fin de la protection débutant |
| Bataille | En rase campagne : ni muraille ni défense de base ; nos troupes attaquent, l'armée surprise défend (`resolveCombat`, `baseDefense: 0`) |
| Après | Les survivants adverses poursuivent leur route ; une armée détruite laisse son butin, que nos survivants rapportent (dans la limite de ce qu'ils portent) ; nos troupes rentrent depuis le champ de bataille |
| Armée disparue | Si elle est arrivée, annulée ou détruite avant la rencontre, nos troupes rentrent bredouilles |
| PNJ | Ils interceptent aussi, quand ils sont sûrs de gagner (voir docs/PNJ.md, interrupteur `NPC_INTERCEPT`) |
| Protection | Jamais l'armée d'un joueur sous protection débutant |
| Rapports | Un rapport d'attaque pour l'intercepteur, de défense pour l'armée interceptée, avec le lieu de la bataille |

Côté serveur, l'interception est un mouvement de type `intercept` (migration 022 : `target_command_id`, point de rencontre `meet_x`/`meet_y`), traité dans l'ordre chronologique avec les autres (`server/src/game/intercept.ts`).

Coût serveur : une requête (`GET /api/map/armies`, 600 mouvements au plus) à chaque rechargement de la carte (30 s, 10 s pendant un assaut de croisade) ; le navigateur calcule seul la position entre deux rechargements. Pour une armée aperçue, le serveur n'envoie que la portion de trajet à portée de vue (`sightWindow` dans `shared/src/armies.ts`), pour qu'on ne puisse pas lire sa destination. Le bouton « Armées » de la carte les masque. Les animations s'arrêtent quand l'onglet est caché ; avec « réduire les animations », les armées avancent une fois par seconde sans balancer.

Code : `server/src/routes/map.ts` (`/api/map/armies`), `client/src/components/mapArmies.ts`. Base des futures interceptions en rase campagne.

## Ménage des rapports et des mouvements

`server/src/game/housekeeping.ts`, une fois par heure (et une minute après le démarrage), par lots de 5 000 :

| Élément | Règle |
|---|---|
| Mouvements terminés | Supprimés après `COMMANDS_KEEP_DAYS` jours (4 par défaut, jamais moins) |
| Rapports des joueurs | Supprimés après `REPORTS_KEEP_DAYS` jours (30 par défaut), sauf les rapports archivés |
| Rapports des PNJ | 72 heures au plus, et un seul renseignement par village barbare (voir PNJ.md) |

## Provinces et Terre sainte

La carte est découpée en provinces de taille et de forme variables (environ une pour 450 cases), avec la Terre sainte au centre. Le découpage est calculé à l'identique par le serveur et le navigateur à partir des points stockés (`shared/src/provinces.ts`, `provinceGrid`). Chaque province a un bastion (village sans propriétaire, `kind = 'bastion'`) ; la Terre sainte a son Sanctuaire. La Citadelle des croisades reste à part.

| Réglage (admin) | Variable | Défaut | Effet |
|---|---|---|---|
| Provinces | `PROVINCES` | 1 | 0 : plus de bonus ni de prise de bastion |
| Tenue d'un bastion avant contrôle | `PROVINCE_HOLD_HOURS` | 12 h | Temps de bannière sans interruption pour contrôler la province |
| Garde d'un bastion, niveaux 1 / 2 / 3 | `PROVINCE_GARRISON_1` … `_3` | 1 500 / 3 000 / 6 000 | Population de la garde neutre ; appliquée tout de suite aux bastions sans bannière quand on la change |
| Muraille d'un bastion, niveaux 1 / 2 / 3 | `PROVINCE_WALL_1` … `_3` | 5 / 10 / 15 | Idem |
| Bonus d'une province, niveaux 1 / 2 / 3 | `PROVINCE_BONUS_1` … `_3` | 5 / 10 / 15 % | Production de sa ressource, vitesse de recrutement ou vitesse des troupes, pour toute la tribu |
| Trésor d'une province, niveaux 1 / 2 / 3 | `PROVINCE_TREASURE_1` … `_3` | 10 / 20 / 30 % | Objet d'inventaire reçu par chaque membre à la prise de contrôle (une fois par tribu et par province) : remplit cette part de l'entrepôt d'un village. Code : `server/src/game/items.ts` (migration 025), page `client/src/components/Inventory.tsx` |
| Provinces voisines exigées | `HOLY_ACCESS` | 2 | Provinces bordant la Terre sainte à contrôler pour attaquer le Sanctuaire (0 = libre) |
| Tenue de la Terre sainte | `HOLY_HOLD_DAYS` | 3 j | Tenue du Sanctuaire pour gagner le monde (titre « Maître d'Aldoria ») |

Niveaux : 3 pour les provinces qui bordent la Terre sainte, puis les autres coupées en deux selon leur distance au centre (la moitié la plus proche en niveau 2, le reste en niveau 1), calculés au démarrage (migration 024). Règles : garde neutre et muraille selon le niveau (Sanctuaire : 8 000 et muraille 20). Une attaque victorieuse avec un noble survivant plante la bannière de la tribu de l'attaquant et ses survivants restent en garnison ; sans noble, elle abat la bannière. Seuls la tribu qui tient le bastion et ses alliés peuvent le renforcer. Code : `server/src/game/provinces.ts` (migration 023), page `client/src/components/Provinces.tsx`, `GET /api/provinces`.
