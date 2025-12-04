const { AppDataSource } = require("../db");
const { Article } = require("../entities/Article");
const { Client } = require("../entities/Client");
const { Vendeur } = require("../entities/Vendeur");
const {
  VenteComptoire,
  VenteComptoireArticle,
} = require("../entities/VenteComptoire");

exports.createVenteComptoire = async (req, res) => {
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
      // ✅ ADD PAYMENT FIELDS
      paymentMethods,
      totalPaymentAmount,
      espaceNotes,
    } = req.body;

    const clientRepo = AppDataSource.getRepository(Client);
    const vendeurRepo = AppDataSource.getRepository(Vendeur);
    const articleRepo = AppDataSource.getRepository(Article);
    const venteRepo = AppDataSource.getRepository(VenteComptoire);

    if (!numeroCommande || !client_id || !vendeur_id || !dateCommande) {
      return res
        .status(400)
        .json({ message: "Les champs obligatoires sont manquants" });
    }

    const client = await clientRepo.findOneBy({ id: parseInt(client_id) });
    if (!client) return res.status(404).json({ message: "Client non trouvé" });

    const vendeur = await vendeurRepo.findOneBy({ id: parseInt(vendeur_id) });
    if (!vendeur)
      return res.status(404).json({ message: "Vendeur non trouvé" });

    if (!articles || !Array.isArray(articles) || articles.length === 0) {
      return res.status(400).json({ message: "Les articles sont requis" });
    }

    const vente = {
      numeroCommande,
      dateCommande: new Date(dateCommande),
      remise: parseFloat(remise) || 0,
      remiseType: remiseType || "percentage",
      notes: notes || null,
      client,
      vendeur,
      taxMode,
      // ✅ ADD PAYMENT DATA
      paymentMethods: paymentMethods || [],
      totalPaymentAmount: parseFloat(totalPaymentAmount) || 0,
      espaceNotes: espaceNotes || null,
      articles: [],
    };

    let subTotal = 0;
    let totalTax = 0;
    let grandTotal = 0;

    for (const item of articles) {
      const article = await articleRepo.findOneBy({
        id: parseInt(item.article_id),
      });
      if (!article) {
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

      const tvaRate =
        item.tva != null ? parseFloat(item.tva) : article.tva || 0;
      let prixUnitaire = parseFloat(item.prix_unitaire);

      // CALCULATE prix_ttc BASED ON prix_unitaire AND TVA
      let prix_ttc = item.prix_ttc ? parseFloat(item.prix_ttc) : null;
      if (!prix_ttc) {
        // If prix_ttc not provided, calculate it from prix_unitaire and TVA
        prix_ttc = prixUnitaire * (1 + tvaRate / 100);
      } else {
        // If prix_ttc is provided, ensure prix_unitaire is consistent
        if (taxMode === "TTC") {
          prixUnitaire = prix_ttc / (1 + tvaRate / 100);
        }
      }

      const quantite = parseInt(item.quantite);
      const remiseRate = item.remise ? parseFloat(item.remise) : 0;
      const montantHTLigne = quantite * prixUnitaire * (1 - remiseRate / 100);
      const montantTTCLigne = quantite * prix_ttc; // Use prix_ttc for TTC calculation
      const taxAmount = montantTTCLigne - montantHTLigne;

      subTotal += montantHTLigne;
      totalTax += taxAmount;
      grandTotal += montantTTCLigne;

      const venteArticle = {
        article,
        quantite,
        prixUnitaire,
        prix_ttc: prix_ttc, // SAVE prix_ttc IN DATABASE
        tva: tvaRate,
        remise: remiseRate || null,
      };
      vente.articles.push(venteArticle);
    }

    const totalAfterRemise =
      remiseType === "percentage"
        ? grandTotal * (1 - parseFloat(remise) / 100)
        : parseFloat(remise);

    // SAVE THE CALCULATED totalAfterRemise IN THE ENTITY
    vente.totalAfterRemise = totalAfterRemise;

    const result = await venteRepo.save(vente);
    res.status(201).json({
      ...result,
      subTotal: subTotal.toFixed(3),
      totalTax: totalTax.toFixed(3),
      grandTotal: grandTotal.toFixed(3),
      totalAfterRemise: totalAfterRemise.toFixed(3),
    });
    console.log("Total After Remise saved:", totalAfterRemise);
  } catch (err) {
    console.error(err);
    res.status(500).json({ message: "Erreur serveur", error: err.message });
  }
};

exports.updateVenteComptoire = async (req, res) => {
  try {
    const venteRepo = AppDataSource.getRepository(VenteComptoire);
    const articleRepo = AppDataSource.getRepository(Article);
    const venteArticleRepo = AppDataSource.getRepository(VenteComptoireArticle);
    const clientRepo = AppDataSource.getRepository(Client);
    const vendeurRepo = AppDataSource.getRepository(Vendeur);

    // --- Load existing vente comptoire ---
    const vente = await venteRepo.findOne({
      where: { id: parseInt(req.params.id) },
      relations: ["articles", "articles.article", "client", "vendeur"],
    });

    if (!vente) {
      return res.status(404).json({ message: "Vente comptoir non trouvée" });
    }

    // --- Update parent scalar fields ---
    const updates = {};
    if (req.body.dateCommande)
      updates.dateCommande = new Date(req.body.dateCommande);
    if (req.body.remise !== undefined)
      updates.remise = parseFloat(req.body.remise);
    if (req.body.remiseType) updates.remiseType = req.body.remiseType;
    if (req.body.notes !== undefined) updates.notes = req.body.notes;
    if (req.body.taxMode) updates.taxMode = req.body.taxMode;

    // ✅ ADD PAYMENT UPDATES
    if (req.body.paymentMethods !== undefined)
      updates.paymentMethods = req.body.paymentMethods;
    if (req.body.totalPaymentAmount !== undefined)
      updates.totalPaymentAmount = parseFloat(req.body.totalPaymentAmount);
    if (req.body.espaceNotes !== undefined)
      updates.espaceNotes = req.body.espaceNotes;

    // CALCULATE AND SAVE totalAfterRemise IN UPDATE
    if (
      req.body.remise !== undefined ||
      req.body.remiseType ||
      req.body.articles
    ) {
      let grandTotal = 0;

      // Recalculate grand total from articles
      if (req.body.articles && Array.isArray(req.body.articles)) {
        for (const item of req.body.articles) {
          const prixUnitaire = parseFloat(item.prix_unitaire);
          const tvaRate = item.tva ? parseFloat(item.tva) : 0;
          const remiseRate = item.remise ? parseFloat(item.remise) : 0;
          const quantite = parseInt(item.quantite);

          // CALCULATE prix_ttc FROM prix_unitaire AND TVA
          const prix_ttc = item.prix_ttc
            ? parseFloat(item.prix_ttc)
            : prixUnitaire * (1 + tvaRate / 100);

          const montantHTLigne =
            quantite * prixUnitaire * (1 - remiseRate / 100);
          const montantTTCLigne = quantite * prix_ttc; // Use prix_ttc for TTC calculation
          grandTotal += montantTTCLigne;
        }
      } else {
        // Use existing articles if not provided in update
        vente.articles.forEach((item) => {
          const montantHTLigne =
            item.quantite * item.prixUnitaire * (1 - (item.remise || 0) / 100);
          const montantTTCLigne =
            item.quantite *
            (item.prix_ttc || item.prixUnitaire * (1 + (item.tva || 0) / 100));
          grandTotal += montantTTCLigne;
        });
      }

      const remiseValue =
        req.body.remise !== undefined
          ? parseFloat(req.body.remise)
          : vente.remise;
      const remiseTypeValue = req.body.remiseType || vente.remiseType;

      const totalAfterRemise =
        remiseTypeValue === "percentage"
          ? grandTotal * (1 - remiseValue / 100)
          : remiseValue;

      updates.totalAfterRemise = totalAfterRemise;
    }

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

    // --- Apply updates to parent record ---
    await venteRepo.update(vente.id, updates);

    // --- Handle articles (with deletion & insertion logic) ---
    if (req.body.articles && Array.isArray(req.body.articles)) {
      // 1️⃣ Load current articles in the vente
      const currentArticles = await venteArticleRepo.find({
        where: { venteComptoire: { id: vente.id } },
        relations: ["article", "venteComptoire"],
      });

      // 2️⃣ Delete any removed articles
      for (const oldItem of currentArticles) {
        const existsInNew = req.body.articles.some(
          (a) => parseInt(a.article_id) === oldItem.article.id
        );
        if (!existsInNew) {
          await venteArticleRepo.remove(oldItem);
        }
      }

      // 3️⃣ Update existing or insert new articles
      for (const item of req.body.articles) {
        const article = await articleRepo.findOneBy({
          id: parseInt(item.article_id),
        });
        if (!article) {
          return res.status(404).json({
            message: `Article avec ID ${item.article_id} non trouvé`,
          });
        }

        const prixUnitaire = parseFloat(item.prix_unitaire);
        const tvaRate = item.tva ? parseFloat(item.tva) : 0;
        // CALCULATE prix_ttc FROM prix_unitaire AND TVA
        const prix_ttc = item.prix_ttc
          ? parseFloat(item.prix_ttc)
          : prixUnitaire * (1 + tvaRate / 100);

        const existing = await venteArticleRepo.findOne({
          where: {
            venteComptoire: { id: vente.id },
            article: { id: article.id },
          },
          relations: ["article", "venteComptoire"],
        });

        if (existing) {
          // Update existing line
          existing.quantite = parseInt(item.quantite);
          existing.prixUnitaire = prixUnitaire;
          existing.prix_ttc = prix_ttc; // UPDATE prix_ttc
          existing.tva = tvaRate;
          existing.remise = item.remise ? parseFloat(item.remise) : null;
          await venteArticleRepo.save(existing);
        } else {
          // Insert new line
          const venteArticle = venteArticleRepo.create({
            venteComptoire: { id: vente.id },
            article,
            quantite: parseInt(item.quantite),
            prixUnitaire,
            prix_ttc: prix_ttc, // SAVE prix_ttc
            tva: tvaRate,
            remise: item.remise ? parseFloat(item.remise) : null,
          });
          await venteArticleRepo.save(venteArticle);
        }
      }
    }

    // --- Reload and return updated vente ---
    const updatedVente = await venteRepo.findOne({
      where: { id: vente.id },
      relations: ["client", "vendeur", "articles", "articles.article"],
    });

    res.json(updatedVente);
  } catch (err) {
    console.error("Erreur updateVenteComptoire:", err);
    res.status(500).json({ message: "Erreur serveur", error: err.message });
  }
};

exports.getAllVenteComptoire = async (req, res) => {
  try {
    const repo = AppDataSource.getRepository(VenteComptoire);
    const list = await repo.find({
      relations: ["client", "vendeur", "articles", "articles.article"],
    });

    const enhancedList = list.map((vente) => {
      let subTotal = 0;
      let totalTax = 0;
      let grandTotal = 0;

      vente.articles.forEach((item) => {
        const qty = item.quantite || 1;
        const price = item.prixUnitaire || 0;
        const tvaRate = item.tva || 0;
        const remiseRate = item.remise || 0;

        const montantHTLigne = qty * price * (1 - remiseRate / 100);
        const montantTTCLigne = montantHTLigne * (1 + tvaRate / 100);
        const taxAmount = montantTTCLigne - montantHTLigne;

        subTotal += montantHTLigne;
        totalTax += taxAmount;
        grandTotal += montantTTCLigne;
      });

      const totalAfterRemise =
        vente.remiseType === "percentage"
          ? grandTotal * (1 - parseFloat(vente.remise) / 100)
          : parseFloat(vente.remise);

      return {
        ...vente,
        subTotal: subTotal.toFixed(3),
        totalTax: totalTax.toFixed(3),
        grandTotal: grandTotal.toFixed(3),
        totalAfterRemise: totalAfterRemise.toFixed(3),
      };
    });

    res.json(enhancedList);
  } catch (err) {
    console.error(err);
    res.status(500).json({ message: "Erreur serveur" });
  }
};

exports.deleteVenteComptoire = async (req, res) => {
  try {
    const venteArticleRepo = AppDataSource.getRepository(VenteComptoireArticle);
    const venteRepo = AppDataSource.getRepository(VenteComptoire);

    await venteArticleRepo.delete({
      venteComptoire: { id: parseInt(req.params.id) },
    });
    const result = await venteRepo.delete(req.params.id);

    if (result.affected === 0)
      return res.status(404).json({ message: "Vente non trouvée" });
    res.status(200).json({ message: "Vente supprimée avec succès" });
  } catch (err) {
    console.error(err);
    res.status(500).json({ message: "Erreur serveur", error: err.message });
  }
};

exports.fetchNextVenteComptoireNumber = async (req, res) => {
  try {
    const repo = AppDataSource.getRepository(VenteComptoire);
    const lastVente = await repo.findOne({
      where: {},
      order: { id: "DESC" },
    });

    const currentYear = new Date().getFullYear();
    const DEFAULT_START_SEQ = 948; // ← هنا

    let nextNumber;

    if (lastVente) {
      const [prefix, yearPart] = lastVente.numeroCommande.split("/");
      const lastSeq = parseInt(prefix.split("-")[1], 10);

      if (parseInt(yearPart, 10) === currentYear) {
        const base = Math.max(lastSeq + 1, DEFAULT_START_SEQ);
        const newSeq = base.toString().padStart(4, "0");
        nextNumber = `VENTE-${newSeq}/${currentYear}`;
      } else {
        // بداية سنة جديدة → ممكن تبقى 0001 أو 0925 حسب رغبتك
        const newSeq = DEFAULT_START_SEQ.toString().padStart(4, "0");
        nextNumber = `VENTE-${newSeq}/${currentYear}`;
      }
    } else {
      // أول عملية إطلاقاً
      const newSeq = DEFAULT_START_SEQ.toString().padStart(4, "0");
      nextNumber = `VENTE-${newSeq}/${currentYear}`;
    }

    res.json({ numeroCommande: nextNumber });
  } catch (err) {
    console.error(err);
    res.status(500).json({ message: "Erreur serveur", error: err.message });
  }
};
