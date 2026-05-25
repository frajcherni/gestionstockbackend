const { StockDepot } = require("../entities/StockDepot");
const { Article } = require("../entities/Article");
const { JournalSortieArticle } = require("../entities/JournalSortieArticle");

/**
 * Enregistre une sortie dans le journal (quantite toujours positive).
 * @param {import('typeorm').EntityManager} entityManager
 * @param {object} params
 */
async function recordJournalSortie(entityManager, params) {
  const {
    articleId,
    depotId = null,
    quantite,
    dateSortie = new Date(),
    typeDocument,
    documentId = null,
    numeroDocument = null,
    commentaire = null,
  } = params;

  if (!articleId || !quantite || quantite <= 0 || !typeDocument) return;

  const journalRepo = entityManager.getRepository(JournalSortieArticle);
  const d =
    dateSortie instanceof Date
      ? dateSortie
      : new Date(dateSortie);

  const dateOnly = new Date(
    Date.UTC(d.getUTCFullYear(), d.getUTCMonth(), d.getUTCDate())
  );

  await journalRepo.save(
    journalRepo.create({
      article_id: articleId,
      depot_id: depotId,
      quantite: Math.abs(Math.trunc(quantite)),
      date_sortie: dateOnly,
      type_document: typeDocument,
      document_id: documentId,
      numero_document: numeroDocument,
      commentaire,
    })
  );
}

/**
 * Met à jour le stock d'un article dans un dépôt.
 * Si quantityChange < 0 et journalMeta est fourni, enregistre une sortie dans le journal.
 *
 * journalMeta: {
 *   typeDocument, documentId?, numeroDocument?, dateSortie?, commentaire?
 * }
 */
async function updateDepotStock(
  entityManager,
  articleId,
  depotId,
  quantityChange,
  journalMeta = null
) {
  if (!articleId || !depotId) return;

  const stockRepo = entityManager.getRepository(StockDepot);
  const articleRepo = entityManager.getRepository(Article);

  let stockDepot = await stockRepo.findOne({
    where: { article_id: articleId, depot_id: depotId },
  });

  if (!stockDepot) {
    stockDepot = stockRepo.create({
      article_id: articleId,
      depot_id: depotId,
      qte: quantityChange,
    });
  } else {
    stockDepot.qte = (stockDepot.qte || 0) + quantityChange;
  }
  await stockRepo.save(stockDepot);

  const allStocks = await stockRepo.find({
    where: { article_id: articleId },
  });

  const totalStock = allStocks.reduce((sum, s) => sum + (s.qte || 0), 0);

  await articleRepo.update(articleId, {
    qte: totalStock,
    qte_physique: totalStock,
  });

  if (quantityChange < 0 && journalMeta?.typeDocument) {
    await recordJournalSortie(entityManager, {
      articleId,
      depotId,
      quantite: Math.abs(quantityChange),
      dateSortie: journalMeta.dateSortie || new Date(),
      typeDocument: journalMeta.typeDocument,
      documentId: journalMeta.documentId ?? null,
      numeroDocument: journalMeta.numeroDocument ?? null,
      commentaire: journalMeta.commentaire ?? null,
    });
  }

  return stockDepot;
}

module.exports = { updateDepotStock, recordJournalSortie };
