# Architecture de Aldoria War

## Principe : le serveur fait foi

Le client n'envoie que des intentions (« améliorer la ferme », « envoyer 50 épéistes »).
Le serveur vérifie tout : propriétaire du village, ressources, prérequis, troupes disponibles, protection débutant.
Le client recalcule localement les compteurs pour l'affichage, avec les mêmes formules (`shared/`), mais ne décide de rien.

## Le temps de jeu sans « tick »

Aucun calcul ne tourne en boucle sur tous les villages. Deux mécanismes suffisent :

1. **Synchronisation à la demande** (`server/src/game/village.ts`, `syncVillage`).
   Chaque village stocke ses ressources et l'heure du dernier calcul (`resources_at`).
   Quand on a besoin du village, on l'amène à l'instant voulu : production découpée aux fins de construction,
   constructions terminées appliquées, unités recrutées livrées, loyauté regagnée.
2. **Mouvements datés** (`server/src/game/commands.ts`).
   Chaque attaque, renfort ou retour est une ligne de la table `commands` avec son heure d'arrivée.
   Un worker (toutes les 250 ms) traite les mouvements arrivés, un par transaction, dans l'ordre chronologique exact.
   Chaque action d'un joueur traite d'abord les mouvements échus, ce qui garantit qu'un village n'est jamais lu « dans le futur ».

Le cahier des charges prévoyait Redis + BullMQ pour cette file. La table PostgreSQL fait le même travail avec un service de moins
à installer ; on pourra passer à BullMQ si un jour il faut plusieurs serveurs.

## Concurrence

Toutes les écritures passent par un verrou unique en mémoire (`server/src/lock.ts`) et par une transaction PostgreSQL.
C'est simple, sans risque de double dépense, et suffisant pour un serveur unique et quelques milliers de joueurs.
Pour plusieurs processus, il faudra remplacer ce verrou par des verrous PostgreSQL (`SELECT … FOR UPDATE` par village).

## Combat

`shared/src/combat.ts` : la défense de chaque unité est pondérée par la part d'infanterie et de cavalerie dans l'attaque,
multipliée par le bonus de muraille (+5 % par niveau). Le camp le plus fort gagne ; il perd une part de ses troupes égale à
(force adverse / sa force)^1,5. Le perdant perd tout. Les survivants pillent ce qu'ils peuvent porter, hors ressources cachées.

## Temps réel

Le client ouvre un WebSocket (`/ws`). Le serveur n'y envoie que des signaux courts (« ton village a changé », « nouveau rapport ») ;
le client recharge alors ce qu'il affiche. Les notifications sont collectées pendant la transaction et envoyées après le COMMIT.

## Graphismes

Vue 3/4 réaliste façon Guerre Tribale. Chaque élément est un modèle 3D procédural (three.js) dans `tools/render/`
(`kit.js` : pièces de construction, `textures.js` : textures peintes par le code, `buildings.js`, `scenes.js`, `icons.js`),
rendu en PNG transparent par `render.mjs` dans un Chromium sans écran, toujours avec la même caméra (orthographique,
32° de lacet, 38° d'inclinaison) et le même soleil, pour que tout s'assemble. Les bâtiments ont trois stades
(niveaux 1-6, 7-13, 14-20). Le décor du village est rendu avec la même caméra et `village-spots.json` donne la position
à l'écran de chaque emplacement. `client/src/assets.ts` fait le lien entre les clés du jeu (`farm`, `spearman`…) et les
fichiers ; un illustrateur peut remplacer une image en gardant le même nom de fichier.

Les personnages et les chevaux (`figures.js`) sont sculptés par champs de distance (`sdf.js`) : des formes simples
fondues entre elles (corps, membres, vêtements superposés), puis transformées en maillage par marching cubes. Les
vêtements reçoivent des plis et un matelassage en relief (bruit 3D), maillés plus finement que le reste du corps.

## Base de données

Les migrations SQL sont dans `server/migrations/`, appliquées dans l'ordre par `npm run db:migrate` (et au démarrage du serveur).
Pour une évolution du schéma, ajoutez un fichier `002_….sql` ; ne modifiez jamais une migration déjà appliquée.
