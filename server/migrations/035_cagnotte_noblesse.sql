-- Cagnotte de noblesse : ressources versées par les villages du joueur, sans plafond, qui paient les lettres de noblesse.
ALTER TABLE players
  ADD COLUMN treasury_wood BIGINT NOT NULL DEFAULT 0 CHECK (treasury_wood >= 0),
  ADD COLUMN treasury_clay BIGINT NOT NULL DEFAULT 0 CHECK (treasury_clay >= 0),
  ADD COLUMN treasury_iron BIGINT NOT NULL DEFAULT 0 CHECK (treasury_iron >= 0);
