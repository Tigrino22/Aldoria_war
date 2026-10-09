# Applications iOS et Android

Aldoria War est publié sur l'App Store et le Google Play Store grâce à [Capacitor](https://capacitorjs.com) :
le client React compilé est embarqué dans une vraie application native, installée depuis le store et lancée
depuis l'écran d'accueil, sans navigateur. L'application parle au même serveur que la version web.

```
client/
  capacitor.config.ts   identifiant (fr.aldoriawar.app), nom, couleurs, écran de démarrage
  ios/                  projet Xcode (à ouvrir sur un Mac)
  android/              projet Android Studio
  assets/               sources de l'icône et de l'écran de démarrage (1024 px et 2732 px)
  src/config.ts         adresse du serveur (VITE_API_URL) et détection de l'app native
  src/native.ts         barre d'état, écran de démarrage, bouton retour Android, vibration d'alerte
```

## 1. Mettre le serveur en ligne (obligatoire)

Dans l'application, les pages sont sur le téléphone : il faut un serveur joignable sur Internet, **en HTTPS**
(iOS refuse le HTTP simple). Il faut donc héberger `server/` et une base PostgreSQL, par exemple sur Railway,
Render, Fly.io, Scaleway ou un petit VPS avec Caddy devant.

- Variables à régler sur l'hébergeur : `DATABASE_URL`, `WORLD_SPEED`, `PORT`.
- `CORS_ORIGINS` : par défaut le serveur accepte déjà les applications iOS (`capacitor://localhost`) et
  Android (`https://localhost`). Ajoutez le domaine du site web s'il est servi ailleurs que l'API.
- Le WebSocket (`/ws`) doit passer par le proxy (Caddy et la plupart des hébergeurs le font tout seuls).

## 2. Construire l'application

Une seule fois :

```bash
cd client
cp .env.mobile.example .env.mobile      # puis mettez l'adresse de votre serveur : VITE_API_URL=https://…
```

Ensuite, à chaque nouvelle version :

```bash
npm run ios        # compile le client, copie dans ios/ et ouvre Xcode
npm run android    # idem pour Android Studio
```

`npm run build:mobile` fait la compilation et la copie sans ouvrir l'IDE. Pour changer l'icône ou l'écran
de démarrage : remplacez les images de `client/assets/` puis lancez `npm run assets:mobile`.

## 3. Publier sur l'App Store (iPhone et iPad)

Ce qu'il faut :

- un Mac avec **Xcode** (gratuit sur le Mac App Store) ;
- un compte **Apple Developer** (99 € par an) : https://developer.apple.com/programs/ ;
- une adresse web pour la **politique de confidentialité** (le texte de `docs/PRIVACY.md` peut servir de base).

Étapes :

1. `npm run ios` ouvre le projet. Dans Xcode, cliquez sur **App** dans la colonne de gauche, onglet
   **Signing & Capabilities**, choisissez votre équipe (*Team*). L'identifiant `fr.aldoriawar.app` doit être
   unique sur l'App Store : changez-le dans `capacitor.config.ts` et dans Xcode s'il est déjà pris.
2. Testez sur le simulateur, puis sur votre iPhone branché en USB (bouton ▶).
3. Sur https://appstoreconnect.apple.com, **Mes apps → +** : nom « Aldoria War », langue français,
   identifiant de l'app, catégorie **Jeux → Stratégie**.
4. Dans Xcode : choisissez la cible *Any iOS Device*, puis **Product → Archive**, puis **Distribute App →
   App Store Connect**. La version apparaît après quelques minutes dans App Store Connect.
5. Testez-la avec **TestFlight** (vous et jusqu'à 10 000 testeurs invités par lien).
6. Remplissez la fiche : description, mots-clés, captures d'écran (iPhone 6,9" obligatoire, iPad si
   vous le proposez), icône (déjà incluse dans le projet), lien de confidentialité, questionnaire
   *Confidentialité de l'app* (données collectées : identifiant utilisateur et contenu de jeu, non liés à
   un suivi publicitaire), classification d'âge (violence fantastique légère).
7. Donnez à Apple un **compte de test** (pseudo et mot de passe) dans *Informations pour la vérification*,
   puis **Soumettre pour vérification**. Comptez en général 1 à 3 jours.

Points que la vérification d'Apple contrôle et qui sont déjà prêts dans le jeu :

- **Suppression du compte depuis l'app** (règle 5.1.1) : page *Mon compte* (cliquer sur son pseudo en haut).
- **Pas un simple site web** (règle 4.2) : contenu embarqué, écran de démarrage, vibration en cas d'attaque,
  bouton retour natif. Les notifications push, quand elles seront ajoutées, renforceront ce point.
- Pas de lien vers un paiement externe. Si un jour il y a des achats (confort, cosmétiques), ils devront
  passer par l'achat intégré d'Apple sur iOS.

## 4. Publier sur Google Play (Android)

Ce qu'il faut : **Android Studio** (gratuit, Mac, Windows ou Linux) et un compte **Google Play Console**
(25 $ une fois) : https://play.google.com/console.

1. `npm run android` ouvre le projet. **Build → Generate Signed App Bundle** : créez une clé de signature
   (gardez le fichier et le mot de passe précieusement : sans eux, plus de mise à jour possible).
2. Dans la Play Console : créez l'application, envoyez le fichier `.aab` en **test interne**, remplissez la
   fiche, la sécurité des données et la classification, puis passez en production.
3. Les nouveaux comptes développeur personnels doivent faire un test fermé avec au moins 12 testeurs
   pendant 14 jours avant la production.

## 5. Mises à jour

Le serveur se met à jour sans repasser par les stores. Toute modification du client (écrans, images,
règles affichées) demande une nouvelle version de l'application : changez le numéro de version
(Xcode : *General → Version* ; Android : `versionCode` et `versionName` dans `android/app/build.gradle`),
puis refaites l'étape 3 ou 4.
