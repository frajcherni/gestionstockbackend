-- =============================================================================
-- 02 — Aligner stock_depot + articles.qte sur le DERNIER inventaire (dépôt magazin)
-- =============================================================================

BEGIN;

WITH mag_depot AS (
  SELECT id, nom FROM depots
  WHERE LOWER(nom) LIKE '%magaz%' OR LOWER(nom) LIKE '%magasin%'
  LIMIT 1
),
latest_inventaire AS (
  SELECT i.id AS inventaire_id
  FROM inventaires i, mag_depot md
  WHERE LOWER(i.depot) LIKE '%magaz%'
     OR LOWER(i.depot) LIKE '%magasin%'
     OR LOWER(i.depot) = LOWER(md.nom)
  ORDER BY i.date_inventaire DESC NULLS LAST, i.id DESC
  LIMIT 1
),
inv_par_article AS (
  SELECT
    ii.article_id,
    SUM(ii.qte_reel) AS qte_reel
  FROM inventaire_items ii
  INNER JOIN latest_inventaire li ON li.inventaire_id = ii.inventaire_id
  WHERE ii.article_id IS NOT NULL
  GROUP BY ii.article_id
)

-- Mettre à jour les lignes stock_depot existantes
UPDATE stock_depot sd
SET qte = ipa.qte_reel,
    updated_at = CURRENT_TIMESTAMP
FROM inv_par_article ipa, mag_depot md
WHERE sd.article_id = ipa.article_id
  AND sd.depot_id = md.id;

-- Créer les lignes manquantes dans stock_depot
INSERT INTO stock_depot (article_id, depot_id, qte, created_at, updated_at)
SELECT ipa.article_id, md.id, ipa.qte_reel, CURRENT_TIMESTAMP, CURRENT_TIMESTAMP
FROM inv_par_article ipa
CROSS JOIN mag_depot md
WHERE NOT EXISTS (
  SELECT 1 FROM stock_depot sd
  WHERE sd.article_id = ipa.article_id AND sd.depot_id = md.id
);

-- Recalculer articles.qte = somme de tous les dépôts
UPDATE articles a
SET qte = COALESCE(totals.total_qte, 0),
    qte_physique = COALESCE(totals.total_qte, 0)
FROM (
  SELECT article_id, SUM(qte) AS total_qte
  FROM stock_depot
  GROUP BY article_id
) totals
WHERE a.id = totals.article_id;

COMMIT;

-- Vérification
SELECT COUNT(*) AS articles_inventaire FROM inventaire_items ii
JOIN inventaires i ON i.id = ii.inventaire_id
WHERE LOWER(i.depot) LIKE '%magaz%';
