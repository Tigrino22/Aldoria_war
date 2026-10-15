-- Équilibrage automatique des ressources entre les villages d'un joueur (gestionnaire de compte).
CREATE TABLE manager_balance (
  owner_id INTEGER PRIMARY KEY REFERENCES players(id) ON DELETE CASCADE,
  enabled BOOLEAN NOT NULL DEFAULT false,
  -- Seuils en % de l'entrepôt : sous `low`, un village reçoit ; au-dessus de `high`, il donne son excédent.
  low INTEGER NOT NULL DEFAULT 30 CHECK (low BETWEEN 0 AND 90),
  high INTEGER NOT NULL DEFAULT 70 CHECK (high BETWEEN 10 AND 100),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  CHECK (high >= low + 10)
);

-- Un village peut être tenu à l'écart de l'équilibrage (il ne donne ni ne reçoit). Sans ligne, il participe.
ALTER TABLE manager_villages ADD COLUMN balance BOOLEAN NOT NULL DEFAULT true;

-- Convois envoyés par l'équilibrage : pas de rapport de livraison, pour ne pas noyer la boîte des joueurs.
ALTER TABLE commands ADD COLUMN automatic BOOLEAN NOT NULL DEFAULT false;
