const { AppDataSource } = require("../db");
const { Article } = require("../entities/Article");
const { Fournisseur } = require("../entities/Fournisseur");
const { BonCommande } = require("../entities/BonCommande");

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
console.log(numeroCommande)
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
      const tvaRate = item.tva ? parseFloat(item.tva) : article.tva || 0;
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
      status : "Confirme",
      remise: finalRemise,
      remiseType,
      totalHT: subTotal.toFixed(2),
      totalTVA: totalTax.toFixed(2),
      totalTTC: finalTotal.toFixed(2),
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
    const bonArticleRepo = AppDataSource.getRepository(BonCommande);

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
      return res.status(400).json({ message: "Les champs obligatoires sont manquants" });
    }

    if (!["percentage", "fixed"].includes(remiseType)) {
      return res.status(400).json({
        message: 'Type de remise invalide (doit être "percentage" ou "fixed")',
      });
    }

    const fournisseur = await fournisseurRepo.findOneBy({ id: parseInt(fournisseur_id) });
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

    // --- 🧹 Delete removed articles (not in the updated list) ---
    const newArticleIds = articles.map((a) => parseInt(a.article_id));
    const oldArticlesToDelete = bonCommande.articles.filter(
      (ba) => !newArticleIds.includes(ba.article.id)
    );

    if (oldArticlesToDelete.length > 0) {
      for (const oldItem of oldArticlesToDelete) {
        await bonArticleRepo.delete({ id: oldItem.id });
      }
    }

    // --- Recalculate totals ---
    let calculatedFodec = 0;
    let subTotal = 0;
    let totalTax = 0;
    let grandTotal = 0;

    const bonCommandeArticles = [];
    for (const item of articles) {
      const article = await articleRepo.findOneBy({ id: parseInt(item.article_id) });
      if (!article) {
        return res.status(404).json({ message: `Article avec ID ${item.article_id} non trouvé` });
      }

      if (!item.quantite || !item.prix_unitaire) {
        return res.status(400).json({ message: "Quantité et prix unitaire sont obligatoires" });
      }

      let prixUnitaire = parseFloat(item.prix_unitaire);
      const tvaRate = item.tva ? parseFloat(item.tva) : 0;
      const remiseRate = item.remise ? parseFloat(item.remise) : 0;
      const tauxFodec =
        item.taux_fodec !== undefined ? Boolean(item.taux_fodec) : article.taux_fodec;

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
    bonCommande.totalHT = subTotal.toFixed(2);
    bonCommande.totalTVA = totalTax.toFixed(2);
    bonCommande.totalTTC = finalTotal.toFixed(2);
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
    console.log(list)
  } catch (err) {
    console.error(err);
    res.status(500).json({ message: "Erreur serveur", error: err.message });
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
    const lastCommande = await repo
      .createQueryBuilder("bc")
      .where("bc.numeroCommande LIKE :pattern", {
        pattern: `${prefix}-%/${year}`,
      })
      .orderBy("bc.numeroCommande", "DESC")
      .getOne();

    let nextNumber = 1;
    if (lastCommande && lastCommande.numeroCommande) {
      const match = lastCommande.numeroCommande.match(
        new RegExp(`^${prefix}-(\\d{4})/${year}$`)
      );
      if (match) {
        nextNumber = parseInt(match[1], 10) + 1;
      }
    }

    const nextCommandeNumber = `${prefix}-${nextNumber
      .toString()
      .padStart(4, "0")}/${year}`;
    res.json({ numeroCommande: nextCommandeNumber });
  } catch (err) {
    console.error(err);
    res.status(500).json({
      message: "Erreur lors de la génération du numéro de commande",
      error: err.message,
    });
  }
};
