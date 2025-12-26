// controllers/StockController.js
const { StockDepot, Depot, Article } = require("../entities");
const { AppDataSource } = require("../db");

// Get all stock (across all depots)
exports.getAllStock = async (req, res) => {
  try {
    const stockRepo = AppDataSource.getRepository(StockDepot);
    
    const stock = await stockRepo.find({
      where: { qte: { gt: 0 } }, // Only items with stock > 0
      relations: ['article', 'depot', 'article.categorie', 'article.fournisseur'],
      order: { 'article.designation': 'ASC' }
    });
    
    res.status(200).json({
      success: true,
      data: stock,
      message: "Stock récupéré avec succès"
    });
  } catch (error) {
    console.error("Error fetching all stock:", error);
    res.status(500).json({
      success: false,
      message: "Erreur lors de la récupération du stock"
    });
  }
};

// Get stock summary across all depots
exports.getStockSummary = async (req, res) => {
  try {
    const stockRepo = AppDataSource.getRepository(StockDepot);
    const depotRepo = AppDataSource.getRepository(Depot);
    const articleRepo = AppDataSource.getRepository(Article);
    
    // Get counts
    const [totalDepots, totalArticles, stockEntries] = await Promise.all([
      depotRepo.count(),
      articleRepo.count(),
      stockRepo.count()
    ]);
    
    // Get total stock value
    const stock = await stockRepo.find({ relations: ['article'] });
    const totalValue = stock.reduce((sum, item) => {
      const price = parseFloat(item.article?.pua_ttc) || 0;
      return sum + (price * item.qte);
    }, 0);
    
    // Get total quantity
    const totalQuantity = stock.reduce((sum, item) => sum + item.qte, 0);
    
    res.status(200).json({
      success: true,
      data: {
        totalDepots,
        totalArticles,
        stockEntries,
        totalQuantity,
        totalValue: totalValue.toFixed(3),
        articlesWithStock: new Set(stock.map(item => item.article_id)).size
      },
      message: "Résumé du stock récupéré"
    });
  } catch (error) {
    console.error("Error fetching stock summary:", error);
    res.status(500).json({
      success: false,
      message: "Erreur lors de la récupération du résumé"
    });
  }
};

// Get low stock items (below threshold)
exports.getLowStock = async (req, res) => {
  try {
    const { threshold = 5 } = req.query;
    const stockRepo = AppDataSource.getRepository(StockDepot);
    
    const lowStock = await stockRepo
      .createQueryBuilder('stock')
      .innerJoinAndSelect('stock.article', 'article')
      .innerJoinAndSelect('stock.depot', 'depot')
      .where('stock.qte <= :threshold', { threshold: parseInt(threshold) })
      .andWhere('stock.qte > 0') // Don't show zero stock
      .orderBy('stock.qte', 'ASC')
      .getMany();
    
    res.status(200).json({
      success: true,
      data: lowStock,
      message: "Articles en rupture récupérés"
    });
  } catch (error) {
    console.error("Error fetching low stock:", error);
    res.status(500).json({
      success: false,
      message: "Erreur lors de la récupération des ruptures"
    });
  }
};

// Get stock history for an article
exports.getArticleStockHistory = async (req, res) => {
  try {
    const { articleId } = req.params;
    const stockRepo = AppDataSource.getRepository(StockDepot);
    
    const history = await stockRepo.find({
      where: { article_id: articleId },
      relations: ['depot'],
      order: { updated_at: 'DESC' }
    });
    
    res.status(200).json({
      success: true,
      data: history,
      message: "Historique du stock récupéré"
    });
  } catch (error) {
    console.error("Error fetching article stock history:", error);
    res.status(500).json({
      success: false,
      message: "Erreur lors de la récupération de l'historique"
    });
  }
};

// Update stock manually (for adjustments)
exports.updateStockManually = async (req, res) => {
  const queryRunner = AppDataSource.createQueryRunner();
  
  try {
    const { articleId, depotId, qte } = req.body;
    
    if (!articleId || !depotId || qte === undefined) {
      return res.status(400).json({
        success: false,
        message: "Données manquantes"
      });
    }
    
    await queryRunner.connect();
    await queryRunner.startTransaction();
    
    const stockRepo = queryRunner.manager.getRepository(StockDepot);
    const articleRepo = queryRunner.manager.getRepository(Article);
    
    // Find or create stock entry
    let stock = await stockRepo.findOne({
      where: {
        article_id: articleId,
        depot_id: depotId
      }
    });
    
    if (!stock) {
      stock = stockRepo.create({
        article_id: articleId,
        depot_id: depotId,
        qte: parseInt(qte)
      });
    } else {
      stock.qte = parseInt(qte);
    }
    
    await stockRepo.save(stock);
    
    // Update global article quantity
    const allStocks = await stockRepo.find({
      where: { article_id: articleId }
    });
    
    const totalStock = allStocks.reduce((sum, s) => sum + s.qte, 0);
    await articleRepo.update(articleId, { qte: totalStock });
    
    await queryRunner.commitTransaction();
    
    res.status(200).json({
      success: true,
      data: stock,
      message: "Stock mis à jour avec succès"
    });
    
  } catch (error) {
    await queryRunner.rollbackTransaction();
    console.error("Error updating stock manually:", error);
    res.status(500).json({
      success: false,
      message: "Erreur lors de la mise à jour du stock"
    });
  } finally {
    await queryRunner.release();
  }
};