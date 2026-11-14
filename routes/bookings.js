const express = require('express');
const { getBookings, getBooking, updateBooking, deleteBooking } = require('../controllers/bookings');
const { applyPromo } = require('../controllers/promos');
const { protect } = require('../middleware/auth');

const router = express.Router();

router.get('/', protect, getBookings);
router.post('/:id/promo', protect, applyPromo);
router
  .route('/:id')
  .get(protect, getBooking)
  .put(protect, updateBooking)
  .delete(protect, deleteBooking);

module.exports = router;
