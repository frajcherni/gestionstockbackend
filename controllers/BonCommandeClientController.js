const { AppDataSource } = require("../db");
const { Article } = require("../entities/Article");
const { Client } = require("../entities/Client");
const { ClientWebsite } = require("../entities/ClientWebsite");
const { Vendeur } = require("../entities/Vendeur");
const { BonCommandeClient, BonCommandeClientArticle } = require("../entities/BonCommandeClient");

exports.createBonCommandeClient = async (req, res) => {
  const queryRunner = AppDataSource.createQueryRunner();
  await queryRunner.connect();
  await queryRunner.startTransaction();

  try {
    const {
      numeroCommande,
      dateCommande,
      remise,
      remiseType,
      notes,
      client_id,
      vendeur_id,
      articles,
      taxMode,
      clientWebsiteInfo,
    } = req.body;

    const clientRepo = queryRunner.manager.getRepository(Client);
    const clientWebsiteRepo = queryRunner.manager.getRepository(ClientWebsite);
    const vendeurRepo = queryRunner.manager.getRepository(Vendeur);
    const articleRepo = queryRunner.manager.getRepository(Article);
    const bonRepo = queryRunner.manager.getRepository(BonCommandeClient);

    // Validate required fields
    if (!numeroCommande || !dateCommande) {
      await queryRunner.rollbackTransaction();
      return res.status(400).json({ message: "Les champs obligatoires sont manquants" });
    }

    let client = null;
    let clientWebsite = null;
    let vendeur = null;

    // Handle Client
    if (client_id) {
      client = await clientRepo.findOneBy({ id: parseInt(client_id) });
      if (!client) {
        await queryRunner.rollbackTransaction();
        return res.status(404).json({ message: "Client non trouvé" });
      }
    } else if (clientWebsiteInfo) {
      if (!clientWebsiteInfo.nomPrenom || !clientWebsiteInfo.telephone || !clientWebsiteInfo.adresse) {
        await queryRunner.rollbackTransaction();
        return res.status(400).json({ message: "Nom, téléphone et adresse sont obligatoires pour les clients du site web" });
      }
      clientWebsite = clientWebsiteRepo.create(clientWebsiteInfo);
      clientWebsite = await clientWebsiteRepo.save(clientWebsite);
    } else {
      await queryRunner.rollbackTransaction();
      return res.status(400).json({ message: "Informations client requises" });
    }

    if (vendeur_id) {
      vendeur = await vendeurRepo.findOneBy({ id: parseInt(vendeur_id) });
    }

    if (!articles || !Array.isArray(articles) || articles.length === 0) {
      await queryRunner.rollbackTransaction();
      return res.status(400).json({ message: "Les articles sont requis" });
    }

    let totalQuantite = 0;
    let totalLivree = 0;

    const bonCommande = {
      numeroCommande,
      dateCommande: new Date(dateCommande),
      status: "Confirme",
      remise: remise || 0,
      remiseType: remiseType,
      notes: notes || null,
      client,
      clientWebsite,
      vendeur,
      taxMode,
      articles: [],
    };

    // Process articles - REDUCE STOCK if quantiteLivree > 0
    for (const item of articles) {
      const article = await articleRepo.findOneBy({ id: parseInt(item.article_id) });
      if (!article) {
        await queryRunner.rollbackTransaction();
        return res.status(404).json({ message: `Article avec ID ${item.article_id} non trouvé` });
      }

      let prixUnitaire = parseFloat(item.prix_unitaire);
      const tvaRate = item.tva || 0;

      if (taxMode === "TTC") {
        prixUnitaire = prixUnitaire / (1 + tvaRate / 100);
      }

      if (!item.quantite || !item.prix_unitaire) {
        await queryRunner.rollbackTransaction();
        return res.status(400).json({ message: "Quantité et prix unitaire sont obligatoires" });
      }

      const quantiteLivree = parseInt(item.quantiteLivree) || 0;
      const quantite = parseInt(item.quantite);

      // Validate that delivered quantity doesn't exceed ordered quantity
      if (quantiteLivree > quantite) {
        await queryRunner.rollbackTransaction();
        return res.status(400).json({
          message: `La quantité livrée (${quantiteLivree}) ne peut pas dépasser la quantité commandée (${quantite})`
        });
      }

    

      // ✅ REDUCE STOCK if quantiteLivree > 0
      if (quantiteLivree > 0) {
        article.qte -= quantiteLivree;
        article.qte_physique -= quantiteLivree;
        await articleRepo.save(article);
      }

      totalQuantite += quantite;
      totalLivree += quantiteLivree;

      const bonArticle = {
        article,
        quantite: quantite,
        quantiteLivree: quantiteLivree, // ✅ Store the initial delivered quantity
        prixUnitaire,
        tva: tvaRate,
        remise: item.remise ? parseFloat(item.remise) : null,
      };

      bonCommande.articles.push(bonArticle);
    }

    // Update BC status based on delivery
    if (totalLivree === totalQuantite && totalQuantite > 0) {
      bonCommande.status = "Livre";
    } else if (totalLivree > 0 && totalLivree < totalQuantite) {
      bonCommande.status = "Partiellement Livre";
    }

    const result = await bonRepo.save(bonCommande);
    await queryRunner.commitTransaction();

    res.status(201).json({
      message: "Bon de commande client créé avec succès" + (totalLivree > 0 ? " et stock mis à jour" : ""),
      data: result,
    });
  } catch (err) {
    await queryRunner.rollbackTransaction();
    console.error(err);
    res.status(500).json({ message: "Erreur serveur", error: err.message });
  } finally {
    await queryRunner.release();
  }
};
exports.updateBonCommandeClient = async (req, res) => {
  try {
    const bonRepo = AppDataSource.getRepository(BonCommandeClient);
    const articleRepo = AppDataSource.getRepository(Article);
    const bonArticleRepo = AppDataSource.getRepository(BonCommandeClientArticle);
    const clientRepo = AppDataSource.getRepository(Client);
    const vendeurRepo = AppDataSource.getRepository(Vendeur);
    const bonLivRepo = AppDataSource.getRepository(BonLivraison);

    // --- Load existing bon ---
    const bon = await bonRepo.findOne({
      where: { id: parseInt(req.params.id) },
      relations: ["articles", "articles.article", "client", "vendeur"],
    });

    if (!bon) {
      return res.status(404).json({ message: "Bon de commande client non trouvé" });
    }

    // ✅ RULE: Check if linked to BL, prevent article modifications
    const linkedBLs = await bonLivRepo.find({
      where: { bonCommandeClient: { id: bon.id } }
    });

    if (linkedBLs.length > 0 && req.body.articles) {
      return res.status(400).json({
        message: "Impossible de modifier les articles ou les quantités livrées car ce bon de commande est lié à des bons de livraison. Veuillez gérer les livraisons via les bons de livraison."
      });
    }

    // --- Calculate new status based on delivery quantities ---
    let newStatus = "Confirme";
    let totalQuantite = 0;
    let totalLivree = 0;
    let hasAnyDelivery = false;

    if (req.body.articles && Array.isArray(req.body.articles)) {
      for (const item of req.body.articles) {
        const quantite = parseInt(item.quantite) || 0;
        const quantiteLivree = parseInt(item.quantiteLivree) || 0;
        
        totalQuantite += quantite;
        totalLivree += quantiteLivree;
        
        if (quantiteLivree > 0) {
          hasAnyDelivery = true;
        }

        // Validate that delivered quantity doesn't exceed ordered quantity
        if (quantiteLivree > quantite) {
          return res.status(400).json({
            message: `La quantité livrée (${quantiteLivree}) ne peut pas dépasser la quantité commandée (${quantite})`
          });
        }
      }

      // Determine status based on delivery quantities
      if (totalLivree === totalQuantite && totalQuantite > 0) {
        newStatus = "Livre";
      } else if (hasAnyDelivery && totalLivree < totalQuantite) {
        newStatus = "Partiellement Livre";
      } else {
        newStatus = "Confirme";
      }
    }

    // --- Update parent scalar fields ---
    const updates = {};
    if (req.body.dateCommande)
      updates.dateCommande = new Date(req.body.dateCommande);
    updates.status = newStatus; // Use calculated status
    if (req.body.remise !== undefined)
      updates.remise = parseFloat(req.body.remise);
    if (req.body.remiseType) updates.remiseType = req.body.remiseType;
    if (req.body.notes !== undefined) updates.notes = req.body.notes;
    if (req.body.taxMode) updates.taxMode = req.body.taxMode;

    // --- Update relations ---
    if (req.body.client_id) {
      const client = await clientRepo.findOneBy({
        id: parseInt(req.body.client_id),
      });
      if (!client)
        return res.status(404).json({ message: "Client non trouvé" });
      updates.client = client;
    }

    if (req.body.vendeur_id) {
      const vendeur = await vendeurRepo.findOneBy({
        id: parseInt(req.body.vendeur_id),
      });
      if (!vendeur)
        return res.status(404).json({ message: "Vendeur non trouvé" });
      updates.vendeur = vendeur;
    }

    // --- Apply updates to parent only ---
    await bonRepo.update(bon.id, updates);

    // --- Handle articles with deletion support and stock adjustments ---
    if (req.body.articles && Array.isArray(req.body.articles)) {
      // 1️⃣ Load current articles in the bon
      const currentArticles = await bonArticleRepo.find({
        where: { bonCommandeClient: { id: bon.id } },
        relations: ["article", "bonCommandeClient"],
      });

      // 2️⃣ Delete any articles not in the new list and restore stock
      for (const oldItem of currentArticles) {
        const existsInNew = req.body.articles.some(
          (a) => parseInt(a.article_id) === oldItem.article.id
        );
        if (!existsInNew) {
          // ✅ Restore stock for delivered qty
          if (oldItem.quantiteLivree > 0) {
            const article = await articleRepo.findOneBy({ id: oldItem.article.id });
            article.qte += oldItem.quantiteLivree;
            article.qte_physique += oldItem.quantiteLivree;
            await articleRepo.save(article);
          }
          await bonArticleRepo.remove(oldItem);
        }
      }

      // 3️⃣ Update existing or add new articles with stock delta
      for (const item of req.body.articles) {
        const article = await articleRepo.findOneBy({
          id: parseInt(item.article_id),
        });
        if (!article) {
          return res.status(404).json({ message: `Article avec ID ${item.article_id} non trouvé` });
        }

        const prixUnitaire = parseFloat(item.prix_unitaire);
        const tvaRate = item.tva ? parseFloat(item.tva) : 0;
        const quantiteLivree = parseInt(item.quantiteLivree) || 0;

        const existing = await bonArticleRepo.findOne({
          where: {
            bonCommandeClient: { id: bon.id },
            article: { id: article.id },
          },
          relations: ["article", "bonCommandeClient"],
        });

        let delta = 0;

        if (existing) {
          // Calculate delta before update
          delta = quantiteLivree - existing.quantiteLivree;

          // Update existing line
          existing.quantite = parseInt(item.quantite);
          existing.quantiteLivree = quantiteLivree;
          existing.prixUnitaire = prixUnitaire;
          existing.tva = tvaRate;
          existing.remise = item.remise ? parseFloat(item.remise) : null;
          await bonArticleRepo.save(existing);
        } else {
          // Insert new line
          delta = quantiteLivree; // old is 0
          const bonArticle = bonArticleRepo.create({
            bonCommandeClient: { id: bon.id },
            article,
            quantite: parseInt(item.quantite),
            quantiteLivree: quantiteLivree,
            prixUnitaire,
            tva: tvaRate,
            remise: item.remise ? parseFloat(item.remise) : null,
          });
          await bonArticleRepo.save(bonArticle);
        }

        // ✅ Adjust stock based on delta
        if (delta !== 0) {
          article.qte = (article.qte || 0) - delta;
          article.qte_physique = (article.qte_physique || 0) - delta;
          await articleRepo.save(article);
        }
      }
    }

    // --- Reload the updated bon with fresh data ---
    const updatedBon = await bonRepo.findOne({
      where: { id: bon.id },
      relations: ["client", "vendeur", "articles", "articles.article"],
    });

    // ✅ RULE: Inform user if articles were modified
    let message = "Bon de commande client mis à jour avec succès";
    if (req.body.articles) {
      message += " et stock ajusté pour les changements de quantités livrées";
    }

    res.json({ message, data: updatedBon });
  } catch (err) {
    console.error(err);
    res.status(500).json({ message: "Erreur serveur", error: err.message });
  }
};

exports.deleteBonCommandeClient = async (req, res) => {
  try {
    const bonArticleRepo = AppDataSource.getRepository(
      BonCommandeClientArticle
    );
    const bonRepo = AppDataSource.getRepository(BonCommandeClient);
    const articleRepo = AppDataSource.getRepository(Article);
    const bonLivRepo = AppDataSource.getRepository(BonLivraison);

    const bon = await bonRepo.findOne({
      where: { id: parseInt(req.params.id) },
      relations: ["articles", "articles.article"],
    });

    if (!bon) {
      return res
        .status(404)
        .json({ message: "Bon de commande client non trouvé" });
    }

    // ✅ RULE: Check if linked to BL, prevent deletion
    const linkedBLs = await bonLivRepo.find({
      where: { bonCommandeClient: { id: bon.id } }
    });

    if (linkedBLs.length > 0) {
      return res.status(400).json({
        message: "Impossible de supprimer un bon de commande lié à des bons de livraison."
      });
    }

    // ✅ RULE: Restore stock for delivered quantities
    for (const item of bon.articles) {
      if (item.quantiteLivree > 0) {
        const article = item.article;
        article.qte += item.quantiteLivree;
        article.qte_physique += item.quantiteLivree;
        await articleRepo.save(article);
      }
    }

    // Delete related articles first
    await bonArticleRepo.delete({
      bonCommandeClient: { id: parseInt(req.params.id) },
    });

    // Then delete the bon de commande
    await bonRepo.delete(req.params.id);

    res
      .status(200)
      .json({ message: "Bon de commande client supprimé avec succès et stock restauré si applicable" });
  } catch (err) {
    console.error(err);
    res.status(500).json({ message: "Erreur serveur", error: err.message });
  }
};

exports.annulerBonCommandeClient = async (req, res) => {
  try {
    const bonRepo = AppDataSource.getRepository(BonCommandeClient);
    const bon = await bonRepo.findOne({
      where: { id: parseInt(req.params.id) },
      relations: ["articles", "articles.article"],
    });

    if (!bon) {
      return res
        .status(404)
        .json({ message: "Bon de commande client non trouv�" });
    }

    if (bon.status === "Annule") {
      return res.status(400).json({ message: "Ce bon est d�j� annul�" });
    }

    bon.status = "Annule";
    await bonRepo.save(bon);

    res
      .status(200)
      .json({ message: "Bon de commande client annul� avec succ�s" });
  } catch (err) {
    console.error(err);
    res.status(500).json({ message: "Erreur serveur", error: err.message });
  }
};

exports.getNextCommandeNumber = async (req, res) => {
  try {
    const year = new Date().getFullYear();
    const prefix = "BC";

    const bonRepo = AppDataSource.getRepository(BonCommandeClient);

    const lastBon = await bonRepo
      .createQueryBuilder("bon")
      .where("bon.numeroCommande LIKE :pattern", {
        pattern: `${prefix}-%/${year}`,
      })
      .orderBy("bon.createdAt", "DESC")
      .getOne();

    let nextCommandeNumber;

    if (!lastBon || !lastBon.numeroCommande) {
      nextCommandeNumber = `${prefix}-0001/${year}`;
    } else {
      const match = lastBon.numeroCommande.match(
        new RegExp(`^${prefix}-(\\d{4})/${year}$`)
      );
      if (match) {
        const current = parseInt(match[1], 10);
        const next = current + 1;
        nextCommandeNumber = `${prefix}-${String(next).padStart(
          3,
          "0"
        )}/${year}`;
      } else {
        nextCommandeNumber = `${prefix}-0001/${year}`;
      }
    }

    res.json({ numeroCommande: nextCommandeNumber });
  } catch (err) {
    console.error(err);
    res.status(500).json({
      message: "Erreur lors de la g�n�ration du num�ro",
      error: err.message,
    });
  }
};
exports.createBonCommandeClientBasedOnDevis = async (req, res) => {
  try {
    const {
      numeroCommande,
      dateCommande,
      status,
      remise,
      remiseType,
      notes,
      client_id,
      vendeur_id,
      articles,
      taxMode,
    } = req.body;

    const clientRepo = AppDataSource.getRepository(Client);
    const vendeurRepo = AppDataSource.getRepository(Vendeur);
    const articleRepo = AppDataSource.getRepository(Article);
    const bonRepo = AppDataSource.getRepository(BonCommandeClient);

    // Validate required fields
    if (
      !numeroCommande ||
      !client_id ||
      !vendeur_id ||
      !dateCommande ||
      !status
    ) {
      return res
        .status(400)
        .json({ message: "Les champs obligatoires sont manquants" });
    }

    const client = await clientRepo.findOneBy({ id: parseInt(client_id) });
    if (!client) return res.status(404).json({ message: "Client non trouv�" });

    const vendeur = await vendeurRepo.findOneBy({ id: parseInt(vendeur_id) });
    if (!vendeur)
      return res.status(404).json({ message: "Vendeur non trouv�" });

    const bonCommande = {
      numeroCommande,
      dateCommande: new Date(dateCommande),
      status,
      remise: remise || 0,
      remiseType: remiseType,
      notes: notes || null,
      client,
      vendeur,
      taxMode,
      articles: [],
    };

    // Validate articles
    if (!articles || !Array.isArray(articles) || articles.length === 0) {
      return res.status(400).json({ message: "Les articles sont requis" });
    }

    for (const item of articles) {
      const article = await articleRepo.findOneBy({
        id: parseInt(item.article_id),
      });
      if (!article) {
        return res
          .status(404)
          .json({ message: `Article avec ID ${item.article_id} non trouv�` });
      }

      let prixUnitaire = parseFloat(item.prixUnitaire);
      const tvaRate = item.tva || 0;

      if (!item.quantite || !item.prixUnitaire) {
        return res.status(400).json({
          message:
            "Quantit� et prix unitaire sont obligatoires pour chaque article",
        });
      }

      const bonArticle = {
        article,
        quantite: parseInt(item.quantite),
        prixUnitaire,
        tva: tvaRate,
        remise: item.remise ? parseFloat(item.remise) : null,
      };

      bonCommande.articles.push(bonArticle);
    }

    const result = await bonRepo.save(bonCommande);
    res.status(201).json(result);
  } catch (err) {
    console.error(err);
    res.status(500).json({ message: "Erreur serveur", error: err.message });
  }
};

exports.getAllBonCommandeClient = async (req, res) => {
  try {
    const repo = AppDataSource.getRepository(BonCommandeClient);
    const list = await repo.find({
      relations: ["client", "vendeur", "articles", "articles.article" , "clientWebsite", 
    ],
    });
    res.json(list);
  } catch (err) {
    console.error(err);
    res.status(500).json({ message: "Erreur serveur" });
  }
};
