const { Depot } = require("../entities/Depot");
const { StockDepot } = require("../entities/StockDepot");
const { Article } = require("../entities/Article");

const { AppDataSource } = require("../db");

// Get all depots
exports.getAllDepots = async (req, res) => {
  try {
    const depotRepo = AppDataSource.getRepository(Depot);
    const depots = await depotRepo.find({
      order: { nom: 'ASC' }
    });
    
    res.status(200).json({
      success: true,
      data: depots,
      message: "Dépôts récupérés avec succès"
    });
  } catch (error) {
    console.error("Error fetching depots:", error);
    res.status(500).json({
      success: false,
      message: "Erreur lors de la récupération des dépôts"
    });
  }
};

// Create new depot
exports.createDepot = async (req, res) => {
  try {
    const depotRepo = AppDataSource.getRepository(Depot);
    const { nom, description } = req.body;
    
    // Check if depot name already exists
    const existingDepot = await depotRepo.findOne({ where: { nom } });
    if (existingDepot) {
      return res.status(400).json({
        success: false,
        message: "Un dépôt avec ce nom existe déjà"
      });
    }
    
    const newDepot = depotRepo.create({
      nom,
      description: description || ''
    });
    
    await depotRepo.save(newDepot);
    
    res.status(201).json({
      success: true,
      data: newDepot,
      message: "Dépôt créé avec succès"
    });
  } catch (error) {
    console.error("Error creating depot:", error);
    res.status(500).json({
      success: false,
      message: "Erreur lors de la création du dépôt"
    });
  }
};

// Update depot
exports.updateDepot = async (req, res) => {
  try {
    const { id } = req.params;
    const depotRepo = AppDataSource.getRepository(Depot);
    
    const depot = await depotRepo.findOne({ where: { id } });
    if (!depot) {
      return res.status(404).json({
        success: false,
        message: "Dépôt non trouvé"
      });
    }
    
    // Check if new name already exists (if changing)
    if (req.body.nom && req.body.nom !== depot.nom) {
      const existingDepot = await depotRepo.findOne({ 
        where: { nom: req.body.nom } 
      });
      if (existingDepot) {
        return res.status(400).json({
          success: false,
          message: "Un dépôt avec ce nom existe déjà"
        });
      }
    }
    
    depotRepo.merge(depot, req.body);
    await depotRepo.save(depot);
    
    res.status(200).json({
      success: true,
      data: depot,
      message: "Dépôt mis à jour avec succès"
    });
  } catch (error) {
    console.error("Error updating depot:", error);
    res.status(500).json({
      success: false,
      message: "Erreur lors de la mise à jour du dépôt"
    });
  }
};

// Delete depot
exports.deleteDepot = async (req, res) => {
  const queryRunner = AppDataSource.createQueryRunner();
  
  try {
    const { id } = req.params;
    
    await queryRunner.connect();
    await queryRunner.startTransaction();
    
    const depotRepo = queryRunner.manager.getRepository(Depot);
    const stockRepo = queryRunner.manager.getRepository(StockDepot);
    const articleRepo = queryRunner.manager.getRepository(Article);
    
    // Find depot
    const depot = await depotRepo.findOne({ 
      where: { id },
      relations: ['stocks'] 
    });
    
    if (!depot) {
      return res.status(404).json({
        success: false,
        message: "Dépôt non trouvé"
      });
    }
    
    // If depot has stock, delete stock entries first
    if (depot.stocks && depot.stocks.length > 0) {
      // Get all article IDs from this depot
      const articleIds = depot.stocks.map(stock => stock.article_id);
      
      // Delete stock entries
      await stockRepo.delete({ depot_id: id });
      
      // Update global quantity for each article
      for (const articleId of articleIds) {
        const articleStocks = await stockRepo.find({ 
          where: { article_id: articleId } 
        });
        
        const totalStock = articleStocks.reduce((sum, stock) => sum + stock.qte, 0);
        
        await articleRepo.update(articleId, { qte: totalStock });
      }
    }
    
    // Delete depot
    await depotRepo.delete(id);
    
    await queryRunner.commitTransaction();
    
    res.status(200).json({
      success: true,
      message: "Dépôt supprimé avec succès"
    });
    
  } catch (error) {
    await queryRunner.rollbackTransaction();
    console.error("Error deleting depot:", error);
    res.status(500).json({
      success: false,
      message: "Erreur lors de la suppression du dépôt"
    });
  } finally {
    await queryRunner.release();
  }
};

// Get depot stock
exports.getDepotStock = async (req, res) => {
  try {
    const { id } = req.params;
    const stockRepo = AppDataSource.getRepository(StockDepot);
    
    const stock = await stockRepo.find({
      where: { depot_id: id },
      relations: [
        'article', 
        'article.categorie', 
        'article.sousCategorie', 
        'article.fournisseur'
      ],
    });
    
    // Calculate summary
    const summary = {
      totalArticles: stock.length,
      totalQuantity: stock.reduce((sum, item) => sum + item.qte, 0),
      totalValue: stock.reduce((sum, item) => {
        const price = parseFloat(item.article?.pua_ttc) || 0;
        return sum + (price * item.qte);
      }, 0)
    };
    
    res.status(200).json({
      success: true,
      data: {
        items: stock,
        summary: summary
      },
      message: "Stock du dépôt récupéré avec succès"
    });
  } catch (error) {
    console.error("Error fetching depot stock:", error);
    res.status(500).json({
      success: false,
      message: "Erreur lors de la récupération du stock"
    });
  }
};

// Get article stock across all depots
exports.getArticleStock = async (req, res) => {
  try {
    const { articleId } = req.params;
    const stockRepo = AppDataSource.getRepository(StockDepot);
    
    const stock = await stockRepo.find({
      where: { article_id: articleId },
      relations: ['depot'],
      order: { 'depot.nom': 'ASC' }
    });
    
    const totalStock = stock.reduce((sum, item) => sum + item.qte, 0);
    
    res.status(200).json({
      success: true,
      data: {
        stockPerDepot: stock,
        totalStock: totalStock
      },
      message: "Stock de l'article récupéré avec succès"
    });
  } catch (error) {
    console.error("Error fetching article stock:", error);
    res.status(500).json({
      success: false,
      message: "Erreur lors de la récupération du stock"
    });
  }
};

// Get depot details with basic stats
exports.getDepotDetails = async (req, res) => {
  try {
    const { id } = req.params;
    const depotRepo = AppDataSource.getRepository(Depot);
    const stockRepo = AppDataSource.getRepository(StockDepot);
    
    const depot = await depotRepo.findOne({ 
      where: { id },
      relations: ['stocks'] 
    });
    
    if (!depot) {
      return res.status(404).json({
        success: false,
        message: "Dépôt non trouvé"
      });
    }
    
    // Calculate basic stats
    const stats = {
      totalArticles: depot.stocks?.length || 0,
      totalQuantity: depot.stocks?.reduce((sum, stock) => sum + stock.qte, 0) || 0,
      lastUpdated: depot.updated_at
    };
    
    res.status(200).json({
      success: true,
      data: {
        depot,
        stats
      },
      message: "Détails du dépôt récupérés avec succès"
    });
  } catch (error) {
    console.error("Error fetching depot details:", error);
    res.status(500).json({
      success: false,
      message: "Erreur lors de la récupération des détails"
    });
  }
};