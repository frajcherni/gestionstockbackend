// routes/auth.js
const express = require("express");
const router = express.Router();
const { register, login , updateProfile } = require("../controllers/authController");
const authController = require('../controllers/authController');

router.post("/register", register);
router.post("/login", login);
router.put('/profile', authController.upload.single('company_logo'), authController.updateProfile);

module.exports = router;
