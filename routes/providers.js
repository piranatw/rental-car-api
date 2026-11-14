const express = require('express');
const {
  getProviders,
  getProvider,
  createProvider,
  updateProvider,
  deleteProvider
} = require('../controllers/providers');
const { addBooking } = require('../controllers/bookings');
const { protect, authorize } = require('../middleware/auth');

const router = express.Router();

router.route('/').get(getProviders).post(protect, authorize('admin'), createProvider);
router
  .route('/:id')
  .get(getProvider)
  .put(protect, authorize('admin'), updateProvider)
  .delete(protect, authorize('admin'), deleteProvider);
router.post('/:providerId/bookings', protect, addBooking);

module.exports = router;
