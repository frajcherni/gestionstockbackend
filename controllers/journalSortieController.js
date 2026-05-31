const { AppDataSource } = require("../db");
const { JournalSortieArticle } = require("../entities/JournalSortieArticle");
const { Article } = require("../entities/Article");
const { Depot } = require("../entities/Depot");

/**
 * GET /api/journal-sortie
 * Query: startDate, endDate, articleId, depotId, typeDocument, page, limit
 */
exports.getJournalSorties = async (req, res) => {
  try {
    const {
      startDate,
      endDate,
      articleId,
      depotId,
      typeDocument,
      page = 1,
      limit = 50,
    } = req.query;

    const repo = AppDataSource.getRepository(JournalSortieArticle);
    const qb = repo
      .createQueryBuilder("j")
      .leftJoinAndSelect("j.article", "article")
      .leftJoinAndSelect("j.depot", "depot")
      .orderBy("j.date_sortie", "DESC")
      .addOrderBy("j.id", "DESC");

    if (startDate) {
      qb.andWhere("j.date_sortie >= :startDate", { startDate });
    }
    if (endDate) {
      qb.andWhere("j.date_sortie <= :endDate", { endDate });
    }
    if (articleId) {
      qb.andWhere("j.article_id = :articleId", {
        articleId: parseInt(articleId, 10),
      });
    }
    if (depotId) {
      qb.andWhere("j.depot_id = :depotId", { depotId: parseInt(depotId, 10) });
    }
    if (typeDocument) {
      qb.andWhere("j.type_document = :typeDocument", { typeDocument });
    }

    const take = Math.min(parseInt(limit, 10) || 50, 500);
    const skip = (Math.max(parseInt(page, 10) || 1, 1) - 1) * take;

    const [rows, total] = await qb.skip(skip).take(take).getManyAndCount();

    res.json({
      data: rows,
      pagination: {
        page: parseInt(page, 10) || 1,
        limit: take,
        total,
        totalPages: Math.ceil(total / take),
      },
    });
  } catch (err) {
    console.error("getJournalSorties:", err);
    res.status(500).json({ message: err.message });
  }
};

/**
 * GET /api/journal-sortie/summary-by-date
 * Totaux sorties groupés par date (et optionnellement article / dépôt)
 */
exports.getSummaryByDate = async (req, res) => {
  try {
    const { startDate, endDate, articleId, depotId, groupByArticle } = req.query;

    const repo = AppDataSource.getRepository(JournalSortieArticle);
    const qb = repo
      .createQueryBuilder("j")
      .select("j.date_sortie", "date_sortie")
      .addSelect("SUM(j.quantite)", "total_sortie")
      .addSelect("COUNT(*)", "nb_lignes");

    if (groupByArticle === "true" || groupByArticle === "1") {
      qb.addSelect("j.article_id", "article_id")
        .addSelect("article.reference", "reference")
        .addSelect("article.designation", "designation")
        .leftJoin("j.article", "article")
        .groupBy("j.date_sortie")
        .addGroupBy("j.article_id")
        .addGroupBy("article.reference")
        .addGroupBy("article.designation");
    } else {
      qb.groupBy("j.date_sortie");
    }

    if (startDate) {
      qb.andWhere("j.date_sortie >= :startDate", { startDate });
    }
    if (endDate) {
      qb.andWhere("j.date_sortie <= :endDate", { endDate });
    }
    if (articleId) {
      qb.andWhere("j.article_id = :articleId", {
        articleId: parseInt(articleId, 10),
      });
    }
    if (depotId) {
      qb.andWhere("j.depot_id = :depotId", { depotId: parseInt(depotId, 10) });
    }

    qb.orderBy("j.date_sortie", "DESC");

    const rows = await qb.getRawMany();

    res.json({ summary: rows });
  } catch (err) {
    console.error("getSummaryByDate:", err);
    res.status(500).json({ message: err.message });
  }
};

/**
 * GET /api/journal-sortie/totals-by-article
 * Total sorties par article sur une période (pour correction stock)
 */
exports.getTotalsByArticle = async (req, res) => {
  try {
    const { startDate, endDate, depotId } = req.query;

    const repo = AppDataSource.getRepository(JournalSortieArticle);
    const qb = repo
      .createQueryBuilder("j")
      .select("j.article_id", "article_id")
      .addSelect("article.reference", "reference")
      .addSelect("article.designation", "designation")
      .addSelect("SUM(j.quantite)", "total_sortie")
      .leftJoin("j.article", "article")
      .groupBy("j.article_id")
      .addGroupBy("article.reference")
      .addGroupBy("article.designation")
      .orderBy("SUM(j.quantite)", "DESC");

    if (startDate) {
      qb.andWhere("j.date_sortie >= :startDate", { startDate });
    }
    if (endDate) {
      qb.andWhere("j.date_sortie <= :endDate", { endDate });
    }
    if (depotId) {
      qb.andWhere("j.depot_id = :depotId", { depotId: parseInt(depotId, 10) });
    }

    const rows = await qb.getRawMany();
    res.json({ totals: rows });
  } catch (err) {
    console.error("getTotalsByArticle:", err);
    res.status(500).json({ message: err.message });
  }
};

/**
 * POST /api/journal-sortie/backfill-historique
 * Reconstruit le journal depuis les ventes / livraisons / factures existantes (dépôt magazin).
 * À lancer une seule fois après création de la table.
 */
exports.backfillHistorique = async (req, res) => {
  const queryRunner = AppDataSource.createQueryRunner();
  await queryRunner.connect();
  await queryRunner.startTransaction();

  try {
    const depotRepo = queryRunner.manager.getRepository(Depot);
    const magDepots = await depotRepo
      .createQueryBuilder("d")
      .where("LOWER(d.nom) LIKE :m1 OR LOWER(d.nom) LIKE :m2", {
        m1: "%magaz%",
        m2: "%magasin%",
      })
      .getMany();

    if (magDepots.length === 0) {
      await queryRunner.rollbackTransaction();
      return res.status(400).json({
        message:
          "Aucun dépôt magazin/magasin trouvé. Vérifiez le nom du dépôt dans la table depots.",
      });
    }

    const depotIds = magDepots.map((d) => d.id);
    const depotIdList = depotIds.join(",");

    await queryRunner.manager.query(
      `DELETE FROM journal_sortie_articles WHERE commentaire = 'backfill_historique'`
    );

    const inserts = [];

    // 1. Ventes comptoir (dépôt magazin)
    const vc = await queryRunner.manager.query(`
      INSERT INTO journal_sortie_articles (
        article_id, depot_id, quantite, date_sortie, type_document, document_id, numero_document, commentaire
      )
      SELECT
        vca.article_id,
        vc.depot_id,
        vca.quantite,
        DATE(vc."dateCommande"),
        'vente_comptoire',
        vc.id,
        vc."numeroCommande",
        'backfill_historique'
      FROM vente_comptoire_articles vca
      INNER JOIN vente_comptoire vc ON vc.id = vca.vente_comptoire_id
      WHERE vc.depot_id IN (${depotIdList})
        AND vca.quantite > 0
      RETURNING id
    `);
    inserts.push({ source: "vente_comptoire", count: vc.length });

    // 2. Bons de livraison (hors BL liés à vente comptoir — stock déjà sorti sur VC)
    const bl = await queryRunner.manager.query(`
      INSERT INTO journal_sortie_articles (
        article_id, depot_id, quantite, date_sortie, type_document, document_id, numero_document, commentaire
      )
      SELECT
        bla.article_id,
        bl.depot_id,
        bla.quantite,
        DATE(bl."dateLivraison"),
        'bon_livraison',
        bl.id,
        bl."numeroLivraison",
        'backfill_historique'
      FROM bon_livraison_articles bla
      INNER JOIN bon_livraisons bl ON bl.id = bla.bon_livraison_id
      WHERE bl.depot_id IN (${depotIdList})
        AND bla.quantite > 0
        AND bl.vente_comptoire_id IS NULL
        AND bl.status IN ('Livré', 'Partiellement Livré')
      RETURNING id
    `);
    inserts.push({ source: "bon_livraison", count: bl.length });

    // 3. Factures client (directes, ou liées à un BC sans BL pour la quantité facturée restante)
    const fc = await queryRunner.manager.query(`
      INSERT INTO journal_sortie_articles (
        article_id, depot_id, quantite, date_sortie, type_document, document_id, numero_document, commentaire
      )
      SELECT
        fca.article_id,
        fc.depot_id,
        fca.quantite - COALESCE(bcca."quantiteLivreeDirecte", 0),
        DATE(fc."dateFacture"),
        'facture_client',
        fc.id,
        fc."numeroFacture",
        'backfill_historique'
      FROM factures_client_articles fca
      INNER JOIN factures_client fc ON fc.id = fca.facture_client_id
      LEFT JOIN bon_commande_client_articles bcca ON bcca.bon_commande_client_id = fc."bonCommandeClient_id" AND bcca.article_id = fca.article_id
      WHERE fc.depot_id IN (${depotIdList})
        AND (fca.quantite - COALESCE(bcca."quantiteLivreeDirecte", 0)) > 0
        AND fc.vente_comptoire_id IS NULL
        AND fc.bon_livraison_id IS NULL
        AND fc.status != 'Annulee'
      RETURNING id
    `);
    inserts.push({ source: "facture_client", count: fc.length });

    // 4. BC — quantités livrées directement sur le BC (via quantiteLivreeDirecte)
    const bcc = await queryRunner.manager.query(`
      INSERT INTO journal_sortie_articles (
        article_id, depot_id, quantite, date_sortie, type_document, document_id, numero_document, commentaire
      )
      SELECT
        bcca.article_id,
        bcc.depot_id,
        bcca."quantiteLivreeDirecte",
        DATE(bcc."dateCommande"),
        'bon_commande_client',
        bcc.id,
        bcc."numeroCommande",
        'backfill_historique'
      FROM bon_commande_client_articles bcca
      INNER JOIN bon_commande_clients bcc ON bcc.id = bcca.bon_commande_client_id
      WHERE bcc.depot_id IN (${depotIdList})
        AND bcca."quantiteLivreeDirecte" > 0
      RETURNING id
    `);
    inserts.push({ source: "bon_commande_client", count: bcc.length });

    await queryRunner.commitTransaction();

    res.json({
      message: "Journal historique reconstruit (dépôt magazin)",
      depots: magDepots.map((d) => ({ id: d.id, nom: d.nom })),
      inserted: inserts,
      total: inserts.reduce((s, i) => s + i.count, 0),
    });
  } catch (err) {
    await queryRunner.rollbackTransaction();
    console.error("backfillHistorique:", err);
    res.status(500).json({ message: err.message });
  } finally {
    await queryRunner.release();
  }
};
