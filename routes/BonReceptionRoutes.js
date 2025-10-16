// src/routes/bonCommandeRoutes.js
const express = require('express');
const bonReceptionController = require('../controllers/bonReceptionController');

const router = express.Router();

router.post('/addbonreception', bonReceptionController.createBonReception);
router.get('/getbonreception', bonReceptionController.getAllBonReception);
router.get('/bonreception/:id', bonReceptionController.getBonReceptionById);

router.put('/updateBonReception/:id', bonReceptionController.updateBonReception);
router.delete('/deleteBonReception/:id', bonReceptionController.deleteBonReception);

router.get('/getNextReceptionNumber', bonReceptionController.getNextReceptionNumber);


//router.put('/bonreception/cancel/:id', bonReceptionController.cancelBonReception);

module.exports = router;
