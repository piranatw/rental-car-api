// Seeds the Stats fixture (5000 bookings dated in 2090) into the _test database.
// Usage: node scripts/seed-stats.js   (MONGO_URI env, database name must end with _test)
// Isolation: the providers are named 'Stats Provider ...', the bookings belong to the dedicated user
// stats-seed@example.test, and every date is in 2090 (no other folder uses that year). A rerun first
// deletes only the bookings of that user on those providers, then inserts again, so counts never double.
// Providers are reused by name when they already exist (never deleted: they may carry other bookings).
const crypto = require('crypto');
const mongoose = require('mongoose');
const Booking = require('../models/Booking');
const Provider = require('../models/Provider');
const User = require('../models/User');
const { PROVIDERS, buildBookings } = require('./stats-fixture');

const noq = (process.env.MONGO_URI || '').split('?')[0];
if (!noq.endsWith('_test')) {
  console.error('Refusing to run: MONGO_URI database name must end with _test');
  process.exit(1);
}

const EMAIL = 'stats-seed@example.test';

(async () => {
  await mongoose.connect(process.env.MONGO_URI, { serverSelectionTimeoutMS: 3000 });
  try {
    let user = await User.findOne({ email: EMAIL });
    if (!user) {
      user = await User.create({ name: 'stats-seed', telephone: '0000000000', email: EMAIL, password: crypto.randomBytes(16).toString('hex') });
    }

    const ids = new Map();
    for (const p of PROVIDERS) {
      let doc = await Provider.findOne({ name: p.name });
      if (!doc) doc = await Provider.create({ name: p.name, address: 'Stats Road', tel: '029999999', lateFeePerHour: 100, dailyRate: 1000 });
      ids.set(p.name, doc._id);
    }

    const removed = await Booking.deleteMany({ user: user._id, provider: { $in: [...ids.values()] } });

    // Fixed ids with the highest possible timestamp prefix: GET /bookings lists by _id ascending, so these
    // 5000 rows sort after every booking another folder creates and never crowd its first page.
    const rows = buildBookings().map((r, i) => ({
      _id: new mongoose.Types.ObjectId(`ffffffff${i.toString(16).padStart(16, '0')}`),
      user: user._id,
      provider: ids.get(r.provider),
      date: r.date,
      returnDate: r.date,
      totalPrice: 1000
    }));
    for (let i = 0; i < rows.length; i += 1000) {
      await Booking.insertMany(rows.slice(i, i + 1000));
    }
    console.log(`Seeded ${rows.length} stats bookings in 2090 across ${PROVIDERS.length} providers (removed ${removed.deletedCount} from a previous run)`);
  } finally {
    await mongoose.disconnect();
  }
})().catch((e) => {
  console.error('seed-stats error: ' + e.message);
  process.exit(1);
});
