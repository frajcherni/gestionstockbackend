const { Router } = require('express');
const {
  getAllFournisseurs,
  getFournisseurById,
  createFournisseur,
  updateFournisseur,
  deleteFournisseur,
} = require('../controllers/fournisseurController');

const router = Router();

router.get('/getfournisseur', getAllFournisseurs);
router.get('/search', require('../controllers/fournisseurController').searchFournisseurs);
router.get('/:id', getFournisseurById);
router.post('/addfournisseur', createFournisseur);
router.put('/updateFournisseur/:id', updateFournisseur);
router.delete('/deletefournisseur/:id', deleteFournisseur);

module.exports = router;