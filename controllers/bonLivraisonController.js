const { AppDataSource } = require("../db");
const {
  BonLivraison,
  BonLivraisonArticle,
} = require("../entities/BonLivraison");
const {
  BonCommandeClient,
  BonCommandeClientArticle,
} = require("../entities/BonCommandeClient");
const { Article } = require("../entities/Article");
const { Client } = require("../entities/Client");
const { Vendeur } = require("../entities/Vendeur");

exports.createBonLivraison = async (req, res) => {
  const queryRunner = AppDataSource.createQueryRunner();
  await queryRunner.connect();
  await queryRunner.startTransaction();

  try {
    const {
      numeroLivraison,
      dateLivraison,
      remise,
      remiseType,
      notes,
      client_id,
      vendeur_id,
      bonCommandeClient_id,
      articles,
      taxMode,
    } = req.body;

    const clientRepo = queryRunner.manager.getRepository(Client);
    const vendeurRepo = queryRunner.manager.getRepository(Vendeur);
    const articleRepo = queryRunner.manager.getRepository(Article);
    const bonRepo = queryRunner.manager.getRepository(BonLivraison);
    const bonCmdClientRepo = queryRunner.manager.getRepository(BonCommandeClient);
    const bonCmdArticleRepo = queryRunner.manager.getRepository(BonCommandeClientArticle);

    let client = null;
    let vendeur = null;
    let finalArticles = [];
    let bonCommandeClient = null;

    if (!articles || !Array.isArray(articles) || articles.length === 0) {
      await queryRunner.rollbackTransaction();
      return res.status(400).json({ message: "Articles requis" });
    }

    if (bonCommandeClient_id) {
      // Load BC with current delivered quantities
      bonCommandeClient = await bonCmdClientRepo.findOne({
        where: { id: parseInt(bonCommandeClient_id) },
        relations: ["client", "vendeur", "articles", "articles.article"],
      });

      if (!bonCommandeClient) {
        await queryRunner.rollbackTransaction();
        return res.status(404).json({ message: "Bon de commande client non trouvé" });
      }

      client = bonCommandeClient.client;
      vendeur = bonCommandeClient.vendeur;

      // Process each article for delivery
      for (const item of articles) {
        const article = await articleRepo.findOneBy({ id: parseInt(item.article_id) });
        if (!article) {
          await queryRunner.rollbackTransaction();
          return res.status(404).json({ message: `Article ${item.article_id} introuvable` });
        }

        const bonCmdArticle = bonCommandeClient.articles.find(
          a => a.article.id === parseInt(item.article_id)
        );

        if (!bonCmdArticle) {
          await queryRunner.rollbackTransaction();
          return res.status(400).json({ message: `Article ${item.article_id} non trouvé dans le bon de commande` });
        }

        const quantiteCommandee = bonCmdArticle.quantite;
        const quantiteActuelleLivree = bonCmdArticle.quantiteLivree || 0; // Current delivered in BC
        
        // ✅ Get the NEW quantiteLivree from request
        const nouvelleQuantiteLivree = parseInt(item.quantiteLivree) || 0;
        
        // ✅ CORRECTED: Calculate EXACT delivery for this BL = New total - Current delivered
        const quantiteSouhaiteePourCeBL = nouvelleQuantiteLivree - quantiteActuelleLivree;

        console.log(`Article ${article.designation}: Commandé=${quantiteCommandee}, Actuellement livré=${quantiteActuelleLivree}, Nouveau total demandé=${nouvelleQuantiteLivree}, Souhaité pour ce BL=${quantiteSouhaiteePourCeBL}`);

        // ✅ Validate that new total doesn't exceed ordered quantity
        if (nouvelleQuantiteLivree > quantiteCommandee) {
          await queryRunner.rollbackTransaction();
          return res.status(400).json({
            message: `Quantité totale livrée (${nouvelleQuantiteLivree}) ne peut pas dépasser la quantité commandée (${quantiteCommandee}) pour ${article.designation}`
          });
        }

        // ✅ Check if user wants to deliver anything in this BL
        if (quantiteSouhaiteePourCeBL <= 0) {
          console.log(`Quantité nulle ou négative pour ${article.designation} dans ce BL, ignorée`);
          continue; // Skip zero or negative quantities for this BL
        }
  
    
        // ✅ Reduce stock for this BL delivery
        article.qte -= quantiteSouhaiteePourCeBL;
        article.qte_physique -= quantiteSouhaiteePourCeBL;
        await articleRepo.save(article);

        // ✅ UPDATE BC article's quantiteLivree to the NEW total delivered quantity
        bonCmdArticle.quantiteLivree = nouvelleQuantiteLivree;
        await bonCmdArticleRepo.save(bonCmdArticle);

        let prix_unitaire = parseFloat(item.prix_unitaire);
        const tvaRate = item.tva ? parseFloat(item.tva) : article.tva || 0;

        if (taxMode === "TTC") {
          prix_unitaire = prix_unitaire / (1 + tvaRate / 100);
        }

        finalArticles.push({
          article,
          quantite: quantiteSouhaiteePourCeBL, // Store only the quantity for THIS BL
          prix_unitaire,
          prix_ttc: prix_unitaire * (1 + tvaRate / 100), // Make sure this line exists
          tva: tvaRate,
          remise: item.remise ? parseFloat(item.remise) : null,
        });

        console.log(`Livraison BL: ${quantiteSouhaiteePourCeBL} unités - Total livré mis à jour dans BC: ${nouvelleQuantiteLivree}`);
      }

      // ✅ Update BC status based on NEW delivered quantities
      const totalAfterThisBL = bonCommandeClient.articles.reduce((sum, item) => sum + item.quantiteLivree, 0);
      const totalOrdered = bonCommandeClient.articles.reduce((sum, item) => sum + item.quantite, 0);

      let bcStatus = "Confirme";
      if (totalAfterThisBL === totalOrdered && totalOrdered > 0) {
        bcStatus = "Livre";
      } else if (totalAfterThisBL > 0 && totalAfterThisBL < totalOrdered) {
        bcStatus = "Partiellement Livre";
      }

      // ✅ Update BC status
      await bonCmdClientRepo.update(bonCommandeClient.id, { status: bcStatus });

      console.log(`Statut BC mis à jour: ${bcStatus}, Total commandé: ${totalOrdered}, Total livré: ${totalAfterThisBL}`);

    } else {
      // BL without BC (direct delivery) - FIXED: Use quantite instead of quantiteLivree
      client = await clientRepo.findOneBy({ id: parseInt(client_id) });
      vendeur = await vendeurRepo.findOneBy({ id: parseInt(vendeur_id) });

      if (!client || !vendeur) {
        await queryRunner.rollbackTransaction();
        return res.status(404).json({ message: "Client ou vendeur introuvable" });
      }

      for (const item of articles) {
        const article = await articleRepo.findOneBy({ id: parseInt(item.article_id) });
        if (!article) {
          await queryRunner.rollbackTransaction();
          return res.status(404).json({ message: `Article ${item.article_id} introuvable` });
        }

        // ✅ FIXED: Use quantite for direct BL creation (not quantiteLivree)
        const quantitePourStock = parseInt(item.quantite) || 0;

        // Skip if no delivery requested
        if (quantitePourStock <= 0) {
          continue;
        }

        // Check stock availability
  
        let prix_unitaire = parseFloat(item.prix_unitaire);
        const tvaRate = item.tva ? parseFloat(item.tva) : article.tva || 0;

        if (taxMode === "TTC") {
          prix_unitaire = prix_unitaire / (1 + tvaRate / 100);
        }

        // Reduce stock
        article.qte -= quantitePourStock;
        article.qte_physique -= quantitePourStock;
        await articleRepo.save(article);

        finalArticles.push({
          article,
          quantite: quantitePourStock,
          prix_unitaire,
          prix_ttc: prix_unitaire * (1 + tvaRate / 100), // Make sure this line exists
          tva: tvaRate,
          remise: item.remise ? parseFloat(item.remise) : null,
        });
      }
    }

    // Check if we have any articles to deliver
    if (finalArticles.length === 0) {
      await queryRunner.rollbackTransaction();
      return res.status(400).json({ message: "Aucune quantité à livrer spécifiée" });
    }

    // Create BL
    const bonLivraison = {
      numeroLivraison,
      dateLivraison: new Date(dateLivraison),
      status: "Livré",
      remise: remise || 0,
      remiseType: remiseType || "percentage",
      notes: notes || null,
      client,
      vendeur,
      taxMode,
      bonCommandeClient: bonCommandeClient_id ? bonCommandeClient : null,
      articles: finalArticles,
    };

    const result = await bonRepo.save(bonLivraison);
    await queryRunner.commitTransaction();

    let message = "Bon de livraison créé avec succès";
    if (bonCommandeClient_id) {
      message += ` pour ${finalArticles.length} articles`;
    }

    res.status(201).json({ message, data: result });
  } catch (err) {
    await queryRunner.rollbackTransaction();
    console.error("Erreur:", err);
    res.status(500).json({ message: "Erreur serveur", error: err.message });
  } finally {
    await queryRunner.release();
  }
};
// ✅ UPDATE - Handle all restoration cases properly
exports.updateBonLivraison = async (req, res) => {
  const queryRunner = AppDataSource.createQueryRunner();
  await queryRunner.connect();
  await queryRunner.startTransaction();

  try {
    const bonRepo = queryRunner.manager.getRepository(BonLivraison);
    const bonArticleRepo =
      queryRunner.manager.getRepository(BonLivraisonArticle);
    const articleRepo = queryRunner.manager.getRepository(Article);
    const bonCmdClientRepo =
      queryRunner.manager.getRepository(BonCommandeClient);
    const bonCmdArticleRepo = queryRunner.manager.getRepository(
      BonCommandeClientArticle
    );

    const bon = await bonRepo.findOne({
      where: { id: parseInt(req.params.id) },
      relations: [
        "articles",
        "articles.article",
        "client",
        "vendeur",
        "bonCommandeClient",
        "bonCommandeClient.articles",
        "bonCommandeClient.articles.article",
      ],
    });

    if (!bon) {
      await queryRunner.rollbackTransaction();
      return res.status(404).json({ message: "Bon de livraison introuvable" });
    }

    const { dateLivraison, remise, remiseType, notes, taxMode, articles } =
      req.body;

    // ✅ RULE: BL status is always "Livré" - remove from updateable fields
    bon.dateLivraison = dateLivraison
      ? new Date(dateLivraison)
      : bon.dateLivraison;
    bon.remise = remise !== undefined ? remise : bon.remise;
    bon.remiseType = remiseType || bon.remiseType;
    bon.notes = notes || bon.notes;
    bon.taxMode = taxMode || bon.taxMode;
    bon.status = "Livré"; // Always set to "Livré"

    // ✅ Update articles
    if (articles && Array.isArray(articles)) {
      // --- Step 1: Restaurer les quantités livrées dans le bon de commande et stock ---
      if (bon.bonCommandeClient) {
        for (const oldItem of bon.articles) {
          const bonCmdArticle = bon.bonCommandeClient.articles.find(
            (a) => a.article.id === oldItem.article.id
          );

          if (bonCmdArticle) {
            // ✅ Restaurer l'ancienne quantité livrée dans BC
            bonCmdArticle.quantiteLivree -= oldItem.quantite;
            // Ensure quantiteLivree doesn't go below 0
            if (bonCmdArticle.quantiteLivree < 0) {
              bonCmdArticle.quantiteLivree = 0;
            }
            await bonCmdArticleRepo.save(bonCmdArticle);
          }

          // ✅ Restaurer le stock
          const articleEntity = await articleRepo.findOneBy({
            id: oldItem.article.id,
          });
          if (articleEntity) {
            articleEntity.qte += oldItem.quantite;
            articleEntity.qte_physique += oldItem.quantite;
            await articleRepo.save(articleEntity);
          }
        }
      } else {
        // ✅ Restaurer le stock pour les BL sans BC
        for (const oldItem of bon.articles) {
          const articleEntity = await articleRepo.findOneBy({
            id: oldItem.article.id,
          });
          if (articleEntity) {
            articleEntity.qte += oldItem.quantite;
            articleEntity.qte_physique += oldItem.quantite;
            await articleRepo.save(articleEntity);
          }
        }
      }

      // --- Step 2: Delete old article relations ---
      await bonArticleRepo.delete({ bonLivraison: { id: bon.id } });

      // --- Step 3: Create new article relations and update BC/stock ---
      const newArticles = [];

      for (const item of articles) {
        const article = await articleRepo.findOneBy({
          id: parseInt(item.article_id),
        });
        if (!article) {
          await queryRunner.rollbackTransaction();
          return res
            .status(404)
            .json({ message: `Article ${item.article_id} introuvable` });
        }

        let prix_unitaire = parseFloat(item.prix_unitaire);
        const tvaRate = item.tva ? parseFloat(item.tva) : 0;
        if (taxMode === "TTC") {
          prix_unitaire = prix_unitaire / (1 + tvaRate / 100);
        }

        const quantite = parseInt(item.quantite);

        // ✅ Handle quantity control for BC-linked BL
        if (bon.bonCommandeClient) {
          const bonCmdArticle = bon.bonCommandeClient.articles.find(
            (a) => a.article.id === parseInt(item.article_id)
          );

          if (bonCmdArticle) {
            const quantiteRestante =
              bonCmdArticle.quantite - bonCmdArticle.quantiteLivree;

            // ✅ RULE: Control that delivered quantity doesn't exceed remaining quantity
            if (quantite > quantiteRestante) {
              await queryRunner.rollbackTransaction();
              return res.status(400).json({
                message: `Quantité invalide pour l'article ${article.designation}. Quantité restante: ${quantiteRestante}, Tentative de livraison: ${quantite}`,
              });
            }

            // ✅ Update BC with new delivered quantity
            bonCmdArticle.quantiteLivree += quantite;
            await bonCmdArticleRepo.save(bonCmdArticle);
          }
        }

        // ✅ Update stock
        article.qte = (article.qte || 0) - quantite;
        article.qte_physique = (article.qte_physique || 0) - quantite;
        await articleRepo.save(article);

        newArticles.push(
          bonArticleRepo.create({
            bonLivraison: bon,
            article,
            quantite: quantite,
            prix_unitaire,
            tva: tvaRate,
            remise: item.remise ? parseFloat(item.remise) : null,
          })
        );
      }

      bon.articles = newArticles;

      // --- Step 4: Mettre à jour le statut du bon de commande ---
      if (bon.bonCommandeClient) {
        const updatedBonCmd = await bonCmdClientRepo.findOne({
          where: { id: bon.bonCommandeClient.id },
          relations: ["articles"],
        });

        let totalQuantiteBC = updatedBonCmd.articles.reduce(
          (sum, item) => sum + item.quantite,
          0
        );
        let totalLivreeBC = updatedBonCmd.articles.reduce(
          (sum, item) => sum + item.quantiteLivree,
          0
        );

        let bcStatus = "Confirme";
        if (totalLivreeBC === totalQuantiteBC && totalQuantiteBC > 0) {
          bcStatus = "Livre";
        } else if (totalLivreeBC > 0 && totalLivreeBC < totalQuantiteBC) {
          bcStatus = "Partiellement Livre";
        }

        updatedBonCmd.status = bcStatus;
        await bonCmdClientRepo.save(updatedBonCmd);
      }
    }

    const updated = await bonRepo.save(bon);
    await queryRunner.commitTransaction();

    const result = await bonRepo.findOne({
      where: { id: bon.id },
      relations: [
        "client",
        "vendeur",
        "articles",
        "articles.article",
        "bonCommandeClient",
      ],
    });

    res.json(result);
  } catch (err) {
    await queryRunner.rollbackTransaction();
    console.error(err);
    res.status(500).json({ message: "Erreur serveur", error: err.message });
  } finally {
    await queryRunner.release();
  }
};

// ✅ DELETE - Restore everything properly
exports.deleteBonLivraison = async (req, res) => {
  const queryRunner = AppDataSource.createQueryRunner();
  await queryRunner.connect();
  await queryRunner.startTransaction();

  try {
    const bonRepo = queryRunner.manager.getRepository(BonLivraison);
    const bonArticleRepo =
      queryRunner.manager.getRepository(BonLivraisonArticle);
    const articleRepo = queryRunner.manager.getRepository(Article);
    const bonCmdClientRepo =
      queryRunner.manager.getRepository(BonCommandeClient);
    const bonCmdArticleRepo = queryRunner.manager.getRepository(
      BonCommandeClientArticle
    );

    const bon = await bonRepo.findOne({
      where: { id: parseInt(req.params.id) },
      relations: [
        "articles",
        "articles.article",
        "bonCommandeClient",
        "bonCommandeClient.articles",
        "bonCommandeClient.articles.article",
      ],
    });

    if (!bon) {
      await queryRunner.rollbackTransaction();
      return res.status(404).json({ message: "Bon de livraison introuvable" });
    }

    // ✅ RULE: Restore stock before deleting
    for (const item of bon.articles) {
      const articleEntity = await articleRepo.findOneBy({
        id: item.article.id,
      });
      if (articleEntity) {
        articleEntity.qte += item.quantite;
        articleEntity.qte_physique += item.quantite;
        await articleRepo.save(articleEntity);
      }
    }

    // ✅ RULE: Restaurer les quantités livrées dans le bon de commande
    if (bon.bonCommandeClient) {
      for (const item of bon.articles) {
        const bonCmdArticle = bon.bonCommandeClient.articles.find(
          (a) => a.article.id === item.article.id
        );

        if (bonCmdArticle) {
          bonCmdArticle.quantiteLivree -= item.quantite;
          // Ensure quantiteLivree doesn't go below 0
          if (bonCmdArticle.quantiteLivree < 0) {
            bonCmdArticle.quantiteLivree = 0;
          }
          await bonCmdArticleRepo.save(bonCmdArticle);
        }
      }

      // ✅ Mettre à jour le statut du bon de commande
      const updatedBonCmd = await bonCmdClientRepo.findOne({
        where: { id: bon.bonCommandeClient.id },
        relations: ["articles"],
      });

      let totalQuantiteBC = updatedBonCmd.articles.reduce(
        (sum, item) => sum + item.quantite,
        0
      );
      let totalLivreeBC = updatedBonCmd.articles.reduce(
        (sum, item) => sum + item.quantiteLivree,
        0
      );

      let bcStatus = "Confirme";
      if (totalLivreeBC === totalQuantiteBC && totalQuantiteBC > 0) {
        bcStatus = "Livre";
      } else if (totalLivreeBC > 0 && totalLivreeBC < totalQuantiteBC) {
        bcStatus = "Partiellement Livre";
      }

      updatedBonCmd.status = bcStatus;
      await bonCmdClientRepo.save(updatedBonCmd);
    }

    await bonArticleRepo.delete({ bonLivraison: { id: bon.id } });
    await bonRepo.delete(bon.id);

    await queryRunner.commitTransaction();

    // ✅ RULE: Inform user about the deletion
    let message = "Bon de livraison supprimé avec succès";
    if (bon.bonCommandeClient) {
      message += ` et quantités restaurées dans le bon de commande ${bon.bonCommandeClient.numeroCommande}`;
    }

    res.status(200).json({ message });
  } catch (err) {
    await queryRunner.rollbackTransaction();
    console.error(err);
    res.status(500).json({ message: "Erreur serveur", error: err.message });
  } finally {
    await queryRunner.release();
  }
};

// ✅ DELETE - Restore everything properly

exports.annulerBonLivraison = async (req, res) => {
  try {
    const bonRepo = AppDataSource.getRepository(BonLivraison);
    const articleRepo = AppDataSource.getRepository(Article);

    const bon = await bonRepo.findOne({
      where: { id: parseInt(req.params.id) },
      relations: ["articles", "articles.article"],
    });

    if (!bon) {
      return res.status(404).json({ message: "Bon de livraison introuvable" });
    }

    if (bon.status === "Annule") {
      return res.status(400).json({ message: "Ce bon est d�j� annul�" });
    }

    for (const bonArticle of bon.articles) {
      const article = bonArticle.article;
      article.qte = (article.qte || 0) + bonArticle.quantite;
      article.qte_physique = (article.qte_physique || 0) + bonArticle.quantite;
      await articleRepo.save(article);
    }

    bon.status = "Annule";
    await bonRepo.save(bon);

    res.status(200).json({ message: "Bon de livraison annul� avec succ�s" });
  } catch (err) {
    console.error(err);
    res.status(500).json({ message: "Erreur serveur", error: err.message });
  }
};

exports.getNextLivraisonNumber = async (req, res) => {
  try {
    const year = new Date().getFullYear();
    const prefix = "BL";

    const repo = AppDataSource.getRepository(BonLivraison);

    // Get the last numeroLivraison for this year
    const lastBon = await repo
      .createQueryBuilder("bl")
      .where("bl.numeroLivraison LIKE :pattern", {
        pattern: `${prefix}-%/${year}`,
      })
      .orderBy("bl.numeroLivraison", "DESC")
      .getOne();

    let nextNumber = 1;

    if (lastBon && lastBon.numeroLivraison) {
      // Match BL-0001/2025
      const match = lastBon.numeroLivraison.match(
        new RegExp(`^${prefix}-(\\d+)/${year}$`)
      );
      if (match) {
        nextNumber = parseInt(match[1], 10) + 1;
      }
    }

    const nextLivraisonNumber = `${prefix}-${nextNumber
      .toString()
      .padStart(3, "0")}/${year}`;

    res.json({ numeroLivraison: nextLivraisonNumber });
  } catch (err) {
    console.error(err);
    res.status(500).json({
      message: "Erreur lors de la g�n�ration du num�ro de livraison",
      error: err.message,
    });
  }
};

// ✅ DELETE — restore article quantities and update BC status before deleting bon

exports.annulerBonLivraison = async (req, res) => {
  try {
    const bonRepo = AppDataSource.getRepository(BonLivraison);
    const articleRepo = AppDataSource.getRepository(Article);

    const bon = await bonRepo.findOne({
      where: { id: parseInt(req.params.id) },
      relations: ["articles", "articles.article"],
    });

    if (!bon) {
      return res.status(404).json({ message: "Bon de livraison introuvable" });
    }

    if (bon.status === "Annule") {
      return res.status(400).json({ message: "Ce bon est d�j� annul�" });
    }

    for (const bonArticle of bon.articles) {
      const article = bonArticle.article;
      article.qte = (article.qte || 0) + bonArticle.quantite;
      article.qte_physique = (article.qte_physique || 0) + bonArticle.quantite;
      await articleRepo.save(article);
    }

    bon.status = "Annule";
    await bonRepo.save(bon);

    res.status(200).json({ message: "Bon de livraison annul� avec succ�s" });
  } catch (err) {
    console.error(err);
    res.status(500).json({ message: "Erreur serveur", error: err.message });
  }
};

exports.getNextLivraisonNumber = async (req, res) => {
  try {
    const year = new Date().getFullYear();
    const prefix = "BL";

    const repo = AppDataSource.getRepository(BonLivraison);

    // Get the last numeroLivraison for this year
    const lastBon = await repo
      .createQueryBuilder("bl")
      .where("bl.numeroLivraison LIKE :pattern", {
        pattern: `${prefix}-%/${year}`,
      })
      .orderBy("bl.numeroLivraison", "DESC")
      .getOne();

    let nextNumber = 1;

    if (lastBon && lastBon.numeroLivraison) {
      // Match BL-0001/2025
      const match = lastBon.numeroLivraison.match(
        new RegExp(`^${prefix}-(\\d+)/${year}$`)
      );
      if (match) {
        nextNumber = parseInt(match[1], 10) + 1;
      }
    }

    const nextLivraisonNumber = `${prefix}-${nextNumber
      .toString()
      .padStart(4, "0")}/${year}`;

    res.json({ numeroLivraison: nextLivraisonNumber });
  } catch (err) {
    console.error(err);
    res.status(500).json({
      message: "Erreur lors de la g�n�ration du num�ro de livraison",
      error: err.message,
    });
  }
};

exports.getAllBonLivraisons = async (req, res) => {
  try {
    const repo = AppDataSource.getRepository(BonLivraison);
    const list = await repo.find({
      relations: [
        "client",
        "vendeur",
        "articles",
        "articles.article",
        "bonCommandeClient",
      ],
    });
    res.json(list);
  } catch (err) {
    console.error(err);
    res.status(500).json({ message: "Erreur serveur", error: err.message });
  }
};

exports.getBonLivraisonById = async (req, res) => {
  try {
    const repo = AppDataSource.getRepository(BonLivraison);
    const bon = await repo.findOne({
      where: { id: parseInt(req.params.id) },
      relations: [
        "client",
        "vendeur",
        "articles",
        "articles.article",
        "bonCommandeClient",
      ],
    });

    if (!bon)
      return res.status(404).json({ message: "Bon de livraison introuvable" });

    res.json(bon);
  } catch (err) {
    console.error(err);
    res.status(500).json({ message: "Erreur serveur", error: err.message });
  }
};
