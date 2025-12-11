const { AppDataSource } = require("../../config/database");
const { Inventaire, InventaireArticle } = require("../entities/Inventaire");
const { Article } = require("../entities/Article");

const inventaireRepository = AppDataSource.getRepository(Inventaire);
const inventaireArticleRepository = AppDataSource.getRepository(InventaireArticle);
const articleRepository = AppDataSource.getRepository(Article);

// Get all inventaires
exports.getAllInventaires = async (req, res) => {
  try {
    const inventaires = await inventaireRepository.find({
      relations: {
        articles: {
          article: true
        }
      },
      order: {
        dateInventaire: "DESC",
        id: "DESC"
      }
    });
    
    res.json(inventaires);
  } catch (error) {
    console.error("Error fetching inventaires:", error);
    res.status(500).json({ error: "Failed to fetch inventaires" });
  }
};

// Get single inventaire by ID
exports.getInventaireById = async (req, res) => {
  try {
    const { id } = req.params;
    const inventaire = await inventaireRepository.findOne({
      where: { id },
      relations: {
        articles: {
          article: true
        }
      }
    });
    
    if (!inventaire) {
      return res.status(404).json({ error: "Inventaire not found" });
    }
    
    res.json(inventaire);
  } catch (error) {
    console.error("Error fetching inventaire:", error);
    res.status(500).json({ error: "Failed to fetch inventaire" });
  }
};

// Create new inventaire
exports.createInventaire = async (req, res) => {
  const queryRunner = AppDataSource.createQueryRunner();
  
  try {
    await queryRunner.connect();
    await queryRunner.startTransaction();
    
    const { numeroInventaire, dateInventaire, notes, articles } = req.body;
    
    // Create inventaire
    const inventaire = inventaireRepository.create({
      numeroInventaire,
      dateInventaire: new Date(dateInventaire),
      notes,
      totalArticles: articles.length
    });
    
    const savedInventaire = await queryRunner.manager.save(inventaire);
    
    // Create inventaire articles
    const inventaireArticles = [];
    
    for (const articleData of articles) {
      // Verify article exists
      const article = await articleRepository.findOne({
        where: { id: articleData.article_id }
      });
      
      if (!article) {
        throw new Error(`Article with ID ${articleData.article_id} not found`);
      }
      
      const inventaireArticle = inventaireArticleRepository.create({
        inventaire: savedInventaire,
        article: article,
        quantite: articleData.quantite || 0,
        prixAchatHT: articleData.prixAchatHT || 0,
        prixAchatTTC: articleData.prixAchatTTC || 0,
        tva: articleData.tva || null,
        isConsigne: articleData.isConsigne || false,
        montantHT: articleData.montantHT || 0,
        montantTTC: articleData.montantTTC || 0,
        montantTVA: articleData.montantTVA || 0
      });
      
      const savedInventaireArticle = await queryRunner.manager.save(inventaireArticle);
      inventaireArticles.push(savedInventaireArticle);
    }
    
    savedInventaire.articles = inventaireArticles;
    
    await queryRunner.commitTransaction();
    
    // Return the complete inventaire with relations
    const completeInventaire = await inventaireRepository.findOne({
      where: { id: savedInventaire.id },
      relations: {
        articles: {
          article: true
        }
      }
    });
    
    res.status(201).json(completeInventaire);
    
  } catch (error) {
    await queryRunner.rollbackTransaction();
    console.error("Error creating inventaire:", error);
    res.status(400).json({ 
      error: "Failed to create inventaire",
      details: error.message 
    });
  } finally {
    await queryRunner.release();
  }
};

// Update inventaire
exports.updateInventaire = async (req, res) => {
  const queryRunner = AppDataSource.createQueryRunner();
  
  try {
    await queryRunner.connect();
    await queryRunner.startTransaction();
    
    const { id } = req.params;
    const { numeroInventaire, dateInventaire, notes, articles } = req.body;
    
    // Find existing inventaire
    const existingInventaire = await inventaireRepository.findOne({
      where: { id },
      relations: ['articles']
    });
    
    if (!existingInventaire) {
      return res.status(404).json({ error: "Inventaire not found" });
    }
    
    // Update inventaire
    existingInventaire.numeroInventaire = numeroInventaire;
    existingInventaire.dateInventaire = new Date(dateInventaire);
    existingInventaire.notes = notes;
    existingInventaire.totalArticles = articles.length;
    
    const updatedInventaire = await queryRunner.manager.save(existingInventaire);
    
    // Remove existing articles
    await queryRunner.manager.delete(InventaireArticle, { inventaire: { id } });
    
    // Create new inventaire articles
    const inventaireArticles = [];
    
    for (const articleData of articles) {
      const article = await articleRepository.findOne({
        where: { id: articleData.article_id }
      });
      
      if (!article) {
        throw new Error(`Article with ID ${articleData.article_id} not found`);
      }
      
      const inventaireArticle = inventaireArticleRepository.create({
        inventaire: updatedInventaire,
        article: article,
        quantite: articleData.quantite || 0,
        prixAchatHT: articleData.prixAchatHT || 0,
        prixAchatTTC: articleData.prixAchatTTC || 0,
        tva: articleData.tva || null,
        isConsigne: articleData.isConsigne || false,
        montantHT: articleData.montantHT || 0,
        montantTTC: articleData.montantTTC || 0,
        montantTVA: articleData.montantTVA || 0
      });
      
      const savedInventaireArticle = await queryRunner.manager.save(inventaireArticle);
      inventaireArticles.push(savedInventaireArticle);
    }
    
    await queryRunner.commitTransaction();
    
    // Return updated inventaire
    const completeInventaire = await inventaireRepository.findOne({
      where: { id },
      relations: {
        articles: {
          article: true
        }
      }
    });
    
    res.json(completeInventaire);
    
  } catch (error) {
    await queryRunner.rollbackTransaction();
    console.error("Error updating inventaire:", error);
    res.status(400).json({ 
      error: "Failed to update inventaire",
      details: error.message 
    });
  } finally {
    await queryRunner.release();
  }
};

// Delete inventaire
exports.deleteInventaire = async (req, res) => {
  try {
    const { id } = req.params;
    
    const inventaire = await inventaireRepository.findOne({
      where: { id },
      relations: ['articles']
    });
    
    if (!inventaire) {
      return res.status(404).json({ error: "Inventaire not found" });
    }
    
    await inventaireRepository.remove(inventaire);
    
    res.json({ message: "Inventaire deleted successfully" });
    
  } catch (error) {
    console.error("Error deleting inventaire:", error);
    res.status(500).json({ error: "Failed to delete inventaire" });
  }
};

// Generate next inventaire number
exports.generateNextInventaireNumber = async (req, res) => {
  try {
    const currentYear = new Date().getFullYear();
    
    // Get the last inventaire number for this year
    const lastInventaire = await inventaireRepository.findOne({
      where: {
        numeroInventaire: `INV-${currentYear}%`
      },
      order: { id: "DESC" }
    });
    
    let nextNumber = 1;
    
    if (lastInventaire && lastInventaire.numeroInventaire) {
      const match = lastInventaire.numeroInventaire.match(/INV-\d{4}-(\d+)/);
      if (match && match[1]) {
        nextNumber = parseInt(match[1]) + 1;
      }
    }
    
    const nextInventaireNumber = `INV-${currentYear}-${nextNumber.toString().padStart(4, '0')}`;
    
    res.json({ numeroInventaire: nextInventaireNumber });
    
  } catch (error) {
    console.error("Error generating inventaire number:", error);
    res.status(500).json({ error: "Failed to generate inventaire number" });
  }
};