-- Index pour les requêtes les plus fréquentes du serveur : la table des mouvements grossit sans cesse
-- (les mouvements arrivés restent pour l'historique), et sans ces index chaque réflexion de PNJ la parcourt en entier.

-- Mouvements en cours d'un joueur (attaques en route d'un PNJ, cibles déjà visées dans l'assistant de pillage).
CREATE INDEX commands_player_open ON commands (player_id, type) WHERE NOT processed;
-- Derniers envois d'un joueur (délai entre deux espionnages, cibles déjà frappées depuis un rapport).
CREATE INDEX commands_player_sent ON commands (player_id, type, sent_at);
-- Attaques récentes reçues par un village (riposte des PNJ).
CREATE INDEX commands_attack_target_sent ON commands (target_village_id, sent_at) WHERE type = 'attack';
CREATE INDEX commands_attack_sent ON commands (sent_at) WHERE type = 'attack';
-- Mouvements en cours partis d'un village (vue du village).
CREATE INDEX commands_origin ON commands (origin_village_id) WHERE NOT processed;
-- Derniers rapports d'attaque et d'espionnage d'un joueur sur un village précis (assistant de pillage, renseignements).
CREATE INDEX reports_player_target ON reports (player_id, ((data->'defender'->'village'->>'id')::int)) WHERE type IN ('scout', 'attack');
