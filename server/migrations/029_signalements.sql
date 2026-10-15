-- Signalements des joueurs, traités dans Administration > Signalements.
-- Un message signalé est recopié tel quel au moment du signalement : l'administration ne lit que ce que le joueur a choisi de lui montrer.
CREATE TABLE moderation_reports (
  id SERIAL PRIMARY KEY,
  reporter_id INTEGER REFERENCES players(id) ON DELETE SET NULL,
  reporter_name TEXT NOT NULL,
  kind TEXT NOT NULL CHECK (kind IN ('player', 'message', 'tribe')),
  -- Joueur visé (l'auteur pour un message) ; tribu visée pour kind = 'tribe'. Les noms restent lisibles si le compte disparaît.
  target_player_id INTEGER REFERENCES players(id) ON DELETE SET NULL,
  target_tribe_id INTEGER REFERENCES tribes(id) ON DELETE SET NULL,
  target_name TEXT NOT NULL,
  message_id INTEGER,
  message_subject TEXT,
  message_body TEXT,
  reason TEXT NOT NULL CHECK (reason IN ('insult', 'cheat', 'name', 'spam', 'other')),
  comment TEXT NOT NULL DEFAULT '',
  status TEXT NOT NULL DEFAULT 'open' CHECK (status IN ('open', 'done', 'rejected')),
  admin_note TEXT,
  handled_by TEXT,
  handled_at TIMESTAMPTZ,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX moderation_reports_status ON moderation_reports (status, id DESC);
CREATE INDEX moderation_reports_reporter ON moderation_reports (reporter_id, created_at DESC);
