const express = require("express");
const router = express.Router();
const DevisController = require("../controllers/DevisController");

// Create a new client order
router.post("/addBonCommandeClient", DevisController.createDevisClient);

// Get all client orders
router.get("/getAllBonCommandeClient", DevisController.getAllDevisClient);

// Get a specific client order by ID

// Update a client order
router.put("/:id", DevisController.updateDevisClient);

// Delete a client order
router.delete("/deleteDevisClient/:id", DevisController.deleteDevisClient);

// Cancel a client order
module.exports = router;
