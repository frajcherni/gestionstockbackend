const { AppDataSource } = require("../db");
const { Article } = require("../entities/Article");
const { Client } = require("../entities/Client");
const { ClientWebsite } = require("../entities/ClientWebsite");
const { Vendeur } = require("../entities/Vendeur");
const {
  BonCommandeClient,
  BonCommandeClientArticle,
} = require("../entities/BonCommandeClient");

exports.createBonCommandeClient = async (req, res) => {
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
      clientWebsiteInfo // New field for website clients
    } = req.body;

    const clientRepo = AppDataSource.getRepository(Client);
    const clientWebsiteRepo = AppDataSource.getRepository(ClientWebsite);
    const vendeurRepo = AppDataSource.getRepository(Vendeur);
    const articleRepo = AppDataSource.getRepository(Article);
    const bonRepo = AppDataSource.getRepository(BonCommandeClient);

    // Validate required fields
    if (!numeroCommande || !dateCommande) {
      return res.status(400).json({ message: "Les champs obligatoires sont manquants" });
    }

    let client = null;
    let clientWebsite = null;
    let vendeur = null;

    // Handle Client (existing client)
    if (client_id) {
      client = await clientRepo.findOneBy({ id: parseInt(client_id) });
      if (!client) return res.status(404).json({ message: "Client non trouvé" });
    }
    // Handle ClientWebsite (new website client)
    else if (clientWebsiteInfo) {
      // Validate required website client fields
      if (!clientWebsiteInfo.nomPrenom || !clientWebsiteInfo.telephone || !clientWebsiteInfo.adresse) {
        return res.status(400).json({ message: "Nom, téléphone et adresse sont obligatoires pour les clients du site web" });
      }

      // Create new website client
      clientWebsite = clientWebsiteRepo.create({
        nomPrenom: clientWebsiteInfo.nomPrenom,
        telephone: clientWebsiteInfo.telephone,
        email: clientWebsiteInfo.email || null,
        adresse: clientWebsiteInfo.adresse,
        ville: clientWebsiteInfo.ville || null,
        code_postal: clientWebsiteInfo.code_postal || null,
      });
      
      clientWebsite = await clientWebsiteRepo.save(clientWebsite);
    } else {
      return res.status(400).json({ message: "Informations client requises (client_id ou clientWebsiteInfo)" });
    }

    // Handle Vendeur (optional)
    if (vendeur_id) {
      vendeur = await vendeurRepo.findOneBy({ id: parseInt(vendeur_id) });
      // Don't return error if vendeur not found, just continue without vendeur
    }

    const bonCommande = {
      numeroCommande,
      dateCommande: new Date(dateCommande),
      status,
      remise: remise || 0,
      remiseType: remiseType,
      notes: notes || null,
      client, // Can be null if using website client
      clientWebsite, // Can be null if using existing client
      vendeur, // Can be null
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
        return res.status(404).json({ message: `Article avec ID ${item.article_id} non trouvé` });
      }

      let prixUnitaire = parseFloat(item.prix_unitaire);
      const tvaRate = item.tva || 0;

      if (taxMode === "TTC") {
        prixUnitaire = prixUnitaire / (1 + tvaRate / 100);
      }

      if (!item.quantite || !item.prix_unitaire) {
        return res.status(400).json({
          message: "Quantité et prix unitaire sont obligatoires pour chaque article",
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

exports.updateBonCommandeClient = async (req, res) => {
  try {
    const bonRepo = AppDataSource.getRepository(BonCommandeClient);
    const articleRepo = AppDataSource.getRepository(Article);
    const bonArticleRepo = AppDataSource.getRepository(BonCommandeClientArticle);
    const clientRepo = AppDataSource.getRepository(Client);
    const vendeurRepo = AppDataSource.getRepository(Vendeur);

    // --- Load existing bon ---
    const bon = await bonRepo.findOne({
      where: { id: parseInt(req.params.id) },
      relations: ["articles", "articles.article", "client", "vendeur"],
    });

    if (!bon) {
      return res
        .status(404)
        .json({ message: "Bon de commande client non trouvé" });
    }

    // --- Update parent scalar fields ---
    const updates = {};
    if (req.body.dateCommande)
      updates.dateCommande = new Date(req.body.dateCommande);
    if (req.body.status) updates.status = req.body.status;
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

    // --- Handle articles with deletion support ---
    if (req.body.articles && Array.isArray(req.body.articles)) {
      // 1️⃣ Load current articles in the bon
      const currentArticles = await bonArticleRepo.find({
        where: { bonCommandeClient: { id: bon.id } },
        relations: ["article", "bonCommandeClient"],
      });

      // 2️⃣ Delete any articles not in the new list
      for (const oldItem of currentArticles) {
        const existsInNew = req.body.articles.some(
          (a) => parseInt(a.article_id) === oldItem.article.id
        );
        if (!existsInNew) {
          await bonArticleRepo.remove(oldItem);
        }
      }

      // 3️⃣ Update existing or add new articles
      for (const item of req.body.articles) {
        const article = await articleRepo.findOneBy({
          id: parseInt(item.article_id),
        });
        if (!article) {
          return res
            .status(404)
            .json({ message: `Article avec ID ${item.article_id} non trouvé` });
        }

        const prixUnitaire = parseFloat(item.prix_unitaire);
        const tvaRate = item.tva ? parseFloat(item.tva) : 0;

        const existing = await bonArticleRepo.findOne({
          where: {
            bonCommandeClient: { id: bon.id },
            article: { id: article.id },
          },
          relations: ["article", "bonCommandeClient"],
        });

        if (existing) {
          // Update existing line
          existing.quantite = parseInt(item.quantite);
          existing.prixUnitaire = prixUnitaire;
          existing.tva = tvaRate;
          existing.remise = item.remise ? parseFloat(item.remise) : null;
          await bonArticleRepo.save(existing);
        } else {
          // Insert new line
          const bonArticle = bonArticleRepo.create({
            bonCommandeClient: { id: bon.id },
            article,
            quantite: parseInt(item.quantite),
            prixUnitaire,
            tva: tvaRate,
            remise: item.remise ? parseFloat(item.remise) : null,
          });
          await bonArticleRepo.save(bonArticle);
        }
      }
    }

    // --- Reload the updated bon with fresh data ---
    const updatedBon = await bonRepo.findOne({
      where: { id: bon.id },
      relations: ["client", "vendeur", "articles", "articles.article"],
    });

    res.json(updatedBon);
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

    // Delete related articles first
    await bonArticleRepo.delete({
      bonCommandeClient: { id: parseInt(req.params.id) },
    });

    // Then delete the bon de commande
    const result = await bonRepo.delete(req.params.id);

    if (result.affected === 0) {
      return res
        .status(404)
        .json({ message: "Bon de commande client non trouv�" });
    }

    res
      .status(200)
      .json({ message: "Bon de commande client supprim� avec succ�s" });
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
          4,
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
