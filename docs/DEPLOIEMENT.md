# Mettre un serveur de test en ligne

Le jeu tient sur un seul service : le serveur Node sert l'API, le temps réel (WebSocket) et le site compilé,
avec une base PostgreSQL à côté. L'image est décrite par le `Dockerfile` à la racine.

## Render (le plus simple, gratuit pour tester)

1. Créez un compte sur https://render.com (connexion avec GitHub).
2. **New → Blueprint**, autorisez Render à lire le dépôt `Tigrino22/aldoria_war`, choisissez-le.
3. Render lit `render.yaml` : il propose de créer le service `aldoria-war` (branche `dev`) et la base
   `aldoria-db`. Validez avec **Apply**.
4. Après la première construction (quelques minutes), l'adresse du jeu s'affiche en haut de la page du
   service, du type `https://aldoria-war.onrender.com`. Envoyez-la à vos testeurs.

Chaque `git push` sur `dev` redéploie automatiquement. Le monde tourne en vitesse x10 (`WORLD_SPEED`
dans l'onglet *Environment* du service).

Limites de l'offre gratuite (à vérifier sur render.com, elles évoluent) :

- le service s'endort après environ 15 minutes sans visite et met près d'une minute à se réveiller ;
  les attaques arrivées pendant ce temps sont traitées au réveil ;
- la base gratuite est supprimée au bout de 30 jours. Pour un test plus long ou un vrai monde, passez le
  service et la base en offre payante (environ 7 $ par mois chacun), ce qui supprime aussi la mise en veille.

## Autre hébergeur ou VPS

N'importe quel hébergeur qui sait lancer une image Docker convient (Railway, Fly.io, Scaleway, un VPS
avec Docker et Caddy). Variables à fournir : `DATABASE_URL` (PostgreSQL 14 ou plus), `PORT` si
l'hébergeur l'impose, `WORLD_SPEED`. Les migrations et le monde (villages barbares) se créent au premier
démarrage. Mettre le site en HTTPS est indispensable pour l'application mobile (`docs/MOBILE.md`).
