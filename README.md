# Aldoria War

Jeu de stratégie médiéval multijoueur, par navigateur et mobile, inspiré de Guerre Tribale.
On développe un village, on produit des ressources, on lève une armée, on pille et on conquiert les villages voisins, seul ou en tribu.

Cahier des charges : https://claude.ai/code/artifact/6d0a4a26-a787-4d4c-b0d4-8d0ad2a871ce
Aperçu des graphismes : https://claude.ai/artifact/ErSWDhfGNd21g4KHnKc9tQ

## Branches

- `main` : production. On n'y pousse que des versions validées.
- `dev` : développement. Tout le travail se fait ici, puis on fusionne `dev` dans `main` pour une mise en production.

## Lancer le jeu en local

Prérequis : [Node.js 22.9](https://nodejs.org) ou plus récent, et [Docker](https://www.docker.com/products/docker-desktop/) pour la base de données.

```bash
git checkout dev
cp .env.example .env        # réglages locaux (vitesse du monde x10 par défaut)
docker compose up -d        # démarre PostgreSQL
npm install
npm run db:migrate          # crée les tables
npm run dev                 # lance le serveur (port 3001) et le client (port 5173)
```

Ouvrez ensuite http://localhost:5173, créez un compte et jouez.
Pour tester à plusieurs, ouvrez une fenêtre de navigation privée et créez un deuxième compte.
Depuis un téléphone sur le même réseau Wi-Fi, ouvrez l'adresse « Network » affichée par Vite (par exemple http://192.168.1.20:5173).

Sans Docker, n'importe quel PostgreSQL 14+ convient : indiquez son adresse dans `DATABASE_URL` du fichier `.env`.

### Commandes utiles

| Commande | Effet |
| --- | --- |
| `npm run dev` | Serveur et client avec rechargement automatique |
| `npm test` | Tests des règles du jeu et du serveur (utilise la base `aldoria_test`) |
| `npm run typecheck` | Vérifie les types TypeScript des trois paquets |
| `npm run build` | Construit le client pour la production dans `client/dist` |
| `cd client && npm run ios` / `npm run android` | Construit l'application mobile et ouvre Xcode ou Android Studio ([guide](docs/MOBILE.md)) |
| `npm run db:reset` | Efface la base et repart d'un monde neuf |
| `cd tools/render && npm install && npx playwright install chromium && node render.mjs` | Régénère toutes les images 3D (bâtiments, décor, carte, icônes) |

Pour les tests, créez une fois la base de test : `docker compose exec postgres createdb -U aldoria aldoria_test`.

### Réglages (`.env`)

| Variable | Défaut | Rôle |
| --- | --- | --- |
| `WORLD_SPEED` | 10 | Multiplie la production et divise toutes les durées. 1 pour un vrai monde. |
| `MAP_SIZE` | 100 | Carte de 100 × 100 cases |
| `BARBARIAN_VILLAGES` | 250 | Villages barbares créés au démarrage d'un monde |
| `DATABASE_URL` | postgres local | Connexion PostgreSQL |
| `PORT` | 3001 | Port de l'API |
| `CORS_ORIGINS` | apps iOS et Android | Origines autorisées à appeler l'API depuis un autre domaine, séparées par des virgules |

Les barbares sont créés à la première exécution. Après avoir changé `MAP_SIZE` ou `BARBARIAN_VILLAGES`, lancez `npm run db:reset`.

## Organisation du code

```
shared/   Règles du jeu partagées : bâtiments, unités, coûts, formules, combat (TypeScript pur)
server/   API Fastify + PostgreSQL, worker des mouvements de troupes, WebSocket
client/   Interface React + Vite (PWA et apps iOS/Android via Capacitor), carte du monde en PixiJS
tools/    Générateur des illustrations 3D (bâtiments, décor, unités)
docs/     Notes d'architecture
```

Toutes les valeurs d'équilibrage sont dans `shared/src/config.ts` : modifier un coût ou une statistique d'unité suffit, le serveur et le client suivent.

Voir [docs/ARCHITECTURE.md](docs/ARCHITECTURE.md) pour le fonctionnement interne.
Pour mettre un serveur de test en ligne : [docs/DEPLOIEMENT.md](docs/DEPLOIEMENT.md).

Toutes les valeurs (production, coûts, durées, unités) sont résumées dans [docs/PARAMETRES.md](docs/PARAMETRES.md).

## Ce que contient cette première version

- Comptes (pseudo + mot de passe), protection débutant de 5 jours (divisée par la vitesse du monde)
- 4 ressources, 9 bâtiments sur 20 niveaux, file de construction de 2
- 6 unités (lancier, épéiste, éclaireur, cavalier, bélier, noble), recrutement progressif, entretien en blé
- Marché : les marchands livrent des ressources à vos autres villages ou à d'autres joueurs, puis rentrent
- Espionnage : des éclaireurs envoyés seuls rapportent ressources, bâtiments et troupes sans combattre
- Béliers : ils abaissent la muraille pendant le combat et la détruisent en partie après une victoire
- Carte de 100 × 100 avec villages barbares, déplacement et zoom à la souris ou au doigt
- Attaques, pillage avec ressources cachées par l'entrepôt, renforts entre joueurs, rappel des troupes
- Conquête par les nobles (loyauté), regain de loyauté avec le temps, relance si l'on perd son dernier village
- Rapports de combat, messagerie privée, tribus (création, invitations, exclusion, description), classements joueurs et tribus
- Notifications en direct (attaque entrante, rapport, message) et installation sur téléphone (PWA)
- Applications iOS et Android téléchargeables sur les stores (Capacitor), suppression du compte depuis l'app : voir [docs/MOBILE.md](docs/MOBILE.md)
- Muraille : l'enceinte fait tout le tour du village (palissade, puis pierre, puis forteresse à tours)
- Graphismes 3D réalistes en vue 3/4 : chaque bâtiment change d'aspect à 3 stades (niveaux 1-6, 7-13, 14-20)

## Pas encore fait (prochaines étapes)

- Mode vacances, fin de monde et condition de victoire
- Notifications push quand l'application est fermée, et e-mails
- Anti-bots et détection des multi-comptes
- Abonnement confort et cosmétiques (Stripe)
- Mise en production (sauvegardes, supervision)
