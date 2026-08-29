const express = require("express");
const router = express.Router();
const promoController = require("../controllers/PromoController");

router.get("/", promoController.getAll);
router.get("/active", promoController.getActive);
// Flattened list of discounted articles — what the home page band renders.
router.get("/active-products", promoController.getActiveProducts);
router.post("/", promoController.create);
router.put("/:id", promoController.update);
router.delete("/:id", promoController.remove);

module.exports = router;
