-- Heure de mise en file : sert à rembourser en totalité une annulation faite tout de suite après une erreur de clic.
ALTER TABLE build_queue ADD COLUMN queued_at TIMESTAMPTZ NOT NULL DEFAULT now();
ALTER TABLE recruit_queue ADD COLUMN queued_at TIMESTAMPTZ NOT NULL DEFAULT now();
