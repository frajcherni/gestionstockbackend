const { AppDataSource } = require("../db");
const { Article } = require("../entities/Article");
const { Fournisseur } = require("../entities/Fournisseur");
const { BonReception } = require("../entities/BonReception");
const {
  FactureFournisseur,
  FactureFournisseurArticle,
} = require("../entities/FactureFournisseur");

exports.createFactureFournisseur = async (req, res) => {
  try {
    const {
      numeroFacture,
      dateFacture,
      status,
      notes,
      fournisseur_id,
      bonReception_id,
      articles,
      modeReglement,
      dateEcheance,
      montantPaye,
      resteAPayer,
      remise,
      remiseType,
      totalHT,
      totalTVA,
      totalTTC,
      timbreFiscal,
      conditionPaiement,
    } = req.body;

    const fournisseurRepo = AppDataSource.getRepository(Fournisseur);
    const bonReceptionRepo = AppDataSource.getRepository(BonReception);
    const articleRepo = AppDataSource.getRepository(Article);
    const factureRepo = AppDataSource.getRepository(FactureFournisseur);

    // Validate required fields
    if (!numeroFacture || !dateFacture || !fournisseur_id) {
      return res
        .status(400)
        .json({ message: "Les champs obligatoires sont manquants" });
    }

    const fournisseur = await fournisseurRepo.findOneBy({
      id: parseInt(fournisseur_id),
    });
    if (!fournisseur)
      return res.status(404).json({ message: "Fournisseur non trouvé" });

    let bonReception = null;
    if (bonReception_id) {
      bonReception = await bonReceptionRepo.findOneBy({
        id: parseInt(bonReception_id),
      });
      if (!bonReception)
        return res.status(404).json({ message: "Bon de réception non trouvé" });
    }

    const facture = {
      numeroFacture,
      dateFacture: new Date(dateFacture),
      status : "Validee",
      notes: notes || null,
      fournisseur,
      bonReception,
      conditionPaiement: conditionPaiement || null,
      modeReglement: modeReglement || null,
      dateEcheance: dateEcheance ? new Date(dateEcheance) : null,
      montantPaye: parseFloat(montantPaye || 0),
      resteAPayer: parseFloat(resteAPayer || 0),
      remise: parseFloat(remise || 0),
      remiseType: remiseType || "percentage",
      totalHT: parseFloat(totalHT || 0),
      totalTVA: parseFloat(totalTVA || 0),
      totalTTC: parseFloat(totalTTC || 0) ,// Include timbreFiscal in totalTTC
      timbreFiscal: !!timbreFiscal, // Save timbreFiscal as boolean
      articles: [],
    };
    console.log(facture)

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
        return res
          .status(400)
          .json({
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

exports.getAllFacturesFournisseur = async (req, res) => {
  try {
    const repo = AppDataSource.getRepository(FactureFournisseur);
    const list = await repo.find({
      relations: [
        "fournisseur",
        "bonReception",
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

exports.updateFactureFournisseur = async (req, res) => {
    try {
      const {
        numeroFacture,
        dateFacture,
        status,
        notes,
        fournisseur_id,
        bonReception_id,
        articles,
        modeReglement,
        dateEcheance,
        montantPaye,
        resteAPayer,
        remise,
        remiseType,
        totalHT,
        totalTVA,
        totalTTC,
        timbreFiscal,
        conditionPaiement,
      } = req.body;
  
      const repo = AppDataSource.getRepository(FactureFournisseur);
      const articleRepo = AppDataSource.getRepository(Article);
      const fournisseurRepo = AppDataSource.getRepository(Fournisseur);
      const bonReceptionRepo = AppDataSource.getRepository(BonReception);
      const factureArticleRepo = AppDataSource.getRepository(FactureFournisseurArticle);
  
      const facture = await repo.findOne({
        where: { id: parseInt(req.params.id) },
        relations: ["articles", "articles.article", "fournisseur", "bonReception"],
      });
  
      if (!facture) {
        return res.status(404).json({ message: "Facture fournisseur non trouvée" });
      }
  
      // ✅ Update basic fields
      facture.numeroFacture = numeroFacture || facture.numeroFacture;
      facture.dateFacture = dateFacture ? new Date(dateFacture) : facture.dateFacture;
      facture.status = status || facture.status;
      facture.notes = notes || facture.notes;
      facture.modeReglement = modeReglement || facture.modeReglement;
      facture.dateEcheance = dateEcheance ? new Date(dateEcheance) : facture.dateEcheance;
      facture.montantPaye = parseFloat(montantPaye ?? facture.montantPaye ?? 0);
      facture.resteAPayer = parseFloat(resteAPayer ?? facture.resteAPayer ?? 0);
      facture.remise = parseFloat(remise ?? facture.remise ?? 0);
      facture.remiseType = remiseType || facture.remiseType;
      facture.totalHT = parseFloat(totalHT ?? facture.totalHT ?? 0);
      facture.totalTVA = parseFloat(totalTVA ?? facture.totalTVA ?? 0);
      facture.totalTTC = parseFloat(totalTTC ?? facture.totalTTC ?? 0);
      facture.timbreFiscal = !!timbreFiscal;
      facture.conditionPaiement = conditionPaiement || facture.conditionPaiement || null;
  
      // ✅ Update fournisseur if changed
      if (fournisseur_id) {
        const fournisseur = await fournisseurRepo.findOneBy({ id: parseInt(fournisseur_id) });
        if (!fournisseur) return res.status(404).json({ message: "Fournisseur non trouvé" });
        facture.fournisseur = fournisseur;
      }
  
      // ✅ Update bonReception if changed
      if (bonReception_id) {
        const bonReception = await bonReceptionRepo.findOneBy({ id: parseInt(bonReception_id) });
        if (!bonReception) return res.status(404).json({ message: "Bon de réception non trouvé" });
        facture.bonReception = bonReception;
      }
  
      // 🧹 Delete removed articles (not in the updated list)
      if (articles && Array.isArray(articles)) {
        const newArticleIds = articles.map((a) => parseInt(a.article_id));
        const oldArticlesToDelete = facture.articles.filter(
          (fa) => !newArticleIds.includes(fa.article.id)
        );
  
        if (oldArticlesToDelete.length > 0) {
          for (const oldItem of oldArticlesToDelete) {
            await factureArticleRepo.delete({ id: oldItem.id });
          }
        }
      }
  
      // ✅ Replace all article relations
      facture.articles = [];
      if (articles && Array.isArray(articles)) {
        for (const item of articles) {
          const articleEntity = await articleRepo.findOneBy({
            id: parseInt(item.article_id),
          });
          if (!articleEntity) continue;
  
          facture.articles.push({
            article: articleEntity,
            quantite: parseInt(item.quantite),
            prixUnitaire: parseFloat(item.prix_unitaire),
            tva: item.tva ? parseFloat(item.tva) : 0,
            remise: item.remise ? parseFloat(item.remise) : 0,
          });
        }
      }
  
      const updated = await repo.save(facture);
  
      res.status(200).json(updated);
    } catch (err) {
      console.error(err);
      res.status(500).json({ message: "Erreur serveur", error: err.message });
    }
  };
  
  

exports.deleteFactureFournisseur = async (req, res) => {
  try {
    const factureArticleRepo = AppDataSource.getRepository(
      FactureFournisseurArticle
    );
    const factureRepo = AppDataSource.getRepository(FactureFournisseur);

    await factureArticleRepo.delete({
      factureFournisseur: { id: parseInt(req.params.id) },
    });
    const result = await factureRepo.delete(req.params.id);

    if (result.affected === 0) {
      return res
        .status(404)
        .json({ message: "Facture fournisseur non trouv�e" });
    }

    res
      .status(200)
      .json({ message: "Facture fournisseur supprim�e avec succ�s" });
  } catch (err) {
    console.error(err);
    res.status(500).json({ message: "Erreur serveur", error: err.message });
  }
};

exports.annulerFactureFournisseur = async (req, res) => {
  try {
    const repo = AppDataSource.getRepository(FactureFournisseur);
    const facture = await repo.findOne({
      where: { id: parseInt(req.params.id) },
      relations: ["articles", "articles.article"],
    });

    if (!facture) {
      return res
        .status(404)
        .json({ message: "Facture fournisseur non trouv�e" });
    }

    if (facture.status === "Annulee") {
      return res
        .status(400)
        .json({ message: "Cette facture est d�j� annul�e" });
    }

    facture.status = "Annulee";
    await repo.save(facture);

    res
      .status(200)
      .json({ message: "Facture fournisseur annul�e avec succ�s" });
  } catch (err) {
    console.error(err);
    res.status(500).json({ message: "Erreur serveur", error: err.message });
  }
};

exports.getNextFactureNumber = async (req, res) => {
  try {
    const year = new Date().getFullYear();
    const prefix = "FACT";

    const repo = AppDataSource.getRepository(FactureFournisseur);

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
      message: "Erreur lors de la g�n�ration du num�ro de facture",
      error: err.message,
    });
  }
};
