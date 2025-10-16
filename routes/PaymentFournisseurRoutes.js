const express = require("express");
const router = express.Router();
const {
  createPayment,
  getPaymentsByFacture,
  getPaymentById,
  deletePayment,
  getAllPayments,
  getNextPaymentNumber,
  updatePayment,
} = require("../controllers/PaymentFournisseurController");

router.post("/createpayment", createPayment);
router.get("/getAllPayments", getAllPayments);

router.get("/getNextPaymentNumber", getNextPaymentNumber);

router.get("/facture/:factureId", getPaymentsByFacture);

router.get("/:id", getPaymentById);

router.delete("/:id", deletePayment);
router.put("/:id", updatePayment);

module.exports = router;
