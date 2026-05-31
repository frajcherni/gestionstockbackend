-- =============================================================================
-- 04 — MAGAZIN : stock_depot depuis inventaire fixe INVENTAIRE-2025-089
--         puis − TOUTES les sorties journal (magazin), sans filtre de date
--
-- Exécuter TOUT le fichier d'un coup : psql -f 04_magazin_init_inventaire_then_sorties.sql
--
-- Formule :
--   stock_depot[magazin] = SUM(qte_reel) dans INVENTAIRE-2025-089
--                        − SUM(journal_sortie_articles, depot magazin)
--   Les quantités négatives sont autorisées (pas de plancher à 0)
--   articles.qte = SUM(tous stock_depot)
-- =============================================================================

-- Inventaire de référence (modifier ici si besoin)
-- INVENTAIRE-2025-089 — ne pas utiliser date_inventaire (date corrigée après coup)

ROLLBACK;

BEGIN;

DROP TABLE IF EXISTS _mag_depot;
DROP TABLE IF EXISTS _inventaire_ref;
DROP TABLE IF EXISTS _inv_par_article;
DROP TABLE IF EXISTS _sorties_magazin;

CREATE TEMP TABLE _mag_depot AS
SELECT id, nom FROM depots
WHERE LOWER(nom) LIKE '%magaz%' OR LOWER(nom) LIKE '%magasin%'
LIMIT 1;

-- Inventaire par NUMÉRO (pas par date)
CREATE TEMP TABLE _inventaire_ref AS
SELECT i.id AS inventaire_id, i.numero, i.depot, i.date_inventaire
FROM inventaires i
WHERE i.numero = 'INVENTAIRE-2025-089';

-- Vérification : l'inventaire doit exister
DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM _inventaire_ref) THEN
    RAISE EXCEPTION 'Inventaire INVENTAIRE-2025-089 introuvable. Vérifiez le numero.';
  END IF;
END $$;

CREATE TEMP TABLE _inv_par_article AS
SELECT
  ii.article_id,
  SUM(ii.qte_reel)::int AS qte_inventaire
FROM inventaire_items ii
INNER JOIN _inventaire_ref ir ON ir.inventaire_id = ii.inventaire_id
WHERE ii.article_id IS NOT NULL
GROUP BY ii.article_id;

-- Toutes les sorties magazin (historique complet, pas de filtre date)
CREATE TEMP TABLE _sorties_magazin AS
SELECT
  j.article_id,
  SUM(j.quantite)::int AS total_sortie
FROM journal_sortie_articles j
INNER JOIN _mag_depot md ON j.depot_id = md.id
GROUP BY j.article_id;

-- Étape A : stock magazin = quantité inventaire INVENTAIRE-2025-089
UPDATE stock_depot sd
SET qte = ipa.qte_inventaire,
    updated_at = CURRENT_TIMESTAMP
FROM _inv_par_article ipa
CROSS JOIN _mag_depot md
WHERE sd.article_id = ipa.article_id
  AND sd.depot_id = md.id;

INSERT INTO stock_depot (article_id, depot_id, qte, created_at, updated_at)
SELECT ipa.article_id, md.id, ipa.qte_inventaire, CURRENT_TIMESTAMP, CURRENT_TIMESTAMP
FROM _inv_par_article ipa
CROSS JOIN _mag_depot md
WHERE NOT EXISTS (
  SELECT 1 FROM stock_depot sd
  WHERE sd.article_id = ipa.article_id AND sd.depot_id = md.id
);

-- Étape B : déduire toutes les sorties journal magazin
UPDATE stock_depot sd
SET qte = sd.qte - COALESCE(sm.total_sortie, 0),
    updated_at = CURRENT_TIMESTAMP
FROM _inv_par_article ipa
CROSS JOIN _mag_depot md
LEFT JOIN _sorties_magazin sm ON sm.article_id = ipa.article_id
WHERE sd.article_id = ipa.article_id
  AND sd.depot_id = md.id;

-- Étape C : recalcul articles.qte = somme tous dépôts
UPDATE articles a
SET qte = COALESCE(totals.total_qte, 0),
    qte_physique = COALESCE(totals.total_qte, 0)
FROM (
  SELECT article_id, SUM(qte)::int AS total_qte
  FROM stock_depot
  GROUP BY article_id
) totals
WHERE a.id = totals.article_id;

COMMIT;

-- Contrôles (après COMMIT — sans tables TEMP)
SELECT 'depot_magazin' AS info, id, nom FROM depots
WHERE LOWER(nom) LIKE '%magaz%' OR LOWER(nom) LIKE '%magasin%'
LIMIT 1;

SELECT 'inventaire_utilise' AS info, i.id, i.numero, i.depot, i.date_inventaire
FROM inventaires i
WHERE i.numero = 'INVENTAIRE-2025-089';

SELECT COUNT(DISTINCT ii.article_id) AS nb_articles_inventaire
FROM inventaire_items ii
JOIN inventaires i ON i.id = ii.inventaire_id
WHERE i.numero = 'INVENTAIRE-2025-089';

WITH mag_depot AS (
  SELECT id FROM depots
  WHERE LOWER(nom) LIKE '%magaz%' OR LOWER(nom) LIKE '%magasin%'
  LIMIT 1
),
inventaire_ref AS (
  SELECT id AS inventaire_id FROM inventaires WHERE numero = 'INVENTAIRE-2025-089'
),
inv_par_article AS (
  SELECT ii.article_id, SUM(ii.qte_reel)::int AS qte_inventaire
  FROM inventaire_items ii
  INNER JOIN inventaire_ref ir ON ir.inventaire_id = ii.inventaire_id
  WHERE ii.article_id IS NOT NULL
  GROUP BY ii.article_id
),
sorties_magazin AS (
  SELECT j.article_id, SUM(j.quantite)::int AS total_sortie
  FROM journal_sortie_articles j
  INNER JOIN mag_depot md ON j.depot_id = md.id
  GROUP BY j.article_id
)
SELECT
  a.reference,
  ipa.qte_inventaire,
  COALESCE(sm.total_sortie, 0) AS sorties_journal,
  ipa.qte_inventaire - COALESCE(sm.total_sortie, 0) AS stock_magazin_attendu,
  sd.qte AS stock_magazin_actuel
FROM inv_par_article ipa
JOIN articles a ON a.id = ipa.article_id
CROSS JOIN mag_depot md
LEFT JOIN sorties_magazin sm ON sm.article_id = ipa.article_id
LEFT JOIN stock_depot sd ON sd.article_id = ipa.article_id AND sd.depot_id = md.id
ORDER BY a.reference
LIMIT 30;
