-- État des tribus de PNJ : alliances, rivalités, opération coordonnée en cours.
ALTER TABLE tribes ADD COLUMN npc_state JSONB NOT NULL DEFAULT '{}'::jsonb;
