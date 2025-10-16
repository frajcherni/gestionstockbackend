const express = require('express');
const router = express.Router();
const clientController = require('../controllers/clientController');

router.get('/getclient', clientController.getAllClients);
router.get('/:id', clientController.getClientById);
router.post('/addclient', clientController.createClient);
router.put('/updateclient/:id', clientController.updateClient);
router.delete('/deleteclient/:id', clientController.deleteClient);

module.exports = router;
