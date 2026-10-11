-- Statistiques de chaque guerre de tribu : batailles gagnées en attaque et en défense, villages conquis et adversaires battus (valeur en blé),
-- pour la tribu qui a déclaré la guerre et pour la tribu visée. Comptées dès l'entrée en vigueur de la migration, sans reconstitution.
ALTER TABLE tribe_wars
  ADD COLUMN declarer_attack_wins INT NOT NULL DEFAULT 0,
  ADD COLUMN declarer_defense_wins INT NOT NULL DEFAULT 0,
  ADD COLUMN declarer_conquests INT NOT NULL DEFAULT 0,
  ADD COLUMN declarer_kills BIGINT NOT NULL DEFAULT 0,
  ADD COLUMN target_attack_wins INT NOT NULL DEFAULT 0,
  ADD COLUMN target_defense_wins INT NOT NULL DEFAULT 0,
  ADD COLUMN target_conquests INT NOT NULL DEFAULT 0,
  ADD COLUMN target_kills BIGINT NOT NULL DEFAULT 0;
