-- Classement de guerre : conquêtes, villages perdus et batailles gagnées contre un village possédé par quelqu'un (joueur ou PNJ).
-- Les compteurs démarrent à zéro : les batailles passées ne sont pas reconstituées.
ALTER TABLE players
  ADD COLUMN conquests INT NOT NULL DEFAULT 0,
  ADD COLUMN villages_lost INT NOT NULL DEFAULT 0,
  ADD COLUMN attack_wins INT NOT NULL DEFAULT 0,
  ADD COLUMN defense_wins INT NOT NULL DEFAULT 0;

-- Journal public des conquêtes (qui a pris quel village à qui). Les noms sont conservés si un compte est supprimé.
CREATE TABLE conquest_log (
  id BIGSERIAL PRIMARY KEY,
  at TIMESTAMPTZ NOT NULL,
  conqueror_id INT REFERENCES players(id) ON DELETE SET NULL,
  conqueror_name TEXT NOT NULL,
  loser_id INT REFERENCES players(id) ON DELETE SET NULL,
  loser_name TEXT NOT NULL,
  village_name TEXT NOT NULL,
  x INT NOT NULL,
  y INT NOT NULL
);
CREATE INDEX conquest_log_at ON conquest_log (at DESC);
