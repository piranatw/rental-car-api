const express = require('express');
const { createInspection, getInspection } = require('../controllers/inspections');
const { protect, authorize } = require('../middleware/auth');

// Mounted at /api/v1/bookings/:id/inspection, before the bookings router.
const router = express.Router({ mergeParams: true });

router.route('/').get(protect, getInspection).post(protect, authorize('admin'), createInspection);

module.exports = router;
