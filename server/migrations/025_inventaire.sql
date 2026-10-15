-- Inventaire des joueurs : objets à utiliser plus tard (trésor d'un bastion : remplit une part de l'entrepôt d'un village).
CREATE TABLE player_items (
  id SERIAL PRIMARY KEY,
  player_id INTEGER NOT NULL REFERENCES players(id) ON DELETE CASCADE,
  kind TEXT NOT NULL CHECK (kind IN ('treasure')),
  -- Part de l'entrepôt remplie (%).
  percent INTEGER NOT NULL CHECK (percent > 0 AND percent <= 100),
  -- D'où vient l'objet (« Bastion de Valbrune, niveau 2 »).
  source TEXT,
  created_at TIMESTAMPTZ NOT NULL,
  used_at TIMESTAMPTZ,
  used_village_id INTEGER REFERENCES villages(id) ON DELETE SET NULL
);
CREATE INDEX player_items_unused ON player_items (player_id) WHERE used_at IS NULL;

-- Une tribu ne reçoit le trésor d'une province qu'une fois, même si elle la perd puis la reprend.
CREATE TABLE province_rewards (
  province_id INTEGER NOT NULL REFERENCES provinces(id) ON DELETE CASCADE,
  tribe_id INTEGER NOT NULL REFERENCES tribes(id) ON DELETE CASCADE,
  at TIMESTAMPTZ NOT NULL,
  PRIMARY KEY (province_id, tribe_id)
);
