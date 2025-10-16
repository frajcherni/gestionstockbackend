const express = require('express');
const router = express.Router();
const controller = require('../controllers/FactureFournisseurController');

router.get('/getAllFacturesFournisseur', controller.getAllFacturesFournisseur);
router.post('/addAllFacturesFournisseur', controller.createFactureFournisseur);
router.put('/updateFactureFournisseur/:id', controller.updateFactureFournisseur);
router.delete('/:id', controller.deleteFactureFournisseur);
router.post('/:id/annuler', controller.annulerFactureFournisseur);
router.get('/getNextFactureNumber', controller.getNextFactureNumber);


module.exports = router;
