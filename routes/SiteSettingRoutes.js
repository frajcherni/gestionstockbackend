const express = require("express");
const router = express.Router();
const siteSettingController = require("../controllers/SiteSettingController");

router.get("/", siteSettingController.get);
router.put("/", siteSettingController.update);
router.delete("/logo", siteSettingController.removeLogo);
router.delete("/promo-image", siteSettingController.removePromoImage);
router.delete("/showroom-image", siteSettingController.removeShowroomImage);

module.exports = router;
