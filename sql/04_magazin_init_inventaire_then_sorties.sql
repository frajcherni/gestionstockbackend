-- =============================================================================
-- 04 — MAGAZIN UNIQUEMENT : réinitialiser stock_depot depuis inventaire (SUM lignes)
--         puis déduire les sorties journal (depot magazin seulement)
--
-- Logique :
--   stock_depot(magazin) = SUM(qte_reel) dernier inventaire magazin
--   stock_depot(magazin) = stock_depot - SUM(journal sorties pour ce depot)
--   articles.qte = somme de TOUS les stock_depot (autres dépôts inchangés)
-- =============================================================================

BEGIN;

WITH mag_depot AS (
  SELECT id, nom FROM depots
  WHERE LOWER(nom) LIKE '%magaz%' OR LOWER(nom) LIKE '%magasin%'
  LIMIT 1
),
latest_inventaire AS (
  SELECT i.id AS inventaire_id, i.numero, i.date_inventaire
  FROM inventaires i
  WHERE LOWER(i.depot) LIKE '%magaz%'
     OR LOWER(i.depot) LIKE '%magasin%'
  ORDER BY i.date_inventaire DESC NULLS LAST, i.id DESC
  LIMIT 1
),
-- Même article plusieurs fois dans l'inventaire → on SOMME qte_reel
inv_par_article AS (
  SELECT
    ii.article_id,
    SUM(ii.qte_reel) AS qte_inventaire
  FROM inventaire_items ii
  INNER JOIN latest_inventaire li ON li.inventaire_id = ii.inventaire_id
  WHERE ii.article_id IS NOT NULL
  GROUP BY ii.article_id
),
sorties_magazin AS (
  SELECT
    j.article_id,
    SUM(j.quantite) AS total_sortie
  FROM journal_sortie_articles j
  INNER JOIN mag_depot md ON j.depot_id = md.id
  GROUP BY j.article_id
)

-- Étape A : poser le stock magazin = inventaire (somme par article)
UPDATE stock_depot sd
SET qte = ipa.qte_inventaire,
    updated_at = CURRENT_TIMESTAMP
FROM inv_par_article ipa
CROSS JOIN mag_depot md
WHERE sd.article_id = ipa.article_id
  AND sd.depot_id = md.id;

INSERT INTO stock_depot (article_id, depot_id, qte, created_at, updated_at)
SELECT ipa.article_id, md.id, ipa.qte_inventaire, CURRENT_TIMESTAMP, CURRENT_TIMESTAMP
FROM inv_par_article ipa
CROSS JOIN mag_depot md
WHERE NOT EXISTS (
  SELECT 1 FROM stock_depot sd
  WHERE sd.article_id = ipa.article_id AND sd.depot_id = md.id
);

-- Étape B : déduire les sorties enregistrées (journal, depot magazin uniquement)
UPDATE stock_depot sd
SET qte = GREATEST(0, sd.qte - COALESCE(sm.total_sortie, 0)),
    updated_at = CURRENT_TIMESTAMP
FROM inv_par_article ipa
CROSS JOIN mag_depot md
LEFT JOIN sorties_magazin sm ON sm.article_id = ipa.article_id
WHERE sd.article_id = ipa.article_id
  AND sd.depot_id = md.id;

-- Étape C : recalcul articles.qte global = somme tous dépôts
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

-- Contrôles
SELECT 'inventaire_utilise' AS info, li.*
FROM (
  SELECT i.id, i.numero, i.depot, i.date_inventaire
  FROM inventaires i
  WHERE LOWER(i.depot) LIKE '%magaz%' OR LOWER(i.depot) LIKE '%magasin%'
  ORDER BY i.date_inventaire DESC NULLS LAST, i.id DESC
  LIMIT 1
) li;

SELECT
  a.reference,
  ipa.qte_inventaire,
  COALESCE(sm.total_sortie, 0) AS sorties_journal,
  GREATEST(0, ipa.qte_inventaire - COALESCE(sm.total_sortie, 0)) AS stock_magazin_attendu,
  sd.qte AS stock_magazin_actuel
FROM inv_par_article ipa
JOIN articles a ON a.id = ipa.article_id
CROSS JOIN mag_depot md
LEFT JOIN sorties_magazin sm ON sm.article_id = ipa.article_id
LEFT JOIN stock_depot sd ON sd.article_id = ipa.article_id AND sd.depot_id = md.id
ORDER BY a.reference
LIMIT 30;
