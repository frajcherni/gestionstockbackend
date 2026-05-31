-- =============================================================================
-- 01 — Remplir journal_sortie_articles depuis l'historique des ventes (magazin)
-- Exécuter APRÈS création de la table (redémarrage backend ou CREATE TABLE)
-- =============================================================================

-- Adapter si besoin le filtre dépôt :
-- SELECT id, nom FROM depots;

BEGIN;

DELETE FROM journal_sortie_articles WHERE commentaire = 'backfill_historique';

-- Dépôt magazin / magasin
WITH mag_depot AS (
  SELECT id FROM depots
  WHERE LOWER(nom) LIKE '%magaz%' OR LOWER(nom) LIKE '%magasin%'
)

-- 1) Ventes comptoir
INSERT INTO journal_sortie_articles (
  article_id, depot_id, quantite, date_sortie, type_document, document_id, numero_document, commentaire
)
SELECT
  vca.article_id,
  vc.depot_id,
  vca.quantite,
  DATE(vc."dateCommande"),
  'vente_comptoire',
  vc.id,
  vc."numeroCommande",
  'backfill_historique'
FROM vente_comptoire_articles vca
INNER JOIN vente_comptoire vc ON vc.id = vca.vente_comptoire_id
WHERE vc.depot_id IN (SELECT id FROM mag_depot)
  AND vca.quantite > 0;

-- 2) Bons de livraison (sans vente comptoir liée)
INSERT INTO journal_sortie_articles (
  article_id, depot_id, quantite, date_sortie, type_document, document_id, numero_document, commentaire
)
SELECT
  bla.article_id,
  bl.depot_id,
  bla.quantite,
  DATE(bl."dateLivraison"),
  'bon_livraison',
  bl.id,
  bl."numeroLivraison",
  'backfill_historique'
FROM bon_livraison_articles bla
INNER JOIN bon_livraisons bl ON bl.id = bla.bon_livraison_id
WHERE bl.depot_id IN (SELECT id FROM mag_depot)
  AND bla.quantite > 0
  AND bl.vente_comptoire_id IS NULL
  AND bl.status IN ('Livré', 'Partiellement Livré');

-- 3) Factures client (directes, ou liées à un BC sans BL pour la quantité facturée restante)
INSERT INTO journal_sortie_articles (
  article_id, depot_id, quantite, date_sortie, type_document, document_id, numero_document, commentaire
)
SELECT
  fca.article_id,
  fc.depot_id,
  fca.quantite - COALESCE(bcca."quantiteLivreeDirecte", 0),
  DATE(fc."dateFacture"),
  'facture_client',
  fc.id,
  fc."numeroFacture",
  'backfill_historique'
FROM factures_client_articles fca
INNER JOIN factures_client fc ON fc.id = fca.facture_client_id
LEFT JOIN bon_commande_client_articles bcca ON bcca.bon_commande_client_id = fc."bonCommandeClient_id" AND bcca.article_id = fca.article_id
WHERE fc.depot_id IN (SELECT id FROM mag_depot)
  AND (fca.quantite - COALESCE(bcca."quantiteLivreeDirecte", 0)) > 0
  AND fc.vente_comptoire_id IS NULL
  AND fc.bon_livraison_id IS NULL
  AND fc.status != 'Annulee';

-- 4) BC avec livraison directe (via quantiteLivreeDirecte)
INSERT INTO journal_sortie_articles (
  article_id, depot_id, quantite, date_sortie, type_document, document_id, numero_document, commentaire
)
SELECT
  bcca.article_id,
  bcc.depot_id,
  bcca."quantiteLivreeDirecte",
  DATE(bcc."dateCommande"),
  'bon_commande_client',
  bcc.id,
  bcc."numeroCommande",
  'backfill_historique'
FROM bon_commande_client_articles bcca
INNER JOIN bon_commande_clients bcc ON bcc.id = bcca.bon_commande_client_id
WHERE bcc.depot_id IN (SELECT id FROM mag_depot)
  AND bcca."quantiteLivreeDirecte" > 0;

COMMIT;

-- Contrôle
SELECT type_document, COUNT(*) AS lignes, SUM(quantite) AS total_qte
FROM journal_sortie_articles
WHERE commentaire = 'backfill_historique'
GROUP BY type_document;
