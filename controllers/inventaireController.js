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

// Create new inventaire
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
            article_count: articles.length,
            total_ht: 0,
            total_ttc: 0,
            total_tva: 0
        });

        await inventaireRepo.save(newInventaire);

        let totalHT = 0;
        let totalTVA = 0;
        let totalTTC = 0;

        // Process articles in reverse order
        for (let i = articles.length - 1; i >= 0; i--) {
            const { article_id, qte_reel } = articles[i];

            const article = await articleRepo.findOne({ where: { id: article_id } });
            if (!article) {
                throw new Error(`Article ${article_id} non trouvé`);
            }

            // Calculate prices
            const pua_ht = parseFloat(article.pua_ht) || 0;
            const tva_rate = parseFloat(article.tva) || 19;
            const total_ht = pua_ht * qte_reel;
            const total_tva = total_ht * (tva_rate / 100);
            const total_ttc = total_ht + total_tva;

            // Create inventaire item
            const inventaireItem = inventaireItemRepo.create({
                inventaire_id: newInventaire.id,
                article_id,
                qte_reel,
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

            // Update depot stock
            let stockDepot = await stockRepo.findOne({
                where: {
                    article_id: article_id,
                    depot_id: depotEntity.id
                }
            });

            if (!stockDepot) {
                stockDepot = stockRepo.create({
                    article_id: article_id,
                    depot_id: depotEntity.id,
                    qte: qte_reel
                });
            } else {
                stockDepot.qte = qte_reel;
            }
            
            await stockRepo.save(stockDepot);

            // Update global article quantity
            const allDepotStocks = await stockRepo.find({ where: { article_id: article_id } });
            const totalArticleStock = allDepotStocks.reduce((sum, stock) => sum + stock.qte, 0);
            article.qte = totalArticleStock;
            await articleRepo.save(article);
        }

        // Update inventaire totals
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

        // Find existing inventaire
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

        // Get depot (existing or new)
        let depotEntity = await depotRepo.findOne({ 
            where: { nom: depot || existingInventaire.depot } 
        });

        if (!depotEntity) {
            return res.status(400).json({
                success: false,
                message: "Dépôt non trouvé"
            });
        }

        // Update basic info
        if (numero) existingInventaire.numero = numero;
        if (date) existingInventaire.date = date;
        if (date_inventaire) existingInventaire.date_inventaire = date_inventaire;
        if (depot) existingInventaire.depot = depot;
        if (description !== undefined) existingInventaire.description = description;

        let totalHT = 0;
        let totalTVA = 0;
        let totalTTC = 0;

        // Update articles if provided
        if (articles && Array.isArray(articles)) {
            // Delete old items
            await inventaireItemRepo.delete({ inventaire_id: id });

            // Add new items
            for (let i = articles.length - 1; i >= 0; i--) {
                const { article_id, qte_reel } = articles[i];

                const article = await articleRepo.findOne({ where: { id: article_id } });
                if (!article) continue;

                // Calculate prices
                const pua_ht = parseFloat(article.pua_ht) || 0;
                const tva_rate = parseFloat(article.tva) || 19;
                const total_ht = pua_ht * qte_reel;
                const total_tva = total_ht * (tva_rate / 100);
                const total_ttc = total_ht + total_tva;

                // Create item
                const inventaireItem = inventaireItemRepo.create({
                    inventaire_id: id,
                    article_id,
                    qte_reel,
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

                // Update depot stock
                let stockDepot = await stockRepo.findOne({
                    where: {
                        article_id: article_id,
                        depot_id: depotEntity.id
                    }
                });

                if (!stockDepot) {
                    stockDepot = stockRepo.create({
                        article_id: article_id,
                        depot_id: depotEntity.id,
                        qte: qte_reel
                    });
                } else {
                    stockDepot.qte = qte_reel;
                }
                
                await stockRepo.save(stockDepot);

                // Update global article quantity
                const allDepotStocks = await stockRepo.find({ where: { article_id: article_id } });
                const totalArticleStock = allDepotStocks.reduce((sum, stock) => sum + stock.qte, 0);
                article.qte = totalArticleStock;
                await articleRepo.save(article);
            }

            existingInventaire.article_count = articles.length;
        }

        // Update totals
        existingInventaire.total_ht = totalHT;
        existingInventaire.total_tva = totalTVA;
        existingInventaire.total_ttc = totalTTC;
        existingInventaire.updated_at = new Date();

        await inventaireRepo.save(existingInventaire);

        await queryRunner.commitTransaction();

        // Return updated inventaire
        const updatedInventaire = await inventaireRepo.findOne({
            where: { id },
            relations: ['items', 'items.article']
        });

        res.status(200).json({
            success: true,
            data: updatedInventaire,
            message: "Inventaire mis à jour avec succès"
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

// Delete inventaire
// Delete inventaire
exports.deleteInventaire = async (req, res) => {
    const queryRunner = AppDataSource.createQueryRunner();
    
    try {
        const { id } = req.params;

        console.log("Delete request received:", { 
            paramsId: id, 
            idType: typeof id 
        });

        // Convert id to number
        const inventaireId = parseInt(id);
        if (isNaN(inventaireId)) {
            return res.status(400).json({
                success: false,
                message: "ID d'inventaire invalide"
            });
        }

        await queryRunner.connect();
        await queryRunner.startTransaction();

        const inventaireRepo = queryRunner.manager.getRepository(Inventaire);
        const inventaireItemRepo = queryRunner.manager.getRepository(InventaireItem);
        const articleRepo = queryRunner.manager.getRepository(Article);
        const depotRepo = queryRunner.manager.getRepository(Depot);
        const stockRepo = queryRunner.manager.getRepository(StockDepot);

        // Find inventaire - use parsed integer ID
        const inventaire = await inventaireRepo.findOne({
            where: { id: inventaireId },
            relations: ['items']
        });

        console.log("Found inventaire to delete:", inventaire);

        if (!inventaire) {
            return res.status(404).json({
                success: false,
                message: `Inventaire avec ID ${inventaireId} non trouvé`
            });
        }

        // Get depot
        const depotEntity = await depotRepo.findOne({ 
            where: { nom: inventaire.depot } 
        });

        console.log("Found depot for deletion:", depotEntity);

        // Update stock (set to 0)
        if (depotEntity && inventaire.items) {
            console.log("Processing items for stock update:", inventaire.items.length);
            
            for (const item of inventaire.items) {
                console.log(`Processing item ${item.id} for article ${item.article_id}`);
                
                let stockDepot = await stockRepo.findOne({
                    where: {
                        article_id: item.article_id,
                        depot_id: depotEntity.id
                    }
                });

                if (stockDepot) {
                    stockDepot.qte = 0;
                    await stockRepo.save(stockDepot);
                    console.log(`Set stock to 0 for article ${item.article_id} in depot ${depotEntity.nom}`);
                } else {
                    console.log(`No stock found for article ${item.article_id} in depot ${depotEntity.nom}`);
                }

                // Update global article quantity
                const article = await articleRepo.findOne({ where: { id: item.article_id } });
                if (article) {
                    const allDepotStocks = await stockRepo.find({ where: { article_id: item.article_id } });
                    const totalArticleStock = allDepotStocks.reduce((sum, stock) => sum + stock.qte, 0);
                    article.qte = totalArticleStock;
                    await articleRepo.save(article);
                    console.log(`Updated global qte for article ${item.article_id} to ${totalArticleStock}`);
                }
            }
        } else {
            console.log("No depot or items found for this inventaire");
        }

        // Delete items
        const deletedItems = await inventaireItemRepo.delete({ inventaire_id: inventaireId });
        console.log(`Deleted ${deletedItems.affected} inventaire items`);
        
        // Delete inventaire
        await inventaireRepo.delete(inventaireId);
        console.log(`Deleted inventaire ${inventaireId}`);

        await queryRunner.commitTransaction();
        console.log("Delete transaction committed");

        res.status(200).json({
            success: true,
            message: `Inventaire ${inventaire.numero} supprimé avec succès`
        });

    } catch (error) {
        await queryRunner.rollbackTransaction();
        console.error("Error deleting inventaire:", error);
        res.status(500).json({
            success: false,
            message: "Erreur lors de la suppression de l'inventaire"
        });
    } finally {
        await queryRunner.release();
    }
};