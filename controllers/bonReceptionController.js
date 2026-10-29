const { AppDataSource } = require("../db");
const {
  BonReception,
  BonReceptionArticle,
} = require("../entities/BonReception");
const { BonCommande } = require("../entities/BonCommande");
const { Article } = require("../entities/Article");
const { Fournisseur } = require("../entities/Fournisseur");
const { Depot } = require("../entities/Depot");
const { updateDepotStock, findMagazinDepot } = require("../utils/stockUtils");

// Optional numeric field from the form ("" / null / undefined → null)
const parseOptionalNumber = (value) => {
  if (value === undefined || value === null || value === "") return null;
  const num = parseFloat(value);
  return isNaN(num) ? null : num;
};

/**
 * Status rules for stock handling
 *
 * real: change to qte (physical stock)
 * virtual: change to qte_virtual (reserved stock)
 */
const STATUS_ACTIONS = {
  Recu: (article, qty) => {
    article.qte_virtual = (article.qte_virtual || 0) - qty;
    article.qte = (article.qte || 0) + qty;
  },
  "Partiellement Recu": (article, qty) => {
    article.qte_virtual = (article.qte_virtual || 0) - qty;
    article.qte = (article.qte || 0) + qty;
  },
  Annule: (article, qty) => {
    article.qte_virtual = (article.qte_virtual || 0) + qty;
  },
  Brouillon: () => {
    // No stock movement
  },
};

exports.createBonReception = async (req, res) => {
  try {
    const {
      numeroReception,
      dateReception,
      bonCommande_id,
      articles,
      notes,
      remise,
      remiseType,
      fournisseur_id,
      depot_id,
    } = req.body;

    const bonCommandeRepo = AppDataSource.getRepository(BonCommande);
    const articleRepo = AppDataSource.getRepository(Article);
    const bonReceptionRepo = AppDataSource.getRepository(BonReception);
    const fournisseurRepo = AppDataSource.getRepository(Fournisseur);

    // ✅ Validation
    if (!numeroReception || !dateReception || !fournisseur_id) {
      return res.status(400).json({ message: "Champs requis manquants" });
    }

    const fournisseur = await fournisseurRepo.findOneBy({
      id: parseInt(fournisseur_id),
    });
    if (!fournisseur)
      return res.status(404).json({ message: "Fournisseur non trouvé" });

    // ✅ No depot chosen → the "magazin" depot, so the stock always lands in a depot
    const depot = depot_id
      ? await AppDataSource.getRepository(Depot).findOneBy({ id: parseInt(depot_id) })
      : await findMagazinDepot(AppDataSource.manager);

    // ✅ Optionally link to an existing bon de commande (but don't modify it)
    let bonCommande = null;
    if (bonCommande_id) {
      bonCommande = await bonCommandeRepo.findOne({
        where: { id: parseInt(bonCommande_id) },
        relations: ["articles", "articles.article"],
      });
      if (!bonCommande)
        return res.status(404).json({ message: "Bon de commande non trouvé" });
    }

    // ✅ numeroReception is unique: refuse duplicates before touching stock
    const existingReception = await bonReceptionRepo.findOneBy({ numeroReception });
    if (existingReception) {
      return res.status(409).json({
        message: `Le numéro ${numeroReception} existe déjà, veuillez utiliser un autre numéro`,
      });
    }

    // ✅ Always set status to 'Recu' for BonReception
    const bonReception = {
      numeroReception,
      dateReception: new Date(dateReception),
      fournisseur,
      status: "Recu",
      notes: notes || null,
      remise: remise || 0,
      remiseType: remiseType || "percentage",
      bonCommande: bonCommande || null,
      depot: depot,
      articles: [],
    };

    // ✅ Validate all articles before any stock movement
    for (const item of articles || []) {
      const article = await articleRepo.findOneBy({
        id: parseInt(item.article_id),
      });
      if (!article)
        return res
          .status(404)
          .json({ message: `Article ID ${item.article_id} non trouvé` });

      bonReception.articles.push({
        article,
        quantite: parseInt(item.quantite),
        prixUnitaire: parseFloat(item.prix_unitaire) || 0,
        prix_ttc: parseOptionalNumber(item.prix_ttc),
        tva: item.tva !== undefined ? parseFloat(item.tva) : null,
        remise: item.remise !== undefined ? parseFloat(item.remise) : null,
      });
    }

    // ✅ Stock update + save in one transaction: if the save fails, stock is rolled back
    const savedReception = await AppDataSource.transaction(async (tm) => {
      const trxArticleRepo = tm.getRepository(Article);

      for (const line of bonReception.articles) {
        if (depot) {
          await updateDepotStock(tm, line.article.id, depot.id, line.quantite);
        } else {
          // Fallback for global stock if no depot
          line.article.qte = (line.article.qte || 0) + line.quantite;
          line.article.qte_physique = (line.article.qte_physique || 0) + line.quantite;
          await trxArticleRepo.save(line.article);
        }
      }

      return tm.getRepository(BonReception).save(bonReception);
    });

    // 🚫 Do NOT modify BonCommande status
    res.status(201).json(savedReception);
  } catch (err) {
    console.error(err);
    res.status(500).json({ message: "Erreur serveur", error: err.message });
  }
};

exports.getAllBonReception = async (req, res) => {
  try {
    const repo = AppDataSource.getRepository(BonReception);
    const list = await repo.find({
      relations: ["bonCommande", "articles", "articles.article", "fournisseur"],
    });
    res.json(list);
  } catch (err) {
    console.error(err);
    res.status(500).json({ message: "Erreur serveur" });
  }
};

// Same two-step pagination as the ventes lists: paginate the ids with the
// filters, then load the full bons (articles, fournisseur, depot) for that page only.
exports.getBonReceptionPaginated = async (req, res) => {
  try {
    const { page = 1, limit = 10, search = "", status = "", startDate, endDate } = req.query;
    const pageNum = Math.max(1, parseInt(page) || 1);
    const limitNum = Math.max(1, parseInt(limit) || 10);
    const repo = AppDataSource.getRepository(BonReception);

    const idQb = repo
      .createQueryBuilder("br")
      .leftJoin("br.fournisseur", "fournisseur")
      .select(["br.id", "br.dateReception"]);

    if (search) {
      idQb.andWhere(
        "(br.numeroReception ILIKE :search OR fournisseur.raison_sociale ILIKE :search)",
        { search: `%${search}%` }
      );
    }
    if (status) {
      idQb.andWhere("br.status = :status", { status });
    }
    if (startDate) {
      idQb.andWhere("br.dateReception >= :startDate", { startDate });
    }
    if (endDate) {
      const end = new Date(endDate);
      end.setHours(23, 59, 59, 999);
      idQb.andWhere("br.dateReception <= :endDate", { endDate: end });
    }

    const totalCount = await idQb.getCount();
    const idResults = await idQb
      .orderBy("br.dateReception", "DESC")
      .addOrderBy("br.id", "DESC")
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
      .createQueryBuilder("br")
      .leftJoinAndSelect("br.fournisseur", "fournisseur")
      .leftJoinAndSelect("br.depot", "depot")
      .leftJoinAndSelect("br.bonCommande", "bonCommande")
      .leftJoinAndSelect("br.articles", "articles")
      .leftJoinAndSelect("articles.article", "article")
      .where("br.id IN (:...ids)", { ids })
      .orderBy("br.dateReception", "DESC")
      .addOrderBy("br.id", "DESC")
      .addOrderBy("articles.id", "ASC")
      .getMany();

    res.json({ bons, pagination });
  } catch (err) {
    console.error("Pagination error:", err);
    res.status(500).json({ message: "Erreur serveur lors de la pagination", error: err.message });
  }
};

exports.getBonReceptionById = async (req, res) => {
  try {
    const repo = AppDataSource.getRepository(BonReception);
    const reception = await repo.findOne({
      where: { id: parseInt(req.params.id) },
      relations: ["bonCommande", "articles", "articles.article", "fournisseur"],
    });
    if (!reception)
      return res.status(404).json({ message: "Bon de réception non trouvé" });
    res.json(reception);
  } catch (err) {
    console.error(err);
    res.status(500).json({ message: "Erreur serveur" });
  }
};

exports.updateBonReception = async (req, res) => {
  try {
    const {
      numeroReception,
      dateReception,
      articles,
      notes,
      remise,
      remiseType,
      fournisseur_id,
      depot_id,
    } = req.body;

    const receptionRepo = AppDataSource.getRepository(BonReception);
    const articleRepo = AppDataSource.getRepository(Article);
    const bonArticleRepo = AppDataSource.getRepository(BonReceptionArticle);
    const fournisseurRepo = AppDataSource.getRepository(Fournisseur);
    const bonCommandeRepo = AppDataSource.getRepository(BonCommande);

    const receptionId = parseInt(req.params.id, 10);
    if (isNaN(receptionId)) {
      return res.status(400).json({ message: "ID invalide" });
    }

    // load reception with current articles
    const reception = await receptionRepo.findOne({
      where: { id: receptionId },
      relations: ["articles", "articles.article", "bonCommande", "fournisseur"],
    });
    if (!reception)
      return res.status(404).json({ message: "Bon de réception non trouvé" });

    // Transaction: reverse old stock, delete old join rows, create new join rows and apply new stock
    await AppDataSource.manager.transaction(async (tm) => {
      const trxArticleRepo = tm.getRepository(Article);
      const trxBonArticleRepo = tm.getRepository(BonReceptionArticle);
      const trxReceptionRepo = tm.getRepository(BonReception);
      const trxFournisseurRepo = tm.getRepository(Fournisseur);
      const trxBonCommandeRepo = tm.getRepository(BonCommande);

      // 1) Reverse stock effect of OLD lines (remove previously added stock)
      for (const oldItem of reception.articles) {
        if (reception.depot?.id) {
          await updateDepotStock(tm, oldItem.article.id, reception.depot.id, -(oldItem.quantite || 0));
        } else {
          const art = await trxArticleRepo.findOneBy({ id: oldItem.article.id });
          if (!art) continue;
          art.qte = (art.qte || 0) - (oldItem.quantite || 0);
          art.qte_physique = (art.qte_physique || 0) - (oldItem.quantite || 0);
          await trxArticleRepo.save(art);
        }
      }

      // 2) Delete ALL old BonReceptionArticle entries for this reception
      //    (we will recreate the new set below)
      await trxBonArticleRepo.delete({ bonReception: { id: receptionId } });

      // 3) Update reception basic fields (status forced to "Recu")
      reception.numeroReception = numeroReception ?? reception.numeroReception;
      reception.dateReception = dateReception
        ? new Date(dateReception)
        : reception.dateReception;
      reception.status = "Recu";
      reception.notes = notes ?? reception.notes;
      reception.remise = remise ?? reception.remise;
      reception.remiseType = remiseType ?? reception.remiseType;

      if (fournisseur_id) {
        const fournisseur = await trxFournisseurRepo.findOneBy({
          id: parseInt(fournisseur_id),
        });
        if (!fournisseur) throw new Error("Fournisseur non trouvé");
        reception.fournisseur = fournisseur;
      }

      // Depot sent, else the bon's own depot, else "magazin"
      if (depot_id) {
        reception.depot = await tm.getRepository(Depot).findOneBy({ id: parseInt(depot_id) });
      } else if (!reception.depot) {
        reception.depot = await findMagazinDepot(tm);
      }

      // 4) Recreate new BonReceptionArticle rows and apply NEW stock effect
      const createdBonArticles = [];
      if (Array.isArray(articles)) {
        for (const item of articles) {
          const art = await trxArticleRepo.findOneBy({
            id: parseInt(item.article_id),
          });
          if (!art) continue; // skip invalid article ids

          const qty = parseInt(item.quantite || 0);
          const prixUnitaire =
            item.prix_unitaire !== undefined
              ? parseFloat(item.prix_unitaire)
              : null;
          const tvaRate = item.tva !== undefined ? parseFloat(item.tva) : null;
          const remiseArticle =
            item.remise !== undefined ? parseFloat(item.remise) : null;

          // increase stock for reception
          if (reception.depot) {
            await updateDepotStock(tm, art.id, reception.depot.id, qty);
          } else {
            art.qte = (art.qte || 0) + qty;
            art.qte_physique = (art.qte_physique || 0) + qty;
            await trxArticleRepo.save(art);
          }

          const newBonArt = trxBonArticleRepo.create({
            bonReception: reception,
            article: art,
            quantite: qty,
            prixUnitaire,
            prix_ttc: parseOptionalNumber(item.prix_ttc),
            tva: tvaRate,
            remise: remiseArticle,
          });
          await trxBonArticleRepo.save(newBonArt);
          createdBonArticles.push(newBonArt);
        }
      }

      // attach new articles to reception and save reception
      reception.articles = createdBonArticles;
      await trxReceptionRepo.save(reception);
    });

    // reload and return updated reception with relations
    const updated = await receptionRepo.findOne({
      where: { id: receptionId },
      relations: ["articles", "articles.article", "bonCommande", "fournisseur"],
    });

    res.json(updated);
  } catch (err) {
    console.error(err);
    res.status(500).json({ message: "Erreur serveur", error: err.message });
  }
};

exports.deleteBonReception = async (req, res) => {
  try {
    const id = parseInt(req.params.id, 10);
    if (isNaN(id)) {
      return res.status(400).json({ message: "ID invalide" });
    }

    const bonReceptionRepo = AppDataSource.getRepository(BonReception);
    const bonArticleRepo = AppDataSource.getRepository(BonReceptionArticle);
    const articleRepo = AppDataSource.getRepository(Article);

    // Fetch bon with its articles
    const bon = await bonReceptionRepo.findOne({
      where: { id },
      relations: ["articles", "articles.article"],
    });

    if (!bon) {
      return res.status(404).json({ message: "Bon de réception introuvable" });
    }

    // 1️⃣ Reverse stock effect (subtract previously added quantities)
    for (const item of bon.articles) {
      if (bon.depot?.id) {
        await updateDepotStock(AppDataSource.manager, item.article.id, bon.depot.id, -item.quantite);
      } else {
        const article = await articleRepo.findOneBy({ id: item.article.id });
        if (article) {
          article.qte = (article.qte || 0) - item.quantite;
          article.qte_physique = (article.qte_physique || 0) - item.quantite;
          await articleRepo.save(article);
        }
      }
    }

    // 2️⃣ Delete linked articles
    await bonArticleRepo.delete({ bonReception: { id } });

    // 3️⃣ Delete reception itself
    await bonReceptionRepo.delete(id);

    res.status(200).json({
      message: "Bon de réception supprimé et stock restauré avec succès",
    });
  } catch (err) {
    console.error(err);
    res.status(500).json({ message: "Erreur serveur", error: err.message });
  }
};

exports.getNextReceptionNumber = async (req, res) => {
  try {
    const year = new Date().getFullYear();
    const prefix = "BR";

    const repo = AppDataSource.getRepository(BonReception);

    // Get all numeroReception for this year and keep the highest sequence
    // (string ordering is wrong with mixed padding: "BR-010" < "BR-0009")
    const receptions = await repo
      .createQueryBuilder("br")
      .select(["br.id", "br.numeroReception"])
      .where("br.numeroReception ILIKE :pattern", {
        pattern: `${prefix}-%/${year}`,
      })
      .getMany();

    const numeroRegex = new RegExp(`^${prefix}-(\\d+)/${year}$`, "i");
    const lastNumber = receptions.reduce((max, { numeroReception }) => {
      const match = numeroReception?.trim().match(numeroRegex);
      return match ? Math.max(max, parseInt(match[1], 10)) : max;
    }, 0);

    const nextNumber = lastNumber + 1;

    const nextReceptionNumber = `${prefix}-${nextNumber
      .toString()
      .padStart(3, "0")}/${year}`;

    res.json({ numeroReception: nextReceptionNumber });
  } catch (err) {
    console.error(err);
    res.status(500).json({
      message: "Erreur lors de la génération du numéro de réception",
      error: err.message,
    });
  }
};
