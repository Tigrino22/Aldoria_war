-- Guerres qui concernent une tribu de joueurs : déclarées par un chef de tribu, ou par une tribu de PNJ contre une tribu de joueurs.
-- (Les guerres entre deux tribus de PNJ restent dans `tribes.npc_state`.) Une guerre est active tant que `ended_at` est vide
-- et que `until` n'est pas passé.
CREATE TABLE tribe_wars (
  id SERIAL PRIMARY KEY,
  declarer_id INTEGER NOT NULL REFERENCES tribes(id) ON DELETE CASCADE,
  target_id INTEGER NOT NULL REFERENCES tribes(id) ON DELETE CASCADE,
  declared_by INTEGER REFERENCES players(id) ON DELETE SET NULL,
  started_at TIMESTAMPTZ NOT NULL,
  until TIMESTAMPTZ NOT NULL,
  ended_at TIMESTAMPTZ,
  CHECK (declarer_id <> target_id)
);
CREATE INDEX tribe_wars_active ON tribe_wars (until) WHERE ended_at IS NULL;
CREATE INDEX tribe_wars_declarer ON tribe_wars (declarer_id);
CREATE INDEX tribe_wars_target ON tribe_wars (target_id);
