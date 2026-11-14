// Audit ordering and failure markers. Usage: node scripts/audit-failure-check.js (MONGO_URI env, _test db)
// Proves, by calling the booking controllers directly with an injected mutation fault:
//   - the audit entry exists BEFORE the booking mutation runs (a mutation cannot succeed unlogged)
//   - a failed mutation appends a second, 'failed' entry and never touches the first entry
const mongoose = require('mongoose');
const Booking = require('../models/Booking');
const Provider = require('../models/Provider');
const AuditLog = require('../models/AuditLog');
const { updateBooking, deleteBooking } = require('../controllers/bookings');

const noq = (process.env.MONGO_URI || '').split('?')[0];
if (!noq.endsWith('_test')) {
  console.error('Refusing to run: MONGO_URI database name must end with _test');
  process.exit(1);
}

const failures = [];
const check = (ok, label) => {
  console.log(`${ok ? 'PASS' : 'FAIL'} ${label}`);
  if (!ok) failures.push(label);
};

const fakeRes = () => ({
  code: null,
  body: null,
  status(c) { this.code = c; return this; },
  json(b) { this.body = b; return this; }
});

(async () => {
  await mongoose.connect(process.env.MONGO_URI, { serverSelectionTimeoutMS: 3000 });
  const provider = await Provider.create({ name: 'AuditFail', address: 'x', tel: '1', dailyRate: 1000, lateFeePerHour: 0 });
  const owner = new mongoose.Types.ObjectId();
  const admin = new mongoose.Types.ObjectId();
  const mk = () => Booking.create({
    user: owner, provider: provider._id, date: new Date(Date.now() + 10 * 86400000),
    returnDate: new Date(Date.now() + 12 * 86400000), totalPrice: 2000, discount: 0
  });
  const req = (b, body) => ({ user: { id: admin.toString(), _id: admin, role: 'admin' }, params: { id: b._id.toString() }, body: body || {}, query: {} });
  const entries = (b) => AuditLog.find({ booking: b._id }).sort({ _id: 1 }).lean();
  const realDeleteOne = Booking.deleteOne;
  const realFindOneAndUpdate = Booking.findOneAndUpdate;
  const bookings = [];
  try {
    // 1. Order: when deleteOne runs, the delete entry is already stored; the delete then succeeds.
    let b = await mk(); bookings.push(b._id);
    let seen = -1;
    Booking.deleteOne = async function (...a) { seen = await AuditLog.countDocuments({ booking: b._id, action: 'delete' }); return realDeleteOne.apply(this, a); };
    let res = fakeRes();
    await deleteBooking(req(b), res);
    check(seen === 1, `delete entry already stored when the booking is deleted (seen ${seen})`);
    let e = await entries(b);
    check(res.code === 200 && e.length === 1 && e[0].action === 'delete' && e[0].status === 'recorded' && e[0].after === null, 'successful delete: exactly one recorded entry, after null');

    // 2. Delete that removes nothing: first entry intact, second 'failed' entry appended, 404.
    b = await mk(); bookings.push(b._id);
    Booking.deleteOne = async () => ({ deletedCount: 0 });
    res = fakeRes();
    await deleteBooking(req(b), res);
    e = await entries(b);
    check(res.code === 404, `delete matching nothing answers 404 (${res.code})`);
    check(e.length === 2 && e[0].status === 'recorded' && e[1].status === 'failed' && typeof e[1].reason === 'string' && e[1].reason.length > 0, 'delete matching nothing: recorded entry then failed entry with reason');
    const first = JSON.stringify(e[0]);

    // 3. Delete that throws: failed marker appended, 500, first entry unchanged.
    Booking.deleteOne = async () => { throw new Error('injected'); };
    res = fakeRes();
    const origErr = console.error; console.error = () => {};
    await deleteBooking(req(b), res);
    console.error = origErr;
    e = await entries(b);
    check(res.code === 500 && e.length === 4 && e[2].status === 'recorded' && e[3].status === 'failed', `delete that throws: 500 with another recorded+failed pair (${res.code}, ${e.length} entries)`);
    check(JSON.stringify(e[0]) === first, 'first entry unchanged by the later failures');
    Booking.deleteOne = realDeleteOne;

    // 4. Edit: entry stored before the write; a write that never matches ends 409 with 3 failed markers.
    b = await mk(); bookings.push(b._id);
    const newReturn = new Date(Date.now() + 15 * 86400000).toISOString();
    let before = [];
    Booking.findOneAndUpdate = function () {
      const p = AuditLog.countDocuments({ booking: b._id, status: 'recorded' }).then((n) => { before.push(n); return null; });
      return { populate: () => p };
    };
    res = fakeRes();
    await updateBooking(req(b, { returnDate: newReturn }), res);
    e = await entries(b);
    check(before.join() === '1,2,3', `each edit attempt has its entry stored before the write (${before.join()})`);
    check(res.code === 409, `exhausted retries answer 409 (${res.code})`);
    check(e.length === 6 && e.filter((x) => x.status === 'recorded').length === 3 && e.filter((x) => x.status === 'failed').length === 3, `3 recorded + 3 failed entries (${e.length})`);
    check(e.every((x) => x.action === 'edit' && Object.keys(x.before).sort().join() === 'returnDate,totalPrice'), 'edit entries carry only the changed keys');
    Booking.findOneAndUpdate = realFindOneAndUpdate;

    // 5. Real successful edit afterwards: one recorded entry, no failed marker; no-op writes none.
    b = await mk(); bookings.push(b._id);
    res = fakeRes();
    await updateBooking(req(b, { returnDate: newReturn }), res);
    e = await entries(b);
    check(res.code === 200 && e.length === 1 && e[0].status === 'recorded', 'successful edit: one recorded entry');
    res = fakeRes();
    await updateBooking(req(b, { returnDate: newReturn }), res);
    e = await entries(b);
    check(res.code === 200 && e.length === 1, 'edit changing nothing writes no entry and no failed marker');
  } finally {
    Booking.deleteOne = realDeleteOne;
    Booking.findOneAndUpdate = realFindOneAndUpdate;
    await Booking.deleteMany({ _id: { $in: bookings } });
    await Provider.deleteOne({ _id: provider._id });
    await mongoose.disconnect();
  }
  if (failures.length) {
    console.error(`audit-failure-check: ${failures.length} violation(s)`);
    process.exit(1);
  }
})().catch((e) => {
  console.error('audit-failure-check error: ' + e.message);
  process.exit(1);
});
