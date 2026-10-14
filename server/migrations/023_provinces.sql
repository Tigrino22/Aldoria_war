-- Provinces : le territoire est découpé en provinces (seuls leur point et leur poids sont stockés, la carte se recalcule),
-- chacune avec un bastion, village sans propriétaire de genre `bastion`. La Terre sainte est la province de genre `holy`.
CREATE TABLE provinces (
  id SERIAL PRIMARY KEY,
  name TEXT NOT NULL,
  kind TEXT NOT NULL DEFAULT 'province' CHECK (kind IN ('province', 'holy')),
  x INTEGER NOT NULL,
  y INTEGER NOT NULL,
  weight REAL NOT NULL,
  -- Bonus de la province pour la tribu qui la contrôle (aucun pour la Terre sainte).
  bonus TEXT,
  bastion_village_id INTEGER REFERENCES villages(id) ON DELETE SET NULL,
  -- Tribu dont la bannière flotte sur le bastion, et depuis quand : elle contrôle la province après la durée de tenue.
  holder_tribe_id INTEGER REFERENCES tribes(id) ON DELETE SET NULL,
  holder_since TIMESTAMPTZ,
  -- Le contrôle (ou la victoire, pour la Terre sainte) a déjà été annoncé à la tribu.
  control_notified BOOLEAN NOT NULL DEFAULT false
);
CREATE INDEX provinces_bastion ON provinces (bastion_village_id);
CREATE INDEX provinces_holder ON provinces (holder_tribe_id);

-- Tableau d'honneur du monde : la tribu qui a tenu la Terre sainte assez longtemps.
CREATE TABLE world_victories (
  id SERIAL PRIMARY KEY,
  tribe_id INTEGER REFERENCES tribes(id) ON DELETE SET NULL,
  tribe_name TEXT NOT NULL,
  tribe_tag TEXT NOT NULL,
  at TIMESTAMPTZ NOT NULL
);
