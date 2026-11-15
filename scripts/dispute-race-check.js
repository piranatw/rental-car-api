// Concurrency check for inspection disputes. Talks to the running test server over HTTP
// (Promise.all) and creates its own throwaway users, provider, bookings and inspections.
//  (i)   DOUBLE SUBMIT: 20 parallel submits by the owner -> exactly one 200, nineteen 400
//        'A dispute has already been submitted', one dispute stored (the winner's comment).
//  (ii)  RESOLVE RACE: an open dispute and 20 parallel admin PUTs (10 resolved, 10 dismissed) ->
//        exactly one 200, nineteen 400 'Dispute has already been closed', stored status = the
//        winner's, resolvedBy/resolvedAt set; (iv) the fee fields are unchanged by it.
//  (iii) SUBMIT vs EXPIRY: inspections aged (through scripts/age-inspection.js) to 7 days - 60 s
//        (exactly one 200), 7 days - 3 s (at most one 200) and 7 days + 3 s (all closed).
// (i) and (ii) repeat for 3 rounds with fresh data. Stored documents are read directly from the
// _test database by booking id only. Prints only counts; any 429 or 5xx aborts; any violation exits non-zero.
// Usage: node scripts/dispute-race-check.js   (MONGO_URI, PORT, adminEmail, adminPassword in env; server up)
const { execFileSync } = require('child_process');
const path = require('path');
const mongoose = require('mongoose');
const Provider = require('../models/Provider');
const Booking = require('../models/Booking');
const Inspection = require('../models/Inspection');
const User = require('../models/User');

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
const ROUNDS = 3;
const ALREADY = 'A dispute has already been submitted';
const WINDOW = 'Dispute window of 7 days has passed';
const CLOSED = 'Dispute has already been closed';
const FEE_FIELDS = ['lateHours', 'lateFee', 'feePerHourUsed', 'scheduledReturnAt', 'actualReturnTime'];

const call = async (method, p, token, body) => {
  const res = await fetch(base + p, {
    method,
    headers: { 'Content-Type': 'application/json', ...(token ? { Authorization: `Bearer ${token}` } : {}) },
    body: body === undefined ? undefined : JSON.stringify(body)
  });
  if (res.status === 429) throw new Error(`Got 429 on ${method} ${p}: the IP limiter is active (is RATE_LIMIT_FORCE exported?)`);
  if (res.status >= 500) throw new Error(`Got ${res.status} on ${method} ${p}`);
  let json = null;
  try { json = await res.json(); } catch (e) { /* non-JSON body */ }
  return { status: res.status, body: json };
};

const failures = [];
const check = (ok, label) => {
  console.log(`${ok ? 'PASS' : 'FAIL'} ${label}`);
  if (!ok) failures.push(label);
};
const msgCount = (rs, status, message) => rs.filter((r) => r.status === status && r.body && r.body.message === message).length;
const feeOf = (doc) => JSON.stringify(FEE_FIELDS.map((k) => (doc[k] instanceof Date ? doc[k].toISOString() : doc[k])));

(async () => {
  await mongoose.connect(process.env.MONGO_URI, { serverSelectionTimeoutMS: 3000 });
  const bookingIds = [];
  const userEmails = [];
  let providerId = null;
  try {
    const login = await call('POST', '/api/v1/auth/login', null, { email: process.env.adminEmail, password: process.env.adminPassword });
    if (login.status !== 200) throw new Error('admin login failed: ' + login.status);
    const adminToken = login.body.token;
    const me = await call('GET', '/api/v1/auth/me', adminToken);
    const adminId = me.body.data._id;

    const prov = await call('POST', '/api/v1/providers', adminToken, {
      name: 'Dispute Race Provider', address: '7 Race Road', tel: '020000007', dailyRate: 1000, lateFeePerHour: 200
    });
    if (prov.status !== 201) throw new Error('provider create failed: ' + prov.status);
    providerId = prov.body.data._id;

    const day = 86400000;
    const pickup = new Date(Date.now() - 5 * day).toISOString();
    const due = new Date(Date.now() - 3 * day).toISOString();
    const returned = new Date(Date.now() - 2 * day).toISOString();
    const sfx = Date.now().toString(36) + Math.floor(Math.random() * 1e6).toString(36);
    let seq = 0;

    // A fresh owner with one booking that has a recorded inspection.
    const fresh = async () => {
      const email = `drace${sfx}${seq++}@example.com`;
      const reg = await call('POST', '/api/v1/auth/register', null, { name: 'dRace', telephone: '0812345678', email, password: 'secret123' });
      if (reg.status !== 201) throw new Error('register failed: ' + reg.status);
      userEmails.push(email);
      const b = await call('POST', `/api/v1/providers/${providerId}/bookings`, reg.body.token, { date: pickup, returnDate: due });
      if (b.status !== 201) throw new Error('booking create failed: ' + b.status);
      const bookingId = b.body.data._id;
      bookingIds.push(bookingId);
      const i = await call('POST', `/api/v1/bookings/${bookingId}/inspection`, adminToken, { actualReturnTime: returned, odometer: 500, fuelLevel: 40, damageNotes: 'race' });
      if (i.status !== 201) throw new Error('inspection create failed: ' + i.status);
      return { token: reg.body.token, bookingId };
    };
    const age = (bookingId, ms) =>
      execFileSync(process.execPath, [path.join(__dirname, 'age-inspection.js'), bookingId, `${ms}ms`], { stdio: ['ignore', 'pipe', 'inherit'] });
    const submitAll = (o) => Promise.all(Array.from({ length: PARALLEL }, (_, i) =>
      call('POST', `/api/v1/bookings/${o.bookingId}/inspection/dispute`, o.token, { comment: `racer ${i}` })));

    for (let round = 1; round <= ROUNDS; round++) {
      // (i) double submit
      const o = await fresh();
      const rs = await submitAll(o);
      const ok = rs.filter((r) => r.status === 200);
      const dup = msgCount(rs, 400, ALREADY);
      check(ok.length === 1 && dup === PARALLEL - 1 && ok.length + dup === rs.length,
        `round ${round} (i): ${PARALLEL} parallel submits -> ${ok.length} x 200, ${dup} x 400 already-submitted, ${rs.length - ok.length - dup} other`);
      const docs = await Inspection.find({ booking: o.bookingId }).lean();
      const stored = docs[0] && docs[0].dispute;
      check(docs.length === 1 && stored && ok.length === 1 && stored.comment === ok[0].body.data.dispute.comment && stored.status === 'open',
        `round ${round} (i): one inspection row, one stored dispute = the winner's comment, status open`);

      // (ii) resolve race (+ iv fee fields)
      const before = feeOf(docs[0]);
      const rr = await Promise.all(Array.from({ length: PARALLEL }, (_, i) =>
        call('PUT', `/api/v1/bookings/${o.bookingId}/inspection/dispute`, adminToken,
          { status: i % 2 === 0 ? 'resolved' : 'dismissed', resolutionNote: `note ${i}` })));
      const won = rr.filter((r) => r.status === 200);
      const closed = msgCount(rr, 400, CLOSED);
      check(won.length === 1 && closed === PARALLEL - 1 && won.length + closed === rr.length,
        `round ${round} (ii): ${PARALLEL} parallel resolves -> ${won.length} x 200, ${closed} x 400 closed, ${rr.length - won.length - closed} other`);
      const after = await Inspection.findOne({ booking: o.bookingId }).lean();
      const d = after.dispute;
      const w = won[0] && won[0].body.data.dispute;
      check(won.length === 1 && d.status === w.status && d.resolutionNote === w.resolutionNote && String(d.resolvedBy) === adminId && d.resolvedAt instanceof Date,
        `round ${round} (ii): stored status/note equal the single winner's; resolvedBy and resolvedAt set once`);
      check(d.comment === stored.comment && String(d.createdAt) === String(stored.createdAt), `round ${round} (ii): submitted comment/createdAt untouched by the resolve race`);
      check(feeOf(after) === before, `round ${round} (iv): fee fields identical before and after the resolve race`);
    }

    // (iii) submit vs expiry
    const cases = [
      { label: '7 days - 60 s', ms: 7 * day - 60000, exact: true },
      { label: '7 days - 3 s', ms: 7 * day - 3000, exact: false },
      { label: '7 days + 3 s', ms: 7 * day + 3000, none: true }
    ];
    for (const c of cases) {
      const o = await fresh();
      age(o.bookingId, c.ms);
      const rs = await submitAll(o);
      const ok = rs.filter((r) => r.status === 200).length;
      const already = msgCount(rs, 400, ALREADY);
      const late = msgCount(rs, 400, WINDOW);
      const stored = (await Inspection.findOne({ booking: o.bookingId }).lean()).dispute;
      let pass;
      if (c.none) pass = ok === 0 && late === PARALLEL && stored === null;
      else if (c.exact) pass = ok === 1 && already === PARALLEL - 1 && !!stored;
      else pass = ok <= 1 && ok + already + late === PARALLEL && (ok === 1 ? already === PARALLEL - 1 && !!stored : late === PARALLEL && stored === null);
      check(pass, `(iii) aged ${c.label}: ${PARALLEL} parallel submits -> ${ok} x 200, ${already} x already-submitted, ${late} x window-passed; stored dispute ${stored ? 'present' : 'absent'}`);
    }
  } catch (e) {
    console.error('dispute-race error: ' + e.message);
    failures.push('error: ' + e.message);
  } finally {
    try {
      await Inspection.deleteMany({ booking: { $in: bookingIds } });
      await Booking.deleteMany({ _id: { $in: bookingIds } });
      await User.deleteMany({ email: { $in: userEmails } });
      if (providerId) await Provider.deleteOne({ _id: providerId });
    } catch (e) {
      console.error('cleanup error: ' + e.message);
    }
    await mongoose.disconnect();
  }
  if (failures.length) {
    console.error(`dispute-race-check: ${failures.length} violation(s)`);
    process.exit(1);
  }
})();
