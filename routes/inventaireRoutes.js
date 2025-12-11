// inventaireRoutes.js
const express = require("express");
const router = express.Router();
const InventaireController = require("../controllers/inventaireController");

// CRUD routes
router.post('/create', InventaireController.createInventaire);          // CREATE
router.get('/', InventaireController.getAllInventaires);                // READ ALL
router.get('/:id', InventaireController.getInventaireById);            // READ ONE
router.put('/:id', InventaireController.updateInventaire);             // UPDATE
router.delete('/:id', InventaireController.deleteInventaire);   

module.exports = router;