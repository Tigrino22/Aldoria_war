-- Archivage des rapports : une vue séparée « Archives », réversible.
ALTER TABLE reports ADD COLUMN archived BOOLEAN NOT NULL DEFAULT false;
