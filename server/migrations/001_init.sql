CREATE TABLE world_meta (
  key TEXT PRIMARY KEY,
  value JSONB NOT NULL
);

CREATE TABLE tribes (
  id SERIAL PRIMARY KEY,
  name TEXT NOT NULL UNIQUE,
  tag TEXT NOT NULL UNIQUE,
  leader_id INTEGER,
  description TEXT NOT NULL DEFAULT '',
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE TABLE players (
  id SERIAL PRIMARY KEY,
  username TEXT NOT NULL,
  password_hash TEXT NOT NULL,
  tribe_id INTEGER REFERENCES tribes(id) ON DELETE SET NULL,
  protection_until TIMESTAMPTZ,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE UNIQUE INDEX players_username_lower ON players (lower(username));

ALTER TABLE tribes ADD CONSTRAINT tribes_leader_fk FOREIGN KEY (leader_id) REFERENCES players(id) ON DELETE SET NULL;

CREATE TABLE sessions (
  token TEXT PRIMARY KEY,
  player_id INTEGER NOT NULL REFERENCES players(id) ON DELETE CASCADE,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE TABLE tribe_invites (
  id SERIAL PRIMARY KEY,
  tribe_id INTEGER NOT NULL REFERENCES tribes(id) ON DELETE CASCADE,
  player_id INTEGER NOT NULL REFERENCES players(id) ON DELETE CASCADE,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  UNIQUE (tribe_id, player_id)
);

CREATE TABLE villages (
  id SERIAL PRIMARY KEY,
  owner_id INTEGER REFERENCES players(id) ON DELETE SET NULL,
  name TEXT NOT NULL,
  x INTEGER NOT NULL,
  y INTEGER NOT NULL,
  buildings JSONB NOT NULL,
  wood DOUBLE PRECISION NOT NULL,
  clay DOUBLE PRECISION NOT NULL,
  iron DOUBLE PRECISION NOT NULL,
  wheat DOUBLE PRECISION NOT NULL,
  resources_at TIMESTAMPTZ NOT NULL,
  loyalty DOUBLE PRECISION NOT NULL DEFAULT 100,
  points INTEGER NOT NULL DEFAULT 0,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  UNIQUE (x, y)
);
CREATE INDEX villages_owner ON villages (owner_id);

CREATE TABLE build_queue (
  id SERIAL PRIMARY KEY,
  village_id INTEGER NOT NULL REFERENCES villages(id) ON DELETE CASCADE,
  building TEXT NOT NULL,
  level INTEGER NOT NULL,
  finish_at TIMESTAMPTZ NOT NULL
);
CREATE INDEX build_queue_village ON build_queue (village_id, finish_at);

CREATE TABLE recruit_queue (
  id SERIAL PRIMARY KEY,
  village_id INTEGER NOT NULL REFERENCES villages(id) ON DELETE CASCADE,
  unit TEXT NOT NULL,
  count INTEGER NOT NULL,
  delivered INTEGER NOT NULL DEFAULT 0,
  start_at TIMESTAMPTZ NOT NULL,
  unit_seconds DOUBLE PRECISION NOT NULL
);
CREATE INDEX recruit_queue_village ON recruit_queue (village_id, start_at);

-- Troupes stationnées dans village_id et appartenant à home_village_id.
-- Quand les deux sont égaux, ce sont les troupes du village chez elles.
CREATE TABLE troops (
  village_id INTEGER NOT NULL REFERENCES villages(id) ON DELETE CASCADE,
  home_village_id INTEGER NOT NULL REFERENCES villages(id) ON DELETE CASCADE,
  units JSONB NOT NULL,
  PRIMARY KEY (village_id, home_village_id)
);
CREATE INDEX troops_home ON troops (home_village_id);

-- Mouvements de troupes : attaque, renfort ou retour. Traités à arrive_at par le worker.
CREATE TABLE commands (
  id SERIAL PRIMARY KEY,
  type TEXT NOT NULL CHECK (type IN ('attack', 'support', 'return')),
  origin_village_id INTEGER NOT NULL REFERENCES villages(id) ON DELETE CASCADE,
  target_village_id INTEGER NOT NULL REFERENCES villages(id) ON DELETE CASCADE,
  home_village_id INTEGER NOT NULL REFERENCES villages(id) ON DELETE CASCADE,
  player_id INTEGER REFERENCES players(id) ON DELETE SET NULL,
  units JSONB NOT NULL,
  loot JSONB,
  sent_at TIMESTAMPTZ NOT NULL,
  arrive_at TIMESTAMPTZ NOT NULL,
  processed BOOLEAN NOT NULL DEFAULT false
);
CREATE INDEX commands_due ON commands (arrive_at) WHERE NOT processed;
CREATE INDEX commands_target ON commands (target_village_id) WHERE NOT processed;
CREATE INDEX commands_home ON commands (home_village_id) WHERE NOT processed;

CREATE TABLE reports (
  id SERIAL PRIMARY KEY,
  player_id INTEGER NOT NULL REFERENCES players(id) ON DELETE CASCADE,
  type TEXT NOT NULL,
  title TEXT NOT NULL,
  data JSONB NOT NULL,
  read BOOLEAN NOT NULL DEFAULT false,
  created_at TIMESTAMPTZ NOT NULL
);
CREATE INDEX reports_player ON reports (player_id, created_at DESC);

CREATE TABLE messages (
  id SERIAL PRIMARY KEY,
  from_id INTEGER REFERENCES players(id) ON DELETE SET NULL,
  to_id INTEGER NOT NULL REFERENCES players(id) ON DELETE CASCADE,
  subject TEXT NOT NULL,
  body TEXT NOT NULL,
  read BOOLEAN NOT NULL DEFAULT false,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX messages_to ON messages (to_id, created_at DESC);
CREATE INDEX messages_from ON messages (from_id, created_at DESC);
