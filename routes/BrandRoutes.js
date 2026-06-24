const express = require("express");
const router = express.Router();
const brandController = require("../controllers/BrandController");

router.get("/", brandController.getAll);
router.post("/", brandController.create);
router.put("/:id", brandController.update);
router.delete("/:id", brandController.remove);

module.exports = router;
