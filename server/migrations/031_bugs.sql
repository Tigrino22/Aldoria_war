-- Bugs remontés par les joueurs, traités dans Administration > Bugs.
CREATE TABLE bug_reports (
  id SERIAL PRIMARY KEY,
  reporter_id INTEGER REFERENCES players(id) ON DELETE SET NULL,
  reporter_name TEXT NOT NULL,
  -- Page du jeu où le joueur était (« carte/12,40 »), appareil et taille d'écran, relevés automatiquement.
  page TEXT NOT NULL DEFAULT '',
  device TEXT NOT NULL DEFAULT '',
  screen TEXT NOT NULL DEFAULT '',
  description TEXT NOT NULL,
  status TEXT NOT NULL DEFAULT 'open' CHECK (status IN ('open', 'fixed', 'rejected')),
  admin_note TEXT,
  handled_by TEXT,
  handled_at TIMESTAMPTZ,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX bug_reports_status ON bug_reports (status, id DESC);
CREATE INDEX bug_reports_reporter ON bug_reports (reporter_id, id DESC);
