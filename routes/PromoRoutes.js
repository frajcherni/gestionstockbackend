const express = require("express");
const router = express.Router();
const promoController = require("../controllers/PromoController");

router.get("/", promoController.getAll);
router.get("/active", promoController.getActive);
router.post("/", promoController.create);
router.put("/:id", promoController.update);
router.delete("/:id", promoController.remove);

module.exports = router;
