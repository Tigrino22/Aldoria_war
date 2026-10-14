-- Vagues de la Garde de la Citadelle : nombre de vagues déjà traitées (envoyées ou sautées parce qu'une bannière flottait).
ALTER TABLE crusades ADD COLUMN guard_waves INTEGER NOT NULL DEFAULT 0;
