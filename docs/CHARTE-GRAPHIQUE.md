# Charte graphique d'Aldoria War : thème « Heure dorée »

Référence pour toute nouvelle page ou retouche visuelle. Le thème réunit ce qui a été validé par Valentin :
le menu (`nav.css`), la carte (`map.css`), la page Tribu (`tribe.css`) et la vue du village (`village.css`).
Esprit : jeu de stratégie médiéval « rétro 2010 » (Guerre Tribale, Travian), modernisé par le verre de bois sombre,
l'or et une lumière chaude de fin de journée. Jamais de flat design, jamais d'emoji en décor.

## 1. Matières

| Matière | Recette CSS | Où |
| --- | --- | --- |
| **Bois sombre texturé** (bannières, menu, en-tête mobile) | `linear-gradient(180deg, rgb(20 14 9 / 0.55), rgb(20 14 9 / 0.92)), url('../assets/map/ground.jpg') center / 420px` + `border: 1px solid #1a130c` + `box-shadow: inset 0 0 80px rgb(10 7 3 / 0.55)` | menu latéral, bannière Tribu, en-tête du village (mobile) |
| **Reflet doré** sur bois | `radial-gradient(120% 140% at 0% 0%, rgb(201 154 30 / 0.22), transparent 55%)` posé avant le bois | bannière Tribu |
| **Verre de bois** (panneaux posés sur un décor) | `background: rgb(26 19 12 / 0.72 à 0.84)`, `border: 1px solid rgb(243 226 179 / 0.18)`, `backdrop-filter: blur(8px)`, `box-shadow: 0 8px 24px rgb(0 0 0 / 0.35)` | outils de la carte, titre et file du village, tuiles de stats Tribu |
| **Vignette** (bords assombris) | `box-shadow: inset 0 0 90px à 120px rgb(10 7 3 / 0.55)` sur un pseudo-élément | carte, décor du village |
| **Parchemin** (étiquettes du décor) | `linear-gradient(180deg, #f7ecd0, #e2cf9f)`, encre `#2b2018`, bord `inset 0 0 0 1px rgb(120 86 40 / 0.45)`, bout en queue d'aronde (`clip-path`) | étiquettes des bâtiments |

Règle : la texture `ground.jpg` est écrite en dur dans chaque règle (une `url()` dans une variable CSS n'est pas réécrite au build).

## 2. Couleurs

| Rôle | Valeur |
| --- | --- |
| Or (titres, icônes, médaillons, accents) | `#e0b23c` (variante claire `#f1cc63`, sombre `#a77a14`, contour `#f6dc8c`) |
| Or de l'interface claire/sombre | `--gold: #c99a1e` |
| Encre sur bois | `#f3e9d2` (titres `#fbf3df`), secondaire `#c9b995` |
| Ligne sur bois | `rgb(243 226 179 / 0.16 à 0.18)` |
| Fond de page sombre | `--bg: #1b1712`, panneaux `--panel: #26201a`, `--panel-2: #2f281f`, lignes `--line: #443a2d` |
| Guerre / danger | bandeau `linear-gradient(90deg, rgb(160 30 30 / 0.92), rgb(110 20 20 / 0.86))`, bord `#ff8a7a`, rouge vif `#e04848` |
| Alliés | bleu ciel `#62c8ff` (encre `#0b2a3d`) |
| Sceau de cire (niveau sur parchemin) | `radial-gradient(circle at 35% 30%, #c4413a, #6e1414 80%)` |

Couleurs **fixes** de la carte (ne jamais les réutiliser pour autre chose) : village actif `#ffffff`, vos villages `#f5c518`,
votre tribu `#2f6fdc`, alliés `#62c8ff`, guerre déclarée `#ff2b2b`, autres joueurs `#8c1c1c`, barbares `#9c927f`
(`client/src/components/mapStyle.ts`).

## 3. Typographie

- Titres : **Cinzel** 600/700 (`var(--display)`), petites capitales naturelles, souvent `text-shadow: 0 2px 8px rgb(0 0 0 / 0.5)`.
- Texte : **Inter** 400/500/600 (`var(--body)`), chiffres en `font-variant-numeric: tabular-nums`.
- Sur-titre (« kicker ») : 11 px, 700, `letter-spacing: 0.14em`, majuscules, couleur or.
- Titres de carte : 13 px, 700, `letter-spacing: 0.1em`, majuscules, couleur `--muted`, icône dorée devant.

## 4. Composants

- **Médaillon** (icônes du menu, niveau d'un bâtiment) : cercle `radial-gradient(circle at 35% 30%, #4a3826, #1c140d 70%)` + anneau or `inset 0 0 0 1px rgb(224 178 60 / 0.55)`. Actif : or plein `#f1cc63 → #a77a14`, icône `#2b2018`.
- **Icônes** : un seul jeu au trait (`NavIcon.tsx`), le trait prend la couleur du texte. Pas de pictos colorés.
- **Pastilles** (« pills ») : rondes, 12 px, 600, fond `rgb(0 0 0 / 0.3)`, bord ligne sur bois. Variantes alliée (bleu ciel), guerre (rouge), en attente (or).
- **Cartes** : `border-radius: 14px`, padding 14 à 16 px, ombre légère, en-tête titre majuscule + compteur rond.
- **Onglets** : barre `--panel-2`, onglet actif en bois `--wood` avec soulignement or `inset 0 -2px 0 var(--gold)`.
- **Bouton or** : `linear-gradient(180deg, #e2b43a, #b8871a)`, bord `#8a6410`, encre `#2b2018`.
- **Barre d'avancement** : 6 px, fond `rgb(0 0 0 / 0.25)`, remplissage `linear-gradient(90deg, #a77a14, #f1cc63)` avec halo.
- **Bandeau de guerre** : icône ronde qui pulse doucement, titre blanc, sous-titre rose pâle, compte à rebours en gras.
- **Bandeau de croisade** (`CrusadeBanner.tsx`) : bois sombre bordé d'or, médaillon or plein (il pulse pendant l'assaut), compte à rebours en or. Sur la carte, la Citadelle garde un socle doré ; la relique ajoute un double liseré doré sous les villages du camp vainqueur.
- **Blason de tribu** : `TribeCrest.tsx` (bouclier généré depuis l'identifiant).
- Animations lentes et discrètes uniquement, toutes coupées par `prefers-reduced-motion`.

## 5. Mise en page

- Ordinateur : décor ou carte en grand, panneaux en verre posés dessus (coins), contenu secondaire en cartes dessous ou en colonne de 320 à 340 px.
- Mobile (≤ 640 px) : décor bord à bord, panneaux en verre qui passent au-dessus ou au-dessous du décor, étiquettes du décor réduites au sceau de cire (le nom réapparaît sur le bâtiment sélectionné), cibles de 44 px, tiroir et barre du bas en bois sombre avec liseré or.

## 6. Images 3D (bâtiments, décor, enceinte)

Rendues par `tools/render` (three.js dans Chromium, `node render.mjs [filtre]`), option `golden: true` dans `main.js` :

- Caméra orthographique 3/4 (lacet 32°, tangage 38°), même échelle pour tout (cadre de 18 m par bâtiment, 64 m pour le décor).
- **Lumière d'heure dorée** : soleil chaud `#ffe0b0` en haut à gauche, ciel froid `#c4d2f2`, sol `#4a3a26`, lumière d'ambiance douce.
- **Trait d'encre** `rgb(38 24 14)` sur les arêtes et le contour (normales + profondeur), façon illustration.
- **Occlusion ambiante** sur les creux, pieds de murs et dessous de toits, et ombre de contact au sol.
- Tuiles en terre cuite patinée (`#86361f → #a94f34`), ardoise bleu-gris, chaume doré, pierre beige-gris.
- Détails de vie sur les bâtiments : fenêtres éclairées de l'intérieur (vitre ambrée émissive `#ffa040`, croisillon), volets en planches vert-de-gris `#7d8c62`, appuis et jardinières fleuries, portes ferrées avec lanterne, bannières bordées d'or avec disque doré (`tools/render/kit.js`).
- La porte de la muraille est tournée de 32° pour s'aligner sur l'enceinte (tracée face à l'écran).
- Côté page, le décor reçoit en plus un voile chaud (`.vv-light`, `mix-blend-mode: soft-light`), des ombres de nuages lentes et une vignette.

Réglages pour comparer : `window.FX = { light, post, ink, ao }` (chacun à `false` pour le désactiver) avant `renderBuilding`.

## 7. Fichiers de référence

`client/src/components/nav.css` (menu), `map.css` + `mapStyle.ts` (carte), `tribe.css` (page Tribu),
`village.css` (vue du village), `NavIcon.tsx`, `TribeCrest.tsx`, `client/src/styles.css` (variables de base).

## 8. Pages du jeu (bannière et cartes partagées)

Les autres pages (hôtel de ville, caserne, marché, troupes, rapports, messagerie, classement, wiki, compte…) suivent toutes le même gabarit :

- `PageBanner` (`client/src/components/PageBanner.tsx`) : bannière en bois texturé, médaillon doré avec l'icône du menu (ou l'image du bâtiment), sur-titre, titre Cinzel, phrase d'intro, pastilles, actions, et jusqu'à six chiffres clés en tuiles de verre.
- `CardTitle` : titre de carte en majuscules espacées, icône dorée, compteur rond.
- `page.css` : cartes, onglets en bois, tableaux, liens or, bouton or, barre de progression, rangées de mouvements. Tout est écrit sous `.app .pg` : une page entre dans le thème en ajoutant la classe `pg` à son conteneur, sans rien changer aux pages validées.
- Une feuille par page (`townhall.css`, `barracks.css`, `reports.css`, `wiki.css`…) pour ce qui lui est propre, toujours sous `.app .pg`. Jamais de règle globale du type `.btn.gold` dans une feuille de page.
