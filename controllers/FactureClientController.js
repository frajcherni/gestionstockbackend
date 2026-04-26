const { Depot } = require("../entities/Depot");
const { updateDepotStock } = require("../utils/stockUtils");
const { AppDataSource } = require("../db");
const { Client } = require("../entities/Client");
const { Article } = require("../entities/Article");
const { Vendeur } = require("../entities/Vendeur");
const { BonLivraison } = require("../entities/BonLivraison");
const { BonCommandeClient } = require("../entities/BonCommandeClient");
const { VenteComptoire } = require("../entities/VenteComptoire");
const { EncaissementClient } = require("../entities/EncaissementClient");

const {
  FactureClient,
  FactureClientArticle,
} = require("../entities/FactureClient");

// ============================================================
// HELPER: Calculate payment totals for a facture
// ============================================================
function calculatePaymentTotals(facture, encaissementsMap) {
  const safeParseFloat = (val) => {
    if (val === null || val === undefined || val === "") return 0;
    const num = typeof val === "string" ? parseFloat(val) : Number(val);
    return isNaN(num) ? 0 : num;
  };

  const sumPaymentMethods = (methods, excludeRetenue = true) => {
    if (!methods || !Array.isArray(methods)) return 0;
    return methods.reduce((sum, pm) => {
      if (excludeRetenue && pm.method === "retenue") return sum;
      return sum + safeParseFloat(pm.amount);
    }, 0);
  };

  const sumPaiements = (paiements) => {
    if (!paiements || !Array.isArray(paiements)) return 0;
    return paiements.reduce((sum, p) => sum + safeParseFloat(p.montant), 0);
  };

  const sumRetention = (methods, finalTotal) => {
    if (!methods || !Array.isArray(methods)) return 0;
    return methods
      .filter((pm) => pm.method === "retenue")
      .reduce((sum, pm) => {
        const rate = pm.tauxRetention || 1;
        return sum + (finalTotal * rate) / 100;
      }, 0);
  };

  // Get encaissements for this facture from the pre-built map
  const relevantEncaissements = encaissementsMap.get(facture.id) || [];
  const totalEncaissements = relevantEncaissements.reduce(
    (sum, enc) => sum + safeParseFloat(enc.montant),
    0
  );

  // Payment methods from all sources (excluding retention)
  const facturePayments = sumPaymentMethods(facture.paymentMethods);
  const bcPayments = sumPaymentMethods(facture.bonCommandeClient?.paymentMethods);
  const bcPaiements = sumPaiements(facture.bonCommandeClient?.paiements);
  const vcPayments = sumPaymentMethods(facture.venteComptoire?.paymentMethods);
  const blPayments = sumPaymentMethods(facture.bonLivraison?.paymentMethods);
  const blPaiements = sumPaiements(facture.bonLivraison?.paiements);

  const totalPaymentMethods =
    facturePayments + bcPayments + vcPayments + blPayments + blPaiements;

  // Calculate article totals
  let subTotal = 0, totalTax = 0, grandTotal = 0;
  if (facture.articles && Array.isArray(facture.articles)) {
    facture.articles.forEach((item) => {
      const qty = Number(item.quantite) || 1;
      const priceHT = Number(item.prixUnitaire) || 0;
      const tvaRate = Number(item.tva ?? 0);
      const remiseRate = Number(item.remise || 0);
      const priceTTC = Number(item.prix_ttc) || priceHT * (1 + tvaRate / 100);

      const montantHTLigne = Math.round(qty * priceHT * (1 - remiseRate / 100) * 1000) / 1000;
      const montantTTCLigne = Math.round(qty * priceTTC * 1000) / 1000;
      const taxAmount = Math.round((montantTTCLigne - montantHTLigne) * 1000) / 1000;

      subTotal += montantHTLigne;
      totalTax += taxAmount;
      grandTotal += montantTTCLigne;
    });
  }

  // Calculate final total
  let finalTotal = grandTotal;
  const hasDiscount = facture.remise && Number(facture.remise) > 0;
  if (hasDiscount) {
    if (facture.remiseType === "percentage") {
      finalTotal = grandTotal * (1 - Number(facture.remise) / 100);
    } else {
      finalTotal = Number(facture.remise);
    }
  }
  if (facture.timbreFiscal) {
    if (hasDiscount) {
      finalTotal += 1;
    } else {
      grandTotal += 1;
      finalTotal = grandTotal;
    }
  }

  subTotal = Math.round(subTotal * 1000) / 1000;
  totalTax = Math.round(totalTax * 1000) / 1000;
  grandTotal = Math.round(grandTotal * 1000) / 1000;
  finalTotal = Math.round(finalTotal * 1000) / 1000;

  // Retention from all sources
  const factureRetention = facture.paymentMethods
    ? sumRetention(facture.paymentMethods, finalTotal)
    : safeParseFloat(facture.montantRetenue);
  const bcRetention = facture.bonCommandeClient?.paymentMethods
    ? sumRetention(facture.bonCommandeClient.paymentMethods, finalTotal)
    : safeParseFloat(facture.bonCommandeClient?.montantRetenue);
  const vcRetention = facture.venteComptoire?.paymentMethods
    ? sumRetention(facture.venteComptoire.paymentMethods, finalTotal)
    : 0;
  const blRetention = facture.bonLivraison?.paymentMethods
    ? sumRetention(facture.bonLivraison.paymentMethods, finalTotal)
    : safeParseFloat(facture.bonLivraison?.montantRetenue);

  const totalRetention = factureRetention + bcRetention + vcRetention + blRetention;

  const totalPaye = totalEncaissements + totalPaymentMethods + bcPaiements;
  let resteAPayer = Math.round((finalTotal - totalRetention - totalPaye) * 1000) / 1000;
  resteAPayer = Math.max(0, resteAPayer);

  // Determine status
  let status = facture.status;
  if (facture.status === "Annulee") {
    status = "Annulee";
  } else if (resteAPayer === 0 && finalTotal > 0) {
    status = "Payee";
  } else if (totalPaye > 0 && totalPaye < finalTotal - totalRetention) {
    status = "Partiellement Payee";
  }

  return {
    totalHT: subTotal,
    totalTVA: totalTax,
    totalTTC: grandTotal,
    totalTTCAfterRemise: finalTotal,
    montantPaye: totalPaye,
    resteAPayer,
    montantRetenue: totalRetention,
    status,
    hasPayments: totalPaye > 0,
  };
}

// ============================================================
// PAGINATED ENDPOINT - Optimized for the list view
// ============================================================
exports.getAllFacturesClientPaginated = async (req, res) => {
  try {
    const page = Math.max(1, parseInt(req.query.page) || 1);
    const limit = Math.min(100, Math.max(1, parseInt(req.query.limit) || 20));
    const search = (req.query.search || "").trim();
    const searchPhone = (req.query.searchPhone || "").trim();
    const statusFilter = (req.query.status || "").trim();
    const startDate = req.query.startDate || null;
    const endDate = req.query.endDate || null;

    const repo = AppDataSource.getRepository(FactureClient);
    const encRepo = AppDataSource.getRepository(EncaissementClient);

    // Build query with filters
    const qb = repo
      .createQueryBuilder("facture")
      .leftJoinAndSelect("facture.client", "client")
      .leftJoinAndSelect("facture.vendeur", "vendeur")
      .leftJoinAndSelect("facture.depot", "depot")
      .leftJoinAndSelect("facture.bonLivraison", "bonLivraison")
      .leftJoinAndSelect("facture.venteComptoire", "venteComptoire")
      .leftJoinAndSelect("facture.bonCommandeClient", "bonCommandeClient")
      .leftJoinAndSelect("facture.articles", "articles")
      .leftJoinAndSelect("articles.article", "article");

    // Apply search filters
    if (search) {
      qb.andWhere(
        "(facture.numeroFacture LIKE :search OR client.raison_sociale LIKE :search OR client.designation LIKE :search)",
        { search: `%${search}%` }
      );
    }

    if (searchPhone) {
      const cleanPhone = searchPhone.replace(/\s/g, "");
      qb.andWhere(
        "(REPLACE(client.telephone1, ' ', '') LIKE :phone OR REPLACE(client.telephone2, ' ', '') LIKE :phone)",
        { phone: `%${cleanPhone}%` }
      );
    }

    if (startDate) {
      qb.andWhere("facture.dateFacture >= :startDate", { startDate });
    }
    if (endDate) {
      qb.andWhere("facture.dateFacture <= :endDate", { endDate: endDate + "T23:59:59" });
    }

    // Get total count BEFORE pagination (for the UI)
    const totalCount = await qb.getCount();

    // Apply ordering and pagination
    qb.orderBy("facture.dateFacture", "DESC")
      .addOrderBy("facture.numeroFacture", "DESC")
      .skip((page - 1) * limit)
      .take(limit);

    const factures = await qb.getMany();

    // Get ALL encaissements for the fetched facture IDs only (not all encaissements)
    const factureIds = factures.map((f) => f.id);
    let encaissementsMap = new Map();

    if (factureIds.length > 0) {
      const encaissements = await encRepo
        .createQueryBuilder("enc")
        .where("enc.facture_id IN (:...ids)", { ids: factureIds })
        .getMany();

      // Build Map: factureId -> [encaissements]
      encaissements.forEach((enc) => {
        const fId = enc.facture_id;
        if (!encaissementsMap.has(fId)) {
          encaissementsMap.set(fId, []);
        }
        encaissementsMap.get(fId).push(enc);
      });
    }

    // Calculate totals server-side
    const enrichedFactures = factures.map((facture) => {
      const calculated = calculatePaymentTotals(facture, encaissementsMap);

      // Combine payment methods for display
      const allPaymentMethods = [
        ...(facture.paymentMethods || []),
        ...(facture.bonCommandeClient?.paymentMethods || []),
        ...(facture.venteComptoire?.paymentMethods || []),
        ...(facture.bonLivraison?.paymentMethods || []),
      ];
      const allPaiements = [
        ...(facture.bonCommandeClient?.paiements || []),
        ...(facture.bonLivraison?.paiements || []),
      ];

      return {
        ...facture,
        ...calculated,
        allPaymentMethods,
        allPaiements,
        paymentMethods: allPaymentMethods,
        bonCommandePaiements: allPaiements,
      };
    });

    // Apply status filter AFTER calculation (since status is computed)
    let finalResults = enrichedFactures;
    if (statusFilter) {
      finalResults = enrichedFactures.filter((f) => f.status === statusFilter);
    }

    res.json({
      factures: finalResults,
      pagination: {
        page,
        limit,
        totalCount,
        totalPages: Math.ceil(totalCount / limit),
      },
    });
  } catch (err) {
    console.error("Error in paginated factures:", err);
    res.status(500).json({ message: "Erreur serveur" });
  }
};

// ============================================================
// ORIGINAL ENDPOINT - Kept for journal export / backward compat
// ============================================================
exports.getAllFacturesClient = async (req, res) => {
  try {
    const repo = AppDataSource.getRepository(FactureClient);
    const list = await repo.find({
      relations: [
        "client",
        "vendeur",
        "bonLivraison",
        "bonLivraison.paiements", // ADD THIS
        "bonCommandeClient",
        "venteComptoire", // ADD THIS
        "bonCommandeClient.paiements", // ADD THIS TOO
        "articles",
        "articles.article",
      ],
      order: {
        dateFacture: "DESC",
        numeroFacture: "DESC",
      }
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
      depot_id,
      bonLivraison_id,
      articles,
      modeReglement,
      totalHT,
      totalTVA,
      totalTTC,
      totalTTCAfterRemise,
      notes,
      remise,
      conditionPaiement,
      timbreFiscal,
      remiseType,
      montantPaye,
      exoneration,
      boncommandeclientid, // This is coming from req.body
      venteComptoire_id, // ADD THIS: For vente comptoire reference
      paymentMethods = [],
      totalPaymentAmount = 0,
      espaceNotes = "",
      montantRetenue = 0,
      hasRetenue = false,
    } = req.body;
    console.log(exoneration)
    const clientRepo = AppDataSource.getRepository(Client);
    const vendeurRepo = AppDataSource.getRepository(Vendeur);
    const depotRepo = AppDataSource.getRepository(Depot);
    const bonLivraisonRepo = AppDataSource.getRepository(BonLivraison);
    const articleRepo = AppDataSource.getRepository(Article);
    const factureRepo = AppDataSource.getRepository(FactureClient);
    const bonCommandeClientRepo = AppDataSource.getRepository(BonCommandeClient);
    const venteComptoireRepo = AppDataSource.getRepository(VenteComptoire); // ADD THIS: Import your VenteComptoire repository

    // Validate required fields
    if (!numeroFacture || !dateFacture || !client_id) {
      return res
        .status(400)
        .json({ message: "Les champs obligatoires sont manquants" });
    }

    console.log("boncommandeclientid:", boncommandeclientid);
    console.log("venteComptoire_id:", venteComptoire_id); // ADD THIS: Debug log

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

    // Check if bonCommandeClient exists
    let bonCommandeClient = null;
    if (boncommandeclientid) {
      bonCommandeClient = await bonCommandeClientRepo.findOneBy({
        id: parseInt(boncommandeclientid),
      });
      if (!bonCommandeClient) {
        return res
          .status(404)
          .json({ message: "Bon de commande client non trouvé" });
      }
    }

    // ADD THIS: Check if venteComptoire exists
    let venteComptoire = null;
    if (venteComptoire_id) {
      venteComptoire = await venteComptoireRepo.findOneBy({
        id: parseInt(venteComptoire_id),
      });
      if (!venteComptoire) {
        return res
          .status(404)
          .json({ message: "Vente comptoire non trouvée" });
      }
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
    const netAPayer =
      parseFloat(totalTTCAfterRemise || totalTTC || 0) -
      parseFloat(montantRetenue || 0);

    // Create the facture object
    const facture = {
      numeroFacture,
      dateFacture: new Date(dateFacture),
      dateEcheance: dateEcheance ? new Date(dateEcheance) : null,
      status: "Validee",
      conditions,
      bonCommandeClient: bonCommandeClient, // Set the relation object
      venteComptoire: venteComptoire, // ADD THIS: Set venteComptoire relation
      client: client,
      vendeur: vendeur,
      bonLivraison: bonLivraison,
      modeReglement: modeReglement,
      timbreFiscal: !!timbreFiscal,
      exoneration: !!exoneration,
      conditionPaiement: conditionPaiement || null,
      totalHT: parseFloat(totalHT || 0),
      totalTVA: parseFloat(totalTVA || 0),
      totalTTC: parseFloat(totalTTC || 0),
      totalTTCAfterRemise: parseFloat(totalTTCAfterRemise || totalTTC || 0),
      notes: notes || null,
      remise: parseFloat(remise || 0),
      remiseType: remiseType || "percentage",
      montantPaye: parseFloat(montantPaye || 0),
      resteAPayer: Math.max(0, netAPayer - parseFloat(montantPaye || 0)),
      paymentMethods: paymentMethods,
      totalPaymentAmount: parseFloat(totalPaymentAmount || 0),
      espaceNotes: espaceNotes || null,
      montantRetenue: parseFloat(montantRetenue || 0),
      hasRetenue: !!hasRetenue,
      depot: depot_id ? await depotRepo.findOneBy({ id: parseInt(depot_id) }) : null,
      articles: [],
    };

    console.log("Creating facture:", facture);

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
      const prix_ttc =
        parseFloat(item.prix_ttc) ||
        (tvaRate > 0 ? prixUnitaire * (1 + tvaRate / 100) : prixUnitaire);

      const factureArticle = {
        article: articleEntity,
        quantite: parseInt(item.quantite),
        prixUnitaire: prixUnitaire,
        prix_ttc: +prix_ttc.toFixed(3),
        designation: item.designation || articleEntity.designation || '', // Changed article to articleEntity
        tva: tvaRate,
        remise: item.remise ? parseFloat(item.remise) : 0,
      };
      facture.articles.push(factureArticle);

      // REDUCE STOCK ONLY IF DIRECT FACTURE (not from BL or Vente which already move stock)
      // Actually, user wants to reduce stock from selected depot.
      // If it's from VenteComptoire or BonLivraison, we assume they already handled it.
      if (!bonLivraison_id && !venteComptoire_id && facture.depot) {
        await updateDepotStock(AppDataSource.manager, articleEntity.id, facture.depot.id, -parseInt(item.quantite));
      }
    }

    const result = await factureRepo.save(facture);
    res.status(201).json(result);
  } catch (err) {
    console.error("Error creating facture:", err);
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
      depot_id,
      exoneration,
      timbreFiscal,
      articles,
      paymentMethods, // ADDED: paymentMethods field
    } = req.body;

    const factureRepo = AppDataSource.getRepository(FactureClient);
    const clientRepo = AppDataSource.getRepository(Client);
    const vendeurRepo = AppDataSource.getRepository(Vendeur);
    const articleRepo = AppDataSource.getRepository(Article);
    const depotRepo = AppDataSource.getRepository(Depot);

    // Vérifier si la facture existe
    const facture = await factureRepo.findOne({
      where: { id: parseInt(id) },
      relations: ["articles", "articles.article", "client", "vendeur", "depot", "venteComptoire", "bonLivraison"],
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
    facture.paymentMethods = paymentMethods; // ADDED: Update paymentMethods field

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

    // Depot
    if (depot_id) {
      const depot = await depotRepo.findOneBy({ id: parseInt(depot_id) });
      if (!depot) {
        return res.status(404).json({ message: "Depot non trouvé" });
      }
      facture.depot = depot;
    }

    // RESTORE OLD STOCK IF DIRECT FACTURE
    if (!facture.venteComptoire && !facture.bonLivraison && facture.depot && facture.articles) {
      for (const oldItem of facture.articles) {
        if (oldItem.article) {
          await updateDepotStock(AppDataSource.manager, oldItem.article.id, facture.depot.id, parseInt(oldItem.quantite));
        }
      }
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

        const prixUnitaire = parseFloat(item.prix_unitaire);
        const tvaRate = item.tva ? parseFloat(item.tva) : 0;

        // Calculate prix_ttc based on prix_unitaire and TVA
        // ✅ FIX: Use prix_ttc sent from frontend instead of calculating it
        const prix_ttc =
          parseFloat(item.prix_ttc) ||
          (tvaRate > 0 ? prixUnitaire * (1 + tvaRate / 100) : prixUnitaire);

        const factureArticle = {
          article: articleEntity,
          quantite: parseInt(item.quantite),
          prixUnitaire: prixUnitaire,
          prix_ttc: +prix_ttc.toFixed(3),
          designation: item.designation || articleEntity.designation || '', // Changed article to articleEntity
          // Use the TTC value from frontend
          tva: tvaRate,
          remise: item.remise ? parseFloat(item.remise) : 0,
        };

        console.log(factureArticle);
        newArticles.push(factureArticle);

        // REDUCE NEW STOCK IF DIRECT FACTURE
        if (!facture.venteComptoire && !facture.bonLivraison && facture.depot) {
          await updateDepotStock(AppDataSource.manager, articleEntity.id, facture.depot.id, -parseInt(item.quantite));
        }
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
    const prefix = "FACTURE-";
    const repo = AppDataSource.getRepository(FactureClient);

    // آخر Facture من نفس السنة
    const lastFacture = await repo
      .createQueryBuilder("fact")
      .where("fact.numeroFacture LIKE :pattern", {
        pattern: `${prefix}%/${year}`,
      })
      .orderBy("fact.id", "DESC")
      .getOne();

    let nextSeq = 1;

    if (lastFacture && lastFacture.numeroFacture) {
      // الصيغة: FACTURE-001/2026
      const [facturePart, yearPart] =
        lastFacture.numeroFacture.split("/");
      const lastYear = parseInt(yearPart, 10);

      if (lastYear === year) {
        const lastSeq = parseInt(facturePart.split("-")[1], 10);
        nextSeq = lastSeq + 1;
      }
    }

    let nextFactureNumber;

    while (true) {
      nextFactureNumber = `${prefix}${String(nextSeq).padStart(
        3,
        "0"
      )}/${year}`;

      const exists = await repo.findOne({
        where: { numeroFacture: nextFactureNumber },
      });

      if (!exists) break;
      nextSeq++;
    }

    res.status(200).json({ numeroFacture: nextFactureNumber });
  } catch (error) {
    console.error("❌ Error generating facture number:", error);
    res.status(500).json({ message: error.message });
  }
};

