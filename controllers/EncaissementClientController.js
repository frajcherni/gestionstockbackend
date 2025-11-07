const { AppDataSource } = require("../db");
const { EncaissementClient } = require("../entities/EncaissementClient");
const { FactureClient } = require("../entities/FactureClient");
const { Client } = require("../entities/Client");

exports.createEncaissement = async (req, res) => {
  try {
    let {
      montant,
      modePaiement,
      numeroEncaissement,
      date,
      client_id,
      facture_id,
      numeroCheque,
      banque,
      numeroTraite,
      dateEcheance,
    } = req.body;

    console.log("REQ BODY:", req.body);

    // Sanitize IDs (convert invalid values to null)
    client_id =
      client_id && !isNaN(Number(client_id)) && Number(client_id) > 0
        ? Number(client_id)
        : null;

    facture_id =
      facture_id && !isNaN(Number(facture_id)) && Number(facture_id) > 0
        ? Number(facture_id)
        : null;

    montant = montant && !isNaN(Number(montant)) ? Number(montant) : 0;

    // Validate modePaiement
    const allowedModes = ["Espece", "Cheque", "Virement", "Traite", "Autre"];
    if (!allowedModes.includes(modePaiement)) {
      return res.status(400).json({ error: "Mode de paiement invalide" });
    }

    // Validate required fields based on payment mode
    if (modePaiement === "Cheque") {
      if (!numeroCheque) {
        return res.status(400).json({ error: "Le numéro du chèque est requis" });
      }
      if (!banque) {
        return res.status(400).json({ error: "La banque est requise" });
      }
    }

    if (modePaiement === "Traite") {
      if (!numeroTraite) {
        return res.status(400).json({ error: "Le numéro de traite est requis" });
      }
      if (!dateEcheance) {
        return res.status(400).json({ error: "La date d'échéance est requise" });
      }
    }

    // Validate client_id if provided
    let client = null;
    if (client_id) {
      const clientRepo = AppDataSource.getRepository(Client);
      client = await clientRepo.findOneBy({ id: client_id });
      if (!client) {
        return res.status(404).json({ error: "Client non trouvé" });
      }
    }

    // Validate facture_id if provided
    let facture = null;
    if (facture_id) {
      const factureRepo = AppDataSource.getRepository(FactureClient);
      facture = await factureRepo.findOneBy({ id: facture_id });
      if (!facture) {
        return res.status(404).json({ error: "Facture non trouvée" });
      }
    }

    const encaissementRepo = AppDataSource.getRepository(EncaissementClient);
    const newEncaissement = encaissementRepo.create({
      montant,
      modePaiement,
      numeroEncaissement,
      date,
      client_id,
      facture_id,
      numeroCheque,
      banque,
      numeroTraite,
      dateEcheance,
    });

    const savedEncaissement = await encaissementRepo.save(newEncaissement);

    // Update facture totals if linked
    if (facture) {
      facture.montantPaye = (
        Number(facture.montantPaye || 0) + Number(montant)
      ).toFixed(3); // Changed to 3 decimals
      facture.resteAPayer = (
        Number(facture.totalTTC) - Number(facture.montantPaye)
      ).toFixed(3); // Changed to 3 decimals
      facture.status = Number(facture.resteAPayer) <= 0 ? "Payee" : "Validee";
      await AppDataSource.getRepository(FactureClient).save(facture);
    }

    // Fetch the saved encaissement with client relation
    const result = await encaissementRepo.findOne({
      where: { id: savedEncaissement.id },
      relations: ["client", "factureClient"],
    });

    res.status(201).json(result);
  } catch (error) {
    console.error("Erreur lors de la création de l'encaissement:", error);
    res.status(500).json({ error: "Erreur serveur interne" });
  }
};

exports.getEncaissementsByFacture = async (req, res) => {
  try {
    const encaissementRepo = AppDataSource.getRepository(EncaissementClient);
    const encaissements = await encaissementRepo.find({
      where: { facture_id: Number(req.params.factureId) },
      relations: ["client", "factureClient"],
      order: { date: "ASC" },
    });
    res.json(encaissements);
  } catch (err) {
    console.error("Erreur lors de la récupération des encaissements:", err);
    res
      .status(500)
      .json({ error: "Erreur lors de la récupération des encaissements" });
  }
};

exports.getEncaissementById = async (req, res) => {
  try {
    const encaissementRepo = AppDataSource.getRepository(EncaissementClient);
    const encaissement = await encaissementRepo.findOne({
      where: { id: Number(req.params.id) },
      relations: ["client", "factureClient"],
    });
    if (!encaissement)
      return res.status(404).json({ error: "Encaissement non trouvé" });
    res.json(encaissement);
  } catch (err) {
    console.error("Erreur lors de la récupération de l'encaissement:", err);
    res
      .status(500)
      .json({ error: "Erreur lors de la récupération de l'encaissement" });
  }
};

exports.deleteEncaissement = async (req, res) => {
  try {
    const encaissementRepo = AppDataSource.getRepository(EncaissementClient);
    const encaissement = await encaissementRepo.findOne({
      where: { id: Number(req.params.id) },
      relations: ["factureClient"],
    });
    if (!encaissement)
      return res.status(404).json({ error: "Encaissement non trouvé" });

    // Update facture totals if linked
    if (encaissement.facture_id) {
      const factureRepo = AppDataSource.getRepository(FactureClient);
      const facture = await factureRepo.findOneBy({
        id: encaissement.facture_id,
      });
      if (facture) {
        facture.montantPaye = (
          Number(facture.montantPaye || 0) - Number(encaissement.montant)
        ).toFixed(3); // Changed to 3 decimals
        facture.resteAPayer = (
          Number(facture.totalTTC) - Number(facture.montantPaye)
        ).toFixed(3); // Changed to 3 decimals
        facture.status = Number(facture.resteAPayer) <= 0 ? "Payee" : "Validee";
        await factureRepo.save(facture);
      }
    }

    await encaissementRepo.remove(encaissement);
    res.json({ message: "Encaissement supprimé avec succès" });
  } catch (err) {
    console.error("Erreur lors de la suppression de l'encaissement:", err);
    res
      .status(500)
      .json({ error: "Erreur lors de la suppression de l'encaissement" });
  }
};
exports.updateEncaissement = async (req, res) => {
  try {
    const { id } = req.params;
    let {
      montant,
      modePaiement,
      numeroEncaissement,
      date,
      client_id,
      facture_id,
      numeroCheque,
      banque,
      numeroTraite,
      dateEcheance,
    } = req.body;

    console.log("UPDATE REQ BODY:", req.body);

    // Sanitize IDs (convert invalid values to null)
    client_id =
      client_id && !isNaN(Number(client_id)) && Number(client_id) > 0
        ? Number(client_id)
        : null;

    facture_id =
      facture_id && !isNaN(Number(facture_id)) && Number(facture_id) > 0
        ? Number(facture_id)
        : null;

    montant = montant && !isNaN(Number(montant)) ? Number(montant) : 0;

    // Validate modePaiement
    const allowedModes = ["Espece", "Cheque", "Virement", "Traite", "Autre"];
    if (!allowedModes.includes(modePaiement)) {
      return res.status(400).json({ error: "Mode de paiement invalide" });
    }

    // Validate required fields based on payment mode
    if (modePaiement === "Cheque") {
      if (!numeroCheque) {
        return res.status(400).json({ error: "Le numéro du chèque est requis" });
      }
      if (!banque) {
        return res.status(400).json({ error: "La banque est requise" });
      }
    }

    if (modePaiement === "Traite") {
      if (!numeroTraite) {
        return res.status(400).json({ error: "Le numéro de traite est requis" });
      }
      if (!dateEcheance) {
        return res.status(400).json({ error: "La date d'échéance est requise" });
      }
    }

    const encaissementRepo = AppDataSource.getRepository(EncaissementClient);
    
    // Find existing encaissement with relations
    const existingEncaissement = await encaissementRepo.findOne({
      where: { id: Number(id) },
      relations: ["factureClient"],
    });

    if (!existingEncaissement) {
      return res.status(404).json({ error: "Encaissement non trouvé" });
    }

    const oldMontant = Number(existingEncaissement.montant);
    const newMontant = Number(montant);

    // Update facture totals if linked to a facture
    if (existingEncaissement.facture_id) {
      const factureRepo = AppDataSource.getRepository(FactureClient);
      const facture = await factureRepo.findOneBy({
        id: existingEncaissement.facture_id,
      });

      if (facture) {
        // Calculate the difference and update facture
        const montantDifference = newMontant - oldMontant;
        const newMontantPaye = Number(facture.montantPaye || 0) + montantDifference;
        const newResteAPayer = Number(facture.totalTTC) - newMontantPaye;

        // Validate that new payment amount doesn't exceed total
        if (newMontantPaye > Number(facture.totalTTC)) {
          return res.status(400).json({ 
            error: `Le montant total payé (${newMontantPaye.toFixed(3)} DT) ne peut pas dépasser le total de la facture (${Number(facture.totalTTC).toFixed(3)} DT)` 
          });
        }

        facture.montantPaye = newMontantPaye.toFixed(3); // Changed to 3 decimals
        facture.resteAPayer = newResteAPayer.toFixed(3); // Changed to 3 decimals
        
        // Update status based on new resteAPayer
        if (newResteAPayer <= 0) {
          facture.status = "Payee";
        } else if (newMontantPaye > 0) {
          facture.status = "Partiellement Payee";
        } else {
          facture.status = "Validee";
        }

        await factureRepo.save(facture);
      }
    }

    // Update the encaissement
    await encaissementRepo.update(Number(id), {
      montant: newMontant,
      modePaiement,
      numeroEncaissement,
      date,
      client_id,
      facture_id,
      numeroCheque,
      banque,
      numeroTraite,
      dateEcheance,
    });

    // Fetch the updated encaissement with relations
    const updatedEncaissement = await encaissementRepo.findOne({
      where: { id: Number(id) },
      relations: ["client", "factureClient"],
    });

    res.json(updatedEncaissement);
  } catch (error) {
    console.error("Erreur lors de la mise à jour de l'encaissement:", error);
    res.status(500).json({ error: "Erreur serveur interne" });
  }
};
exports.getAllEncaissements = async (req, res) => {
  try {
    const encaissementRepo = AppDataSource.getRepository(EncaissementClient);
    const encaissements = await encaissementRepo.find({
      relations: ["client", "factureClient"],
      order: { date: "DESC" },
    });
    res.json(encaissements);
  } catch (err) {
    console.error("Erreur lors de la récupération des encaissements:", err);
    res
      .status(500)
      .json({ error: "Erreur lors de la récupération des encaissements" });
  }
};

exports.getNextEncaissementNumber = async (req, res) => {
  try {
    const year = new Date().getFullYear();
    const prefix = "ENC-C";
    const repo = AppDataSource.getRepository(EncaissementClient);
    const lastEncaissement = await repo
      .createQueryBuilder("encaissement")
      .where("encaissement.numeroEncaissement LIKE :pattern", {
        pattern: `${prefix}%/${year}`,
      })
      .orderBy("encaissement.numeroEncaissement", "DESC")
      .getOne();

    let nextNumber = 1;
    if (lastEncaissement && lastEncaissement.numeroEncaissement) {
      const match = lastEncaissement.numeroEncaissement.match(
        new RegExp(`^${prefix}(\\d{5})/${year}$`)
      );
      if (match) {
        nextNumber = parseInt(match[1], 10) + 1;
      }
    }

    const nextEncaissementNumber = `${prefix}${nextNumber
      .toString()
      .padStart(5, "0")}/${year}`;
    res.json({ numeroEncaissement: nextEncaissementNumber });
  } catch (err) {
    console.error(
      "Erreur lors de la génération du numéro d'encaissement:",
      err
    );
    res.status(500).json({
      message: "Erreur lors de la génération du numéro d'encaissement",
      error: err.message,
    });
  }
};
