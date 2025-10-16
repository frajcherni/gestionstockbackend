const express = require("express");
const router = express.Router();
const bonCommandeClientController = require("../controllers/BonCommandeClientController");

// Create a new client order
router.post(
  "/addBonCommandeClient",
  bonCommandeClientController.createBonCommandeClient
);

router.post(
  "/createBonCommandeClientBasedOnDevis",
  bonCommandeClientController.createBonCommandeClientBasedOnDevis
);

router.get(
  "/getAllBonCommandeClient",
  bonCommandeClientController.getAllBonCommandeClient
);

router.put("/:id", bonCommandeClientController.updateBonCommandeClient);

// Delete a client order
router.delete("/:id", bonCommandeClientController.deleteBonCommandeClient);

// Cancel a client order
router.post(
  "/:id/annuler",
  bonCommandeClientController.annulerBonCommandeClient
);

router.get(
  "/getnumbercommande",
  bonCommandeClientController.getNextCommandeNumber
);

module.exports = router;
