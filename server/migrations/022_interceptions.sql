-- Interceptions : des troupes partent à la rencontre d'une armée repérée et la combattent en rase campagne.
ALTER TABLE commands DROP CONSTRAINT IF EXISTS commands_type_check;
ALTER TABLE commands ADD CONSTRAINT commands_type_check CHECK (type IN ('attack', 'support', 'return', 'trade', 'trade_return', 'intercept'));
-- Armée visée par une interception.
ALTER TABLE commands ADD COLUMN target_command_id INTEGER;
-- Point de rencontre (en cases) : arrivée d'une interception, départ du retour qui la suit.
ALTER TABLE commands ADD COLUMN meet_x REAL;
ALTER TABLE commands ADD COLUMN meet_y REAL;
