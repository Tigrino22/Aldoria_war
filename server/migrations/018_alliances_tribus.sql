-- Alliances entre tribus de joueurs : symétriques, une ligne par paire (tribe_a < tribe_b).
CREATE TABLE tribe_alliances (
  id SERIAL PRIMARY KEY,
  tribe_a INTEGER NOT NULL REFERENCES tribes(id) ON DELETE CASCADE,
  tribe_b INTEGER NOT NULL REFERENCES tribes(id) ON DELETE CASCADE,
  created_by INTEGER REFERENCES players(id) ON DELETE SET NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  CHECK (tribe_a < tribe_b),
  UNIQUE (tribe_a, tribe_b)
);
CREATE INDEX tribe_alliances_b ON tribe_alliances (tribe_b);

-- Propositions d'alliance en attente : une seule par paire de tribus, quel que soit le sens.
CREATE TABLE tribe_alliance_invites (
  id SERIAL PRIMARY KEY,
  from_tribe INTEGER NOT NULL REFERENCES tribes(id) ON DELETE CASCADE,
  to_tribe INTEGER NOT NULL REFERENCES tribes(id) ON DELETE CASCADE,
  invited_by INTEGER REFERENCES players(id) ON DELETE SET NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  CHECK (from_tribe <> to_tribe)
);
CREATE UNIQUE INDEX tribe_alliance_invites_pair ON tribe_alliance_invites (LEAST(from_tribe, to_tribe), GREATEST(from_tribe, to_tribe));
CREATE INDEX tribe_alliance_invites_to ON tribe_alliance_invites (to_tribe);
