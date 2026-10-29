const { AppDataSource } = require("../db");
const { Article } = require("../entities/Article");
const { Fournisseur } = require("../entities/Fournisseur");
const { BonCommande, BonCommandeArticle } = require("../entities/BonCommande");

// Optional numeric field from the form ("" / null / undefined → null)
const parseOptionalNumber = (value) => {
  if (value === undefined || value === null || value === "") return null;
  const num = parseFloat(value);
  return isNaN(num) ? null : num;
};

// Totals are computed by the frontend with the same engine as the ventes pages;
// fall back to the backend computation only when they are not sent.
const pickTotal = (sent, computed) => {
  const value = parseOptionalNumber(sent);
  return Math.round((value !== null ? value : computed) * 1000) / 1000;
};

exports.createBonCommande = async (req, res) => {
  try {
    const {
      numeroCommande,
      dateCommande,
      status,
      remise,
      remiseType,
      notes,
      fournisseur_id,
      articles,
      taxMode,
      montant_fodec,
    } = req.body;
    console.log(numeroCommande);
    const fournisseurRepo = AppDataSource.getRepository(Fournisseur);
    const articleRepo = AppDataSource.getRepository(Article);
    const bonRepo = AppDataSource.getRepository(BonCommande);

    if (!numeroCommande || !fournisseur_id || !dateCommande || !status) {
      return res
        .status(400)
        .json({ message: "Les champs obligatoires sont manquants" });
    }

    if (!["percentage", "fixed"].includes(remiseType)) {
      return res.status(400).json({
        message: 'Type de remise invalide (doit être "percentage" ou "fixed")',
      });
    }

    const fournisseur = await fournisseurRepo.findOneBy({
      id: parseInt(fournisseur_id),
    });
    if (!fournisseur)
      return res.status(404).json({ message: "Fournisseur non trouvé" });

    if (!articles || !Array.isArray(articles) || articles.length === 0) {
      return res.status(400).json({ message: "Les articles sont requis" });
    }

    let calculatedFodec = 0;
    let subTotal = 0;
    let totalTax = 0;
    let grandTotal = 0;

    const bonCommandeArticles = [];
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
      // 0% chosen on the line must stay 0, not fall back to the article TVA
      const lineTva = parseOptionalNumber(item.tva);
      const tvaRate = lineTva !== null ? lineTva : article.tva || 0;
      const remiseRate = item.remise ? parseFloat(item.remise) : 0;
      const tauxFodec =
        item.taux_fodec !== undefined
          ? Boolean(item.taux_fodec)
          : article.taux_fodec;

      if (!item.quantite || !item.prix_unitaire) {
        return res.status(400).json({
          message:
            "Quantité et prix unitaire sont obligatoires pour chaque article",
        });
      }

      const quantite = parseInt(item.quantite);
      const montantHTLigne = quantite * prixUnitaire * (1 - remiseRate / 100);
      const montantTTCLigne = montantHTLigne * (1 + tvaRate / 100);
      const taxAmount = montantTTCLigne - montantHTLigne;
      const fodecAmount = tauxFodec ? montantHTLigne * 0.01 : 0;

      subTotal += montantHTLigne;
      totalTax += taxAmount;
      grandTotal += montantTTCLigne;
      calculatedFodec += fodecAmount;

      article.qte_virtual = (article.qte_virtual || 0) + quantite;
      await articleRepo.save(article);

      bonCommandeArticles.push({
        article,
        quantite,
        prixUnitaire,
        prix_ttc: parseOptionalNumber(item.prix_ttc),
        tva: tvaRate,
        remise: remiseRate,
        taux_fodec: tauxFodec,
      });
    }

    const finalRemise = parseFloat(remise) || 0;
    let finalTotal = grandTotal;
    if (finalRemise > 0) {
      if (remiseType === "percentage") {
        finalTotal = grandTotal * (1 - finalRemise / 100);
      } else {
        finalTotal = finalRemise;
      }
    }

    const bonCommande = {
      numeroCommande,
      dateCommande: new Date(dateCommande),
      status: "Confirme",
      remise: finalRemise,
      remiseType,
      totalHT: pickTotal(req.body.totalHT, subTotal),
      totalTVA: pickTotal(req.body.totalTVA, totalTax),
      totalTTC: pickTotal(req.body.totalTTC, finalTotal),
      notes: notes || null,
      fournisseur,
      taxMode,
      montant_fodec:
        montant_fodec !== undefined
          ? parseFloat(montant_fodec)
          : calculatedFodec,
      articles: bonCommandeArticles,
    };

    const result = await bonRepo.save(bonCommande);
    res.status(201).json(result);
  } catch (err) {
    console.error(err);
    res.status(500).json({ message: "Erreur serveur", error: err.message });
  }
};

exports.updateBonCommande = async (req, res) => {
  try {
    const { id } = req.params;
    const {
      numeroCommande,
      dateCommande,
      status,
      remise,
      remiseType,
      notes,
      fournisseur_id,
      articles,
      taxMode,
      montant_fodec,
    } = req.body;

    const bonRepo = AppDataSource.getRepository(BonCommande);
    const fournisseurRepo = AppDataSource.getRepository(Fournisseur);
    const articleRepo = AppDataSource.getRepository(Article);
    const bonArticleRepo = AppDataSource.getRepository(BonCommandeArticle);

    // Get bon de commande + articles
    const bonCommande = await bonRepo.findOne({
      where: { id: parseInt(id) },
      relations: ["articles", "articles.article"],
    });

    if (!bonCommande) {
      return res.status(404).json({ message: "Bon de commande non trouvé" });
    }

    // Validation
    if (!numeroCommande || !fournisseur_id || !dateCommande) {
      return res
        .status(400)
        .json({ message: "Les champs obligatoires sont manquants" });
    }

    if (!["percentage", "fixed"].includes(remiseType)) {
      return res.status(400).json({
        message: 'Type de remise invalide (doit être "percentage" ou "fixed")',
      });
    }

    const fournisseur = await fournisseurRepo.findOneBy({
      id: parseInt(fournisseur_id),
    });
    if (!fournisseur) {
      return res.status(404).json({ message: "Fournisseur non trouvé" });
    }

    if (!articles || !Array.isArray(articles) || articles.length === 0) {
      return res.status(400).json({ message: "Les articles sont requis" });
    }

    // --- Restore virtual stock for old articles ---
    for (const bonArticle of bonCommande.articles) {
      const article = bonArticle.article;
      article.qte_virtual = (article.qte_virtual || 0) - bonArticle.quantite;
      await articleRepo.save(article);
    }

    // --- 🧹 Delete the old lines: the new list below is re-inserted in full ---
    await bonArticleRepo.delete({ bonCommande: { id: bonCommande.id } });

    // --- Recalculate totals ---
    let calculatedFodec = 0;
    let subTotal = 0;
    let totalTax = 0;
    let grandTotal = 0;

    const bonCommandeArticles = [];
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
        return res
          .status(400)
          .json({ message: "Quantité et prix unitaire sont obligatoires" });
      }

      let prixUnitaire = parseFloat(item.prix_unitaire);
      const tvaRate = parseOptionalNumber(item.tva) || 0;
      const remiseRate = item.remise ? parseFloat(item.remise) : 0;
      const tauxFodec =
        item.taux_fodec !== undefined
          ? Boolean(item.taux_fodec)
          : article.taux_fodec;

      if (taxMode === "TTC") {
        prixUnitaire = prixUnitaire / (1 + tvaRate / 100);
      }

      const quantite = parseInt(item.quantite);
      const montantHTLigne = quantite * prixUnitaire * (1 - remiseRate / 100);
      const montantTTCLigne = montantHTLigne * (1 + tvaRate / 100);
      const taxAmount = montantTTCLigne - montantHTLigne;
      const fodecAmount = tauxFodec ? montantHTLigne * 0.01 : 0;

      subTotal += montantHTLigne;
      totalTax += taxAmount;
      grandTotal += montantTTCLigne;
      calculatedFodec += fodecAmount;

      // Update virtual stock
      article.qte_virtual = (article.qte_virtual || 0) + quantite;
      await articleRepo.save(article);

      bonCommandeArticles.push({
        article,
        quantite,
        prixUnitaire,
        prix_ttc: parseOptionalNumber(item.prix_ttc),
        tva: tvaRate,
        remise: remiseRate,
        taux_fodec: tauxFodec,
      });
    }

    // --- Apply remise ---
    const finalRemise = parseFloat(remise) || 0;
    let finalTotal = grandTotal;
    if (finalRemise > 0) {
      if (remiseType === "percentage") {
        finalTotal = grandTotal * (1 - finalRemise / 100);
      } else {
        finalTotal = finalRemise;
      }
    }

    // --- Update bon commande ---
    bonCommande.numeroCommande = numeroCommande;
    bonCommande.dateCommande = new Date(dateCommande);
    bonCommande.status = status;
    bonCommande.remise = finalRemise;
    bonCommande.remiseType = remiseType;
    bonCommande.totalHT = pickTotal(req.body.totalHT, subTotal);
    bonCommande.totalTVA = pickTotal(req.body.totalTVA, totalTax);
    bonCommande.totalTTC = pickTotal(req.body.totalTTC, finalTotal);
    bonCommande.notes = notes || null;
    bonCommande.fournisseur = fournisseur;
    bonCommande.taxMode = taxMode;
    bonCommande.montant_fodec =
      montant_fodec !== undefined ? parseFloat(montant_fodec) : calculatedFodec;
    bonCommande.articles = bonCommandeArticles;

    const result = await bonRepo.save(bonCommande);
    res.status(200).json(result);
  } catch (err) {
    console.error("Erreur updateBonCommande:", err);
    res.status(500).json({ message: "Erreur serveur", error: err.message });
  }
};

exports.getAllBonCommande = async (req, res) => {
  try {
    const repo = AppDataSource.getRepository(BonCommande);
    const list = await repo.find({
      relations: ["fournisseur", "articles", "articles.article"],
    });
    res.json(list);
    console.log(list);
  } catch (err) {
    console.error(err);
    res.status(500).json({ message: "Erreur serveur", error: err.message });
  }
};

// Same two-step pagination as the ventes lists: paginate the ids with the
// filters, then load the full bons (articles, fournisseur) for that page only.
exports.getBonCommandePaginated = async (req, res) => {
  try {
    const { page = 1, limit = 10, search = "", status = "", startDate, endDate } = req.query;
    const pageNum = Math.max(1, parseInt(page) || 1);
    const limitNum = Math.max(1, parseInt(limit) || 10);
    const repo = AppDataSource.getRepository(BonCommande);

    const idQb = repo
      .createQueryBuilder("bc")
      .leftJoin("bc.fournisseur", "fournisseur")
      .select(["bc.id", "bc.dateCommande"]);

    if (search) {
      idQb.andWhere(
        "(bc.numeroCommande ILIKE :search OR fournisseur.raison_sociale ILIKE :search)",
        { search: `%${search}%` }
      );
    }
    if (status) {
      idQb.andWhere("bc.status = :status", { status });
    }
    if (startDate) {
      idQb.andWhere("bc.dateCommande >= :startDate", { startDate });
    }
    if (endDate) {
      const end = new Date(endDate);
      end.setHours(23, 59, 59, 999);
      idQb.andWhere("bc.dateCommande <= :endDate", { endDate: end });
    }

    const totalCount = await idQb.getCount();
    const idResults = await idQb
      .orderBy("bc.dateCommande", "DESC")
      .addOrderBy("bc.id", "DESC")
      .skip((pageNum - 1) * limitNum)
      .take(limitNum)
      .getMany();

    const ids = idResults.map((b) => b.id);
    const pagination = {
      totalCount,
      page: pageNum,
      limit: limitNum,
      totalPages: Math.ceil(totalCount / limitNum),
    };

    if (ids.length === 0) {
      return res.json({ bons: [], pagination });
    }

    const bons = await repo
      .createQueryBuilder("bc")
      .leftJoinAndSelect("bc.fournisseur", "fournisseur")
      .leftJoinAndSelect("bc.articles", "articles")
      .leftJoinAndSelect("articles.article", "article")
      .where("bc.id IN (:...ids)", { ids })
      .orderBy("bc.dateCommande", "DESC")
      .addOrderBy("bc.id", "DESC")
      .addOrderBy("articles.id", "ASC")
      .getMany();

    res.json({ bons, pagination });
  } catch (err) {
    console.error("Pagination error:", err);
    res.status(500).json({ message: "Erreur serveur lors de la pagination", error: err.message });
  }
};

exports.deleteBonCommande = async (req, res) => {
  try {
    const bonArticleRepo = AppDataSource.getRepository("BonCommandeArticle");
    const bonRepo = AppDataSource.getRepository("BonCommande");

    await bonArticleRepo.delete({
      bonCommande: { id: parseInt(req.params.id) },
    });
    const result = await bonRepo.delete(req.params.id);

    if (result.affected === 0) {
      return res.status(404).json({ message: "Bon de commande non trouvé" });
    }

    res.status(200).json({ message: "Bon de commande supprimé avec succès" });
  } catch (err) {
    console.error(err);
    res.status(500).json({ message: "Erreur serveur", error: err.message });
  }
};

exports.annulerBonCommande = async (req, res) => {
  try {
    const bonRepo = AppDataSource.getRepository(BonCommande);
    const articleRepo = AppDataSource.getRepository(Article);

    const bonCommande = await bonRepo.findOne({
      where: { id: parseInt(req.params.id) },
      relations: ["articles", "articles.article"],
    });

    if (!bonCommande) {
      return res.status(404).json({ message: "Bon de commande non trouvé" });
    }

    if (bonCommande.status === "Annule") {
      return res.status(400).json({ message: "Ce bon est déjà annulé" });
    }

    for (const bonArticle of bonCommande.articles) {
      const article = bonArticle.article;
      article.qte_virtual = (article.qte_virtual || 0) - bonArticle.quantite;
      await articleRepo.save(article);
    }

    bonCommande.status = "Annule";
    await bonRepo.save(bonCommande);

    res.status(200).json({ message: "Bon de commande annulé avec succès" });
  } catch (err) {
    console.error(err);
    res.status(500).json({ message: "Erreur serveur", error: err.message });
  }
};

exports.getNextCommandeNumber = async (req, res) => {
  try {
    const year = new Date().getFullYear();
    const prefix = "BC";

    const repo = AppDataSource.getRepository(BonCommande);
    // Keep the highest sequence (string ordering is wrong with mixed padding)
    const commandes = await repo
      .createQueryBuilder("bc")
      .select(["bc.id", "bc.numeroCommande"])
      .where("bc.numeroCommande ILIKE :pattern", {
        pattern: `${prefix}-%/${year}`,
      })
      .getMany();

    const numeroRegex = new RegExp(`^${prefix}-(\\d+)/${year}$`, "i");
    const lastNumber = commandes.reduce((max, { numeroCommande }) => {
      const match = numeroCommande?.trim().match(numeroRegex);
      return match ? Math.max(max, parseInt(match[1], 10)) : max;
    }, 0);

    const nextNumber = lastNumber + 1;

    const nextCommandeNumber = `${prefix}-${nextNumber
      .toString()
      .padStart(3, "0")}/${year}`;
    res.json({ numeroCommande: nextCommandeNumber });
  } catch (err) {
    console.error(err);
    res.status(500).json({
      message: "Erreur lors de la génération du numéro de commande",
      error: err.message,
    });
  }
};
