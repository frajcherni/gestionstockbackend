const express = require("express");
const router = express.Router();
const paiementClientController = require("../controllers/paiementClientController");

// Create a new payment
router.post("/createpaiement", paiementClientController.createPaiement);

// Get all payments
router.get("/getAllPaiementsClient", paiementClientController.getAllPaiements);

// Get payments by bon commande ID
router.get("/bon-commande/:bonCommandeId", paiementClientController.getPaiementsByBonCommande);

// Get payment by ID
//router.get("/:id", paiementClientController.getPaiementById);

// Update payment
router.put("/updatePaiement/:id", paiementClientController.updatePaiement);

// Delete payment
router.delete("/:id", paiementClientController.deletePaiement);

// Get next payment number
router.get("/getNextPaiementNumber", paiementClientController.getNextPaiementNumber);

module.exports = router;