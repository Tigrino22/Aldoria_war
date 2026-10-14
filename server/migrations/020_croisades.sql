-- Croisades : une Citadelle apparaît sur la carte, annoncée à l'avance, et s'ouvre pendant une fenêtre d'assaut.
-- La Citadelle est un village sans propriétaire d'un genre à part : les combats, l'espionnage et les renforts réutilisent ceux des villages.
ALTER TABLE villages ADD COLUMN kind TEXT NOT NULL DEFAULT 'village';

CREATE TABLE crusades (
  id SERIAL PRIMARY KEY,
  -- La Citadelle est supprimée quelque temps après la fin, quand plus aucune troupe n'est en route vers elle ou depuis elle.
  village_id INTEGER REFERENCES villages(id) ON DELETE SET NULL,
  name TEXT NOT NULL,
  x INTEGER NOT NULL,
  y INTEGER NOT NULL,
  -- Numéro de saison (4 semaines) : le classement de gloire repart de zéro à chaque saison.
  season INTEGER NOT NULL,
  announced_at TIMESTAMPTZ NOT NULL,
  opens_at TIMESTAMPTZ NOT NULL,
  closes_at TIMESTAMPTZ NOT NULL,
  status TEXT NOT NULL DEFAULT 'announced',
  garrison JSONB NOT NULL,
  wall INTEGER NOT NULL,
  -- Trésor à partager entre les participants, par ressource.
  treasure INTEGER NOT NULL,
  breached_at TIMESTAMPTZ,
  -- Camp qui tient la bannière : une tribu, ou un joueur sans tribu.
  holder_tribe_id INTEGER REFERENCES tribes(id) ON DELETE SET NULL,
  holder_player_id INTEGER REFERENCES players(id) ON DELETE SET NULL,
  holder_since TIMESTAMPTZ,
  winner_tribe_id INTEGER REFERENCES tribes(id) ON DELETE SET NULL,
  winner_player_id INTEGER REFERENCES players(id) ON DELETE SET NULL,
  -- Noms au moment de la victoire, pour le tableau d'honneur même si la tribu disparaît.
  winner_name TEXT,
  ended_at TIMESTAMPTZ
);
CREATE INDEX crusades_status ON crusades (status, opens_at);
CREATE INDEX crusades_village ON crusades (village_id);

-- Gloire gagnée par chaque participant d'une croisade.
CREATE TABLE crusade_scores (
  crusade_id INTEGER NOT NULL REFERENCES crusades(id) ON DELETE CASCADE,
  player_id INTEGER NOT NULL REFERENCES players(id) ON DELETE CASCADE,
  tribe_id INTEGER REFERENCES tribes(id) ON DELETE SET NULL,
  glory INTEGER NOT NULL DEFAULT 0,
  kills INTEGER NOT NULL DEFAULT 0,
  breaches INTEGER NOT NULL DEFAULT 0,
  captures INTEGER NOT NULL DEFAULT 0,
  PRIMARY KEY (crusade_id, player_id)
);
CREATE INDEX crusade_scores_player ON crusade_scores (player_id);

-- Chronique d'une croisade : brèche, prises et chutes de la bannière, victoire. Quelques lignes par croisade, sans rapport à chaque joueur.
CREATE TABLE crusade_log (
  id SERIAL PRIMARY KEY,
  crusade_id INTEGER NOT NULL REFERENCES crusades(id) ON DELETE CASCADE,
  at TIMESTAMPTZ NOT NULL,
  kind TEXT NOT NULL,
  player_name TEXT,
  tribe_tag TEXT,
  text TEXT NOT NULL
);
CREATE INDEX crusade_log_crusade ON crusade_log (crusade_id, at);

-- Récompenses : relique (bonus de production) de la tribu ou du joueur vainqueur, titres et trophées à afficher.
ALTER TABLE tribes ADD COLUMN relic_until TIMESTAMPTZ;
ALTER TABLE players ADD COLUMN relic_until TIMESTAMPTZ;
ALTER TABLE players ADD COLUMN title TEXT;
CREATE TABLE player_titles (
  player_id INTEGER NOT NULL REFERENCES players(id) ON DELETE CASCADE,
  title TEXT NOT NULL,
  earned_at TIMESTAMPTZ NOT NULL,
  crusade_id INTEGER REFERENCES crusades(id) ON DELETE SET NULL,
  PRIMARY KEY (player_id, title)
);

-- Ménage : les mouvements terminés ne servent plus après quelques jours.
CREATE INDEX commands_processed_arrive ON commands (arrive_at) WHERE processed;
CREATE INDEX reports_created ON reports (created_at);
