-- Dernière requête authentifiée d'un joueur (mise à jour au plus une fois par minute).
ALTER TABLE players ADD COLUMN last_seen_at TIMESTAMPTZ;
