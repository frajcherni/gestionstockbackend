const { AppDataSource } = require("../db");
const { PaiementClient } = require("../entities/PaiementClient");
const { BonCommandeClient } = require("../entities/BonCommandeClient");
const { Client } = require("../entities/Client");

exports.createPaiement = async (req, res) => {
  try {
    let {
      montant,
      modePaiement,
      numeroPaiement,
      date,
      client_id,
      bonCommandeClient_id,
      numeroCheque,
      banque,
      numeroTraite,
      dateEcheance,
      notes,
    } = req.body;

    console.log("REQ BODY:", req.body);

    // Sanitize IDs (convert invalid values to null)
    client_id =
      client_id && !isNaN(Number(client_id)) && Number(client_id) > 0
        ? Number(client_id)
        : null;

    bonCommandeClient_id =
      bonCommandeClient_id && !isNaN(Number(bonCommandeClient_id)) && Number(bonCommandeClient_id) > 0
        ? Number(bonCommandeClient_id)
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

    // Validate bonCommandeClient_id if provided
    let bonCommande = null;
    if (bonCommandeClient_id) {
      const bonCommandeRepo = AppDataSource.getRepository(BonCommandeClient);
      bonCommande = await bonCommandeRepo.findOneBy({ id: bonCommandeClient_id });
      if (!bonCommande) {
        return res.status(404).json({ error: "Bon de commande non trouvé" });
      }
    }

    const paiementRepo = AppDataSource.getRepository(PaiementClient);
    const newPaiement = paiementRepo.create({
      montant,
      modePaiement,
      numeroPaiement,
      date,
      client_id,
      bonCommandeClient_id,
      numeroCheque,
      banque,
      numeroTraite,
      dateEcheance,
      notes,
    });

    const savedPaiement = await paiementRepo.save(newPaiement);

    // Update bon commande totals if linked
    if (bonCommande) {
      // Calculate total payments for this bon commande
      const allPaiements = await paiementRepo.find({
        where: { bonCommandeClient_id: bonCommande.id }
      });
      
      const totalPaiements = allPaiements.reduce((sum, paiement) => 
        sum + Number(paiement.montant), 0
      );

      // Update bon commande payment information
      bonCommande.montantPaye = totalPaiements.toFixed(3);
      bonCommande.resteAPayer = (
        Number(bonCommande.totalTTCAfterRemise || bonCommande.totalTTC || 0) - totalPaiements
      ).toFixed(3);
      
      await AppDataSource.getRepository(BonCommandeClient).save(bonCommande);
    }

    // Fetch the saved paiement with relations
    const result = await paiementRepo.findOne({
      where: { id: savedPaiement.id },
      relations: ["client", "bonCommandeClient"],
    });

    res.status(201).json(result);
  } catch (error) {
    console.error("Erreur lors de la création du paiement:", error);
    res.status(500).json({ error: "Erreur serveur interne" });
  }
};

exports.getPaiementsByBonCommande = async (req, res) => {
  try {
    const paiementRepo = AppDataSource.getRepository(PaiementClient);
    const paiements = await paiementRepo.find({
      where: { bonCommandeClient_id: Number(req.params.bonCommandeId) },
      relations: ["client", "bonCommandeClient"],
      order: { date: "ASC" },
    });
    res.json(paiements);
  } catch (err) {
    console.error("Erreur lors de la récupération des paiements:", err);
    res
      .status(500)
      .json({ error: "Erreur lors de la récupération des paiements" });
  }
};



exports.deletePaiement = async (req, res) => {
  try {
    const paiementRepo = AppDataSource.getRepository(PaiementClient);
    const paiement = await paiementRepo.findOne({
      where: { id: Number(req.params.id) },
      relations: ["bonCommandeClient"],
    });
    if (!paiement)
      return res.status(404).json({ error: "Paiement non trouvé" });

    // Update bon commande totals if linked
    if (paiement.bonCommandeClient_id) {
      const bonCommandeRepo = AppDataSource.getRepository(BonCommandeClient);
      const bonCommande = await bonCommandeRepo.findOneBy({
        id: paiement.bonCommandeClient_id,
      });
      if (bonCommande) {
        // Recalculate total payments after deletion
        const remainingPaiements = await paiementRepo.find({
          where: { bonCommandeClient_id: bonCommande.id }
        });
        
        const totalPaiements = remainingPaiements.reduce((sum, p) => 
          sum + Number(p.montant), 0
        ) - Number(paiement.montant); // Subtract the deleted payment

        bonCommande.montantPaye = Math.max(0, totalPaiements).toFixed(3);
        bonCommande.resteAPayer = (
          Number(bonCommande.totalTTCAfterRemise || bonCommande.totalTTC || 0) - totalPaiements
        ).toFixed(3);
        
        await bonCommandeRepo.save(bonCommande);
      }
    }

    await paiementRepo.remove(paiement);
    res.json({ message: "Paiement supprimé avec succès" });
  } catch (err) {
    console.error("Erreur lors de la suppression du paiement:", err);
    res
      .status(500)
      .json({ error: "Erreur lors de la suppression du paiement" });
  }
};

exports.updatePaiement = async (req, res) => {
  try {
    const { id } = req.params;
    let {
      montant,
      modePaiement,
      numeroPaiement,
      date,
      client_id,
      bonCommandeClient_id,
      numeroCheque,
      banque,
      numeroTraite,
      dateEcheance,
      notes,
    } = req.body;

    console.log("UPDATE REQ BODY:", req.body);

    // Sanitize IDs (convert invalid values to null)
    client_id =
      client_id && !isNaN(Number(client_id)) && Number(client_id) > 0
        ? Number(client_id)
        : null;

    bonCommandeClient_id =
      bonCommandeClient_id && !isNaN(Number(bonCommandeClient_id)) && Number(bonCommandeClient_id) > 0
        ? Number(bonCommandeClient_id)
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

    const paiementRepo = AppDataSource.getRepository(PaiementClient);
    
    // Find existing paiement with relations
    const existingPaiement = await paiementRepo.findOne({
      where: { id: Number(id) },
      relations: ["bonCommandeClient"],
    });

    if (!existingPaiement) {
      return res.status(404).json({ error: "Paiement non trouvé" });
    }

    const oldMontant = Number(existingPaiement.montant);
    const newMontant = Number(montant);

    // Update bon commande totals if linked
    if (existingPaiement.bonCommandeClient_id) {
      const bonCommandeRepo = AppDataSource.getRepository(BonCommandeClient);
      const bonCommande = await bonCommandeRepo.findOneBy({
        id: existingPaiement.bonCommandeClient_id,
      });

      if (bonCommande) {
        // Get all payments for this bon commande
        const allPaiements = await paiementRepo.find({
          where: { bonCommandeClient_id: bonCommande.id }
        });

        // Calculate total payments excluding the current one being updated
        const totalWithoutCurrent = allPaiements.reduce((sum, p) => {
          if (p.id !== existingPaiement.id) {
            return sum + Number(p.montant);
          }
          return sum;
        }, 0);

        // Add the new amount
        const newTotalPaiements = totalWithoutCurrent + newMontant;
        const bonCommandeTotal = Number(bonCommande.totalTTCAfterRemise || bonCommande.totalTTC || 0);

        // Validate that new payment amount doesn't exceed total
        if (newTotalPaiements > bonCommandeTotal) {
          return res.status(400).json({ 
            error: `Le montant total payé (${newTotalPaiements.toFixed(3)} DT) ne peut pas dépasser le total du bon de commande (${bonCommandeTotal.toFixed(3)} DT)` 
          });
        }

        bonCommande.montantPaye = newTotalPaiements.toFixed(3);
        bonCommande.resteAPayer = (bonCommandeTotal - newTotalPaiements).toFixed(3);

        await bonCommandeRepo.save(bonCommande);
      }
    }

    // Update the paiement
    await paiementRepo.update(Number(id), {
      montant: newMontant,
      modePaiement,
      numeroPaiement,
      date,
      client_id,
      bonCommandeClient_id,
      numeroCheque,
      banque,
      numeroTraite,
      dateEcheance,
      notes,
    });

    // Fetch the updated paiement with relations
    const updatedPaiement = await paiementRepo.findOne({
      where: { id: Number(id) },
      relations: ["client", "bonCommandeClient"],
    });

    res.json(updatedPaiement);
  } catch (error) {
    console.error("Erreur lors de la mise à jour du paiement:", error);
    res.status(500).json({ error: "Erreur serveur interne" });
  }
};

exports.getAllPaiements = async (req, res) => {
  try {
    const paiementRepo = AppDataSource.getRepository(PaiementClient);
    const paiements = await paiementRepo.find({
      relations: ["client", "bonCommandeClient"],
      order: { date: "DESC" },
    });
    res.json(paiements);
  } catch (err) {
    console.error("Erreur lors de la récupération des paiements:", err);
    res
      .status(500)
      .json({ error: "Erreur lors de la récupération des paiements" });
  }
};

exports.getNextPaiementNumber = async (req, res) => {
  try {
    const year = new Date().getFullYear();
    const prefix = "PAY-C";
    const repo = AppDataSource.getRepository(PaiementClient);
    const lastPaiement = await repo
      .createQueryBuilder("paiement")
      .where("paiement.numeroPaiement LIKE :pattern", {
        pattern: `${prefix}%/${year}`,
      })
      .orderBy("paiement.numeroPaiement", "DESC")
      .getOne();

    let nextNumber = 1;
    if (lastPaiement && lastPaiement.numeroPaiement) {
      const match = lastPaiement.numeroPaiement.match(
        new RegExp(`^${prefix}(\\d{5})/${year}$`)
      );
      if (match) {
        nextNumber = parseInt(match[1], 10) + 1;
      }
    }

    const nextPaiementNumber = `${prefix}${nextNumber
      .toString()
      .padStart(5, "0")}/${year}`;
    res.json({ numeroPaiement: nextPaiementNumber });
  } catch (err) {
    console.error(
      "Erreur lors de la génération du numéro de paiement:",
      err
    );
    res.status(500).json({
      message: "Erreur lors de la génération du numéro de paiement",
      error: err.message,
    });
  }
};