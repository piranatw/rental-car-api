const express = require('express');
const { register, login, getMe, logout } = require('../controllers/auth');
const { protect } = require('../middleware/auth');
const { loginLimiter } = require('../middleware/loginLimiter');

const router = express.Router();

router.post('/register', register);
router.post('/login', loginLimiter, login);
router.get('/me', protect, getMe);
router.post('/logout', protect, logout);

module.exports = router;
