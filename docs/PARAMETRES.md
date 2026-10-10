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
Produit du blé, qui nourrit aussi vos troupes. Prérequis : aucun. Coût x1.26 et durée x1.2 par niveau.

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

| Unité | Coût (bois / argile / fer / blé) | Entretien blé/h | Recrutement caserne 1 | caserne 10 | caserne 20 | Attaque | Déf. inf. | Déf. cav. | Vitesse (min/case) | Butin |
|---|---|---|---|---|---|---|---|---|---|---|
| Lancier | 50 / 30 / 10 / 20 | 1 | 3 min 00 | 1 min 43 | 56 s | 10 | 15 | 45 | 18 | 25 |
| Épéiste | 30 / 30 / 70 / 20 | 1 | 4 min 20 | 2 min 29 | 1 min 20 | 40 | 20 | 10 | 22 | 15 |
| Éclaireur | 50 / 50 / 20 / 10 | 2 | 5 min 00 | 2 min 52 | 1 min 33 | 0 | 2 | 1 | 9 | 0 |
| Cavalier | 125 / 100 / 250 / 40 | 4 | 10 min 00 | 5 min 44 | 3 min 05 | 120 | 30 | 40 | 10 | 80 |
| Bélier | 300 / 200 / 200 / 40 | 5 | 15 min 00 | 8 min 36 | 4 min 38 | 2 | 20 | 50 | 30 | 0 |
| Noble | 4000 / 5000 / 5000 / 2000 | 100 | 1 h 00 | 34 min 23 | 18 min 31 | 30 | 100 | 50 | 35 | 0 |

Chaque niveau de caserne réduit le temps de recrutement de 6 %.

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
| Offres ouvertes par joueur | 5 (2 pour un PNJ) |
| PNJ : excédent / manque | plus de 70 % / moins de 25 % de l'entrepôt |
| PNJ : montant offert | 30 % du stock en excédent (max. 1 000), taux 0,9 (bâtisseur) ou 1 |
| PNJ : rayon pour accepter | 25 cases |
| PNJ pillards | commercent une réflexion sur trois |

Les ressources offertes sont retirées du village à la publication et rendues à l'annulation ou à l'expiration. À l'acceptation, deux convois de marchands partent, un dans chaque sens ; chaque côté doit avoir assez de marchands libres.

## Administration

Page `#/admin` (menu « Aide » > « Administration »), en lecture seule : activité des PNJ (attaques, espionnages, offres, avec un repère 🌙 pour les heures calmes), joueurs et PNJ, offres du marché, totaux et paramètres du monde.

Elle n'est visible que pour les pseudos listés dans la variable d'environnement `ADMIN_USERNAMES` (séparés par des virgules, sans tenir compte des majuscules). Le serveur revérifie l'identité à chaque requête (`/api/admin/*` répond 403 aux autres).
