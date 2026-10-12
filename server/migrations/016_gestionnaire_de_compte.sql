-- Gestionnaire de compte : modèles du joueur, réglages par village et petit journal.
-- Tables indépendantes : aucune table du jeu n'est modifiée.
CREATE TABLE manager_templates (
  id SERIAL PRIMARY KEY,
  owner_id INTEGER NOT NULL REFERENCES players(id) ON DELETE CASCADE,
  name TEXT NOT NULL,
  -- Liste ordonnée [{ "building": "farm", "level": 10 }, ...] et effectifs voulus { "spearman": 500, ... }.
  buildings JSONB NOT NULL DEFAULT '[]',
  troops JSONB NOT NULL DEFAULT '{}',
  -- Part (0 à 100 %) des ressources du prochain bâtiment que les troupes peuvent déjà utiliser.
  troops_share INTEGER NOT NULL DEFAULT 0,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX manager_templates_owner ON manager_templates (owner_id);

CREATE TABLE manager_villages (
  village_id INTEGER PRIMARY KEY REFERENCES villages(id) ON DELETE CASCADE,
  owner_id INTEGER NOT NULL REFERENCES players(id) ON DELETE CASCADE,
  enabled BOOLEAN NOT NULL DEFAULT false,
  template_id INTEGER REFERENCES manager_templates(id) ON DELETE SET NULL,
  -- Réglage propre à ce village ({ buildings, troops, troopsShare }), qui remplace le modèle quand il est présent.
  custom JSONB,
  last_blocked TEXT,
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX manager_villages_owner ON manager_villages (owner_id);

CREATE TABLE manager_log (
  id BIGSERIAL PRIMARY KEY,
  village_id INTEGER NOT NULL REFERENCES villages(id) ON DELETE CASCADE,
  at TIMESTAMPTZ NOT NULL DEFAULT now(),
  text TEXT NOT NULL
);
CREATE INDEX manager_log_village ON manager_log (village_id, id DESC);
