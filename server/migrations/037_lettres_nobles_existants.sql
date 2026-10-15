-- La migration 036 ne comptait pas les nobles déjà recrutés : leurs propriétaires devaient refrapper leurs lettres.
-- Chaque noble existant (chez lui, en renfort, en route ou en formation) et chaque village conquis compte comme une
-- lettre déjà frappée, pour que le prochain noble demande seulement la lettre suivante.
UPDATE players p SET letters_minted = GREATEST(p.letters_minted, x.needed)
FROM (
  SELECT v.owner_id AS player_id,
         count(*) - 1
         + COALESCE(sum((SELECT sum((t.units->>'noble')::int) FROM troops t WHERE t.home_village_id = v.id)), 0)
         + COALESCE(sum((SELECT sum((c.units->>'noble')::int) FROM commands c WHERE c.home_village_id = v.id AND NOT c.processed)), 0)
         + COALESCE(sum((SELECT sum(q.count - q.delivered) FROM recruit_queue q WHERE q.village_id = v.id AND q.unit = 'noble')), 0) AS needed
  FROM villages v
  WHERE v.owner_id IS NOT NULL AND v.kind = 'village'
  GROUP BY v.owner_id
) x
WHERE x.player_id = p.id;
