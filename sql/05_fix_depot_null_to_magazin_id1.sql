-- =============================================================================
-- 05 — Affecter depot_id = 1 (magazin) aux documents VENTE sans dépôt
-- Tables concernées par les SORTIES stock (voir README / réponse doc)
-- =============================================================================

SELECT id, nom FROM depots WHERE id = 1;

SELECT 'vente_comptoire' AS tbl, COUNT(*) AS sans_depot FROM vente_comptoire WHERE depot_id IS NULL
UNION ALL SELECT 'bon_livraisons', COUNT(*) FROM bon_livraisons WHERE depot_id IS NULL
UNION ALL SELECT 'bon_commande_clients', COUNT(*) FROM bon_commande_clients WHERE depot_id IS NULL
UNION ALL SELECT 'factures_client', COUNT(*) FROM factures_client WHERE depot_id IS NULL;

BEGIN;

UPDATE vente_comptoire SET depot_id = 1 WHERE depot_id IS NULL;
UPDATE bon_livraisons SET depot_id = 1 WHERE depot_id IS NULL;
UPDATE bon_commande_clients SET depot_id = 1 WHERE depot_id IS NULL;
UPDATE factures_client SET depot_id = 1 WHERE depot_id IS NULL;

COMMIT;

SELECT 'vente_comptoire' AS tbl, depot_id, COUNT(*) FROM vente_comptoire GROUP BY depot_id
UNION ALL SELECT 'bon_livraisons', depot_id, COUNT(*) FROM bon_livraisons GROUP BY depot_id
UNION ALL SELECT 'bon_commande_clients', depot_id, COUNT(*) FROM bon_commande_clients GROUP BY depot_id
UNION ALL SELECT 'factures_client', depot_id, COUNT(*) FROM factures_client GROUP BY depot_id
ORDER BY tbl, depot_id;
