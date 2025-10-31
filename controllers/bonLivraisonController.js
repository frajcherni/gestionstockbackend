const { AppDataSource } = require("../db");
const {
  BonLivraison,
  BonLivraisonArticle,
} = require("../entities/BonLivraison");
const { BonCommandeClient , BonCommandeClientArticle } = require("../entities/BonCommandeClient");
const { Article } = require("../entities/Article");
const { Client } = require("../entities/Client");
const { Vendeur } = require("../entities/Vendeur");
exports.createBonLivraison = async (req, res) => {
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

    const clientRepo = AppDataSource.getRepository(Client);
    const vendeurRepo = AppDataSource.getRepository(Vendeur);
    const articleRepo = AppDataSource.getRepository(Article);
    const bonRepo = AppDataSource.getRepository(BonLivraison);
    const bonCmdClientRepo = AppDataSource.getRepository(BonCommandeClient);
    const bonCmdArticleRepo = AppDataSource.getRepository(BonCommandeClientArticle);

    let client = null;
    let vendeur = null;
    let finalArticles = [];

    if (bonCommandeClient_id) {
      // 🔹 Load BonCommandeClient avec ses articles
      const bonCommandeClient = await bonCmdClientRepo.findOne({
        where: { id: parseInt(bonCommandeClient_id) },
        relations: ["client", "vendeur", "articles", "articles.article"],
      });

      if (!bonCommandeClient)
        return res.status(404).json({ message: "Bon de commande client non trouvé" });

      client = bonCommandeClient.client;
      vendeur = bonCommandeClient.vendeur;

      if (!articles || !Array.isArray(articles) || articles.length === 0) {
        return res.status(400).json({ message: "Articles requis" });
      }

      // 🔹 Mettre à jour quantiteLivree dans le bon de commande
      for (const item of articles) {
        const article = await articleRepo.findOneBy({
          id: parseInt(item.article_id),
        });

        if (!article)
          return res.status(404).json({ message: `Article ${item.article_id} introuvable` });

        // 🔹 Trouver et mettre à jour l'article du bon de commande
        const bonCmdArticle = bonCommandeClient.articles.find(
          a => a.article.id === parseInt(item.article_id)
        );

        if (bonCmdArticle) {
          // 🔹 CORRECTION: SET the delivered quantity instead of ADDING to it
          const quantiteALivrer = parseInt(item.quantiteLivree) || parseInt(item.quantite);
          
          // 🔹 IMPORTANT: Set quantiteLivree to the actual delivered quantity
          // This ensures that if you deliver 3 out of 5, it sets quantiteLivree to 3
          bonCmdArticle.quantiteLivree = quantiteALivrer;
          await bonCmdArticleRepo.save(bonCmdArticle);
        }

        let prix_unitaire = parseFloat(item.prix_unitaire);
        const tvaRate = item.tva ? parseFloat(item.tva) : article.tva || 0;

        if (taxMode === "TTC") {
          prix_unitaire = prix_unitaire / (1 + tvaRate / 100);
        }

        // 🔹 CORRECTION: Use quantiteLivree for stock
        const quantitePourStock = parseInt(item.quantiteLivree) || parseInt(item.quantite);
        
        // 🔹 Mettre à jour le stock
        article.qte = (article.qte || 0) - quantitePourStock;
        article.qte_physique = (article.qte_physique || 0) - quantitePourStock;
        await articleRepo.save(article);

        finalArticles.push({
          article,
          quantite: quantitePourStock, // Use the actual delivered quantity
          prix_unitaire,
          tva: tvaRate,
          remise: item.remise ? parseFloat(item.remise) : null,
        });
      }

      // 🔹 Mettre à jour le statut du bon de commande
      const updatedBonCmd = await bonCmdClientRepo.findOne({
        where: { id: parseInt(bonCommandeClient_id) },
        relations: ["articles"]
      });

      let allFullyDelivered = true;
      let hasPartialDelivery = false;
      let hasAnyDelivery = false;

      for (const article of updatedBonCmd.articles) {
        if (article.quantiteLivree < article.quantite) {
          allFullyDelivered = false;
        }
        if (article.quantiteLivree > 0) {
          hasPartialDelivery = true;
          hasAnyDelivery = true;
        }
      }

      // 🔹 Déterminer le statut du BC
      if (allFullyDelivered && hasAnyDelivery) {
        updatedBonCmd.status = "Livre";
      } else if (hasPartialDelivery) {
        updatedBonCmd.status = "Partiellement Livre";
      } else {
        updatedBonCmd.status = "Confirme";
      }

      await bonCmdClientRepo.save(updatedBonCmd);

    } else {
      // 🔹 Création sans bon de commande (code existant)
      client = await clientRepo.findOneBy({ id: parseInt(client_id) });
      vendeur = await vendeurRepo.findOneBy({ id: parseInt(vendeur_id) });

      if (!client || !vendeur) {
        return res.status(404).json({ message: "Client ou vendeur introuvable" });
      }

      if (!articles || !Array.isArray(articles) || articles.length === 0) {
        return res.status(400).json({ message: "Articles requis" });
      }

      for (const item of articles) {
        const article = await articleRepo.findOneBy({
          id: parseInt(item.article_id),
        });

        if (!article)
          return res.status(404).json({ message: `Article ${item.article_id} introuvable` });

        let prix_unitaire = parseFloat(item.prix_unitaire);
        const tvaRate = item.tva ? parseFloat(item.tva) : article.tva || 0;

        if (taxMode === "TTC") {
          prix_unitaire = prix_unitaire / (1 + tvaRate / 100);
        }

        // Mettre à jour le stock
        const quantitePourStock = parseInt(item.quantite);
        article.qte = (article.qte || 0) - quantitePourStock;
        article.qte_physique = (article.qte_physique || 0) - quantitePourStock;
        await articleRepo.save(article);

        finalArticles.push({
          article,
          quantite: quantitePourStock,
          prix_unitaire,
          tva: tvaRate,
          remise: item.remise ? parseFloat(item.remise) : null,
        });
      }
    }

    // 🔹 Déterminer le statut du BL
    let blStatus = "Livré";
    if (bonCommandeClient_id) {
      const bonCmd = await bonCmdClientRepo.findOne({
        where: { id: parseInt(bonCommandeClient_id) },
        relations: ["articles"]
      });
      
      let totalQuantite = 0;
      let totalLivree = 0;
      
      for (const article of bonCmd.articles) {
        totalQuantite += article.quantite;
        totalLivree += article.quantiteLivree;
      }
      
      if (totalLivree < totalQuantite) {
        blStatus = "Partiellement Livré";
      }
    }

    // 🔹 Créer le bon de livraison
    const bonLivraison = {
      numeroLivraison,
      dateLivraison: new Date(dateLivraison),
      status: blStatus,
      remise: remise || 0,
      remiseType: remiseType || "percentage",
      notes: notes || null,
      client,
      vendeur,
      taxMode,
      bonCommandeClient: bonCommandeClient_id
        ? await bonCmdClientRepo.findOneBy({ id: parseInt(bonCommandeClient_id) })
        : null,
      articles: finalArticles,
    };

    const result = await bonRepo.save(bonLivraison);

    res.status(201).json({
      message: "Bon de livraison créé avec succès",
      data: result,
    });
  } catch (err) {
    console.error("Erreur serveur:", err);
    res.status(500).json({ message: "Erreur serveur", error: err.message });
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

exports.updateBonLivraison = async (req, res) => {
  try {
    const repo = AppDataSource.getRepository(BonLivraison);
    const bonArticleRepo = AppDataSource.getRepository(BonLivraisonArticle);
    const articleRepo = AppDataSource.getRepository(Article);
    const bonCmdClientRepo = AppDataSource.getRepository(BonCommandeClient);
    const bonCmdArticleRepo = AppDataSource.getRepository(BonCommandeClientArticle);

    const bon = await repo.findOne({
      where: { id: parseInt(req.params.id) },
      relations: [
        "articles",
        "articles.article",
        "client",
        "vendeur",
        "bonCommandeClient",
        "bonCommandeClient.articles",
      ],
    });

    if (!bon) {
      return res.status(404).json({ message: "Bon de livraison introuvable" });
    }

    const {
      dateLivraison,
      status,
      remise,
      remiseType,
      notes,
      taxMode,
      articles,
    } = req.body;

    // Sauvegarder l'ancien bon de commande pour restauration
    const oldBonCommandeClient = bon.bonCommandeClient;

    bon.dateLivraison = dateLivraison
      ? new Date(dateLivraison)
      : bon.dateLivraison;
    bon.status = status || bon.status;
    bon.remise = remise !== undefined ? remise : bon.remise;
    bon.remiseType = remiseType || bon.remiseType;
    bon.notes = notes || bon.notes;
    bon.taxMode = taxMode || bon.taxMode;

    // ✅ Update articles
    if (articles && Array.isArray(articles)) {
      // --- Step 1: Restaurer les quantités livrées dans le bon de commande ---
      if (oldBonCommandeClient) {
        for (const oldItem of bon.articles) {
          const bonCmdArticle = oldBonCommandeClient.articles.find(
            a => a.article.id === oldItem.article.id
          );
          
          if (bonCmdArticle) {
            // Restaurer l'ancienne quantité livrée
            bonCmdArticle.quantiteLivree -= oldItem.quantite;
            await bonCmdArticleRepo.save(bonCmdArticle);
          }
        }
      }

      // --- Step 2: Adjust stock for deleted or updated articles ---
      for (const oldItem of bon.articles) {
        const existing = articles.find(
          (a) => parseInt(a.article_id) === oldItem.article.id
        );

        const articleEntity = await articleRepo.findOneBy({
          id: oldItem.article.id,
        });
        if (!articleEntity) continue;

        if (!existing) {
          // ❌ Article deleted → restore quantity
          articleEntity.qte += oldItem.quantite;
          articleEntity.qte_physique += oldItem.quantite;
        } else if (existing.quantite !== oldItem.quantite) {
          // ✏️ Quantity changed → adjust stock difference
          const diff = oldItem.quantite - parseInt(existing.quantite);
          articleEntity.qte += diff;
          articleEntity.qte_physique += diff;
        }

        await articleRepo.save(articleEntity);
      }

      // --- Step 3: Delete old article relations ---
      await bonArticleRepo.delete({ bonLivraison: { id: bon.id } });

      // --- Step 4: Create new article relations ---
      const newArticles = [];
      for (const item of articles) {
        const article = await articleRepo.findOneBy({
          id: parseInt(item.article_id),
        });
        if (!article) {
          return res
            .status(404)
            .json({ message: `Article ${item.article_id} introuvable` });
        }

        let prix_unitaire = parseFloat(item.prix_unitaire);
        const tvaRate = item.tva ? parseFloat(item.tva) : 0;
        if (taxMode === "TTC") {
          prix_unitaire = prix_unitaire / (1 + tvaRate / 100);
        }

        newArticles.push(
          bonArticleRepo.create({
            bonLivraison: bon,
            article,
            quantite: parseInt(item.quantite),
            prix_unitaire,
            tva: tvaRate,
            remise: item.remise ? parseFloat(item.remise) : null,
          })
        );
      }

      bon.articles = newArticles;

      // --- Step 5: Mettre à jour les quantités livrées dans le nouveau bon de commande ---
      if (bon.bonCommandeClient) {
        for (const item of articles) {
          const bonCmdArticle = bon.bonCommandeClient.articles.find(
            a => a.article.id === parseInt(item.article_id)
          );
          
          if (bonCmdArticle) {
            // Appliquer la nouvelle quantité livrée
            const quantiteALivrer = parseInt(item.quantiteLivree) || parseInt(item.quantite);
            bonCmdArticle.quantiteLivree += quantiteALivrer;
            await bonCmdArticleRepo.save(bonCmdArticle);
          }
        }

        // --- Step 6: Mettre à jour le statut du bon de commande ---
        const updatedBonCmd = await bonCmdClientRepo.findOne({
          where: { id: bon.bonCommandeClient.id },
          relations: ["articles"]
        });

        let allFullyDelivered = true;
        let hasPartialDelivery = false;
        let hasAnyDelivery = false;

        for (const article of updatedBonCmd.articles) {
          if (article.quantiteLivree < article.quantite) {
            allFullyDelivered = false;
          }
          if (article.quantiteLivree > 0) {
            hasPartialDelivery = true;
            hasAnyDelivery = true;
          }
        }

        // Déterminer le statut du BC
        if (allFullyDelivered && hasAnyDelivery) {
          updatedBonCmd.status = "Livre";
        } else if (hasPartialDelivery) {
          updatedBonCmd.status = "Partiellement Livre";
        } else {
          updatedBonCmd.status = "Confirme";
        }

        await bonCmdClientRepo.save(updatedBonCmd);
      }
    }

    const updated = await repo.save(bon);

    const result = await repo.findOne({
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
    console.error(err);
    res.status(500).json({ message: "Erreur serveur", error: err.message });
  }
};

// ✅ DELETE — restore article quantities before deleting bon
// ✅ DELETE — restore article quantities and update BC status before deleting bon
exports.deleteBonLivraison = async (req, res) => {
  try {
    const bonRepo = AppDataSource.getRepository(BonLivraison);
    const bonArticleRepo = AppDataSource.getRepository(BonLivraisonArticle);
    const articleRepo = AppDataSource.getRepository(Article);
    const bonCmdClientRepo = AppDataSource.getRepository(BonCommandeClient);
    const bonCmdArticleRepo = AppDataSource.getRepository(BonCommandeClientArticle);

    const bon = await bonRepo.findOne({
      where: { id: parseInt(req.params.id) },
      relations: [
        "articles", 
        "articles.article", 
        "bonCommandeClient",
        "bonCommandeClient.articles"
      ],
    });

    if (!bon) {
      return res.status(404).json({ message: "Bon de livraison introuvable" });
    }

    // ✅ Restore stock before deleting
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

    // ✅ Restaurer les quantités livrées dans le bon de commande
    if (bon.bonCommandeClient) {
      for (const item of bon.articles) {
        const bonCmdArticle = bon.bonCommandeClient.articles.find(
          a => a.article.id === item.article.id
        );
        
        if (bonCmdArticle) {
          bonCmdArticle.quantiteLivree -= item.quantite;
          await bonCmdArticleRepo.save(bonCmdArticle);
        }
      }

      // ✅ Mettre à jour le statut du bon de commande
      const updatedBonCmd = await bonCmdClientRepo.findOne({
        where: { id: bon.bonCommandeClient.id },
        relations: ["articles"]
      });

      let allFullyDelivered = true;
      let hasPartialDelivery = false;
      let hasAnyDelivery = false;

      for (const article of updatedBonCmd.articles) {
        if (article.quantiteLivree < article.quantite) {
          allFullyDelivered = false;
        }
        if (article.quantiteLivree > 0) {
          hasPartialDelivery = true;
          hasAnyDelivery = true;
        }
      }

      // Déterminer le statut du BC
      if (allFullyDelivered && hasAnyDelivery) {
        updatedBonCmd.status = "Livre";
      } else if (hasPartialDelivery) {
        updatedBonCmd.status = "Partiellement Livre";
      } else {
        updatedBonCmd.status = "Confirme";
      }

      await bonCmdClientRepo.save(updatedBonCmd);
    }

    await bonArticleRepo.delete({ bonLivraison: { id: bon.id } });
    await bonRepo.delete(bon.id);

    res.status(200).json({ message: "Bon de livraison supprimé avec succès" });
  } catch (err) {
    console.error(err);
    res.status(500).json({ message: "Erreur serveur", error: err.message });
  }
};


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
