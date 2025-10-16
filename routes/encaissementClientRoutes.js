const express = require("express");
const router = express.Router();
const {
  createEncaissement,
  getEncaissementsByFacture,
  getEncaissementById,
  deleteEncaissement,
  getAllEncaissements,
  getNextEncaissementNumber,
  updateEncaissement
} = require("../controllers/EncaissementClientController");

router.post("/createencaissement", createEncaissement);
router.get("/getAllEncaissements", getAllEncaissements);
router.get("/getNextEncaissementNumber", getNextEncaissementNumber);
router.get("/facture/:factureId", getEncaissementsByFacture);
router.get("/:id", getEncaissementById);
router.delete("/:id", deleteEncaissement);
router.put("/updateEncaissement/:id", updateEncaissement);


module.exports = router;
