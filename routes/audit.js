const express = require('express');
const { getAuditLogs } = require('../controllers/audit');
const { protect, authorize } = require('../middleware/auth');

const router = express.Router();

// Read-only by design: no other method and no /:id route exists under /api/v1/audit.
router.get('/', protect, authorize('admin'), getAuditLogs);

module.exports = router;
