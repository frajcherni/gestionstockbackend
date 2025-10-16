const express = require('express');
const controller = require('../controllers/categorieController');

const router = express.Router();

router.get('/getcategorie', controller.getAll);
router.post('/addcategorie', controller.create);
router.put('/updatecategorie/:id', controller.update);
router.delete('/deletecategorie/:id', controller.remove);

module.exports = router;
