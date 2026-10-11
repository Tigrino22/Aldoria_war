-- Adversaires battus : chaque troupe tuée vaut son coût en blé par heure (cavalier 4, lancier 1…).
-- « attaque » : troupes ennemies tuées en attaquant ; « défense » : troupes ennemies tuées quand on est attaqué.
ALTER TABLE players
  ADD COLUMN kills_attack BIGINT NOT NULL DEFAULT 0,
  ADD COLUMN kills_defense BIGINT NOT NULL DEFAULT 0;
