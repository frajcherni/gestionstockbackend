const express = require('express');
const router = express.Router();
const {
    getAllInventaires,
    getInventaireById,
    createInventaire,
    updateInventaire,
    deleteInventaire,
    getNextInventaireNumber,
    getInventaireStats,
    searchInventaires,
    getInventairesByDateRange
} = require('../controllers/inventaireController');

// Get all inventaires
router.get('/getAllInventaires', getAllInventaires);

// Search inventaires
//router.get('/search', searchInventaires);

// Get inventaires by date range
//router.get('/by-date', getInventairesByDateRange);

// Get inventaire by ID
//router.get('/:id', getInventaireById);

// Create new inventaire
router.post('/createInventaire', createInventaire);

// Update inventaire
router.put('/update/:id', updateInventaire);

// Delete inventaire
router.delete('/deleteInventaire/:id', deleteInventaire);

// Get next inventaire number
//router.get('/getNextNumber', getNextInventaireNumber);

// Get inventaire statistics
//router.get('/stats/summary', getInventaireStats);

module.exports = router;