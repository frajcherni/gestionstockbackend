const express = require("express");
const router = express.Router();
const websiteFeatureController = require("../controllers/WebsiteFeatureController");

router.get("/", websiteFeatureController.getAll);
router.post("/", websiteFeatureController.create);
router.put("/:id", websiteFeatureController.update);
router.delete("/:id", websiteFeatureController.remove);

module.exports = router;
