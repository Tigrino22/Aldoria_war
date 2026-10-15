-- Niveaux des provinces : 1 au bord de la carte, 2 à mi-chemin, 3 autour de la Terre sainte (0 pour elle-même).
-- Calculé au démarrage d'après les voisines ; tant qu'il est vide, les gardes et les bonus des bastions sans bannière sont remis au niveau.
ALTER TABLE provinces ADD COLUMN tier SMALLINT;
