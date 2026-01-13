const express = require('express');
const router = express.Router();
const articleController = require('../controllers/ArticleController');

router.get('/getarticle', articleController.getAllArticles);
router.get('/:id', articleController.getArticleById);
router.post('/addarticle', articleController.createArticle);
router.put('/updatearticle/:id', articleController.updateArticle);
router.delete('/deletearticle/:id', articleController.deleteArticle);
router.post('/search', articleController.searchArticles);

router.put('/:id/website-settings', articleController.updateArticleWebsiteSettings);
router.post('/:id/website-images', articleController.uploadWebsiteImages);
router.delete('/:id/website-images/:imageIndex', articleController.removeWebsiteImage);

module.exports = router;