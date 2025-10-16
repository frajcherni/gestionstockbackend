// routes/auth.js
const express = require("express");
const router = express.Router();
const { register, login , updateProfile } = require("../controllers/AuthController");
const AuthController = require('../controllers/AuthController');

router.post("/register", register);
router.post("/login", login);
router.put('/profile', AuthController.upload.single('company_logo'), AuthController.updateProfile);

module.exports = router;
