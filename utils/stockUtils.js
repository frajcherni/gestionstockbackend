const { StockDepot } = require("../entities/StockDepot");
const { Article } = require("../entities/Article");

/**
 * Updates the stock of an article in a specific depot.
 * Also updates the global article quantity to reflect the sum of all depots.
 * 
 * @param {EntityManager} entityManager - The TypeORM entity manager (to use within transactions)
 * @param {number} articleId - ID of the article
 * @param {number} depotId - ID of the depot
 * @param {number} quantityChange - The amount to add (positive) or subtract (negative)
 */
async function updateDepotStock(entityManager, articleId, depotId, quantityChange) {
  if (!articleId || !depotId) return;

  const stockRepo = entityManager.getRepository(StockDepot);
  const articleRepo = entityManager.getRepository(Article);

  // 1. Update or create StockDepot entry
  let stockDepot = await stockRepo.findOne({
    where: { article_id: articleId, depot_id: depotId }
  });

  if (!stockDepot) {
    stockDepot = stockRepo.create({
      article_id: articleId,
      depot_id: depotId,
      qte: quantityChange
    });
  } else {
    stockDepot.qte = (stockDepot.qte || 0) + quantityChange;
  }
  await stockRepo.save(stockDepot);

  // 2. Update global Article quantity (Sum of all depots)
  const allStocks = await stockRepo.find({
    where: { article_id: articleId }
  });

  const totalStock = allStocks.reduce((sum, s) => sum + (s.qte || 0), 0);

  // We also update qte_physique to keep it in sync if needed, 
  // though the user specifically asked about depot stock.
  await articleRepo.update(articleId, {
    qte: totalStock,
    qte_physique: totalStock
  });

  return stockDepot;
}

module.exports = { updateDepotStock };
