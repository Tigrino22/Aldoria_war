-- Tables communes à tous les mondes : la liste des mondes, les comptes des joueurs, leurs inscriptions et leurs sessions.
-- Le premier monde garde ses tables dans le schéma public ; chaque nouveau monde a son schéma monde_<id>.

CREATE TABLE core.worlds (
  id SERIAL PRIMARY KEY,
  name TEXT NOT NULL,
  schema_name TEXT NOT NULL UNIQUE,
  -- Réglages fixés à la création (vitesse, taille de la carte, villages barbares, PNJ) ; les autres sont dans world_settings.
  config JSONB NOT NULL DEFAULT '{}',
  -- Inscriptions ouvertes aux nouveaux joueurs.
  open BOOLEAN NOT NULL DEFAULT true,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE UNIQUE INDEX worlds_name_lower ON core.worlds (lower(name));

CREATE TABLE core.accounts (
  id SERIAL PRIMARY KEY,
  username TEXT NOT NULL,
  password_hash TEXT NOT NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  last_seen_at TIMESTAMPTZ
);
CREATE UNIQUE INDEX accounts_username_lower ON core.accounts (lower(username));

-- Inscription d'un compte dans un monde : son joueur dans les tables de ce monde.
CREATE TABLE core.memberships (
  account_id INTEGER NOT NULL REFERENCES core.accounts(id) ON DELETE CASCADE,
  world_id INTEGER NOT NULL REFERENCES core.worlds(id) ON DELETE CASCADE,
  player_id INTEGER NOT NULL,
  joined_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  last_played_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  PRIMARY KEY (account_id, world_id),
  UNIQUE (world_id, player_id)
);

-- Une session appartient à un compte ; world_id est le monde choisi (NULL tant que le joueur n'en a pas choisi).
CREATE TABLE core.sessions (
  token TEXT PRIMARY KEY,
  account_id INTEGER NOT NULL REFERENCES core.accounts(id) ON DELETE CASCADE,
  world_id INTEGER REFERENCES core.worlds(id) ON DELETE SET NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX sessions_account ON core.sessions (account_id);

-- Le monde existant devient le monde n° 1 : ses joueurs deviennent des comptes (même numéro), inscrits dans ce monde,
-- et leurs sessions restent valables.
INSERT INTO core.worlds (id, name, schema_name) VALUES (1, 'Aldoria', 'public');
SELECT setval(pg_get_serial_sequence('core.worlds', 'id'), 1);

INSERT INTO core.accounts (id, username, password_hash, created_at, last_seen_at)
SELECT id, username, password_hash, created_at, last_seen_at FROM public.players WHERE NOT is_npc;
SELECT setval(pg_get_serial_sequence('core.accounts', 'id'), GREATEST((SELECT max(id) FROM core.accounts), 1), (SELECT max(id) FROM core.accounts) IS NOT NULL);

INSERT INTO core.memberships (account_id, world_id, player_id, joined_at, last_played_at)
SELECT id, 1, id, created_at, COALESCE(last_seen_at, created_at) FROM public.players WHERE NOT is_npc;

INSERT INTO core.sessions (token, account_id, world_id, created_at)
SELECT s.token, s.player_id, 1, s.created_at FROM public.sessions s JOIN public.players p ON p.id = s.player_id AND NOT p.is_npc;
