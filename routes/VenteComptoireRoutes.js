const express = require('express');
const router = express.Router();
const VenteComptoireController = require('../controllers/VenteComptoireController');

router.post('/addVenteComptoire', VenteComptoireController.createVenteComptoire);
router.get('/getAllVenteComptoire', VenteComptoireController.getAllVenteComptoire);
router.put('/updateventecomptoire/:id', VenteComptoireController.updateVenteComptoire);
router.delete('/deleteventecomptoire/:id', VenteComptoireController.deleteVenteComptoire);
router.get('/fetchNextVenteComptoireNumber', VenteComptoireController.fetchNextVenteComptoireNumber);


module.exports = router;
