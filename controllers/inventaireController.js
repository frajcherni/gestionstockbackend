// controllers/InventaireController.js
const { Inventaire, InventaireItem } = require('../entities/Inventaire');
const { Article } = require("../entities/Article");
const { Depot } = require("../entities/Depot");
const { StockDepot } = require("../entities/StockDepot");
const { AppDataSource } = require("../db");
const { In } = require('typeorm');

// Helper: safely convert any value to integer (returns 0 for NaN/null/undefined)
const toInt = (v) => { const n = Math.round(parseFloat(v)); return isNaN(n) ? 0 : n; };

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
exports.createInventaire = async (req, res) => {
    const queryRunner = AppDataSource.createQueryRunner();

    try {
        const { numero, date, date_inventaire, depot, description, articles } = req.body;

        // Simple validation
        if (!numero || !date || !date_inventaire || !depot || !articles || !Array.isArray(articles) || articles.length === 0) {
            return res.status(400).json({
                success: false,
                message: "Données invalides"
            });
        }

        await queryRunner.connect();
        await queryRunner.startTransaction();

        const inventaireRepo    = queryRunner.manager.getRepository(Inventaire);
        const inventaireItemRepo = queryRunner.manager.getRepository(InventaireItem);
        const articleRepo       = queryRunner.manager.getRepository(Article);
        const depotRepo         = queryRunner.manager.getRepository(Depot);
        const stockRepo         = queryRunner.manager.getRepository(StockDepot);

        // Check if numero exists
        const existingInventaire = await inventaireRepo.findOne({ where: { numero } });
        if (existingInventaire) {
            return res.status(400).json({
                success: false,
                message: "Numéro d'inventaire déjà utilisé"
            });
        }

        // ── Resolve depot entity ──────────────────────────────────────────────
        const depotEntity = await depotRepo.findOne({ where: { nom: depot } });
        if (!depotEntity) {
            return res.status(400).json({
                success: false,
                message: `Dépôt "${depot}" introuvable`
            });
        }

        // ── Create inventaire header ──────────────────────────────────────────
        const newInventaire = inventaireRepo.create({
            numero,
            date,
            date_inventaire,
            depot,
            description: description || "",
            status: "Terminé",
            article_count: articles.length,
            total_ht:  0,
            total_ttc: 0,
            total_tva: 0
        });
        await inventaireRepo.save(newInventaire);

        // ── Create items + accumulate totals & per-article qte ────────────────
        let totalHT  = 0;
        let totalTVA = 0;
        let totalTTC = 0;

        // Map: article_id → total qte_reel (multiple lines of same article sum up)
        const articleQteMap = new Map();

        for (const item of articles) {
            const { article_id, ligne_numero } = item;
            const qte_reel = toInt(item.qte_reel); // force integer

            const article = await articleRepo.findOne({ where: { id: article_id } });
            if (!article) {
                console.warn(`Article ${article_id} non trouvé, ignoré`);
                continue;
            }

            // ── Read current stock before inventory (qte_avant) ───────────────
            const existingStock = await stockRepo.findOne({
                where: { article_id, depot_id: depotEntity.id }
            });
            const qte_avant     = existingStock ? toInt(existingStock.qte) : 0;
            const qte_ajustement = qte_reel - qte_avant;

            const pua_ht    = parseFloat(article.pua_ht) || 0;
            const tva_rate  = parseFloat(article.tva)    || 19;
            const total_ht  = pua_ht * qte_reel;
            const total_tva = total_ht * (tva_rate / 100);
            const total_ttc = total_ht + total_tva;

            totalHT  += total_ht;
            totalTVA += total_tva;
            totalTTC += total_ttc;

            // Accumulate qte per article (same article may appear on several lines)
            articleQteMap.set(article_id, (articleQteMap.get(article_id) || 0) + qte_reel);

            await inventaireItemRepo.save(inventaireItemRepo.create({
                inventaire_id:  newInventaire.id,
                article_id,
                ligne_numero:   ligne_numero || 0,
                qte_avant,
                qte_reel,
                qte_ajustement,
                pua_ht,
                pua_ttc:  pua_ht * (1 + tva_rate / 100),
                tva:      tva_rate,
                total_tva,
                total_ht,
                total_ttc
            }));
        }

        // ── Update inventaire totals ───────────────────────────────────────────
        newInventaire.total_ht  = totalHT;
        newInventaire.total_tva = totalTVA;
        newInventaire.total_ttc = totalTTC;
        await inventaireRepo.save(newInventaire);

        // ── Upsert StockDepot + update Article.qte ────────────────────────────
        for (const [articleId, totalQte] of articleQteMap) {
            // Find or create the stock_depot row for this article + depot
            let stockDepot = await stockRepo.findOne({
                where: { article_id: articleId, depot_id: depotEntity.id }
            });

            if (stockDepot) {
                // Set stock to the real counted quantity (replace, not add)
                stockDepot.qte = Math.round(totalQte);
            } else {
                stockDepot = stockRepo.create({
                    article_id: articleId,
                    depot_id:   depotEntity.id,
                    qte:        Math.round(totalQte)
                });
            }
            await stockRepo.save(stockDepot);
            console.log(`✅ StockDepot mis à jour: article ${articleId}, dépôt "${depot}" → ${Math.round(totalQte)}`);

            // Recalculate global article.qte = sum across ALL depots
            const allDepotStocks = await stockRepo.find({ where: { article_id: articleId } });
            const globalQte = allDepotStocks.reduce((sum, s) => sum + (parseInt(s.qte) || 0), 0);
            await articleRepo.update({ id: articleId }, { qte: globalQte });

            console.log(`✅ Article.qte mis à jour: article ${articleId}, global → ${globalQte}`);
        }

        await queryRunner.commitTransaction();

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
// controllers/InventaireController.js - updateInventaire CORRIGÉ
exports.updateInventaire = async (req, res) => {
    const queryRunner = AppDataSource.createQueryRunner();

    try {
        const { id } = req.params;
        const { numero, date, date_inventaire, depot, description, articles } = req.body;

        console.log("🚨 Début updateInventaire - ID:", id);
        console.log("📦 Articles reçus:", articles);

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

        console.log("✅ Inventaire trouvé:", existingInventaire.numero);
        console.log("📋 Items existants:", existingInventaire.items?.length);

        // Block depot change
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

        console.log("✅ Dépôt trouvé:", depotEntity.nom);

        // ================================================
        // 🚨 ÉTAPE 1: ANNULER l'inventaire existant
        // ================================================
        console.log("🔄 Annulation de l'inventaire existant...");

        // Map pour suivre les ajustements par article
        const articleAdjustments = new Map();

        for (const item of existingInventaire.items || []) {
            const currentAdjustment = articleAdjustments.get(item.article_id) || 0;
            articleAdjustments.set(item.article_id, currentAdjustment + toInt(item.qte_ajustement));
            console.log(`Item existant: article ${item.article_id}, qte_reel: ${item.qte_reel}, ajustement: ${item.qte_ajustement}`);
        }

        // Annuler les ajustements dans le stock
        for (const [articleId, totalAdjustment] of articleAdjustments) {
            const stockDepot = await stockRepo.findOne({
                where: {
                    article_id: articleId,
                    depot_id: depotEntity.id
                }
            });

            if (stockDepot) {
                stockDepot.qte = toInt(stockDepot.qte) - totalAdjustment;
                await stockRepo.save(stockDepot);
                console.log(`✅ Stock annulé article ${articleId}: ajustement -${totalAdjustment}, nouveau stock: ${stockDepot.qte}`);
            }
        }

        // ================================================
        // 🚨 ÉTAPE 2: METTRE À JOUR LES ITEMS EXISTANTS
        // ================================================
        let totalHT = 0;
        let totalTVA = 0;
        let totalTTC = 0;

        if (articles && Array.isArray(articles) && articles.length > 0) {
            console.log(`📊 Traitement de ${articles.length} articles...`);

            // Créer un map des items existants par ligne_numero
            const existingItemsMap = new Map();
            for (const item of existingInventaire.items || []) {
                if (item.ligne_numero) {
                    existingItemsMap.set(item.ligne_numero, item);
                }
            }

            console.log("📌 Items existants par ligne:", Array.from(existingItemsMap.keys()));

            // Calculer les totaux par article POUR LES NOUVELLES QUANTITÉS
            const newArticleTotals = new Map();
            const articleDetails = new Map();

            for (const newItem of articles) {
                const { article_id, ligne_numero } = newItem;
                const qte_reel = toInt(newItem.qte_reel); // force integer

                console.log(`Nouvel item: ligne ${ligne_numero}, article ${article_id}, qte: ${qte_reel}`);

                if (!newArticleTotals.has(article_id)) {
                    newArticleTotals.set(article_id, 0);
                    articleDetails.set(article_id, {
                        article: null,
                        items: []
                    });
                }

                newArticleTotals.set(article_id, newArticleTotals.get(article_id) + qte_reel);
                articleDetails.get(article_id).items.push({ ...newItem, qte_reel }); // store coerced value
            }

            // Charger les informations des articles
            for (const [articleId] of newArticleTotals) {
                const article = await articleRepo.findOne({ where: { id: articleId } });
                if (article) {
                    articleDetails.get(articleId).article = article;
                } else {
                    console.warn(`⚠️ Article ${articleId} non trouvé, ignoré`);
                }
            }

            // ================================================
            // 🚨 ÉTAPE 3: METTRE À JOUR LE STOCK
            // ================================================
            for (const [articleId, details] of articleDetails) {
                if (!details.article) continue;

                const newTotalQte = newArticleTotals.get(articleId);
                const article = details.article;

                console.log(`📦 Article ${articleId}: nouvelle qte totale = ${newTotalQte}`);

                // Obtenir le stock actuel (après annulation)
                let stockDepot = await stockRepo.findOne({
                    where: {
                        article_id: articleId,
                        depot_id: depotEntity.id
                    }
                });

                const qteAvant = stockDepot ? toInt(stockDepot.qte) : 0;
                const newTotalQteInt = toInt(newTotalQte);

                // Mettre à jour le stock avec la nouvelle quantité totale
                if (!stockDepot) {
                    stockDepot = stockRepo.create({
                        article_id: articleId,
                        depot_id: depotEntity.id,
                        qte: newTotalQteInt
                    });
                } else {
                    stockDepot.qte = newTotalQteInt;
                }

                await stockRepo.save(stockDepot);
                console.log(`✅ Stock mis à jour article ${articleId}: ${qteAvant} -> ${newTotalQteInt}`);

                // ================================================
                // 🚨 ÉTAPE 4: TRAITER CHAQUE LIGNE (mise à jour ou création)
                // ================================================
                for (let i = 0; i < details.items.length; i++) {
                    const newItem = details.items[i];
                    const { qte_reel, ligne_numero } = newItem;

                    // Vérifier si un item existe déjà pour cette ligne
                    const existingItem = existingItemsMap.get(ligne_numero);

                    if (existingItem && existingItem.article_id === articleId) {
                        // ================================================
                        // 🚨 MISE À JOUR DE L'ITEM EXISTANT
                        // ================================================
                        console.log(`🔄 Mise à jour item existant ligne ${ligne_numero}, article ${articleId}`);

                        // Calculer les nouveaux prix
                        const pua_ht = parseFloat(article.pua_ht) || 0;
                        const tva_rate = parseFloat(article.tva) || 19;
                        const total_ht = pua_ht * qte_reel;
                        const total_tva = total_ht * (tva_rate / 100);
                        const total_ttc = total_ht + total_tva;

                        // Mettre à jour l'item existant
                        existingItem.qte_reel = qte_reel;
                        existingItem.pua_ht = pua_ht;
                        existingItem.pua_ttc = pua_ht * (1 + (tva_rate / 100));
                        existingItem.tva = tva_rate;
                        existingItem.total_tva = total_tva;
                        existingItem.total_ht = total_ht;
                        existingItem.total_ttc = total_ttc;

                        // Recalculer qte_ajustement basé sur le nouveau qte_reel
                        // qte_avant reste le même (stock avant l'inventaire)
                        const qteAvantForItem = toInt(existingItem.qte_avant);
                        const qteAjustementForItem = qte_reel - qteAvantForItem;
                        existingItem.qte_ajustement = qteAjustementForItem;

                        await inventaireItemRepo.save(existingItem);
                        console.log(`✅ Item mis à jour: ligne ${ligne_numero}, qte_reel: ${existingItem.qte_reel} -> ${qte_reel}`);

                        // Ajouter aux totaux globaux
                        totalHT += total_ht;
                        totalTVA += total_tva;
                        totalTTC += total_ttc;

                    } else {
                        // ================================================
                        // 🚨 CRÉATION D'UN NOUVEL ITEM
                        // ================================================
                        console.log(`➕ Création nouvel item ligne ${ligne_numero}, article ${articleId}`);

                        // Calculer qte_avant et qte_ajustement
                        let qteAvantForItem;
                        let qteAjustementForItem;

                        if (i === 0) {
                            // Première ligne: utilise le stock original (après annulation)
                            qteAvantForItem = qteAvant;
                            qteAjustementForItem = qte_reel - toInt(qteAvant);
                        } else {
                            // Lignes suivantes: considérées comme nouvelles
                            qteAvantForItem = 0;
                            qteAjustementForItem = qte_reel;
                        }

                        // Calculer les prix
                        const pua_ht = parseFloat(article.pua_ht) || 0;
                        const tva_rate = parseFloat(article.tva) || 19;
                        const total_ht = pua_ht * qte_reel;
                        const total_tva = total_ht * (tva_rate / 100);
                        const total_ttc = total_ht + total_tva;

                        // Ajouter aux totaux globaux
                        totalHT += total_ht;
                        totalTVA += total_tva;
                        totalTTC += total_ttc;

                        // Créer le nouvel item
                        const inventaireItem = inventaireItemRepo.create({
                            inventaire_id: id,
                            article_id: articleId,
                            ligne_numero: ligne_numero || 0,
                            qte_avant: qteAvantForItem,
                            qte_reel: qte_reel,
                            qte_ajustement: qteAjustementForItem,
                            pua_ht,
                            pua_ttc: pua_ht * (1 + (tva_rate / 100)),
                            tva: tva_rate,
                            total_tva,
                            total_ht,
                            total_ttc
                        });

                        await inventaireItemRepo.save(inventaireItem);
                        console.log(`✅ Nouvel item créé: ligne ${ligne_numero}, qte: ${qte_reel}`);
                    }
                }

                // Mettre à jour la quantité globale de l'article
                const allDepotStocks = await stockRepo.find({
                    where: { article_id: articleId }
                });
                const totalArticleStock = allDepotStocks.reduce((sum, stock) => sum + toInt(stock.qte), 0);

                await articleRepo.update(
                    { id: articleId },
                    { qte: totalArticleStock }
                );
                console.log(`✅ Quantité globale article ${articleId}: ${totalArticleStock}`);
            }

            // ================================================
            // 🚨 ÉTAPE 5: SUPPRIMER LES ITEMS QUI N'EXISTENT PLUS
            // ================================================
            const newLigneNumbers = new Set(articles.map(item => item.ligne_numero));
            const itemsToDelete = [];

            for (const item of existingInventaire.items || []) {
                if (!newLigneNumbers.has(item.ligne_numero)) {
                    itemsToDelete.push(item.id);
                }
            }

            if (itemsToDelete.length > 0) {
                console.log(`🗑️ Suppression des items obsolètes: ${itemsToDelete.join(', ')}`);
                await inventaireItemRepo.delete(itemsToDelete);
            }

            existingInventaire.article_count = articles.length;
        }

        // ================================================
        // 🚨 ÉTAPE 6: METTRE À JOUR L'ENTÊTE DE L'INVENTAIRE
        // ================================================
        existingInventaire.total_ht = totalHT;
        existingInventaire.total_tva = totalTVA;
        existingInventaire.total_ttc = totalTTC;
        existingInventaire.updated_at = new Date();

        if (numero) existingInventaire.numero = numero;
        if (date) existingInventaire.date = date;
        if (date_inventaire) existingInventaire.date_inventaire = date_inventaire;
        if (description !== undefined) existingInventaire.description = description;

        await inventaireRepo.save(existingInventaire);
        console.log("✅ Entête d'inventaire mis à jour");

        // Commit transaction
        await queryRunner.commitTransaction();
        console.log("✅ Transaction commitée avec succès!");

        // Return updated inventaire
        const updatedInventaire = await inventaireRepo.findOne({
            where: { id },
            relations: ['items', 'items.article']
        });

        // Log des items mis à jour pour vérification
        console.log("📋 Items après mise à jour:");
        if (updatedInventaire.items) {
            updatedInventaire.items.forEach(item => {
                console.log(`  - Ligne ${item.ligne_numero}: article ${item.article_id}, qte_reel: ${item.qte_reel}`);
            });
        }

        res.status(200).json({
            success: true,
            data: updatedInventaire,
            message: "Inventaire mis à jour avec succès"
        });

    } catch (error) {
        await queryRunner.rollbackTransaction();
        console.error("❌ Error updating inventaire:", error);
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

        // Calculer les ajustements totaux par article (agrégation)
        const articleAdjustments = new Map();
        for (const item of inventaire.items || []) {
            const currentAdjustment = articleAdjustments.get(item.article_id) || 0;
            articleAdjustments.set(item.article_id, currentAdjustment + toInt(item.qte_ajustement));
        }

        // Annuler les ajustements dans le stock
        for (const [articleId, totalAdjustment] of articleAdjustments) {
            const stockDepot = await stockRepo.findOne({
                where: {
                    article_id: articleId,
                    depot_id: depotEntity.id
                }
            });

            if (stockDepot) {
                stockDepot.qte = toInt(stockDepot.qte) - totalAdjustment;

                // Vérifier le stock négatif
                if (stockDepot.qte < 0) {
                    throw new Error(`Article ${articleId}: Annulation impossible - stock deviendrait négatif`);
                }

                // Si le stock devient 0 et était créé par cet inventaire
                const wasCreatedByInventaire = inventaire.items?.some(
                    item => item.article_id === articleId && item.qte_avant === 0
                );

                if (stockDepot.qte === 0 && wasCreatedByInventaire) {
                    await stockRepo.delete({ id: stockDepot.id });
                } else {
                    await stockRepo.save(stockDepot);
                }
            }

            const allDepotStocks2 = await stockRepo.find({ where: { article_id: articleId } });
            const totalArticleStock2 = allDepotStocks2.reduce((sum, stock) => sum + toInt(stock.qte), 0);

            await articleRepo.update(
                { id: articleId },
                { qte: totalArticleStock2 }
            );
        }

        // Supprimer les items d'inventaire
        await inventaireItemRepo.delete({ inventaire_id: id });

        // Supprimer l'inventaire
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



exports.getNextInventaireNumberEnhanced = async (req, res) => {
    try {
        const inventaireRepo = AppDataSource.getRepository(Inventaire);

        // Get current year
        const currentYear = new Date().getFullYear();

        // CHANGED: Always use previous year (currentYear - 1)
        const targetYear = currentYear - 1;

        const prefix = "INVENTAIRE";

        // Find the last inventaire number overall
        const lastInventaires = await inventaireRepo.find({
            select: ['numero', 'created_at'],
            order: { created_at: 'DESC' },
            take: 1
        });

        const lastInventaire = lastInventaires.length > 0 ? lastInventaires[0] : null;

        let nextYear = targetYear; // Use targetYear (currentYear - 1)
        let nextSequence = 1;

        if (lastInventaire && lastInventaire.numero) {
            // Extract year and sequence from last inventaire
            const pattern = new RegExp(`${prefix}-(\\d{4})-(\\d{3})`);
            const matches = lastInventaire.numero.match(pattern);

            if (matches && matches.length === 3) {
                const lastYear = parseInt(matches[1], 10);
                const lastSequence = parseInt(matches[2], 10);

                if (lastYear === targetYear) { // CHANGED: Compare with targetYear
                    // Same year (previous year), increment sequence
                    nextSequence = lastSequence + 1;
                } else if (lastYear < targetYear) {
                    // New year (previous year), reset sequence
                    nextSequence = 1;
                } else {
                    // Should not happen, but handle gracefully
                    nextYear = lastYear;
                    nextSequence = lastSequence + 1;
                }
            } else {
                // If the format doesn't match, check if there are other inventaires with correct format
                const allInventaires = await inventaireRepo.find({
                    select: ['numero'],
                    order: { created_at: 'DESC' }
                });

                // Find the last inventaire with correct format
                for (const inv of allInventaires) {
                    if (inv.numero && inv.numero.match(pattern)) {
                        const matches = inv.numero.match(pattern);
                        if (matches && matches.length === 3) {
                            const lastYear = parseInt(matches[1], 10);
                            const lastSequence = parseInt(matches[2], 10);

                            if (lastYear === targetYear) { // CHANGED: Compare with targetYear
                                nextSequence = lastSequence + 1;
                            } else {
                                nextSequence = 1;
                            }
                            break;
                        }
                    }
                }
            }
        }

        // Format with leading zeros
        const formattedSequence = nextSequence.toString().padStart(3, '0');
        const nextNumero = `${prefix}-${nextYear}-${formattedSequence}`;

        res.status(200).json({
            success: true,
            data: nextNumero,
            year: nextYear,
            sequence: nextSequence,
            formattedSequence: formattedSequence,
            message: "Prochain numéro d'inventaire généré avec succès"
        });

    } catch (error) {
        console.error("Error generating next inventaire number:", error);
        res.status(500).json({
            success: false,
            message: "Erreur lors de la génération du numéro d'inventaire"
        });
    }
};
