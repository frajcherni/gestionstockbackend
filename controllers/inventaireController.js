// controllers/InventaireController.js
const { Inventaire, InventaireItem } = require('../entities/Inventaire');
const { Article } = require("../entities/Article");
const { Depot } = require("../entities/Depot");
const { StockDepot } = require("../entities/StockDepot");
const { AppDataSource } = require("../db");

// Get all inventaires
exports.getAllInventaires = async (req, res) => {
    try {
        const inventaireRepo = AppDataSource.getRepository(Inventaire);
        
        const inventaires = await inventaireRepo.find({
            relations: ['items', 'items.article'],
            order: { created_at: 'DESC' }
        });

        res.status(200).json({
            success: true,
            data: inventaires,
            message: "Inventaires récupérés avec succès"
        });
    } catch (error) {
        console.error("Error fetching inventaires:", error);
        res.status(500).json({
            success: false,
            message: "Erreur lors de la récupération des inventaires"
        });
    }
};
// Create new inventaire (ERP Standard)
exports.createInventaire = async (req, res) => {
    const queryRunner = AppDataSource.createQueryRunner();
    
    try {
        const { numero, date, date_inventaire, depot, description, articles } = req.body;

        // Validate
        if (!numero || !date || !date_inventaire || !depot || !articles || !Array.isArray(articles) || articles.length === 0) {
            return res.status(400).json({
                success: false,
                message: "Données invalides"
            });
        }

        // Start transaction
        await queryRunner.connect();
        await queryRunner.startTransaction();

        const inventaireRepo = queryRunner.manager.getRepository(Inventaire);
        const inventaireItemRepo = queryRunner.manager.getRepository(InventaireItem);
        const articleRepo = queryRunner.manager.getRepository(Article);
        const depotRepo = queryRunner.manager.getRepository(Depot);
        const stockRepo = queryRunner.manager.getRepository(StockDepot);

        // Check if inventaire number exists
        const existingInventaire = await inventaireRepo.findOne({ where: { numero } });
        if (existingInventaire) {
            return res.status(400).json({
                success: false,
                message: "Numéro d'inventaire déjà utilisé"
            });
        }

        // Get depot
        const depotEntity = await depotRepo.findOne({ where: { nom: depot } });
        if (!depotEntity) {
            return res.status(400).json({
                success: false,
                message: `Dépôt "${depot}" non trouvé`
            });
        }

        // Create inventaire
        const newInventaire = inventaireRepo.create({
            numero,
            date,
            date_inventaire,
            depot,
            description: description || "",
            status: "Terminé",
            article_count: 0, // We'll count unique articles
            total_ht: 0,
            total_ttc: 0,
            total_tva: 0
        });

        await inventaireRepo.save(newInventaire);

        let totalHT = 0;
        let totalTVA = 0;
        let totalTTC = 0;
        
        // Use a Map to track unique articles and their quantities
        const articleQuantities = new Map();
        
        // First, aggregate quantities by article_id
        for (let i = articles.length - 1; i >= 0; i--) {
            const { article_id, qte_reel } = articles[i];
            
            if (articleQuantities.has(article_id)) {
                // Add to existing quantity
                articleQuantities.set(article_id, articleQuantities.get(article_id) + qte_reel);
            } else {
                // New article
                articleQuantities.set(article_id, qte_reel);
            }
        }

        // Process unique articles
        for (const [article_id, qte_reel] of articleQuantities) {
            const article = await articleRepo.findOne({ where: { id: article_id } });
            if (!article) {
                throw new Error(`Article ${article_id} non trouvé`);
            }

            // ✅ ERP STANDARD: Get current stock before inventaire
            let stockDepot = await stockRepo.findOne({
                where: {
                    article_id: article_id,
                    depot_id: depotEntity.id
                }
            });
            
            const qte_avant = stockDepot ? stockDepot.qte : 0;
            const qte_ajustement = qte_reel - qte_avant; // ERP formula: counted - system

            // ✅ Check for negative stock after adjustment
            if (stockDepot) {
                const newQte = stockDepot.qte + qte_ajustement;
                if (newQte < 0) {
                    throw new Error(`Article ${article.reference}: Stock insuffisant. Stock actuel: ${stockDepot.qte}, ajustement: ${qte_ajustement}`);
                }
            }

            // Calculate prices
            const pua_ht = parseFloat(article.pua_ht) || 0;
            const tva_rate = parseFloat(article.tva) || 19;
            const total_ht = pua_ht * qte_reel;
            const total_tva = total_ht * (tva_rate / 100);
            const total_ttc = total_ht + total_tva;

            // ✅ Create inventaire item with before/after quantities
            const inventaireItem = inventaireItemRepo.create({
                inventaire_id: newInventaire.id,
                article_id,
                qte_avant,          // Stock before inventaire
                qte_reel,           // Counted quantity
                qte_ajustement,     // Adjustment (could be + or -)
                pua_ht,
                pua_ttc: pua_ht * (1 + (tva_rate / 100)),
                tva: tva_rate,
                total_tva,
                total_ht,
                total_ttc
            });

            await inventaireItemRepo.save(inventaireItem);

            // Update totals
            totalHT += total_ht;
            totalTVA += total_tva;
            totalTTC += total_ttc;

            // ✅ ERP STANDARD: Apply adjustment to stock
            if (!stockDepot) {
                stockDepot = stockRepo.create({
                    article_id: article_id,
                    depot_id: depotEntity.id,
                    qte: qte_reel // New stock = counted quantity
                });
            } else {
                // Apply adjustment: New Stock = Old Stock + Adjustment
                stockDepot.qte += qte_ajustement;
            }
            
            await stockRepo.save(stockDepot);
        }

        // Update global article quantities
        for (const [article_id, qte_reel] of articleQuantities) {
            const allDepotStocks = await stockRepo.find({ where: { article_id: article_id } });
            const totalArticleStock = allDepotStocks.reduce((sum, stock) => sum + (stock.qte || 0), 0);
            
            await articleRepo.update(
                { id: article_id },
                { qte: totalArticleStock }
            );
        }

        // Update inventaire counts and totals
        newInventaire.article_count = articleQuantities.size;
        newInventaire.total_ht = totalHT;
        newInventaire.total_tva = totalTVA;
        newInventaire.total_ttc = totalTTC;
        await inventaireRepo.save(newInventaire);

        // Commit transaction
        await queryRunner.commitTransaction();

        // Return created inventaire
        const completeInventaire = await inventaireRepo.findOne({
            where: { id: newInventaire.id },
            relations: ['items', 'items.article']
        });

        res.status(201).json({
            success: true,
            data: completeInventaire,
            message: "Inventaire créé avec succès"
        });

    } catch (error) {
        await queryRunner.rollbackTransaction();
        console.error("Error creating inventaire:", error);
        res.status(500).json({
            success: false,
            message: error.message || "Erreur lors de la création de l'inventaire"
        });
    } finally {
        await queryRunner.release();
    }
};

// Update inventaire
exports.updateInventaire = async (req, res) => {
    const queryRunner = AppDataSource.createQueryRunner();
    
    try {
        const { id } = req.params;
        const { numero, date, date_inventaire, depot, description, articles } = req.body;

        await queryRunner.connect();
        await queryRunner.startTransaction();

        const inventaireRepo = queryRunner.manager.getRepository(Inventaire);
        const inventaireItemRepo = queryRunner.manager.getRepository(InventaireItem);
        const articleRepo = queryRunner.manager.getRepository(Article);
        const depotRepo = queryRunner.manager.getRepository(Depot);
        const stockRepo = queryRunner.manager.getRepository(StockDepot);

        // Find existing inventaire with items
        const existingInventaire = await inventaireRepo.findOne({
            where: { id },
            relations: ['items']
        });

        if (!existingInventaire) {
            return res.status(404).json({
                success: false,
                message: "Inventaire non trouvé"
            });
        }

        // ✅ Block depot change
        if (depot && depot !== existingInventaire.depot) {
            return res.status(400).json({
                success: false,
                message: "Modification du dépôt non autorisée."
            });
        }

        // Get depot (use existing)
        const depotEntity = await depotRepo.findOne({ 
            where: { nom: existingInventaire.depot } 
        });

        if (!depotEntity) {
            return res.status(400).json({
                success: false,
                message: "Dépôt non trouvé"
            });
        }

        // ================================================
        // 🚨 ERP CRITICAL LOGIC: CANCEL THEN RECREATE
        // ================================================
        
        // STEP 1: CANCEL existing inventory (reverse all adjustments)
        const existingItems = existingInventaire.items || [];
        
        for (const item of existingItems) {
            const stockDepot = await stockRepo.findOne({
                where: {
                    article_id: item.article_id,
                    depot_id: depotEntity.id
                }
            });
            
            if (stockDepot) {
                // REVERSE the original adjustment
                // Original: stock += qte_ajustement
                // Cancel: stock -= qte_ajustement
                stockDepot.qte -= item.qte_ajustement || 0;
                await stockRepo.save(stockDepot);
            }
            
            // Update global article quantity for this article
            const allDepotStocks = await stockRepo.find({ 
                where: { article_id: item.article_id } 
            });
            const totalArticleStock = allDepotStocks.reduce((sum, stock) => sum + (stock.qte || 0), 0);
            
            await articleRepo.update(
                { id: item.article_id },
                { qte: totalArticleStock }
            );
        }
        
        // Delete all existing inventory items
        await inventaireItemRepo.delete({ inventaire_id: id });
        
        // ================================================
        // STEP 2: CREATE NEW inventory items
        // ================================================
        
        let totalHT = 0;
        let totalTVA = 0;
        let totalTTC = 0;
        const articleIdsToUpdate = new Set();

        if (articles && Array.isArray(articles)) {
            // Aggregate quantities by article_id (to handle duplicates)
            const articleQuantities = new Map();
            
            for (let i = articles.length - 1; i >= 0; i--) {
                const { article_id, qte_reel } = articles[i];
                
                if (articleQuantities.has(article_id)) {
                    articleQuantities.set(article_id, articleQuantities.get(article_id) + qte_reel);
                } else {
                    articleQuantities.set(article_id, qte_reel);
                }
            }

            // Process each unique article
            for (const [article_id, qte_reel] of articleQuantities) {
                const article = await articleRepo.findOne({ where: { id: article_id } });
                if (!article) continue;

                articleIdsToUpdate.add(article_id);

                // ✅ Get CURRENT STOCK (after cancellation)
                const stockDepot = await stockRepo.findOne({
                    where: {
                        article_id: article_id,
                        depot_id: depotEntity.id
                    }
                });
                
                const currentStockQty = stockDepot ? stockDepot.qte : 0;
                
                // Calculate adjustment based on CURRENT stock
                const qte_avant = currentStockQty;
                const qte_ajustement = qte_reel - qte_avant;

                // Calculate prices
                const pua_ht = parseFloat(article.pua_ht) || 0;
                const tva_rate = parseFloat(article.tva) || 19;
                const total_ht = pua_ht * qte_reel;
                const total_tva = total_ht * (tva_rate / 100);
                const total_ttc = total_ht + total_tva;

                // Create new inventory item
                const inventaireItem = inventaireItemRepo.create({
                    inventaire_id: id,
                    article_id,
                    qte_avant,
                    qte_reel,
                    qte_ajustement,
                    pua_ht,
                    pua_ttc: pua_ht * (1 + (tva_rate / 100)),
                    tva: tva_rate,
                    total_tva,
                    total_ht,
                    total_ttc
                });

                await inventaireItemRepo.save(inventaireItem);

                // Update totals
                totalHT += total_ht;
                totalTVA += total_tva;
                totalTTC += total_ttc;

                // ✅ Apply new adjustment to stock
                if (!stockDepot) {
                    // New article in this depot
                    const newStock = stockRepo.create({
                        article_id: article_id,
                        depot_id: depotEntity.id,
                        qte: qte_reel
                    });
                    await stockRepo.save(newStock);
                } else {
                    stockDepot.qte += qte_ajustement;
                    await stockRepo.save(stockDepot);
                }
            }

            existingInventaire.article_count = articleQuantities.size;
        }

        // Update inventaire header
        existingInventaire.total_ht = totalHT;
        existingInventaire.total_tva = totalTVA;
        existingInventaire.total_ttc = totalTTC;
        existingInventaire.updated_at = new Date();
        
        // Update other fields if provided
        if (numero) existingInventaire.numero = numero;
        if (date) existingInventaire.date = date;
        if (date_inventaire) existingInventaire.date_inventaire = date_inventaire;
        if (description !== undefined) existingInventaire.description = description;

        await inventaireRepo.save(existingInventaire);

        // UPDATE GLOBAL ARTICLE QUANTITIES
        for (const articleId of articleIdsToUpdate) {
            const allDepotStocks = await stockRepo.find({ where: { article_id: articleId } });
            const totalArticleStock = allDepotStocks.reduce((sum, stock) => sum + (stock.qte || 0), 0);
            
            await articleRepo.update(
                { id: articleId },
                { qte: totalArticleStock }
            );
        }

        await queryRunner.commitTransaction();

        // Return updated inventaire
        const updatedInventaire = await inventaireRepo.findOne({
            where: { id },
            relations: ['items', 'items.article']
        });

        res.status(200).json({
            success: true,
            data: updatedInventaire,
            message: "Inventaire mis à jour avec succès (ERP logique: annulation + recréation)"
        });

    } catch (error) {
        await queryRunner.rollbackTransaction();
        console.error("Error updating inventaire:", error);
        res.status(500).json({
            success: false,
            message: error.message || "Erreur lors de la mise à jour de l'inventaire"
        });
    } finally {
        await queryRunner.release();
    }
};
// Delete inventaire (ERP Standard - Reverse Adjustment)
exports.deleteInventaire = async (req, res) => {
    const queryRunner = AppDataSource.createQueryRunner();
    
    try {
        const { id } = req.params;

        await queryRunner.connect();
        await queryRunner.startTransaction();

        const inventaireRepo = queryRunner.manager.getRepository(Inventaire);
        const inventaireItemRepo = queryRunner.manager.getRepository(InventaireItem);
        const articleRepo = queryRunner.manager.getRepository(Article);
        const depotRepo = queryRunner.manager.getRepository(Depot);
        const stockRepo = queryRunner.manager.getRepository(StockDepot);

        // Find inventaire with items
        const inventaire = await inventaireRepo.findOne({
            where: { id },
            relations: ['items']
        });

        if (!inventaire) {
            return res.status(404).json({
                success: false,
                message: "Inventaire non trouvé"
            });
        }

        // Get depot
        const depotEntity = await depotRepo.findOne({ 
            where: { nom: inventaire.depot } 
        });

        if (!depotEntity) {
            return res.status(400).json({
                success: false,
                message: "Dépôt non trouvé"
            });
        }

        // ✅ ERP STANDARD: Reverse adjustments for each item
        for (const item of inventaire.items || []) {
            const stockDepot = await stockRepo.findOne({
                where: {
                    article_id: item.article_id,
                    depot_id: depotEntity.id
                }
            });

            if (stockDepot) {
                // ✅ Reverse the adjustment: Current Stock - Adjustment
                stockDepot.qte -= item.qte_ajustement || 0;
                
                // Check for negative stock (shouldn't happen if system is consistent)
                if (stockDepot.qte < 0) {
                    throw new Error(`Article ${item.article_id}: Annulation impossible - stock deviendrait négatif`);
                }
                
                // If stock becomes 0 and was created by this inventaire, delete it
                if (stockDepot.qte === 0 && item.qte_avant === 0) {
                    await stockRepo.delete({ id: stockDepot.id });
                } else {
                    await stockRepo.save(stockDepot);
                }
            }
            
            // Update global article quantity
            const allDepotStocks = await stockRepo.find({ where: { article_id: item.article_id } });
            const totalArticleStock = allDepotStocks.reduce((sum, stock) => sum + (stock.qte || 0), 0);
            
            await articleRepo.update(
                { id: item.article_id },
                { qte: totalArticleStock }
            );
        }

        // Delete inventaire items
        await inventaireItemRepo.delete({ inventaire_id: id });
        
        // Delete inventaire
        await inventaireRepo.delete(id);

        await queryRunner.commitTransaction();

        res.status(200).json({
            success: true,
            message: "Inventaire supprimé avec succès"
        });

    } catch (error) {
        await queryRunner.rollbackTransaction();
        console.error("Error deleting inventaire:", error);
        res.status(500).json({
            success: false,
            message: error.message || "Erreur lors de la suppression de l'inventaire"
        });
    } finally {
        await queryRunner.release();
    }
};