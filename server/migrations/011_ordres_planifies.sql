-- Point de ralliement : mouvements planifiés. Les troupes sont réservées (retirées du village) dès la planification ;
-- chaque mouvement part à `depart_at` pour arriver à `arrive_at`. Un « groupe » réunit les mouvements d'un même ordre
-- (par exemple un assaut et son train de nobles).
CREATE TABLE planned_commands (
  id SERIAL PRIMARY KEY,
  group_id UUID NOT NULL,
  player_id INTEGER NOT NULL REFERENCES players(id) ON DELETE CASCADE,
  origin_village_id INTEGER NOT NULL REFERENCES villages(id) ON DELETE CASCADE,
  target_village_id INTEGER NOT NULL REFERENCES villages(id) ON DELETE CASCADE,
  type TEXT NOT NULL CHECK (type IN ('attack', 'support')),
  units JSONB NOT NULL,
  depart_at TIMESTAMPTZ NOT NULL,
  arrive_at TIMESTAMPTZ NOT NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX planned_commands_depart ON planned_commands (depart_at);
CREATE INDEX planned_commands_player ON planned_commands (player_id);
CREATE INDEX planned_commands_origin ON planned_commands (origin_village_id);
