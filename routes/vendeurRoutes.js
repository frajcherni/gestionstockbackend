const express = require('express');
const router = express.Router();
const vendeurController = require('../controllers/VendeurController');

// Create a new salesperson
router.post('/addvendeur', vendeurController.createVendeur);

// Get all salespeople
router.get('/getvendeur', vendeurController.getAllVendeurs);

// Get a single salesperson
router.get('/:id', vendeurController.getVendeurById);

// Update a salesperson
router.put('/updateVendeur/:id', vendeurController.updateVendeur);

// Delete a salesperson
router.delete('/deletevendeur/:id', vendeurController.deleteVendeur);

// Get salesperson statistics (optional)
router.get('/:id/stats', vendeurController.getVendeurStats);

module.exports = router;