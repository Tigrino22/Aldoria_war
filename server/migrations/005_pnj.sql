-- Joueurs non humains (PNJ) : comptes sans mot de passe pilotés par le serveur, avec les mêmes règles que les joueurs.
ALTER TABLE players ADD COLUMN is_npc BOOLEAN NOT NULL DEFAULT false;
ALTER TABLE players ADD COLUMN npc_profile TEXT;
ALTER TABLE players ADD COLUMN npc_next_action_at TIMESTAMPTZ;
ALTER TABLE players ADD COLUMN npc_state JSONB NOT NULL DEFAULT '{}'::jsonb;
CREATE INDEX players_npc_due ON players (npc_next_action_at) WHERE is_npc;
ALTER TABLE tribes ADD COLUMN is_npc BOOLEAN NOT NULL DEFAULT false;
