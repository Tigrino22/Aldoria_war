-- Quêtes de départ déjà récupérées par chaque joueur.
CREATE TABLE quest_claims (
  player_id INTEGER NOT NULL REFERENCES players(id) ON DELETE CASCADE,
  quest_key TEXT NOT NULL,
  claimed_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  PRIMARY KEY (player_id, quest_key)
);
