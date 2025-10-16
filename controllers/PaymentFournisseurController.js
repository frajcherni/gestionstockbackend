const { AppDataSource } = require("../db");
const {
  FactureFournisseurPayment,
} = require("../entities/FactureFournisseurPayment");
const { FactureFournisseur } = require("../entities/FactureFournisseur");
const { Fournisseur } = require("../entities/Fournisseur");

exports.createPayment = async (req, res) => {
  try {
    let {
      montant,
      modePaiement,
      numeroPaiement,
      date,
      fournisseur_id,
      facture_id,
    } = req.body;

    console.log("REQ BODY:", req.body);

    // Sanitize IDs (convert invalid values to null)
    fournisseur_id =
      fournisseur_id &&
      !isNaN(Number(fournisseur_id)) &&
      Number(fournisseur_id) > 0
        ? Number(fournisseur_id)
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

    // Validate fournisseur_id if provided
    let fournisseur = null;
    if (fournisseur_id) {
      const fournisseurRepo = AppDataSource.getRepository(Fournisseur);
      fournisseur = await fournisseurRepo.findOneBy({ id: fournisseur_id });
      if (!fournisseur) {
        return res.status(404).json({ error: "Fournisseur non trouvé" });
      }
    }

    // Validate facture_id if provided
    let facture = null;
    if (facture_id) {
      const factureRepo = AppDataSource.getRepository(FactureFournisseur);
      facture = await factureRepo.findOneBy({ id: facture_id });
      if (!facture) {
        return res.status(404).json({ error: "Facture non trouvée" });
      }
    }

    const paymentRepo = AppDataSource.getRepository(FactureFournisseurPayment);
    const newPayment = paymentRepo.create({
      montant,
      modePaiement,
      numeroPaiement,
      datePaiement: date,
      fournisseur_id,
      facture_id,
    });

    const savedPayment = await paymentRepo.save(newPayment);

    // Update facture totals if linked
    if (facture) {
      facture.montantPaye = (
        Number(facture.montantPaye || 0) + Number(montant)
      ).toFixed(2);
      facture.resteAPayer = (
        Number(facture.totalTTC) - Number(facture.montantPaye)
      ).toFixed(2);
      facture.status = Number(facture.resteAPayer) <= 0 ? "Payee" : "Validee";
      await AppDataSource.getRepository(FactureFournisseur).save(facture);
    }

    // Fetch the saved payment with fournisseur relation
    const result = await paymentRepo.findOne({
      where: { id: savedPayment.id },
      relations: ["fournisseur", "factureFournisseur"],
    });

    res.status(201).json(result);
  } catch (error) {
    console.error("Erreur lors de la création du paiement:", error);
    res.status(500).json({ error: "Erreur serveur interne" });
  }
};

exports.getPaymentsByFacture = async (req, res) => {
  try {
    const paymentRepo = AppDataSource.getRepository(FactureFournisseurPayment);
    const payments = await paymentRepo.find({
      where: { facture_id: Number(req.params.factureId) },
      relations: ["fournisseur", "factureFournisseur"],
      order: { datePaiement: "ASC" },
    });
    res.json(payments);
  } catch (err) {
    console.error("Erreur lors de la récupération des paiements:", err);
    res
      .status(500)
      .json({ error: "Erreur lors de la récupération des paiements" });
  }
};

exports.getPaymentById = async (req, res) => {
  try {
    const paymentRepo = AppDataSource.getRepository(FactureFournisseurPayment);
    const payment = await paymentRepo.findOne({
      where: { id: Number(req.params.id) },
      relations: ["fournisseur", "factureFournisseur"],
    });
    if (!payment) return res.status(404).json({ error: "Paiement non trouvé" });
    res.json(payment);
  } catch (err) {
    console.error("Erreur lors de la récupération du paiement:", err);
    res
      .status(500)
      .json({ error: "Erreur lors de la récupération du paiement" });
  }
};

exports.deletePayment = async (req, res) => {
  try {
    const paymentRepo = AppDataSource.getRepository(FactureFournisseurPayment);
    const payment = await paymentRepo.findOne({
      where: { id: Number(req.params.id) },
      relations: ["factureFournisseur"],
    });
    if (!payment) return res.status(404).json({ error: "Paiement non trouvé" });

    // Update facture totals if linked
    if (payment.facture_id) {
      const factureRepo = AppDataSource.getRepository(FactureFournisseur);
      const facture = await factureRepo.findOneBy({ id: payment.facture_id });
      if (facture) {
        facture.montantPaye = (
          Number(facture.montantPaye || 0) - Number(payment.montant)
        ).toFixed(2);
        facture.resteAPayer = (
          Number(facture.totalTTC) - Number(facture.montantPaye)
        ).toFixed(2);
        facture.status = Number(facture.resteAPayer) <= 0 ? "Payee" : "Validee";
        await factureRepo.save(facture);
      }
    }

    await paymentRepo.remove(payment);
    res.json({ message: "Paiement supprimé avec succès" });
  } catch (err) {
    console.error("Erreur lors de la suppression du paiement:", err);
    res
      .status(500)
      .json({ error: "Erreur lors de la suppression du paiement" });
  }
};

exports.getAllPayments = async (req, res) => {
  try {
    const paymentRepo = AppDataSource.getRepository(FactureFournisseurPayment);
    const payments = await paymentRepo.find({
      relations: ["fournisseur", "factureFournisseur"],
      order: { datePaiement: "DESC" },
    });
    res.json(payments);
  } catch (err) {
    console.error("Erreur lors de la récupération des paiements:", err);
    res
      .status(500)
      .json({ error: "Erreur lors de la récupération des paiements" });
  }
};
exports.getNextPaymentNumber = async (req, res) => {
  try {
    const year = new Date().getFullYear();
    const prefix = "PAY-";
    const repo = AppDataSource.getRepository(FactureFournisseurPayment);

    // Get the last payment based on numeric part, not lexicographical
    const lastPayment = await repo
      .createQueryBuilder("payment")
      .where("payment.numeroPaiement LIKE :pattern", {
        pattern: `${prefix}%/${year}`,
      })
      .orderBy("CAST(SUBSTRING(payment.numeroPaiement, 5, 4) AS INT)", "DESC") // extract number
      .getOne();

    let nextNumber = 1;
    if (lastPayment && lastPayment.numeroPaiement) {
      const match = lastPayment.numeroPaiement.match(
        new RegExp(`^${prefix}(\\d{4})/${year}$`) // ✅ fixed to 4 digits
      );
      if (match) {
        nextNumber = parseInt(match[1], 10) + 1;
      }
    }

    const nextPaymentNumber = `${prefix}${nextNumber
      .toString()
      .padStart(4, "0")}/${year}`;

    res.json({ numeroPaiement: nextPaymentNumber });
  } catch (err) {
    console.error("Erreur lors de la génération du numéro de paiement:", err);
    res.status(500).json({
      message: "Erreur lors de la génération du numéro de paiement",
      error: err.message,
    });
  }
};


exports.updatePayment = async (req, res) => {
  try {
    const { id } = req.params;
    let {
      montant,
      modePaiement,
      numeroPaiement,
      date,
      fournisseur_id,
      facture_id,
    } = req.body;

    console.log("UPDATE PAYMENT REQ BODY:", req.body);

    // Sanitize IDs (convert invalid values to null)
    fournisseur_id =
      fournisseur_id && !isNaN(Number(fournisseur_id)) && Number(fournisseur_id) > 0
        ? Number(fournisseur_id)
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

    const paymentRepo = AppDataSource.getRepository(FactureFournisseurPayment);
    
    // Find existing payment with relations
    const existingPayment = await paymentRepo.findOne({
      where: { id: Number(id) },
      relations: ["factureFournisseur"],
    });

    if (!existingPayment) {
      return res.status(404).json({ error: "Paiement non trouvé" });
    }

    const oldMontant = Number(existingPayment.montant);
    const newMontant = Number(montant);

    // Update facture totals if linked to a facture
    if (existingPayment.facture_id) {
      const factureRepo = AppDataSource.getRepository(FactureFournisseur);
      const facture = await factureRepo.findOneBy({
        id: existingPayment.facture_id,
      });

      if (facture) {
        // Calculate the difference and update facture
        const montantDifference = newMontant - oldMontant;
        const newMontantPaye = Number(facture.montantPaye || 0) + montantDifference;
        const newResteAPayer = Number(facture.totalTTC) - newMontantPaye;

        // Validate that new payment amount doesn't exceed total
        if (newMontantPaye > Number(facture.totalTTC)) {
          return res.status(400).json({ 
            error: `Le montant total payé (${newMontantPaye.toFixed(2)} DT) ne peut pas dépasser le total de la facture (${Number(facture.totalTTC).toFixed(2)} DT)` 
          });
        }

        facture.montantPaye = newMontantPaye.toFixed(2);
        facture.resteAPayer = newResteAPayer.toFixed(2);
        

        await factureRepo.save(facture);
      }
    }

    // Update the payment
    await paymentRepo.update(Number(id), {
      montant: newMontant,
      modePaiement,
      numeroPaiement,
      datePaiement: date,
      fournisseur_id,
      facture_id,
    });

    // Fetch the updated payment with relations
    const updatedPayment = await paymentRepo.findOne({
      where: { id: Number(id) },
      relations: ["fournisseur", "factureFournisseur"],
    });

    res.json(updatedPayment);
  } catch (error) {
    console.error("Erreur lors de la mise à jour du paiement:", error);
    res.status(500).json({ error: "Erreur serveur interne" });
  }
};