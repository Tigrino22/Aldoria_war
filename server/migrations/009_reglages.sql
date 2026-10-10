-- Réglages du monde modifiables depuis la page d'administration (ils remplacent les variables d'environnement).
CREATE TABLE world_settings (
  key TEXT PRIMARY KEY,
  value TEXT NOT NULL,
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);
