const { AppDataSource } = require("../db");
const {
  BonLivraison,
  BonLivraisonArticle,
} = require("../entities/BonLivraison");
const { BonCommandeClient } = require("../entities/BonCommandeClient");
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

    let client = null;
    let vendeur = null;
    let finalArticles = [];

    if (bonCommandeClient_id) {
      // 🔹 Load BonCommandeClient without causing double subtraction
      const bonCommandeClient = await bonCmdClientRepo.findOne({
        where: { id: parseInt(bonCommandeClient_id) },
        relations: ["client", "vendeur"],
      });

      if (!bonCommandeClient)
        return res.status(404).json({ message: "Bon de commande client non trouvé" });

      client = bonCommandeClient.client;
      vendeur = bonCommandeClient.vendeur;

      if (!articles || !Array.isArray(articles) || articles.length === 0) {
        return res.status(400).json({ message: "Articles requis" });
      }

      // 🔹 Only handle the articles sent in the request (avoid duplication)
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

        // ✅ Subtract once
        article.qte = (article.qte || 0) - parseInt(item.quantite);
        article.qte_physique = (article.qte_physique || 0) - parseInt(item.quantite);
        await articleRepo.save(article);

        finalArticles.push({
          article,
          quantite: parseInt(item.quantite),
          prix_unitaire,
          tva: tvaRate,
          remise: item.remise ? parseFloat(item.remise) : null,
        });
      }

      // ❌ Don't touch bonCommandeClient.status
    } else {
      // 🔹 Create from scratch
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

        // ✅ Subtract correctly
        article.qte = (article.qte || 0) - parseInt(item.quantite);
        article.qte_physique = (article.qte_physique || 0) - parseInt(item.quantite);
        await articleRepo.save(article);

        finalArticles.push({
          article,
          quantite: parseInt(item.quantite),
          prix_unitaire,
          tva: tvaRate,
          remise: item.remise ? parseFloat(item.remise) : null,
        });
      }
    }

    // 🔹 Always set BL status = "Livré"
    const bonLivraison = {
      numeroLivraison,
      dateLivraison: new Date(dateLivraison),
      status: "Livr�",
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
      message: "Bon de livraison créé avec succès et articles mis à jour (sans double déduction)",
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

    const bon = await repo.findOne({
      where: { id: parseInt(req.params.id) },
      relations: [
        "articles",
        "articles.article",
        "client",
        "vendeur",
        "bonCommandeClient",
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
      // --- Step 1: Adjust stock for deleted or updated articles ---
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

      // --- Step 2: Delete old article relations ---
      await bonArticleRepo.delete({ bonLivraison: { id: bon.id } });

      // --- Step 3: Create new article relations ---
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
exports.deleteBonLivraison = async (req, res) => {
  try {
    const bonRepo = AppDataSource.getRepository(BonLivraison);
    const bonArticleRepo = AppDataSource.getRepository(BonLivraisonArticle);
    const articleRepo = AppDataSource.getRepository(Article);

    const bon = await bonRepo.findOne({
      where: { id: parseInt(req.params.id) },
      relations: ["articles", "articles.article"],
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
