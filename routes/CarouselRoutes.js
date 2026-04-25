const express = require("express");
const router = express.Router();
const carouselController = require("../controllers/CarouselController");

router.get("/", carouselController.getAll);
router.post("/", carouselController.create);
router.put("/:id", carouselController.update);
router.delete("/:id", carouselController.remove);

module.exports = router;
