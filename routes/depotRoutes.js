// routes/depotRoutes.js
const express = require('express');
const router = express.Router();
const depotController = require('../controllers/DepotController');

// Depot CRUD
router.get('/fetchDepots', depotController.getAllDepots);
router.post('/createDepot', depotController.createDepot);
router.put('updateDepot/:id', depotController.updateDepot);
router.delete('deleteDepot/:id', depotController.deleteDepot);

// Stock management
router.get('/:id/stock', depotController.getDepotStock);
router.get('/article/:articleId/stock', depotController.getArticleStock);

module.exports = router;