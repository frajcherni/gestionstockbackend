-- =============================================================================
-- 03 — Réduire UNIQUEMENT stock_depot MAGAZIN selon le journal (depot_id = magazin)
-- À exécuter APRÈS 02 (inventaire → stock_depot magazin).
-- Préférer 04_magazin_init_inventaire_then_sorties.sql pour tout faire en une fois.
-- =============================================================================

BEGIN;

WITH mag_depot AS (
  SELECT id FROM depots
  WHERE LOWER(nom) LIKE '%magaz%' OR LOWER(nom) LIKE '%magasin%'
  LIMIT 1
),
sorties_par_article AS (
  SELECT
    j.article_id,
    SUM(j.quantite) AS total_sortie
  FROM journal_sortie_articles j
  INNER JOIN mag_depot md ON j.depot_id = md.id
  GROUP BY j.article_id
)

UPDATE stock_depot sd
SET qte = sd.qte - spa.total_sortie,
    updated_at = CURRENT_TIMESTAMP
FROM sorties_par_article spa, mag_depot md
WHERE sd.article_id = spa.article_id
  AND sd.depot_id = md.id;

-- Recalcul global articles
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

-- Articles avec le plus de sorties
SELECT a.reference, a.designation, SUM(j.quantite) AS sorties
FROM journal_sortie_articles j
JOIN articles a ON a.id = j.article_id
GROUP BY a.id, a.reference, a.designation
ORDER BY sorties DESC
LIMIT 20;
