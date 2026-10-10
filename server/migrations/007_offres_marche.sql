-- Offres publiques du marché : les ressources offertes sont mises de côté (réservées) jusqu'à l'acceptation, l'annulation ou l'expiration.
CREATE TABLE market_offers (
  id SERIAL PRIMARY KEY,
  village_id INTEGER NOT NULL REFERENCES villages(id) ON DELETE CASCADE,
  player_id INTEGER NOT NULL REFERENCES players(id) ON DELETE CASCADE,
  give_resource TEXT NOT NULL,
  give_amount INTEGER NOT NULL CHECK (give_amount > 0),
  want_resource TEXT NOT NULL,
  want_amount INTEGER NOT NULL CHECK (want_amount > 0),
  status TEXT NOT NULL DEFAULT 'open' CHECK (status IN ('open', 'accepted', 'cancelled', 'expired')),
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  expires_at TIMESTAMPTZ NOT NULL
);
CREATE INDEX market_offers_open ON market_offers (status, expires_at);
CREATE INDEX market_offers_village ON market_offers (village_id, status);
