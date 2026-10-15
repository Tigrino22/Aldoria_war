-- Profil joueur enrichi : présentation écrite par le joueur, recopiée dans un signalement le visant.
ALTER TABLE players ADD COLUMN bio TEXT NOT NULL DEFAULT '';
ALTER TABLE moderation_reports ADD COLUMN target_bio TEXT;
CREATE INDEX conquest_log_conqueror ON conquest_log (conqueror_id, at DESC);
CREATE INDEX conquest_log_loser ON conquest_log (loser_id, at DESC);
