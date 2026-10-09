-- Marché (nouveau bâtiment), convois de marchands, éclaireurs et béliers.
UPDATE villages SET buildings = buildings || '{"market": 0}'::jsonb WHERE NOT buildings ? 'market';

ALTER TABLE commands DROP CONSTRAINT commands_type_check;
ALTER TABLE commands ADD CONSTRAINT commands_type_check CHECK (type IN ('attack', 'support', 'return', 'trade', 'trade_return'));
-- Nombre de marchands mobilisés par un convoi (la cargaison est dans `loot`).
ALTER TABLE commands ADD COLUMN merchants INTEGER NOT NULL DEFAULT 0;
