-- Succès à paliers (bronze, argent, or) : badges sur le profil et coffres dans l'inventaire.
CREATE TABLE player_achievements (
  player_id INTEGER NOT NULL REFERENCES players(id) ON DELETE CASCADE,
  key TEXT NOT NULL,
  tier TEXT NOT NULL CHECK (tier IN ('bronze', 'silver', 'gold')),
  earned_at TIMESTAMPTZ NOT NULL,
  PRIMARY KEY (player_id, key, tier)
);

-- Ressources rapportées des pillages, pour le succès « Pillard » (compté à partir de maintenant).
ALTER TABLE players ADD COLUMN loot_total BIGINT NOT NULL DEFAULT 0;

-- Le coffre d'un succès rejoint le trésor de bastion dans l'inventaire.
ALTER TABLE player_items DROP CONSTRAINT player_items_kind_check;
ALTER TABLE player_items ADD CONSTRAINT player_items_kind_check CHECK (kind IN ('treasure', 'chest'));
