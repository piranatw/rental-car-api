const express = require('express');
const { createPromo, getPromos } = require('../controllers/promos');
const { protect, authorize } = require('../middleware/auth');

const router = express.Router();

router.route('/').get(protect, authorize('admin'), getPromos).post(protect, authorize('admin'), createPromo);

module.exports = router;
