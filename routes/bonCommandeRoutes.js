// src/routes/bonCommandeRoutes.js
const express = require('express');
const controller = require('../controllers/bonCommandeController');

const router = express.Router();

router.post('/addcommande', controller.createBonCommande);
router.get('/getcommande', controller.getAllBonCommande);
router.get('/getNextCommandeNumber', controller.getNextCommandeNumber);

//router.put('/deleteboncommande/:id', controller.annulerBonCommande);
router.delete('/deleteboncommande/:id', controller.deleteBonCommande);

router.put('/updateBonCommande/:id', controller.updateBonCommande);


module.exports = router;
