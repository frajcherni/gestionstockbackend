// src/routes/bonCommandeRoutes.js
const express = require('express');
const controller = require('../controllers/bonLivraisonController');

const router = express.Router();

router.post('/addbonlivraison', controller.createBonLivraison);
router.get('/getNextLivraisonNumber', controller.getNextLivraisonNumber);

router.get('/getbonlivraison', controller.getAllBonLivraisons);
router.put('/:id', controller.updateBonLivraison);
router.delete('/:id', controller.deleteBonLivraison);

module.exports = router;
