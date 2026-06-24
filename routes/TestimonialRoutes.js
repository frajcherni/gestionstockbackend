const express = require("express");
const router = express.Router();
const testimonialController = require("../controllers/TestimonialController");

router.get("/", testimonialController.getAll);
router.post("/", testimonialController.create);
router.put("/:id", testimonialController.update);
router.delete("/:id", testimonialController.remove);

module.exports = router;
