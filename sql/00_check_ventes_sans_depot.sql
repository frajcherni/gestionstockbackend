-- =============================================================================
-- 00 — Vérifier les ventes / documents SANS dépôt (depot_id NULL)
-- Exécuter en lecture seule dans pgAdmin
-- =============================================================================

-- 1) Ventes comptoir sans dépôt
SELECT
  'vente_comptoire' AS source,
  vc.id,
  vc."numeroCommande" AS numero,
  vc."dateCommande"::date AS date_doc,
  vc.depot_id,
  COUNT(vca.id) AS nb_lignes,
  SUM(vca.quantite) AS total_qte
FROM vente_comptoire vc
LEFT JOIN vente_comptoire_articles vca ON vca.vente_comptoire_id = vc.id
WHERE vc.depot_id IS NULL
GROUP BY vc.id, vc."numeroCommande", vc."dateCommande", vc.depot_id
ORDER BY vc."dateCommande" DESC;

-- 2) Résumé ventes comptoir : avec / sans dépôt
SELECT
  CASE WHEN vc.depot_id IS NULL THEN 'SANS depot' ELSE 'AVEC depot' END AS categorie,
  COUNT(DISTINCT vc.id) AS nb_documents,
  COALESCE(SUM(vca.quantite), 0) AS total_qte_articles
FROM vente_comptoire vc
LEFT JOIN vente_comptoire_articles vca ON vca.vente_comptoire_id = vc.id
GROUP BY CASE WHEN vc.depot_id IS NULL THEN 'SANS depot' ELSE 'AVEC depot' END;

-- 3) Ventes comptoir sans dépôt — détail par article (top 50)
SELECT
  vc."numeroCommande",
  vc."dateCommande"::date,
  a.reference,
  a.designation,
  vca.quantite
FROM vente_comptoire vc
JOIN vente_comptoire_articles vca ON vca.vente_comptoire_id = vc.id
JOIN articles a ON a.id = vca.article_id
WHERE vc.depot_id IS NULL
ORDER BY vc."dateCommande" DESC
LIMIT 50;

-- 4) Autres documents vente — dépôt NULL (magazin concerné seulement si vous filtrez après)
SELECT 'bon_livraison' AS source, COUNT(*) AS sans_depot
FROM bon_livraisons WHERE depot_id IS NULL
UNION ALL
SELECT 'bon_commande_clients', COUNT(*) FROM bon_commande_clients WHERE depot_id IS NULL
UNION ALL
SELECT 'factures_client', COUNT(*) FROM factures_client WHERE depot_id IS NULL;

-- 5) Ventes AVEC dépôt magazin / magasin (pour comparaison)
SELECT
  d.id AS depot_id,
  d.nom AS depot_nom,
  COUNT(DISTINCT vc.id) AS nb_ventes_comptoire,
  COALESCE(SUM(vca.quantite), 0) AS total_qte
FROM depots d
LEFT JOIN vente_comptoire vc ON vc.depot_id = d.id
LEFT JOIN vente_comptoire_articles vca ON vca.vente_comptoire_id = vc.id
WHERE LOWER(d.nom) LIKE '%magaz%' OR LOWER(d.nom) LIKE '%magasin%'
GROUP BY d.id, d.nom;
