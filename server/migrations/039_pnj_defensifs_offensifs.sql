-- Deux types de PNJ seulement : les bâtisseurs deviennent défensifs, les pillards et conquérants offensifs.
UPDATE players SET npc_profile = CASE WHEN npc_profile IN ('raider', 'conqueror', 'offense') THEN 'offense' ELSE 'defense' END WHERE is_npc;
-- Réglages devenus sans objet : les PNJ suivent les modèles du gestionnaire de compte.
DELETE FROM world_settings WHERE key IN ('npcRecruitBatch', 'npcArmyFirst', 'npcDifficulty');
