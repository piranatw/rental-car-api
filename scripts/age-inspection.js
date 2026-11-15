// Test helper: rewrites Inspection.createdAt of ONE inspection (found by booking id) so that it is
// <age> old, directly in the database. This is the only place that modifies a stored inspection
// outside the API; there is deliberately no test-only HTTP route.
// Usage: node scripts/age-inspection.js <bookingId> <age>
//   <age> is a number of days (fractional allowed, e.g. 7.5) or an integer number of
//   milliseconds with an "ms" suffix (e.g. 604805000ms).
// Refuses to run unless the database name in MONGO_URI ends with _test.
// Prints only the booking id and the new createdAt.
const mongoose = require('mongoose');
const Inspection = require('../models/Inspection');

const DAY_MS = 86400000;

const parseAge = (text) => {
  const m = /^(\d+(?:\.\d+)?)(ms)?$/.exec(String(text));
  if (!m) return null;
  const n = Number(m[1]);
  if (!Number.isFinite(n)) return null;
  return m[2] ? Math.round(n) : Math.round(n * DAY_MS);
};

const main = async () => {
  const noq = (process.env.MONGO_URI || '').split('?')[0];
  if (!noq.endsWith('_test')) throw new Error('Refusing to run: MONGO_URI database name must end with _test');
  const [bookingId, ageArg] = process.argv.slice(2);
  if (!bookingId || !mongoose.isValidObjectId(bookingId)) throw new Error('usage: age-inspection.js <bookingId> <days | <n>ms>');
  const ageMs = parseAge(ageArg);
  if (ageMs === null) throw new Error('age must be a non-negative number of days, or <n>ms');

  await mongoose.connect(process.env.MONGO_URI, { serverSelectionTimeoutMS: 3000 });
  try {
    const createdAt = new Date(Date.now() - ageMs);
    const r = await Inspection.updateOne({ booking: bookingId }, { $set: { createdAt } });
    if (r.matchedCount !== 1) throw new Error('no inspection found for booking ' + bookingId);
    console.log(`${bookingId} createdAt=${createdAt.toISOString()}`);
  } finally {
    await mongoose.disconnect();
  }
};

if (require.main === module) {
  main().catch((e) => { console.error('age-inspection: ' + e.message); process.exit(1); });
}
