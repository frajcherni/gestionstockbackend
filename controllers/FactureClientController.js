const { AppDataSource } = require("../db");
const { Article } = require("../entities/Article");
const { Client } = require("../entities/Client");
const { Vendeur } = require("../entities/Vendeur");
const { BonLivraison } = require("../entities/BonLivraison");
const {
  FactureClient,
  FactureClientArticle,
} = require("../entities/FactureClient");

exports.getAllFacturesClient = async (req, res) => {
  try {
    const repo = AppDataSource.getRepository(FactureClient);
    const list = await repo.find({
      relations: [
        "client",
        "vendeur",
        "bonLivraison",
        "articles",
        "articles.article",
      ],
    });
    res.json(list);
  } catch (err) {
    console.error(err);
    res.status(500).json({ message: "Erreur serveur" });
  }
};

exports.getFactureClientById = async (req, res) => {
  try {
    const repo = AppDataSource.getRepository(FactureClient);
    const facture = await repo.findOne({
      where: { id: parseInt(req.params.id) },
      relations: [
        "client",
        "vendeur",
        "bonLivraison",
        "articles",
        "articles.article",
      ],
    });
    if (!facture) {
      return res.status(404).json({ message: "Facture client non trouvée" });
    }
    res.json(facture);
  } catch (err) {
    console.error(err);
    res.status(500).json({ message: "Erreur serveur" });
  }
};

exports.createFactureClient = async (req, res) => {
  try {
    const {
      numeroFacture,
      dateFacture,
      dateEcheance,
      status,
      conditions,
      client_id,
      vendeur_id,
      bonLivraison_id,
      articles,
      modeReglement,
      totalHT,
      totalTVA,
      totalTTC,
      notes,
      remise,
      conditionPaiement,
      timbreFiscal,
      remiseType,
      montantPaye,
    } = req.body;

    const clientRepo = AppDataSource.getRepository(Client);
    const vendeurRepo = AppDataSource.getRepository(Vendeur);
    const bonLivraisonRepo = AppDataSource.getRepository(BonLivraison);
    const articleRepo = AppDataSource.getRepository(Article);
    const factureRepo = AppDataSource.getRepository(FactureClient);

    // Validate required fields
    if (
      !numeroFacture ||
      !dateFacture ||
      !client_id 
      // !modeReglement ||
     
    ) {
      return res
        .status(400)
        .json({ message: "Les champs obligatoires sont manquants" });
    }

    // Check if numeroFacture is unique
    const existingFacture = await factureRepo.findOne({
      where: { numeroFacture },
    });
    if (existingFacture) {
      return res
        .status(400)
        .json({ message: "Numéro de facture déjà utilisé" });
    }

    const client = await clientRepo.findOneBy({ id: parseInt(client_id) });
    if (!client) {
      return res.status(404).json({ message: "Client non trouvé" });
    }

    let vendeur = null;
    if (vendeur_id) {
      vendeur = await vendeurRepo.findOneBy({ id: parseInt(vendeur_id) });
      if (!vendeur) {
        return res.status(404).json({ message: "Vendeur non trouvé" });
      }
    }

    let bonLivraison = null;
    if (bonLivraison_id) {
      bonLivraison = await bonLivraisonRepo.findOneBy({
        id: parseInt(bonLivraison_id),
      });
      if (!bonLivraison) {
        return res.status(404).json({ message: "Bon de livraison non trouvé" });
      }
    }

    const facture = {
      numeroFacture,
      dateFacture: new Date(dateFacture),
      dateEcheance: dateEcheance ? new Date(dateEcheance) : null,
      status: "Validee",
      conditions,
      client,
      vendeur,
      bonLivraison,
      modeReglement,
      timbreFiscal: !!timbreFiscal, // Save timbreFiscal as boolean
      conditionPaiement: conditionPaiement || null,
      totalHT: parseFloat(totalHT || 0),
      totalTVA: parseFloat(totalTVA || 0),
      totalTTC: parseFloat(totalTTC || 0),
      notes: notes || null,
      remise: parseFloat(remise || 0),
      remiseType: remiseType || "percentage",
      montantPaye: parseFloat(montantPaye || 0),
      resteAPayer: parseFloat(totalTTC || 0) - parseFloat(montantPaye || 0),
      articles: [],
    };

    console.log(facture);

    if (!articles || !Array.isArray(articles) || articles.length === 0) {
      return res.status(400).json({ message: "Les articles sont requis" });
    }

    for (const item of articles) {
      const articleEntity = await articleRepo.findOneBy({
        id: parseInt(item.article_id),
      });
      if (!articleEntity) {
        return res
          .status(404)
          .json({ message: `Article avec ID ${item.article_id} non trouvé` });
      }

      if (!item.quantite || !item.prix_unitaire) {
        return res.status(400).json({
          message:
            "Quantité et prix unitaire sont obligatoires pour chaque article",
        });
      }

      const factureArticle = {
        article: articleEntity,
        quantite: parseInt(item.quantite),
        prixUnitaire: parseFloat(item.prix_unitaire),
        tva: item.tva ? parseFloat(item.tva) : 0,
        remise: item.remise ? parseFloat(item.remise) : 0,
      };

      facture.articles.push(factureArticle);
    }

    const result = await factureRepo.save(facture);
    res.status(201).json(result);
  } catch (err) {
    console.error(err);
    res.status(500).json({ message: "Erreur serveur", error: err.message });
  }
};

exports.updateFactureClient = async (req, res) => {
  try {
    const { id } = req.params;

    const {
      numeroFacture,
      dateFacture,
      dateEcheance,
      modeReglement,
      montantPaye,
      notes,
      remise,
      remiseType,
      status,
      taxMode,
      totalHT,
      totalTTC,
      totalTVA,
      client_id,
      vendeur_id,
      articles,
    } = req.body;

    const factureRepo = AppDataSource.getRepository(FactureClient);
    const clientRepo = AppDataSource.getRepository(Client);
    const vendeurRepo = AppDataSource.getRepository(Vendeur);
    const articleRepo = AppDataSource.getRepository(Article);

    // Vérifier si la facture existe
    const facture = await factureRepo.findOne({
      where: { id: parseInt(id) },
      relations: ["articles", "client", "vendeur"],
    });

    if (!facture) {
      return res.status(404).json({ message: "Facture introuvable" });
    }

    // Mettre à jour les champs principaux
    facture.numeroFacture = numeroFacture;
    facture.dateFacture = dateFacture;
    facture.dateEcheance = dateEcheance;
    facture.modeReglement = modeReglement;
    facture.montantPaye = montantPaye;
    facture.notes = notes;
    facture.remise = remise;
    facture.remiseType = remiseType;
    facture.status = status;
    facture.taxMode = taxMode;
    facture.totalHT = totalHT;
    facture.totalTTC = totalTTC;
    facture.totalTVA = totalTVA;

    // Client
    if (client_id) {
      const client = await clientRepo.findOneBy({ id: parseInt(client_id) });
      if (!client) {
        return res.status(404).json({ message: "Client non trouvé" });
      }
      facture.client = client;
    }

    // Vendeur
    if (vendeur_id) {
      const vendeur = await vendeurRepo.findOneBy({ id: parseInt(vendeur_id) });
      if (!vendeur) {
        return res.status(404).json({ message: "Vendeur non trouvé" });
      }
      facture.vendeur = vendeur;
    }

    // Articles
    if (articles && Array.isArray(articles)) {
      console.log(articles);
      const newArticles = [];
      for (const item of articles) {
        const articleEntity = await articleRepo.findOneBy({
          id: parseInt(item.article_id),
        });
        if (!articleEntity) {
          return res
            .status(404)
            .json({ message: `Article ${item.article_id} non trouvé` });
        }

        const factureArticle = {
          article: articleEntity,
          quantite: parseInt(item.quantite),
          prixUnitaire: parseFloat(item.prix_unitaire),
          tva: item.tva ? parseFloat(item.tva) : 0,
          remise: item.remise ? parseFloat(item.remise) : 0,
        };

        console.log(factureArticle);
        newArticles.push(factureArticle);
      }

      // Remplace les anciens articles → grâce à cascade + onDelete: "CASCADE"
      facture.articles = newArticles;
    }

    // Sauvegarde
    const updatedFacture = await factureRepo.save(facture);

    return res.json(updatedFacture);
  } catch (error) {
    console.error("Erreur lors de la mise à jour de la facture :", error);
    return res
      .status(500)
      .json({ message: "Erreur lors de la mise à jour de la facture" });
  }
};

exports.deleteFactureClient = async (req, res) => {
  try {
    const factureArticleRepo =
      AppDataSource.getRepository(FactureClientArticle);
    const factureRepo = AppDataSource.getRepository(FactureClient);

    await factureArticleRepo.delete({
      factureClient: { id: parseInt(req.params.id) },
    });
    const result = await factureRepo.delete(req.params.id);

    if (result.affected === 0) {
      return res.status(404).json({ message: "Facture client non trouvée" });
    }

    res.status(200).json({ message: "Facture client supprimée avec succès" });
  } catch (err) {
    console.error(err);
    res.status(500).json({ message: "Erreur serveur", error: err.message });
  }
};

exports.annulerFactureClient = async (req, res) => {
  try {
    const repo = AppDataSource.getRepository(FactureClient);
    const facture = await repo.findOne({
      where: { id: parseInt(req.params.id) },
      relations: ["articles", "articles.article"],
    });

    if (!facture) {
      return res.status(404).json({ message: "Facture client non trouvée" });
    }

    if (facture.status === "Annulee") {
      return res
        .status(400)
        .json({ message: "Cette facture est déjà annulée" });
    }

    facture.status = "Annulee";
    await repo.save(facture);

    res.status(200).json({ message: "Facture client annulée avec succès" });
  } catch (err) {
    console.error(err);
    res.status(500).json({ message: "Erreur serveur", error: err.message });
  }
};

exports.getNextFactureNumber = async (req, res) => {
  try {
    const year = new Date().getFullYear();
    const prefix = "FAC";

    const repo = AppDataSource.getRepository(FactureClient);

    // Get the last numeroFacture for this year
    const lastFacture = await repo
      .createQueryBuilder("fact")
      .where("fact.numeroFacture LIKE :pattern", {
        pattern: `${prefix}-%/${year}`,
      })
      .orderBy("fact.numeroFacture", "DESC")
      .getOne();

    let nextNumber = 1;

    if (lastFacture && lastFacture.numeroFacture) {
      const match = lastFacture.numeroFacture.match(
        new RegExp(`^${prefix}-(\\d{4})/${year}$`)
      );
      if (match) {
        nextNumber = parseInt(match[1], 10) + 1;
      }
    }

    const nextFactureNumber = `${prefix}-${nextNumber
      .toString()
      .padStart(4, "0")}/${year}`;

    res.json({ numeroFacture: nextFactureNumber });
  } catch (err) {
    console.error(err);
    res.status(500).json({
      message: "Erreur lors de la génération du numéro de facture",
      error: err.message,
    });
  }
};
