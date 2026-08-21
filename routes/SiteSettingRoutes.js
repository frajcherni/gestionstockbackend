const express = require("express");
const router = express.Router();
const siteSettingController = require("../controllers/SiteSettingController");

router.get("/", siteSettingController.get);
router.put("/", siteSettingController.update);
router.delete("/logo", siteSettingController.removeLogo);
router.delete("/promo-image", siteSettingController.removePromoImage);

module.exports = router;
