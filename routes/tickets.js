const express = require('express');
const {
  createTicket, getTickets, getTicket, addComment, setStatus
} = require('../controllers/tickets');
const { protect, authorize } = require('../middleware/auth');

const router = express.Router();

router.route('/').post(protect, createTicket).get(protect, getTickets);
router.get('/:id', protect, getTicket);
router.post('/:id/comments', protect, addComment);
router.put('/:id/status', protect, authorize('admin'), setStatus);

module.exports = router;
