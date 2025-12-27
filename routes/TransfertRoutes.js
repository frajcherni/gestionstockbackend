// routes/transferRoutes.js
const express = require('express');
const router = express.Router();
const transferController = require('../controllers/TransferController');

// Transfer routes
router.get('/getAllTransfers', transferController.getAllTransfers);
router.get('/transfers/:id', transferController.getTransfer);
router.post('/createTransfer', transferController.createTransfer);
router.put('/updateTransfer/:id', transferController.updateTransfer);
router.delete('/updateTransfer/:id', transferController.updateTransfer);
router.patch('/updateTransfer/:id/status', transferController.updateTransfer);

module.exports = router;