// Seeds 5000 audit entries into the _test database through the model's insertMany (append-only).
// Usage: node scripts/seed-audit.js   (MONGO_URI env, database name must end with _test)
// Ids are fixed so the Postman Audit folder can reference them; they never equal a real user or
// booking id, so the folder's own per-run filters are not disturbed. Timestamps are in the past.
const mongoose = require('mongoose');
const AuditLog = require('../models/AuditLog');

const noq = (process.env.MONGO_URI || '').split('?')[0];
if (!noq.endsWith('_test')) {
  console.error('Refusing to run: MONGO_URI database name must end with _test');
  process.exit(1);
}

const TOTAL = 5000;
const ADMINS = [1, 2, 3, 4, 5].map((n) => new mongoose.Types.ObjectId(`aaaaaaaaaaaaaaaaaaaa${String(n).padStart(4, '0')}`));
const BOOKINGS = Array.from({ length: 50 }, (_, n) => new mongoose.Types.ObjectId(`bbbbbbbbbbbbbbbbbbbb${String(n + 1).padStart(4, '0')}`));
const ACTIONS = ['view', 'edit', 'delete'];

(async () => {
  await mongoose.connect(process.env.MONGO_URI, { serverSelectionTimeoutMS: 3000 });
  try {
    const now = Date.now();
    const docs = [];
    for (let i = 0; i < TOTAL; i++) {
      const action = ACTIONS[i % 3];
      docs.push({
        admin: ADMINS[i % ADMINS.length],
        action,
        booking: BOOKINGS[(i * 7) % BOOKINGS.length],
        // spread over ~60 days, newest 1 hour ago
        timestamp: new Date(now - 3600000 - i * 17 * 60000),
        before: action === 'view' ? null : { totalPrice: 1000 + i },
        after: action === 'edit' ? { totalPrice: 2000 + i } : null
      });
    }
    for (let i = 0; i < docs.length; i += 1000) {
      await AuditLog.insertMany(docs.slice(i, i + 1000));
    }
    console.log(`Seeded ${TOTAL} audit entries (${ADMINS.length} admins, ${BOOKINGS.length} bookings)`);
  } finally {
    await mongoose.disconnect();
  }
})().catch((e) => {
  console.error('seed-audit error: ' + e.message);
  process.exit(1);
});
