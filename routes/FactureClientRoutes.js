const express = require("express");
const router = express.Router();
const controller = require("../controllers/FactureClientController");

router.get("/getAllFacturesClient", controller.getAllFacturesClient);
router.post("/addAllFacturesClient", controller.createFactureClient);
router.put("/updateFactureClient/:id", controller.updateFactureClient);
router.delete("/deleteFactureClient/:id", controller.deleteFactureClient);
router.post("/:id/annuler", controller.annulerFactureClient);
router.get("/getNextFactureNumber", controller.getNextFactureNumber);

module.exports = router;
