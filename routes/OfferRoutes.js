const express = require("express");
const router = express.Router();
const offerController = require("../controllers/OfferController");

router.get("/", offerController.getAll);
router.get("/active", offerController.getActive);
router.post("/", offerController.create);
router.put("/:id", offerController.update);
router.delete("/:id", offerController.remove);

module.exports = router;
