-- Lettres de noblesse frappées depuis le début de la partie. Elles ne se consomment plus : un noble se recrute quand les
-- lettres frappées couvrent villages + nobles. Les lettres du stock (034) et celles déjà prises par des nobles en
-- formation comptent comme frappées ; chaque village au-delà du premier en ajoute une, pour ne bloquer personne.
ALTER TABLE players ADD COLUMN letters_minted INTEGER NOT NULL DEFAULT 0 CHECK (letters_minted >= 0);
UPDATE players p SET letters_minted = p.noble_letters
  + COALESCE((SELECT sum(q.letters) FROM recruit_queue q JOIN villages v ON v.id = q.village_id WHERE v.owner_id = p.id), 0)
  + GREATEST(0, (SELECT count(*) FROM villages v WHERE v.owner_id = p.id AND v.kind = 'village') - 1);
