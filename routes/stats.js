const express = require('express');
const { getStats } = require('../controllers/stats');
const { protect, authorize } = require('../middleware/auth');

const router = express.Router();

// Read-only and admin-only: protect answers 401, authorize answers 403.
router.get('/', protect, authorize('admin'), getStats);

module.exports = router;
