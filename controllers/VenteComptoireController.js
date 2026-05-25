const { AppDataSource } = require("../db");
const { Article } = require("../entities/Article");
const { Client } = require("../entities/Client");
const { Vendeur } = require("../entities/Vendeur");
const {
  VenteComptoire,
  VenteComptoireArticle,
} = require("../entities/VenteComptoire");
const { Depot } = require("../entities/Depot");
const { DevisClient } = require("../entities/Devis"); // ✅ ADD THIS
const { updateDepotStock } = require("../utils/stockUtils");

/** Dépôt magazin par défaut quand le frontend n'envoie pas depot_id */
const DEFAULT_MAGAZIN_DEPOT_ID = 1;

const resolveDepotId = (depot_id) => {
  const parsed = parseInt(depot_id, 10);
  if (!isNaN(parsed) && parsed > 0) return parsed;
  return DEFAULT_MAGAZIN_DEPOT_ID;
};

exports.createVenteComptoire = async (req, res) => {
  const queryRunner = AppDataSource.createQueryRunner();
  await queryRunner.connect();
  await queryRunner.startTransaction();

  try {
    const {
      numeroCommande,
      dateCommande,
      remise,
      remiseType,
      notes,
      client_id,
      vendeur_id,
      depot_id,
      articles,
      taxMode,
      // ✅ ADD PAYMENT FIELDS
      paymentMethods,
      totalPaymentAmount,
      espaceNotes,
      devis_id, // ✅ ADD THIS
    } = req.body;

    const clientRepo = queryRunner.manager.getRepository(Client);
    const vendeurRepo = queryRunner.manager.getRepository(Vendeur);
    const articleRepo = queryRunner.manager.getRepository(Article);
    const venteRepo = queryRunner.manager.getRepository(VenteComptoire);
    const depotRepo = queryRunner.manager.getRepository(Depot);
    const devisRepo = queryRunner.manager.getRepository(DevisClient); // ✅ USE CLASS

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
      depot: await depotRepo.findOneBy({ id: resolveDepotId(depot_id) }),
      taxMode,
      // ✅ ADD PAYMENT DATA
      paymentMethods: paymentMethods || [],
      totalPaymentAmount: parseFloat(totalPaymentAmount) || 0,
      espaceNotes: espaceNotes || null,
      devis: devis_id ? await devisRepo.findOneBy({ id: parseInt(devis_id) }) : null,
      articles: [],
    };

    let subTotal = 0;
    let totalTax = 0;
    let grandTotal = 0;
    let totalFodec = 0; // ✅ ADD FODEC TOTAL

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
      const hasFodec = item.fodec || false; // ✅ GET FODEC FLAG FROM REQUEST

      // CALCULATE prix_ttc WITH FODEC FORMULA
      let prix_ttc = item.prix_ttc ? parseFloat(item.prix_ttc) : null;
      console.log(prix_ttc);

      if (!prix_ttc) {
        // ✅ ADD FODEC CALCULATION HERE
        if (hasFodec) {
          // Tunisian FODEC formula: TTC = HT + FODEC + TVA where TVA = (HT + FODEC) × TVA%
          const fodecAmount = prixUnitaire * 0.01;
          const baseTVA = prixUnitaire + fodecAmount;
          const tvaAmount = baseTVA * (tvaRate / 100);
          prix_ttc = parseFloat(
            (prixUnitaire + fodecAmount + tvaAmount).toFixed(3)
          );
        } else {
          // Original logic without FODEC
          prix_ttc = parseFloat(
            (prixUnitaire * (1 + tvaRate / 100)).toFixed(3)
          );
        }
      } else {
        // ✅ ADD FODEC AWARE LOGIC WHEN prix_ttc IS PROVIDED
        if (taxMode === "TTC") {
          if (hasFodec) {
            // Calculate HT from TTC with FODEC: HT = TTC / (1.01 * (1 + TVA%))
            const coefficient = 1.01 * (1 + tvaRate / 100);
            prixUnitaire = parseFloat((prix_ttc / coefficient).toFixed(3));
          } else {
            // Original logic without FODEC
            prixUnitaire = parseFloat(
              (prix_ttc / (1 + tvaRate / 100)).toFixed(3)
            );
          }
        }
      }

      const quantite = parseInt(item.quantite);
      const remiseRate = item.remise ? parseFloat(item.remise) : 0;
      const montantHTLigne = quantite * prixUnitaire * (1 - remiseRate / 100);
      const montantTTCLigne = quantite * prix_ttc;
      const taxAmount = montantTTCLigne - montantHTLigne;

      // ✅ ADD FODEC AMOUNT CALCULATION
      let fodecAmount = 0;
      if (hasFodec) {
        fodecAmount = prixUnitaire * 0.01 * quantite;
        totalFodec += fodecAmount;
      }

      subTotal += montantHTLigne;
      totalTax += taxAmount;
      grandTotal += montantTTCLigne;

      const venteArticle = {
        article,
        quantite,
        prixUnitaire,
        prix_ttc: prix_ttc,
        designation: item.designation || article.designation || "", // ADD THIS LINE
        fodec: hasFodec, // ✅ SAVE FODEC FLAG IN DATABASE
        tva: tvaRate,
        remise: remiseRate || null,
      };
      vente.articles.push(venteArticle);

      // ✅ REDUCE STOCK (DEPOT AWARE) + journal sortie
      if (vente.depot) {
        await updateDepotStock(
          queryRunner.manager,
          article.id,
          vente.depot.id,
          -quantite,
          {
            typeDocument: "vente_comptoire",
            documentId: null,
            numeroDocument: numeroCommande,
            dateSortie: dateCommande,
          }
        );
      } else {
        article.qte -= quantite;
        article.qte_physique -= quantite;
        await articleRepo.save(article);
      }
    }

    const totalAfterRemise =
      remiseType === "percentage"
        ? grandTotal * (1 - parseFloat(remise) / 100)
        : parseFloat(remise);

    // SAVE THE CALCULATED totalAfterRemise IN THE ENTITY
    vente.totalAfterRemise = totalAfterRemise;

    const result = await venteRepo.save(vente);
    await queryRunner.commitTransaction();

    res.status(201).json({
      ...result,
      subTotal: subTotal.toFixed(3),
      totalTax: totalTax.toFixed(3),
      totalFodec: totalFodec.toFixed(3),
      grandTotal: grandTotal.toFixed(3),
      totalAfterRemise: totalAfterRemise.toFixed(3),
    });
  } catch (err) {
    if (queryRunner.isTransactionActive) {
      await queryRunner.rollbackTransaction();
    }
    console.error(err);
    res.status(500).json({ message: "Erreur serveur", error: err.message });
  } finally {
    await queryRunner.release();
  }
};

exports.updateVenteComptoire = async (req, res) => {
  const queryRunner = AppDataSource.createQueryRunner();
  await queryRunner.connect();
  await queryRunner.startTransaction();

  try {
    const venteRepo = queryRunner.manager.getRepository(VenteComptoire);
    const articleRepo = queryRunner.manager.getRepository(Article);
    const venteArticleRepo = queryRunner.manager.getRepository(VenteComptoireArticle);
    const clientRepo = queryRunner.manager.getRepository(Client);
    const vendeurRepo = queryRunner.manager.getRepository(Vendeur);
    const depotRepo = queryRunner.manager.getRepository(Depot);

    // --- Load existing vente comptoire ---
    const vente = await venteRepo.findOne({
      where: { id: parseInt(req.params.id) },
      relations: ["articles", "articles.article", "client", "vendeur", "depot"],
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
    let grandTotal = 0;
    let totalFodec = 0; // ✅ ADD FODEC TOTAL

    if (
      req.body.remise !== undefined ||
      req.body.remiseType ||
      req.body.articles
    ) {
      // Recalculate grand total from articles
      if (req.body.articles && Array.isArray(req.body.articles)) {
        for (const item of req.body.articles) {
          const prixUnitaire = parseFloat(item.prix_unitaire);
          const tvaRate = item.tva ? parseFloat(item.tva) : 0;
          const remiseRate = item.remise ? parseFloat(item.remise) : 0;
          const quantite = parseInt(item.quantite);
          const hasFodec = item.fodec || false; // ✅ GET FODEC FLAG

          // ✅ CALCULATE prix_ttc WITH FODEC FORMULA
          let prix_ttc = item.prix_ttc ? parseFloat(item.prix_ttc) : null;

          if (!prix_ttc) {
            if (hasFodec) {
              const fodecAmount = prixUnitaire * 0.01;
              const baseTVA = prixUnitaire + fodecAmount;
              const tvaAmount = baseTVA * (tvaRate / 100);
              prix_ttc = parseFloat(
                (prixUnitaire + fodecAmount + tvaAmount).toFixed(3)
              );
            } else {
              prix_ttc = parseFloat(
                (prixUnitaire * (1 + tvaRate / 100)).toFixed(3)
              );
            }
          }

          const montantHTLigne =
            quantite * prixUnitaire * (1 - remiseRate / 100);
          const montantTTCLigne = quantite * prix_ttc;
          grandTotal += montantTTCLigne;

          // ✅ CALCULATE FODEC AMOUNT
          if (hasFodec) {
            totalFodec += prixUnitaire * 0.01 * quantite;
          }
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

          // ✅ CALCULATE FODEC FROM EXISTING ARTICLES
          if (item.fodec) {
            totalFodec += item.prixUnitaire * 0.01 * item.quantite;
          }
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

    if (req.body.depot_id !== undefined && req.body.depot_id !== null && req.body.depot_id !== "") {
      const depot = await depotRepo.findOneBy({
        id: resolveDepotId(req.body.depot_id),
      });
      if (!depot) {
        await queryRunner.rollbackTransaction();
        return res.status(404).json({ message: "Dépôt non trouvé" });
      }
      updates.depot = depot;
    } else if (!vente.depot) {
      const defaultDepot = await depotRepo.findOneBy({ id: DEFAULT_MAGAZIN_DEPOT_ID });
      if (defaultDepot) updates.depot = defaultDepot;
    }

    // --- Apply updates to parent record ---
    await venteRepo.update(vente.id, updates);

    // --- Restore stock from old articles (DEPOT AWARE) ---
    if (req.body.articles && Array.isArray(req.body.articles)) {
      for (const oldItem of vente.articles) {
        if (vente.depot) {
          await updateDepotStock(
            queryRunner.manager,
            oldItem.article.id,
            vente.depot.id,
            oldItem.quantite,
            {
              typeDocument: "vente_comptoire",
              documentId: vente.id,
              numeroDocument: vente.numeroCommande,
              commentaire: "restauration_stock_update",
            }
          );
        } else {
          const articleEntity = await articleRepo.findOneBy({ id: oldItem.article.id });
          if (articleEntity) {
            articleEntity.qte += oldItem.quantite;
            articleEntity.qte_physique += oldItem.quantite;
            await articleRepo.save(articleEntity);
          }
        }
      }
    }

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
        const hasFodec = item.fodec || false; // ✅ GET FODEC FLAG

        // ✅ CALCULATE prix_ttc WITH FODEC FORMULA
        let prix_ttc = item.prix_ttc ? parseFloat(item.prix_ttc) : null;

        if (!prix_ttc) {
          if (hasFodec) {
            const fodecAmount = prixUnitaire * 0.01;
            const baseTVA = prixUnitaire + fodecAmount;
            const tvaAmount = baseTVA * (tvaRate / 100);
            prix_ttc = parseFloat(
              (prixUnitaire + fodecAmount + tvaAmount).toFixed(3)
            );
          } else {
            prix_ttc = parseFloat(
              (prixUnitaire * (1 + tvaRate / 100)).toFixed(3)
            );
          }
        }

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
          existing.prix_ttc = prix_ttc;
          existing.fodec = hasFodec; // ✅ UPDATE FODEC FLAG
          existing.tva = tvaRate;
          existing.remise = item.remise ? parseFloat(item.remise) : null;
          existing.designation = item.designation || article.designation || "";
          await venteArticleRepo.save(existing);
        } else {
          // Create new line
          const newArticle = venteArticleRepo.create({
            venteComptoire: vente,
            article: article,
            quantite: parseInt(item.quantite),
            prixUnitaire: prixUnitaire,
            prix_ttc: prix_ttc,
            fodec: hasFodec,
            tva: tvaRate,
            remise: item.remise ? parseFloat(item.remise) : null,
            designation: item.designation || article.designation || "",
          });
          await venteArticleRepo.save(newArticle);
        }

        // --- Reduce stock for new/updated articles (DEPOT AWARE) ---
        const currentDepot = updates.depot || vente.depot;
        if (currentDepot) {
          await updateDepotStock(
            queryRunner.manager,
            article.id,
            currentDepot.id,
            -parseInt(item.quantite),
            {
              typeDocument: "vente_comptoire",
              documentId: vente.id,
              numeroDocument: vente.numeroCommande,
              dateSortie: req.body.dateCommande || vente.dateCommande,
            }
          );
        } else {
          article.qte = (article.qte || 0) - parseInt(item.quantite);
          article.qte_physique = (article.qte_physique || 0) - parseInt(item.quantite);
          await articleRepo.save(article);
        }
      }
    }
    // --- Reload and return updated vente ---
    await queryRunner.commitTransaction();
    const updatedVente = await venteRepo.findOne({
      where: { id: vente.id },
      relations: ["client", "vendeur", "articles", "articles.article"],
    });

    if (updatedVente && updatedVente.articles) {
      updatedVente.articles.sort((a, b) => a.id - b.id);
    }

    res.json(updatedVente);
  } catch (err) {
    await queryRunner.rollbackTransaction();
    console.error("Erreur updateVenteComptoire:", err);
    res.status(500).json({ message: "Erreur serveur", error: err.message });
  } finally {
    await queryRunner.release();
  }
};

exports.getAllVenteComptoire = async (req, res) => {
  try {
    const repo = AppDataSource.getRepository(VenteComptoire);
    const list = await repo.find({
      relations: ["client", "vendeur", "articles", "articles.article"],
      order: {
        dateCommande: "DESC",
        id: "DESC",
      },
    });

    list.forEach(v => {
      if (v.articles) v.articles.sort((a, b) => a.id - b.id);
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
  const queryRunner = AppDataSource.createQueryRunner();
  await queryRunner.connect();
  await queryRunner.startTransaction();

  try {
    const venteRepo = queryRunner.manager.getRepository(VenteComptoire);
    const venteArticleRepo = queryRunner.manager.getRepository(VenteComptoireArticle);
    const articleRepo = queryRunner.manager.getRepository(Article);

    const vente = await venteRepo.findOne({
      where: { id: parseInt(req.params.id) },
      relations: ["articles", "articles.article", "depot"],
    });

    if (!vente) {
      await queryRunner.rollbackTransaction();
      return res.status(404).json({ message: "Vente non trouvée" });
    }

    // --- Restore stock (DEPOT AWARE) ---
    for (const item of vente.articles) {
      if (vente.depot) {
        await updateDepotStock(
          queryRunner.manager,
          item.article.id,
          vente.depot.id,
          item.quantite,
          {
            typeDocument: "vente_comptoire",
            documentId: vente.id,
            numeroDocument: vente.numeroCommande,
            commentaire: "annulation_suppression_vente",
          }
        );
      } else {
        const articleEntity = await articleRepo.findOneBy({ id: item.article.id });
        if (articleEntity) {
          articleEntity.qte += item.quantite;
          articleEntity.qte_physique += item.quantite;
          await articleRepo.save(articleEntity);
        }
      }
    }

    await venteArticleRepo.delete({
      venteComptoire: { id: vente.id },
    });
    const result = await venteRepo.delete(vente.id);

    await queryRunner.commitTransaction();
    res.status(200).json({ message: "Vente supprimée avec succès" });
  } catch (err) {
    await queryRunner.rollbackTransaction();
    console.error(err);
    res.status(500).json({ message: "Erreur serveur", error: err.message });
  } finally {
    await queryRunner.release();
  }
};

exports.fetchNextVenteComptoireNumber = async (req, res) => {
  try {
    const repo = AppDataSource.getRepository(VenteComptoire);

    // آخر vente حسب id DESC
    const lastVenteArr = await repo.find({
      order: { id: "DESC" },
      take: 1,
    });
    const lastVente = lastVenteArr[0]; // undefined إذا ما فمّاش record

    const currentYear = new Date().getFullYear();
    let nextSeq = 1;

    if (lastVente && lastVente.numeroCommande) {
      const [ventePart, yearPart] = lastVente.numeroCommande.split("/");
      const lastYear = parseInt(yearPart, 10);

      if (lastYear === currentYear) {
        const lastSeq = parseInt(ventePart.split("-")[1], 10);
        nextSeq = lastSeq + 1;
      }
    }

    // Format: VENTE-0001/2026
    let nextNumber;
    while (true) {
      nextNumber = `VENTE COMPTOIRE-${String(nextSeq).padStart(4, "0")}/${currentYear}`;

      const exists = await repo.findOne({
        where: { numeroCommande: nextNumber },
      });

      if (!exists) break;
      nextSeq++;
    }

    res.json({ numeroCommande: nextNumber });
  } catch (err) {
    console.error(err);
    res.status(500).json({
      message: "Erreur serveur",
      error: err.message,
    });
  }
};

exports.getVenteComptoirePaginated = async (req, res) => {
  try {
    const {
      page = 1,
      limit = 10,
      search = "",
      status = "",
      startDate,
      endDate,
    } = req.query;

    const repo = AppDataSource.getRepository(VenteComptoire);
    const pageNum = Math.max(1, parseInt(page) || 1);
    const limitNum = Math.max(1, parseInt(limit) || 10);
    const skip = (pageNum - 1) * limitNum;
    const take = limitNum;

    // 1. Get paginated IDs first (with order columns selected to avoid distinctAlias error)
    const idQueryBuilder = repo.createQueryBuilder("vente")
      .leftJoin("vente.client", "client")
      .select(["vente.id", "vente.dateCommande"]);

    if (search) {
      idQueryBuilder.andWhere(
        "(vente.numeroCommande ILIKE :search OR client.raison_sociale ILIKE :search OR client.telephone1 ILIKE :search OR client.telephone2 ILIKE :search)",
        { search: `%${search}%` }
      );
    }
    if (status) {
      idQueryBuilder.andWhere("vente.status = :status", { status });
    }
    if (startDate && endDate) {
      idQueryBuilder.andWhere("vente.dateCommande BETWEEN :startDate AND :endDate", {
        startDate: `${startDate} 00:00:00`,
        endDate: `${endDate} 23:59:59`,
      });
    } else if (startDate) {
      idQueryBuilder.andWhere("vente.dateCommande >= :startDate", {
        startDate: `${startDate} 00:00:00`,
      });
    } else if (endDate) {
      idQueryBuilder.andWhere("vente.dateCommande <= :endDate", {
        endDate: `${endDate} 23:59:59`,
      });
    }

    const totalCount = await idQueryBuilder.getCount();
    const idResults = await idQueryBuilder
      .orderBy("vente.dateCommande", "DESC")
      .addOrderBy("vente.id", "DESC")
      .skip(skip)
      .take(take)
      .getMany();

    const ids = idResults.map(v => v.id);

    if (ids.length === 0) {
      return res.json({
        bons: [],
        pagination: {
          totalCount: 0,
          page: parseInt(page),
          limit: take,
          totalPages: 0,
        },
      });
    }

    // 2. Fetch full data for these IDs
    const bons = await repo.createQueryBuilder("vente")
      .leftJoinAndSelect("vente.client", "client")
      .leftJoinAndSelect("vente.vendeur", "vendeur")
      .leftJoinAndSelect("vente.depot", "depot")
      .leftJoinAndSelect("vente.articles", "articles")
      .leftJoinAndSelect("articles.article", "articleDetails")
      .leftJoinAndSelect("vente.devis", "devis")
      .where("vente.id IN (:...ids)", { ids })
      .orderBy("vente.dateCommande", "DESC")
      .addOrderBy("vente.id", "DESC")
      .addOrderBy("articles.id", "ASC")
      .getMany();

    // Enhance results with calculated fields
    const enhancedBons = bons.map((vente) => {
      let subTotal = 0;
      let totalTax = 0;
      let grandTotal = 0;

      vente.articles.forEach((item) => {
        const qty = item.quantite || 0;
        const price = parseFloat(item.prixUnitaire) || 0;
        const tvaRate = parseFloat(item.tva) || 0;
        const remiseRate = parseFloat(item.remise) || 0;

        const montantHTLigne = qty * price * (1 - remiseRate / 100);
        const montantTTCLigne = item.prix_ttc ? qty * parseFloat(item.prix_ttc) : montantHTLigne * (1 + tvaRate / 100);
        const taxAmount = montantTTCLigne - montantHTLigne;

        subTotal += montantHTLigne;
        totalTax += taxAmount;
        grandTotal += montantTTCLigne;
      });

      return {
        ...vente,
        subTotal: subTotal.toFixed(3),
        totalTax: totalTax.toFixed(3),
        grandTotal: grandTotal.toFixed(3),
        totalAfterRemise: (parseFloat(vente.totalAfterRemise) || grandTotal).toFixed(3),
      };
    });

    res.json({
      bons: enhancedBons,
      pagination: {
        totalCount,
        page: pageNum,
        limit: take,
        totalPages: Math.ceil(totalCount / take),
      },
    });
  } catch (err) {
    console.error("Error in getVenteComptoirePaginated:", err);
    res.status(500).json({ message: "Erreur serveur", error: err.message });
  }
};

