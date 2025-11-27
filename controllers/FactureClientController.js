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
      totalTTCAfterRemise, // ADD THIS
      notes,
      remise,
      conditionPaiement,
      timbreFiscal,
      remiseType,
      montantPaye,
      exoneration,
      // NEW PAYMENT METHODS FIELDS
      paymentMethods = [],
      totalPaymentAmount = 0,
      espaceNotes = "",
      // RETENTION FIELDS - ADD THESE
      montantRetenue = 0,
      hasRetenue = false,
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

    // Calculate net à payer (after retention)
    const netAPayer = parseFloat(totalTTCAfterRemise || totalTTC || 0) - parseFloat(montantRetenue || 0);
    
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
      timbreFiscal: !!timbreFiscal,
      exoneration: !!exoneration,
      conditionPaiement: conditionPaiement || null,
      totalHT: parseFloat(totalHT || 0),
      totalTVA: parseFloat(totalTVA || 0),
      totalTTC: parseFloat(totalTTC || 0),
      totalTTCAfterRemise: parseFloat(totalTTCAfterRemise || totalTTC || 0), // ADD THIS
      notes: notes || null,
      remise: parseFloat(remise || 0),
      remiseType: remiseType || "percentage",
      montantPaye: parseFloat(montantPaye || 0),
      resteAPayer: Math.max(0, netAPayer - parseFloat(montantPaye || 0)),
      // NEW PAYMENT METHODS FIELDS
      paymentMethods: paymentMethods, // Store as JSON
      totalPaymentAmount: parseFloat(totalPaymentAmount || 0),
      espaceNotes: espaceNotes || null,
      // RETENTION FIELDS - ADD THESE
      montantRetenue: parseFloat(montantRetenue || 0),
      hasRetenue: !!hasRetenue,
      articles: [],
    };

    console.log("Creating facture with retention:", {
      montantRetenue: facture.montantRetenue,
      hasRetenue: facture.hasRetenue,
      paymentMethods: facture.paymentMethods,
      totalPaymentAmount: facture.totalPaymentAmount
    });

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
    
      const prixUnitaire = parseFloat(item.prix_unitaire);
      const tvaRate = item.tva ? parseFloat(item.tva) : 0;
      
      // Calculate prix_ttc based on prix_unitaire and TVA
      const prix_ttc = parseFloat(item.prix_ttc) || (tvaRate > 0 ? prixUnitaire * (1 + tvaRate / 100) : prixUnitaire);

      const factureArticle = {
        article: articleEntity,
        quantite: parseInt(item.quantite),
        prixUnitaire: prixUnitaire,
        prix_ttc: +prix_ttc.toFixed(3),
        tva: tvaRate,
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
      exoneration,
      timbreFiscal,
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
    facture.exoneration = !!exoneration;
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
    
    const prixUnitaire = parseFloat(item.prix_unitaire);
    const tvaRate = item.tva ? parseFloat(item.tva) : 0;
    
    // Calculate prix_ttc based on prix_unitaire and TVA
  // ✅ FIX: Use prix_ttc sent from frontend instead of calculating it
const prix_ttc = parseFloat(item.prix_ttc) || (tvaRate > 0 ? prixUnitaire * (1 + tvaRate / 100) : prixUnitaire);

const factureArticle = {
  article: articleEntity,
  quantite: parseInt(item.quantite),
  prixUnitaire: prixUnitaire,
  prix_ttc: +prix_ttc.toFixed(3), // Use the TTC value from frontend
  tva: tvaRate,
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
    const prefix = "FACTURE";

    const repo = AppDataSource.getRepository(FactureClient);

    // Get the last numeroFacture for this year
    const lastFacture = await repo
      .createQueryBuilder("fact")
      .where("fact.numeroFacture LIKE :pattern", { pattern: `${prefix}-%/${year}` })
      .orderBy("fact.id", "DESC")
      .getOne();

    let nextNumber = 413;

    if (lastFacture) {
      // Extract the numeric part between "-" and "/"
      const match = lastFacture.numeroFacture.match(/FACTURE-(\d+)\/\d{4}/);
      if (match && match[1]) {
        nextNumber = parseInt(match[1]) + 1;
      }
    }

    // Format number with 3 digits (e.g., 001)
    const formattedNumber = nextNumber.toString().padStart(3, '0');

    // Final format: FACTURE-001/2025
    const newNumeroFacture = `${prefix}-${formattedNumber}/${year}`;

    res.status(200).json({ numeroFacture: newNumeroFacture });
  } catch (error) {
    console.error('❌ Error generating facture number:', error);
    res.status(500).json({ message: error.message });
  }
};
