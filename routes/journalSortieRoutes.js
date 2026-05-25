const express = require("express");
const router = express.Router();
const controller = require("../controllers/journalSortieController");

router.get("/", controller.getJournalSorties);
router.get("/summary-by-date", controller.getSummaryByDate);
router.get("/totals-by-article", controller.getTotalsByArticle);
router.post("/backfill-historique", controller.backfillHistorique);

module.exports = router;
