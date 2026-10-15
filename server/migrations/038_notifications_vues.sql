-- Pastilles du menu : une notification disparaît dès que le joueur ouvre la page correspondante.
-- Pour chaque type de notification, on retient le plus grand identifiant déjà vu par le joueur ;
-- la pastille ne compte que ce qui est arrivé après. Les éléments restent « non lus » dans leur page.
CREATE TABLE player_seen (
  player_id INTEGER NOT NULL REFERENCES players(id) ON DELETE CASCADE,
  kind TEXT NOT NULL,
  last_id INTEGER NOT NULL DEFAULT 0,
  PRIMARY KEY (player_id, kind)
);
