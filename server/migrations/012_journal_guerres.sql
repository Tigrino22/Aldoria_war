-- Journal des guerres entre tribus de PNJ : déclarations et fins, pour l'onglet « Guerres » de l'administration.
CREATE TABLE npc_war_log (
  id SERIAL PRIMARY KEY,
  at TIMESTAMPTZ NOT NULL,
  kind TEXT NOT NULL CHECK (kind IN ('declared', 'ended')),
  tribe_a INTEGER NOT NULL,
  tribe_b INTEGER NOT NULL,
  tag_a TEXT NOT NULL,
  tag_b TEXT NOT NULL
);
CREATE INDEX npc_war_log_at ON npc_war_log (at DESC);
