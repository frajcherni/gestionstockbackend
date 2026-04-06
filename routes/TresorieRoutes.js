// routes/trésorerieRoutes.js
const express = require("express");
const router = express.Router();
const trésorerieController = require("../controllers/TresorieController");

// Trésorerie routes
router.get("/data", trésorerieController.getTrésorerieData);

router.get('/stats', trésorerieController.getDashboardDataByDateRange);

module.exports = router;
