// Concurrency check for return inspections: 20 parallel admin creates for ONE booking must give
// exactly one 201 and nineteen 409, and exactly one Inspection row for that booking (checked through
// GET and directly in the _test database, by that booking id only). Repeated over several fresh bookings.
// Talks to the running test server over HTTP (Promise.all); creates its own throwaway provider and bookings (owned by the admin, who has no booking cap).
// Usage: node scripts/inspection-race-check.js   (MONGO_URI, PORT, adminEmail, adminPassword in env; server up)
// Prints counts only. Any 429 or 5xx aborts the run; any violation exits non-zero.
const mongoose = require('mongoose');
const Provider = require('../models/Provider');
const Booking = require('../models/Booking');
const Inspection = require('../models/Inspection');

const base = `http://localhost:${process.env.PORT || 5050}`;
const noq = (process.env.MONGO_URI || '').split('?')[0];
if (!noq.endsWith('_test')) {
  console.error('Refusing to run: MONGO_URI database name must end with _test');
  process.exit(1);
}
if (!process.env.adminEmail || !process.env.adminPassword) {
  console.error('adminEmail and adminPassword must be set. Run: source config/test-env.sh');
  process.exit(1);
}

const PARALLEL = 20;
const ROUNDS = 5;
const DUPLICATE = 'Inspection already recorded for this booking';

const call = async (method, path, token, body) => {
  const res = await fetch(base + path, {
    method,
    headers: { 'Content-Type': 'application/json', ...(token ? { Authorization: `Bearer ${token}` } : {}) },
    body: body === undefined ? undefined : JSON.stringify(body)
  });
  if (res.status === 429) throw new Error(`Got 429 on ${method} ${path}: the IP limiter is active (is RATE_LIMIT_FORCE exported?)`);
  if (res.status >= 500) throw new Error(`Got ${res.status} on ${method} ${path}`);
  let json = null;
  try { json = await res.json(); } catch (e) { /* non-JSON body */ }
  return { status: res.status, body: json };
};

const failures = [];
const check = (ok, label) => {
  console.log(`${ok ? 'PASS' : 'FAIL'} ${label}`);
  if (!ok) failures.push(label);
};

(async () => {
  await mongoose.connect(process.env.MONGO_URI, { serverSelectionTimeoutMS: 3000 });
  const bookingIds = [];
  let providerId = null;
  try {
    const login = await call('POST', '/api/v1/auth/login', null, { email: process.env.adminEmail, password: process.env.adminPassword });
    if (login.status !== 200) throw new Error('admin login failed: ' + login.status);
    const adminToken = login.body.token;

    const prov = await call('POST', '/api/v1/providers', adminToken, {
      name: 'Inspection Race Provider', address: '5 Race Road', tel: '020000005', dailyRate: 1000, lateFeePerHour: 200
    });
    if (prov.status !== 201) throw new Error('provider create failed: ' + prov.status);
    providerId = prov.body.data._id;

    const day = 86400000;
    const pickup = new Date(Date.now() - 5 * day).toISOString();
    const due = new Date(Date.now() - 3 * day).toISOString();
    const returned = new Date(Date.now() - 2 * day).toISOString();

    for (let round = 1; round <= ROUNDS; round++) {
      const b = await call('POST', `/api/v1/providers/${providerId}/bookings`, adminToken, { date: pickup, returnDate: due });
      if (b.status !== 201) throw new Error('booking create failed: ' + b.status);
      const bookingId = b.body.data._id;
      bookingIds.push(bookingId);

      const rs = await Promise.all(Array.from({ length: PARALLEL }, (_, i) =>
        call('POST', `/api/v1/bookings/${bookingId}/inspection`, adminToken, {
          actualReturnTime: returned, odometer: 1000 + i, fuelLevel: 50, damageNotes: `racer ${i}`
        })));
      const created = rs.filter((r) => r.status === 201).length;
      const dup = rs.filter((r) => r.status === 409 && r.body && r.body.message === DUPLICATE).length;
      const other = rs.length - created - dup;
      check(created === 1 && dup === PARALLEL - 1 && other === 0,
        `round ${round}: ${PARALLEL} parallel creates -> ${created} x 201, ${dup} x 409, ${other} other`);

      const rows = await Inspection.countDocuments({ booking: bookingId });
      check(rows === 1, `round ${round}: Inspection rows for this booking = ${rows} (must be 1)`);

      const g = await call('GET', `/api/v1/bookings/${bookingId}/inspection`, adminToken);
      const winner = rs.find((r) => r.status === 201);
      check(g.status === 200 && winner && g.body.data._id === winner.body.data._id && g.body.data.lateHours > 0,
        `round ${round}: GET returns the one inspection the winner was given`);
    }
  } catch (e) {
    console.error('inspection-race error: ' + e.message);
    failures.push('error: ' + e.message);
  } finally {
    try {
      await Inspection.deleteMany({ booking: { $in: bookingIds } });
      await Booking.deleteMany({ _id: { $in: bookingIds } });
      if (providerId) await Provider.deleteOne({ _id: providerId });
    } catch (e) {
      console.error('cleanup error: ' + e.message);
    }
    await mongoose.disconnect();
  }
  if (failures.length) {
    console.error(`inspection-race-check: ${failures.length} violation(s)`);
    process.exit(1);
  }
})();
