const { AppDataSource } = require("../db");
const { Article } = require("../entities/Article");
const { Client } = require("../entities/Client");
const { Vendeur } = require("../entities/Vendeur");
const { DevisClient, DevisClientArticle } = require("../entities/Devis");

exports.updateDevisClient = async (req, res) => {
  try {
    const devisRepo = AppDataSource.getRepository(DevisClient);
    const devisArticleRepo = AppDataSource.getRepository(DevisClientArticle);
    const articleRepo = AppDataSource.getRepository(Article);
    const clientRepo = AppDataSource.getRepository(Client);
    const vendeurRepo = AppDataSource.getRepository(Vendeur);

    // --- Load devis ---
    const devis = await devisRepo.findOne({
      where: { id: parseInt(req.params.id) },
      relations: ["articles", "articles.article", "client", "vendeur"],
    });

    if (!devis) {
      return res.status(404).json({ message: "Devis client non trouvé" });
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
    await devisRepo.update(devis.id, updates);

    // --- Handle articles ---
    if (req.body.articles && Array.isArray(req.body.articles)) {
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
        
        // CALCULATE prix_ttc BASED ON prix_unitaire AND TVA
        const prix_ttc = tvaRate > 0 ? prixUnitaire * (1 + tvaRate / 100) : prixUnitaire;

        // check if article already exists in devis
        const existing = await devisArticleRepo.findOne({
          where: {
            devisClient: { id: devis.id },
            article: { id: article.id },
          },
          relations: ["article", "devisClient"],
        });

        if (existing) {
          // --- Update existing line ---
          existing.quantite = parseInt(item.quantite);
          existing.prixUnitaire = prixUnitaire;
          existing.prix_ttc = +prix_ttc.toFixed(3); // ADD THIS LINE - update TTC price
          existing.tva = tvaRate;
          existing.remise = item.remise ? parseFloat(item.remise) : null;

          await devisArticleRepo.save(existing);
        } else {
          // --- Insert new line ---
          const devisArticle = devisArticleRepo.create({
            devisClient: { id: devis.id }, // attach by ID
            article,
            quantite: parseInt(item.quantite),
            prixUnitaire,
            prix_ttc: +prix_ttc.toFixed(3), // ADD THIS LINE - calculated TTC price
            tva: tvaRate,
            remise: item.remise ? parseFloat(item.remise) : null,
          });

          await devisArticleRepo.save(devisArticle);
        }
      }
    }

    // --- Reload final devis with fresh data ---
    const updatedDevis = await devisRepo.findOne({
      where: { id: devis.id },
      relations: ["client", "vendeur", "articles", "articles.article"],
    });

    res.json(updatedDevis);
  } catch (err) {
    console.error(err);
    res.status(500).json({ message: "Erreur serveur", error: err.message });
  }
};

exports.createDevisClient = async (req, res) => {
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
    const devisRepo = AppDataSource.getRepository(DevisClient);

    // Validate required fields
    if (
      !numeroCommande ||
      !client_id ||
      !vendeur_id ||
      !dateCommande    ) {
      return res
        .status(400)
        .json({ message: "Les champs obligatoires sont manquants" });
    }

    const client = await clientRepo.findOneBy({ id: parseInt(client_id) });
    if (!client) return res.status(404).json({ message: "Client non trouvé" });

    const vendeur = await vendeurRepo.findOneBy({ id: parseInt(vendeur_id) });
    if (!vendeur)
      return res.status(404).json({ message: "Vendeur non trouvé" });

    const devis = {
      numeroCommande,
      dateCommande: new Date(dateCommande),
      status : "Confirme",
      remise: remise || 0,
      remiseType: remiseType || "percentage",
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
          .json({ message: `Article avec ID ${item.article_id} non trouvé` });
      }

      let prixUnitaire = parseFloat(item.prix_unitaire);
      const tvaRate = item.tva ? parseFloat(item.tva) : 0;

      if (!item.quantite || !item.prix_unitaire) {
        return res.status(400).json({
          message:
            "Quantité et prix unitaire sont obligatoires pour chaque article",
        });
      }

      // CALCULATE prix_ttc BASED ON prix_unitaire AND TVA
      const prix_ttc = tvaRate > 0 ? prixUnitaire * (1 + tvaRate / 100) : prixUnitaire;

      const devisArticle = {
        article,
        quantite: parseInt(item.quantite),
        prixUnitaire,
        prix_ttc: +prix_ttc.toFixed(3), // ADD THIS LINE - calculated TTC price
        tva: tvaRate,
        remise: item.remise ? parseFloat(item.remise) : null,
      };

      console.log(devisArticle);

      devis.articles.push(devisArticle);
    }

    const result = await devisRepo.save(devis);
    res.status(201).json(result);
  } catch (err) {
    console.error(err);
    res.status(500).json({ message: "Erreur serveur", error: err.message });
  }
};

exports.getAllDevisClient = async (req, res) => {
  try {
    const repo = AppDataSource.getRepository(DevisClient);
    const list = await repo.find({
      relations: ["client", "vendeur", "articles", "articles.article"],
      order: {
        dateCommande: "DESC" ,
        numeroCommande : "DESC" // Correct: This should be inside an 'order' object
      }
    });
    res.json(list);
  } catch (err) {
    console.error(err);
    res.status(500).json({ message: "Erreur serveur" });
  }
};

exports.getDevisClientById = async (req, res) => {
  try {
    const repo = AppDataSource.getRepository(DevisClient);
    const devis = await repo.findOne({
      where: { id: parseInt(req.params.id) },
      relations: ["client", "vendeur", "articles", "articles.article"],
    });

    if (!devis) {
      return res.status(404).json({ message: "Devis client non trouv�" });
    }

    res.json(devis);
  } catch (err) {
    console.error(err);
    res.status(500).json({ message: "Erreur serveur" });
  }
};

exports.updateDevisClient = async (req, res) => {
  try {
    const devisRepo = AppDataSource.getRepository(DevisClient);
    const devisArticleRepo = AppDataSource.getRepository(DevisClientArticle);
    const articleRepo = AppDataSource.getRepository(Article);
    const clientRepo = AppDataSource.getRepository(Client);
    const vendeurRepo = AppDataSource.getRepository(Vendeur);

    // --- Load devis ---
    const devis = await devisRepo.findOne({
      where: { id: parseInt(req.params.id) },
      relations: ["articles", "articles.article", "client", "vendeur"],
    });

    if (!devis) {
      return res.status(404).json({ message: "Devis client non trouvé" });
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
    await devisRepo.update(devis.id, updates);

    // --- Handle articles ---
    if (req.body.articles && Array.isArray(req.body.articles)) {
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

        // check if article already exists in devis
        const existing = await devisArticleRepo.findOne({
          where: {
            devisClient: { id: devis.id },
            article: { id: article.id },
          },
          relations: ["article", "devisClient"],
        });

        if (existing) {
          // --- Update existing line ---
          existing.quantite = parseInt(item.quantite);
          existing.prixUnitaire = prixUnitaire;
          existing.tva = tvaRate;
          existing.remise = item.remise ? parseFloat(item.remise) : null;

          await devisArticleRepo.save(existing);
        } else {
          // --- Insert new line ---
          const devisArticle = devisArticleRepo.create({
            devisClient: { id: devis.id }, // attach by ID
            article,
            quantite: parseInt(item.quantite),
            prixUnitaire,
            tva: tvaRate,
            remise: item.remise ? parseFloat(item.remise) : null,
          });

          await devisArticleRepo.save(devisArticle);
        }
      }
    }

    // --- Reload final devis with fresh data ---
    const updatedDevis = await devisRepo.findOne({
      where: { id: devis.id },
      relations: ["client", "vendeur", "articles", "articles.article"],
    });

    res.json(updatedDevis);
  } catch (err) {
    console.error(err);
    res.status(500).json({ message: "Erreur serveur", error: err.message });
  }
};

exports.deleteDevisClient = async (req, res) => {
  try {
    const devisArticleRepo = AppDataSource.getRepository(DevisClientArticle);
    const devisRepo = AppDataSource.getRepository(DevisClient);

    await devisArticleRepo.delete({
      devisClient: { id: parseInt(req.params.id) },
    });
    const result = await devisRepo.delete(req.params.id);

    if (result.affected === 0) {
      return res.status(404).json({ message: "Devis client non trouv�" });
    }

    res.status(200).json({ message: "Devis client supprim� avec succ�s" });
  } catch (err) {
    console.error(err);
    res.status(500).json({ message: "Erreur serveur", error: err.message });
  }
};

exports.annulerDevisClient = async (req, res) => {
  try {
    const devisRepo = AppDataSource.getRepository(DevisClient);
    const devis = await devisRepo.findOne({
      where: { id: parseInt(req.params.id) },
      relations: ["articles", "articles.article"],
    });

    if (!devis) {
      return res.status(404).json({ message: "Devis client non trouv�" });
    }

    if (devis.status === "Annule") {
      return res.status(400).json({ message: "Ce devis est d�j� annul�" });
    }

    devis.status = "Annule";
    await devisRepo.save(devis);

    res.status(200).json({ message: "Devis client annul� avec succ�s" });
  } catch (err) {
    console.error(err);
    res.status(500).json({ message: "Erreur serveur", error: err.message });
  }
};
