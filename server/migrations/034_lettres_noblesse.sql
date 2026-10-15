-- Lettres de noblesse : stock du compte, et lettres payées par chaque recrutement de nobles (rendues à l'annulation).
ALTER TABLE players ADD COLUMN noble_letters INTEGER NOT NULL DEFAULT 0 CHECK (noble_letters >= 0);
ALTER TABLE recruit_queue ADD COLUMN letters INTEGER NOT NULL DEFAULT 0;
