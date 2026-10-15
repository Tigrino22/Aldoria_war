# Simulateur du gestionnaire de compte

Simule un village piloté par le gestionnaire (vitesse x1, sans pillage ni attaque) avec les règles de `shared` et `server/src/manager/rules.ts`.

- `npx tsx tools/sim/run.ts` : points, population et niveaux des modèles de départ (`PRESETS`) aux jours 7 à 90.
- `npx tsx tools/sim/optimize.ts Offensif 1500 [plan.json]` : recherche locale sur l'ordre de construction et la part des troupes.
  Score : points et population moyens des jours 5 à 70, avec une garde minimale (150 / 400 / 800 de population aux jours 10 / 15 / 20).
  La dernière ligne est le meilleur plan en JSON, à recopier dans `PRESETS`.
