-- Avant le 2026-10-19 (PR #132), un ordre planifié retirait ses troupes du village dès la commande. Depuis, elles restent au
-- village jusqu'au départ, et le départ (comme l'annulation) ne prend et ne rend que ce qui s'y trouve : les troupes des ordres
-- passés avant le changement n'étaient plus nulle part. On les remet au village, où elles restent réservées par leur ordre.
WITH legacy AS (
  SELECT p.origin_village_id AS village_id, k.key, sum(floor(greatest(0, (p.units ->> k.key)::numeric)))::int AS n
  FROM planned_commands p
  CROSS JOIN unnest(ARRAY['spearman', 'halberdier', 'swordsman', 'scout', 'cavalry', 'ram', 'noble']) AS k(key)
  WHERE p.created_at < '2026-10-19T07:53:05Z' AND p.units ? k.key
  GROUP BY 1, 2
  HAVING sum(floor(greatest(0, (p.units ->> k.key)::numeric))) > 0
),
per_village AS (
  SELECT village_id, jsonb_object_agg(key, n) AS units FROM legacy GROUP BY village_id
)
INSERT INTO troops (village_id, home_village_id, units)
SELECT village_id, village_id, units FROM per_village
ON CONFLICT (village_id, home_village_id) DO UPDATE SET units = (
  SELECT jsonb_object_agg(k.key, floor(coalesce((troops.units ->> k.key)::numeric, 0)) + coalesce((EXCLUDED.units ->> k.key)::int, 0))
  FROM unnest(ARRAY['spearman', 'halberdier', 'swordsman', 'scout', 'cavalry', 'ram', 'noble']) AS k(key)
);
