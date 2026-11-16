const express = require('express');
const { getBookings, getBooking, updateBooking, deleteBooking } = require('../controllers/bookings');
const { protect } = require('../middleware/auth');

const router = express.Router();

router.get('/', protect, getBookings);
router
  .route('/:id')
  .get(protect, getBooking)
  .put(protect, updateBooking)
  .delete(protect, deleteBooking);

module.exports = router;
