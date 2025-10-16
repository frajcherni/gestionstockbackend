// routes/trésorerieRoutes.js
const express = require("express");
const router = express.Router();
const trésorerieController = require("../controllers/TresorieController");

// Trésorerie routes
router.get("/data", trésorerieController.getTrésorerieData);
router.get("/daily-statistics", trésorerieController.getDailyStatistics);
router.get("/ventecomptoire", trésorerieController.getVentesDetails);
router.get("/client", trésorerieController.getEncaissementsDetails);
router.get(
  "/fournisseur",
  trésorerieController.getPaiementsFournisseursDetails
);

module.exports = router;
