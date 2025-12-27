// controllers/TransferController.js
const { Transfer, TransferItem } = require("../entities/Transfer");
const { Depot } = require("../entities/Depot");
const { StockDepot } = require("../entities/StockDepot");
const { Article } = require("../entities/Article");
const { AppDataSource } = require("../db");

// GET ALL TRANSFERS
exports.getAllTransfers = async (req, res) => {
  try {
    const transferRepo = AppDataSource.getRepository(Transfer);
    
    const transfers = await transferRepo.find({
      relations: [
        'items',
        'items.article',
        'items.article.categorie',
        'items.article.fournisseur'
      ],
      order: { created_at: 'DESC' }
    });
    
    res.status(200).json({
      success: true,
      data: transfers,
      message: "Transferts récupérés avec succès"
    });
  } catch (error) {
    console.error("Error fetching transfers:", error);
    res.status(500).json({
      success: false,
      message: "Erreur lors de la récupération des transferts"
    });
  }
};

// GET SINGLE TRANSFER
exports.getTransfer = async (req, res) => {
  try {
    const { id } = req.params;
    const transferRepo = AppDataSource.getRepository(Transfer);
    
    const transfer = await transferRepo.findOne({
      where: { id },
      relations: [
        'items',
        'items.article',
        'items.article.categorie',
        'items.article.fournisseur'
      ]
    });
    
    if (!transfer) {
      return res.status(404).json({
        success: false,
        message: "Transfert non trouvé"
      });
    }
    
    res.status(200).json({
      success: true,
      data: transfer,
      message: "Transfert récupéré avec succès"
    });
  } catch (error) {
    console.error("Error fetching transfer:", error);
    res.status(500).json({
      success: false,
      message: "Erreur lors de la récupération du transfert"
    });
  }
};

// CREATE TRANSFER
exports.createTransfer = async (req, res) => {
  const queryRunner = AppDataSource.createQueryRunner();
  
  try {
    const { 
      numero, 
      date, 
      date_transfert, 
      depot_source, 
      depot_destination, 
      description, 
      articles 
    } = req.body;
    
    // Validate required fields
    if (!numero || !depot_source || !depot_destination || !articles || !Array.isArray(articles)) {
      return res.status(400).json({
        success: false,
        message: "Données manquantes: numéro, dépôts et articles sont requis"
      });
    }
    
    await queryRunner.connect();
    await queryRunner.startTransaction();
    
    const transferRepo = queryRunner.manager.getRepository(Transfer);
    const transferItemRepo = queryRunner.manager.getRepository(TransferItem);
    const stockRepo = queryRunner.manager.getRepository(StockDepot);
    const articleRepo = queryRunner.manager.getRepository(Article);
    const depotRepo = queryRunner.manager.getRepository(Depot);
    
    // 1. Check if transfer number already exists
    const existingTransfer = await transferRepo.findOne({ where: { numero } });
    if (existingTransfer) {
      throw new Error(`Un transfert avec le numéro ${numero} existe déjà`);
    }
    
    // 2. Find source and destination depots
    const sourceDepot = await depotRepo.findOne({ where: { nom: depot_source } });
    const destinationDepot = await depotRepo.findOne({ where: { nom: depot_destination } });
    
    if (!sourceDepot) {
      throw new Error(`Dépôt source "${depot_source}" non trouvé`);
    }
    
    if (!destinationDepot) {
      throw new Error(`Dépôt destination "${depot_destination}" non trouvé`);
    }
    
    if (sourceDepot.id === destinationDepot.id) {
      throw new Error("Les dépôts source et destination doivent être différents");
    }
    
    // 3. Create transfer record
    const transfer = transferRepo.create({
      numero,
      date: date || new Date().toISOString().split('T')[0],
      date_transfert: date_transfert || new Date().toISOString().split('T')[0],
      depot_source,
      depot_destination,
      description: description || '',
      status: "En cours",
      article_count: articles.length,
      total_ht: 0,
      total_tva: 0,
      total_ttc: 0
    });
    
    const savedTransfer = await transferRepo.save(transfer);
    
    // 4. Process each article
    let totalHT = 0;
    let totalTVA = 0;
    let totalTTC = 0;
    const transferItems = [];
    
    for (const itemData of articles) {
      const { article_id, qte } = itemData;
      
      if (!article_id || !qte || qte <= 0) {
        throw new Error("Données d'article invalides");
      }
      
      // Get article details
      const article = await articleRepo.findOne({ 
        where: { id: article_id },
        relations: ['categorie', 'fournisseur'] 
      });
      
      if (!article) {
        throw new Error(`Article ID ${article_id} non trouvé`);
      }
      
      // Check stock availability in source depot
      const sourceStock = await stockRepo.findOne({
        where: {
          article_id: article_id,
          depot_id: sourceDepot.id
        }
      });
      
      const availableStock = sourceStock ? sourceStock.qte : 0;
      
      if (availableStock < qte) {
        throw new Error(`Stock insuffisant pour "${article.designation}" (${article.reference}). Disponible: ${availableStock}, Demandé: ${qte}`);
      }
      
      // Calculate financial values
      const pua_ht = parseFloat(article.pua_ht) || 0;
      const pua_ttc = parseFloat(article.pua_ttc) || 0;
      const tva = parseFloat(article.tva) || 19;
      
      const itemHT = qte * pua_ht;
      const itemTVA = itemHT * (tva / 100);
      const itemTTC = itemHT + itemTVA;
      
      // Create transfer item
      const transferItem = transferItemRepo.create({
        transfer_id: savedTransfer.id,
        article_id: article_id,
        qte: qte,
        pua_ht: pua_ht,
        pua_ttc: pua_ttc,
        tva: tva,
        total_ht: itemHT,
        total_tva: itemTVA,
        total_ttc: itemTTC
      });
      
      transferItems.push(transferItem);
      
      // Update totals
      totalHT += itemHT;
      totalTVA += itemTVA;
      totalTTC += itemTTC;
      
      // 5. Update stock levels
      
      // 5.1. Reduce stock in source depot
      if (sourceStock) {
        sourceStock.qte -= qte;
        await stockRepo.save(sourceStock);
      }
      
      // 5.2. Find or create stock in destination depot
      let destStock = await stockRepo.findOne({
        where: {
          article_id: article_id,
          depot_id: destinationDepot.id
        }
      });
      
      if (destStock) {
        destStock.qte += qte;
      } else {
        destStock = stockRepo.create({
          article_id: article_id,
          depot_id: destinationDepot.id,
          qte: qte
        });
      }
      
      await stockRepo.save(destStock);
    }
    
    // 6. Save all transfer items
    await transferItemRepo.save(transferItems);
    
    // 7. Update transfer with totals and mark as completed
    savedTransfer.total_ht = totalHT;
    savedTransfer.total_tva = totalTVA;
    savedTransfer.total_ttc = totalTTC;
    savedTransfer.status = "Terminé";
    
    await transferRepo.save(savedTransfer);
    
    // 8. Update global article quantities
    for (const itemData of articles) {
      const { article_id } = itemData;
      
      const articleStocks = await stockRepo.find({
        where: { article_id: article_id }
      });
      
      const totalArticleStock = articleStocks.reduce((sum, stock) => sum + stock.qte, 0);
      await articleRepo.update(article_id, { qte: totalArticleStock });
    }
    
    await queryRunner.commitTransaction();
    
    // Fetch the complete transfer with relations
    const completeTransfer = await transferRepo.findOne({
      where: { id: savedTransfer.id },
      relations: [
        'items',
        'items.article',
        'items.article.categorie',
        'items.article.fournisseur'
      ]
    });
    
    res.status(201).json({
      success: true,
      data: completeTransfer,
      message: `Transfert ${numero} créé avec succès`
    });
    
  } catch (error) {
    await queryRunner.rollbackTransaction();
    console.error("❌ Error creating transfer:", error);
    res.status(500).json({
      success: false,
      message: error.message || "Erreur lors de la création du transfert"
    });
  } finally {
    await queryRunner.release();
  }
};

// UPDATE TRANSFER (Only if status is "En cours")
exports.updateTransfer = async (req, res) => {
  const queryRunner = AppDataSource.createQueryRunner();
  
  try {
    const { id } = req.params;
    const { 
      date_transfert, 
      description, 
      articles 
    } = req.body;
    
    await queryRunner.connect();
    await queryRunner.startTransaction();
    
    const transferRepo = queryRunner.manager.getRepository(Transfer);
    const transferItemRepo = queryRunner.manager.getRepository(TransferItem);
    const stockRepo = queryRunner.manager.getRepository(StockDepot);
    const articleRepo = queryRunner.manager.getRepository(Article);
    const depotRepo = queryRunner.manager.getRepository(Depot);
    
    // 1. Find existing transfer
    const transfer = await transferRepo.findOne({
      where: { id },
      relations: ['items']
    });
    
    if (!transfer) {
      return res.status(404).json({
        success: false,
        message: "Transfert non trouvé"
      });
    }
    
    // 2. Check if transfer can be modified
    if (transfer.status !== "En cours") {
      return res.status(400).json({
        success: false,
        message: `Le transfert ne peut pas être modifié car il est ${transfer.status}`
      });
    }
    
    // 3. Find depots
    const sourceDepot = await depotRepo.findOne({ where: { nom: transfer.depot_source } });
    const destinationDepot = await depotRepo.findOne({ where: { nom: transfer.depot_destination } });
    
    if (!sourceDepot || !destinationDepot) {
      throw new Error("Dépôt source ou destination non trouvé");
    }
    
    // 4. Revert old stock changes
    for (const oldItem of transfer.items) {
      // Revert source depot stock (add back what was removed)
      let sourceStock = await stockRepo.findOne({
        where: {
          article_id: oldItem.article_id,
          depot_id: sourceDepot.id
        }
      });
      
      if (sourceStock) {
        sourceStock.qte += oldItem.qte;
        await stockRepo.save(sourceStock);
      }
      
      // Revert destination depot stock (remove what was added)
      let destStock = await stockRepo.findOne({
        where: {
          article_id: oldItem.article_id,
          depot_id: destinationDepot.id
        }
      });
      
      if (destStock) {
        destStock.qte -= oldItem.qte;
        if (destStock.qte <= 0) {
          await stockRepo.delete(destStock.id);
        } else {
          await stockRepo.save(destStock);
        }
      }
    }
    
    // 5. Delete old transfer items
    await transferItemRepo.delete({ transfer_id: id });
    
    // 6. Process new articles (similar to create)
    let totalHT = 0;
    let totalTVA = 0;
    let totalTTC = 0;
    const newTransferItems = [];
    
    for (const itemData of articles) {
      const { article_id, qte } = itemData;
      
      if (!article_id || !qte || qte <= 0) {
        throw new Error("Données d'article invalides");
      }
      
      const article = await articleRepo.findOne({ where: { id: article_id } });
      
      if (!article) {
        throw new Error(`Article ID ${article_id} non trouvé`);
      }
      
      // Check stock availability
      const sourceStock = await stockRepo.findOne({
        where: {
          article_id: article_id,
          depot_id: sourceDepot.id
        }
      });
      
      const availableStock = sourceStock ? sourceStock.qte : 0;
      
      if (availableStock < qte) {
        throw new Error(`Stock insuffisant pour "${article.designation}". Disponible: ${availableStock}, Demandé: ${qte}`);
      }
      
      // Calculate values
      const pua_ht = parseFloat(article.pua_ht) || 0;
      const pua_ttc = parseFloat(article.pua_ttc) || 0;
      const tva = parseFloat(article.tva) || 19;
      
      const itemHT = qte * pua_ht;
      const itemTVA = itemHT * (tva / 100);
      const itemTTC = itemHT + itemTVA;
      
      // Create new transfer item
      const transferItem = transferItemRepo.create({
        transfer_id: id,
        article_id: article_id,
        qte: qte,
        pua_ht: pua_ht,
        pua_ttc: pua_ttc,
        tva: tva,
        total_ht: itemHT,
        total_tva: itemTVA,
        total_ttc: itemTTC
      });
      
      newTransferItems.push(transferItem);
      
      // Update totals
      totalHT += itemHT;
      totalTVA += itemTVA;
      totalTTC += itemTTC;
      
      // Update stock
      if (sourceStock) {
        sourceStock.qte -= qte;
        await stockRepo.save(sourceStock);
      }
      
      let destStock = await stockRepo.findOne({
        where: {
          article_id: article_id,
          depot_id: destinationDepot.id
        }
      });
      
      if (destStock) {
        destStock.qte += qte;
      } else {
        destStock = stockRepo.create({
          article_id: article_id,
          depot_id: destinationDepot.id,
          qte: qte
        });
      }
      
      await stockRepo.save(destStock);
    }
    
    // 7. Save new items
    await transferItemRepo.save(newTransferItems);
    
    // 8. Update transfer
    transfer.date_transfert = date_transfert || transfer.date_transfert;
    transfer.description = description || transfer.description;
    transfer.total_ht = totalHT;
    transfer.total_tva = totalTVA;
    transfer.total_ttc = totalTTC;
    transfer.article_count = articles.length;
    transfer.status = "Terminé";
    
    await transferRepo.save(transfer);
    
    // 9. Update global article quantities
    const uniqueArticleIds = [...new Set(articles.map(item => item.article_id))];
    
    for (const articleId of uniqueArticleIds) {
      const articleStocks = await stockRepo.find({
        where: { article_id: articleId }
      });
      
      const totalArticleStock = articleStocks.reduce((sum, stock) => sum + stock.qte, 0);
      await articleRepo.update(articleId, { qte: totalArticleStock });
    }
    
    await queryRunner.commitTransaction();
    
    // Fetch updated transfer
    const updatedTransfer = await transferRepo.findOne({
      where: { id },
      relations: [
        'items',
        'items.article',
        'items.article.categorie',
        'items.article.fournisseur'
      ]
    });
    
    res.status(200).json({
      success: true,
      data: updatedTransfer,
      message: `Transfert ${transfer.numero} mis à jour avec succès`
    });
    
  } catch (error) {
    await queryRunner.rollbackTransaction();
    console.error("Error updating transfer:", error);
    res.status(500).json({
      success: false,
      message: error.message || "Erreur lors de la mise à jour du transfert"
    });
  } finally {
    await queryRunner.release();
  }
};

// DELETE TRANSFER
exports.deleteTransfer = async (req, res) => {
  const queryRunner = AppDataSource.createQueryRunner();
  
  try {
    const { id } = req.params;
    
    await queryRunner.connect();
    await queryRunner.startTransaction();
    
    const transferRepo = queryRunner.manager.getRepository(Transfer);
    const transferItemRepo = queryRunner.manager.getRepository(TransferItem);
    const stockRepo = queryRunner.manager.getRepository(StockDepot);
    const articleRepo = queryRunner.manager.getRepository(Article);
    const depotRepo = queryRunner.manager.getRepository(Depot);
    
    // 1. Find transfer
    const transfer = await transferRepo.findOne({
      where: { id },
      relations: ['items']
    });
    
    if (!transfer) {
      return res.status(404).json({
        success: false,
        message: "Transfert non trouvé"
      });
    }
    
    // 2. Check if transfer can be deleted
    if (transfer.status !== "En cours") {
      return res.status(400).json({
        success: false,
        message: `Le transfert ne peut pas être supprimé car il est ${transfer.status}`
      });
    }
    
    // 3. Find depots
    const sourceDepot = await depotRepo.findOne({ where: { nom: transfer.depot_source } });
    const destinationDepot = await depotRepo.findOne({ where: { nom: transfer.depot_destination } });
    
    if (sourceDepot && destinationDepot) {
      // 4. Revert stock changes
      for (const item of transfer.items) {
        // Add back to source depot
        let sourceStock = await stockRepo.findOne({
          where: {
            article_id: item.article_id,
            depot_id: sourceDepot.id
          }
        });
        
        if (sourceStock) {
          sourceStock.qte += item.qte;
          await stockRepo.save(sourceStock);
        }
        
        // Remove from destination depot
        let destStock = await stockRepo.findOne({
          where: {
            article_id: item.article_id,
            depot_id: destinationDepot.id
          }
        });
        
        if (destStock) {
          destStock.qte -= item.qte;
          if (destStock.qte <= 0) {
            await stockRepo.delete(destStock.id);
          } else {
            await stockRepo.save(destStock);
          }
        }
        
        // Update global article quantity
        const articleStocks = await stockRepo.find({
          where: { article_id: item.article_id }
        });
        
        const totalArticleStock = articleStocks.reduce((sum, stock) => sum + stock.qte, 0);
        await articleRepo.update(item.article_id, { qte: totalArticleStock });
      }
    }
    
    // 5. Delete transfer items
    await transferItemRepo.delete({ transfer_id: id });
    
    // 6. Delete transfer
    await transferRepo.delete(id);
    
    await queryRunner.commitTransaction();
    
    res.status(200).json({
      success: true,
      message: `Transfert ${transfer.numero} supprimé avec succès`
    });
    
  } catch (error) {
    await queryRunner.rollbackTransaction();
    console.error("Error deleting transfer:", error);
    res.status(500).json({
      success: false,
      message: error.message || "Erreur lors de la suppression du transfert"
    });
  } finally {
    await queryRunner.release();
  }
};

// UPDATE TRANSFER STATUS
exports.updateTransferStatus = async (req, res) => {
  const queryRunner = AppDataSource.createQueryRunner();
  
  try {
    const { id } = req.params;
    const { status } = req.body;
    
    if (!["En cours", "Terminé", "Annulé"].includes(status)) {
      return res.status(400).json({
        success: false,
        message: "Status invalide"
      });
    }
    
    await queryRunner.connect();
    await queryRunner.startTransaction();
    
    const transferRepo = queryRunner.manager.getRepository(Transfer);
    const stockRepo = queryRunner.manager.getRepository(StockDepot);
    const articleRepo = queryRunner.manager.getRepository(Article);
    const depotRepo = queryRunner.manager.getRepository(Depot);
    
    // 1. Find transfer
    const transfer = await transferRepo.findOne({
      where: { id },
      relations: ['items']
    });
    
    if (!transfer) {
      return res.status(404).json({
        success: false,
        message: "Transfert non trouvé"
      });
    }
    
    const oldStatus = transfer.status;
    transfer.status = status;
    
    // 2. Handle status changes
    if (oldStatus === "En cours" && status === "Annulé") {
      // If cancelling an in-progress transfer, revert stock
      const sourceDepot = await depotRepo.findOne({ where: { nom: transfer.depot_source } });
      const destinationDepot = await depotRepo.findOne({ where: { nom: transfer.depot_destination } });
      
      if (sourceDepot && destinationDepot) {
        for (const item of transfer.items) {
          // Add back to source
          let sourceStock = await stockRepo.findOne({
            where: {
              article_id: item.article_id,
              depot_id: sourceDepot.id
            }
          });
          
          if (sourceStock) {
            sourceStock.qte += item.qte;
            await stockRepo.save(sourceStock);
          }
          
          // Remove from destination
          let destStock = await stockRepo.findOne({
            where: {
              article_id: item.article_id,
              depot_id: destinationDepot.id
            }
          });
          
          if (destStock) {
            destStock.qte -= item.qte;
            if (destStock.qte <= 0) {
              await stockRepo.delete(destStock.id);
            } else {
              await stockRepo.save(destStock);
            }
          }
          
          // Update global quantity
          const articleStocks = await stockRepo.find({
            where: { article_id: item.article_id }
          });
          
          const totalArticleStock = articleStocks.reduce((sum, stock) => sum + stock.qte, 0);
          await articleRepo.update(item.article_id, { qte: totalArticleStock });
        }
      }
    } else if (oldStatus === "Annulé" && status === "Terminé") {
      // If reactivating a cancelled transfer, apply stock changes
      const sourceDepot = await depotRepo.findOne({ where: { nom: transfer.depot_source } });
      const destinationDepot = await depotRepo.findOne({ where: { nom: transfer.depot_destination } });
      
      if (sourceDepot && destinationDepot) {
        for (const item of transfer.items) {
          // Check source stock availability
          let sourceStock = await stockRepo.findOne({
            where: {
              article_id: item.article_id,
              depot_id: sourceDepot.id
            }
          });
          
          const availableStock = sourceStock ? sourceStock.qte : 0;
          
          if (availableStock < item.qte) {
            throw new Error(`Stock insuffisant pour article ID ${item.article_id}. Disponible: ${availableStock}, Transfert: ${item.qte}`);
          }
          
          // Remove from source
          if (sourceStock) {
            sourceStock.qte -= item.qte;
            await stockRepo.save(sourceStock);
          }
          
          // Add to destination
          let destStock = await stockRepo.findOne({
            where: {
              article_id: item.article_id,
              depot_id: destinationDepot.id
            }
          });
          
          if (destStock) {
            destStock.qte += item.qte;
          } else {
            destStock = stockRepo.create({
              article_id: item.article_id,
              depot_id: destinationDepot.id,
              qte: item.qte
            });
          }
          
          await stockRepo.save(destStock);
          
          // Update global quantity
          const articleStocks = await stockRepo.find({
            where: { article_id: item.article_id }
          });
          
          const totalArticleStock = articleStocks.reduce((sum, stock) => sum + stock.qte, 0);
          await articleRepo.update(item.article_id, { qte: totalArticleStock });
        }
      }
    }
    
    await transferRepo.save(transfer);
    
    await queryRunner.commitTransaction();
    
    res.status(200).json({
      success: true,
      data: transfer,
      message: `Status du transfert mis à jour à "${status}"`
    });
    
  } catch (error) {
    await queryRunner.rollbackTransaction();
    console.error("Error updating transfer status:", error);
    res.status(500).json({
      success: false,
      message: error.message || "Erreur lors de la mise à jour du status"
    });
  } finally {
    await queryRunner.release();
  }
};