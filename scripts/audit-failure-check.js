// Audit ordering and failure markers. Usage: node scripts/audit-failure-check.js (MONGO_URI env, _test db)
// Calls the booking and promo controllers directly with injected faults and proves:
//   - the audit entry exists BEFORE the booking mutation runs (a mutation cannot succeed unlogged)
//   - a failed mutation appends a NEW 'failed' entry and never touches the first entry
//   - the delete is pinned to the fields recorded in the entry (before cannot be stale)
//   - an admin promo apply stores its entry BEFORE the claim; errors after the claim append a failed
//     marker; a concurrent re-price appends a corrective edit entry; owner applies / rejections that
//     happen before any mutation write nothing
//   - an admin no-change PUT writes exactly one 'view' entry (and no edit / failed entry)
const mongoose = require('mongoose');
const Booking = require('../models/Booking');
const Provider = require('../models/Provider');
const PromoCode = require('../models/PromoCode');
const PromoRedemption = require('../models/PromoRedemption');
const AuditLog = require('../models/AuditLog');
const { updateBooking, deleteBooking } = require('../controllers/bookings');
const { applyPromo } = require('../controllers/promos');

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
const quiet = async (fn) => {
  const orig = console.error;
  console.error = () => {};
  try { return await fn(); } finally { console.error = orig; }
};
const keys = (o) => Object.keys(o || {}).sort().join();

(async () => {
  await mongoose.connect(process.env.MONGO_URI, { serverSelectionTimeoutMS: 3000 });
  const provider = await Provider.create({ name: 'AuditFail', address: 'x', tel: '1', dailyRate: 1000, lateFeePerHour: 0 });
  const owner = new mongoose.Types.ObjectId();
  const admin = new mongoose.Types.ObjectId();
  const sfx = Date.now().toString(36) + Math.floor(Math.random() * 1e6).toString(36);
  const promos = [];
  const mkPromo = async (value) => {
    const p = await PromoCode.create({
      code: `AFC${sfx}${promos.length}`.toUpperCase(), type: 'percentage', value,
      validFrom: new Date(Date.now() - 86400000), validTo: new Date(Date.now() + 86400000), maxRedemptions: 50
    });
    promos.push(p._id);
    return p;
  };
  const mk = () => Booking.create({
    user: owner, provider: provider._id, date: new Date(Date.now() + 10 * 86400000),
    returnDate: new Date(Date.now() + 12 * 86400000), totalPrice: 2000, discount: 0
  });
  const adminReq = (b, body) => ({ user: { id: admin.toString(), _id: admin, role: 'admin' }, params: { id: b._id.toString() }, body: body || {}, query: {} });
  const ownerReq = (b, body) => ({ user: { id: owner.toString(), _id: owner, role: 'user' }, params: { id: b._id.toString() }, body: body || {}, query: {} });
  const entries = (b) => AuditLog.find({ booking: b._id }).sort({ _id: 1 }).lean();
  const real = {
    deleteOne: Booking.deleteOne,
    findOneAndUpdate: Booking.findOneAndUpdate,
    redemptionCreate: PromoRedemption.create
  };
  const restore = () => {
    Booking.deleteOne = real.deleteOne;
    Booking.findOneAndUpdate = real.findOneAndUpdate;
    PromoRedemption.create = real.redemptionCreate;
  };
  const bookings = [];
  const fresh = async () => { const b = await mk(); bookings.push(b._id); return b; };
  try {
    // ---- delete: order -------------------------------------------------------------------------
    let b = await fresh();
    let seen = -1;
    let filter = null;
    Booking.deleteOne = async function (f, ...a) {
      filter = f;
      seen = await AuditLog.countDocuments({ booking: b._id, action: 'delete' });
      return real.deleteOne.call(this, f, ...a);
    };
    let res = fakeRes();
    await deleteBooking(adminReq(b), res);
    check(seen === 1, `delete entry already stored when the booking is deleted (seen ${seen})`);
    check(filter && keys(filter) === '_id,date,discount,promo,provider,returnDate,totalPrice', `delete is pinned to the recorded fields (${keys(filter)})`);
    let e = await entries(b);
    check(res.code === 200 && e.length === 1 && e[0].action === 'delete' && e[0].status === 'recorded' && e[0].after === null, 'successful delete: exactly one recorded entry, after null');

    // ---- delete matching nothing, booking still there: one bounded retry, then 409 -------------
    b = await fresh();
    Booking.deleteOne = async () => ({ deletedCount: 0 });
    res = fakeRes();
    await deleteBooking(adminReq(b), res);
    e = await entries(b);
    check(res.code === 409, `delete that keeps matching nothing answers 409 after one retry (${res.code})`);
    check(e.length === 4 && e.map((x) => x.status).join() === 'recorded,failed,recorded,failed' && e.every((x) => x.action === 'delete') && e[1].reason && e[1].reason.length > 0, 'delete: recorded+failed, then recorded+failed for the retry');
    const first = JSON.stringify(e[0]);

    // ---- delete that throws: marker words the outcome as unknown -------------------------------
    Booking.deleteOne = async () => { throw new Error('injected'); };
    res = fakeRes();
    await quiet(() => deleteBooking(adminReq(b), res));
    e = await entries(b);
    check(res.code === 500 && e.length === 6 && e[4].status === 'recorded' && e[5].status === 'failed' && /unknown/.test(e[5].reason), `delete that throws: 500, failed marker says outcome unknown (${res.code}, ${e.length} entries)`);
    check(JSON.stringify(e[0]) === first, 'first entry unchanged by the later failures');

    // ---- delete where the booking vanishes meanwhile: failed marker, 404 ------------------------
    b = await fresh();
    Booking.deleteOne = async function (f) { await real.deleteOne.call(this, { _id: f._id }); return { deletedCount: 0 }; };
    res = fakeRes();
    await deleteBooking(adminReq(b), res);
    e = await entries(b);
    check(res.code === 404 && e.length === 2 && e[0].status === 'recorded' && e[1].status === 'failed', `delete of a booking removed meanwhile: 404 + failed marker (${res.code}, ${e.length})`);
    Booking.deleteOne = real.deleteOne;

    // ---- delete pinned: a concurrent price change makes the stale delete miss -------------------
    b = await fresh();
    let injected = false;
    Booking.deleteOne = async function (f, ...a) {
      if (!injected) { injected = true; await Booking.updateOne({ _id: b._id }, { $set: { totalPrice: 1234 } }); }
      return real.deleteOne.call(this, f, ...a);
    };
    res = fakeRes();
    await deleteBooking(adminReq(b), res);
    e = await entries(b);
    check(res.code === 200 && e.map((x) => x.status).join() === 'recorded,failed,recorded' && e[0].before.totalPrice === 2000 && e[2].before.totalPrice === 1234, 'stale delete misses, is marked failed, retry records and deletes the CURRENT document');
    Booking.deleteOne = real.deleteOne;

    // ---- edit: order, 409, wording --------------------------------------------------------------
    b = await fresh();
    const newReturn = new Date(Date.now() + 15 * 86400000).toISOString();
    const before = [];
    Booking.findOneAndUpdate = function () {
      return AuditLog.countDocuments({ booking: b._id, status: 'recorded' }).then((n) => { before.push(n); return null; });
    };
    res = fakeRes();
    await updateBooking(adminReq(b, { returnDate: newReturn }), res);
    e = await entries(b);
    check(before.join() === '1,2,3', `each edit attempt has its entry stored before the write (${before.join()})`);
    check(res.code === 409, `exhausted retries answer 409 (${res.code})`);
    check(e.length === 6 && e.filter((x) => x.status === 'recorded').length === 3 && e.filter((x) => x.status === 'failed').length === 3, `3 recorded + 3 failed entries (${e.length})`);
    check(e.every((x) => x.action === 'edit' && keys(x.before) === 'returnDate,totalPrice'), 'edit entries carry only the changed keys');

    // ---- edit whose write throws: outcome unknown; populate failure after commit: no marker -----
    b = await fresh();
    Booking.findOneAndUpdate = () => Promise.reject(new Error('injected'));
    res = fakeRes();
    await quiet(() => updateBooking(adminReq(b, { returnDate: newReturn }), res));
    e = await entries(b);
    check(res.code === 500 && e.length === 2 && e[1].status === 'failed' && /unknown/.test(e[1].reason), 'edit whose write throws: failed marker words the outcome as unknown');
    b = await fresh();
    Booking.findOneAndUpdate = real.findOneAndUpdate;
    const realPopulate = mongoose.Document.prototype.populate;
    mongoose.Document.prototype.populate = function () { return Promise.reject(new Error('populate injected')); };
    res = fakeRes();
    await quiet(() => updateBooking(adminReq(b, { returnDate: newReturn }), res));
    mongoose.Document.prototype.populate = realPopulate;
    e = await entries(b);
    const stored = await Booking.findById(b._id).lean();
    check(res.code === 500 && stored.returnDate.toISOString() === newReturn && e.length === 1 && e[0].status === 'recorded', 'populate failing after the commit writes NO failed marker (the edit happened)');

    // ---- edit: real success, no-op => view ------------------------------------------------------
    b = await fresh();
    res = fakeRes();
    await updateBooking(adminReq(b, { returnDate: newReturn }), res);
    e = await entries(b);
    check(res.code === 200 && e.length === 1 && e[0].action === 'edit' && e[0].status === 'recorded', 'successful edit: one recorded edit entry, no extra view');
    for (const [label, body] of [['identical values', { returnDate: newReturn }], ['junk only', { foo: 1 }], ['empty body', {}]]) {
      res = fakeRes();
      await updateBooking(adminReq(b, body), res);
    }
    e = await entries(b);
    check(e.length === 4 && e.slice(1).every((x) => x.action === 'view' && x.status === 'recorded'), `no-change admin PUTs (identical / junk / empty) write exactly one view each (${e.map((x) => x.action).join()})`);
    res = fakeRes();
    await updateBooking(ownerReq(b, {}), res);
    res = fakeRes();
    await updateBooking(ownerReq(b, { returnDate: newReturn }), res);
    check((await entries(b)).length === 4, 'owner PUTs write nothing');

    // ---- promo apply by admin -------------------------------------------------------------------
    const promo = await mkPromo(10);
    const body = { code: promo.code };

    // entry exists before the claim; a fault in the claim step leaves a failed marker
    b = await fresh();
    let atClaim = -1;
    Booking.findOneAndUpdate = async function () {
      atClaim = await AuditLog.countDocuments({ booking: b._id, action: 'edit', status: 'recorded' });
      throw new Error('injected claim failure');
    };
    res = fakeRes();
    await quiet(() => applyPromo(adminReq(b, body), res));
    e = await entries(b);
    let s = await Booking.findById(b._id).lean();
    check(atClaim === 1, `promo apply: entry already stored when the claim runs (${atClaim})`);
    check(res.code === 500 && e.length === 2 && e[0].status === 'recorded' && e[1].status === 'failed' && s.promo === null && s.totalPrice === 2000, 'fault in the claim: 500, failed marker, booking untouched');
    check(keys(e[0].before) === 'discount,promo,totalPrice' && e[0].before.promo === null && e[0].after.promo.toString() === promo._id.toString() && e[0].after.discount === 200 && e[0].after.totalPrice === 1800, 'promo entry holds exactly promo, discount, totalPrice (intended values)');
    Booking.findOneAndUpdate = real.findOneAndUpdate;

    // thrown error after the claim: undone, failed marker, counters released
    b = await fresh();
    PromoRedemption.create = async () => { throw new Error('injected redemption failure'); };
    res = fakeRes();
    await quiet(() => applyPromo(adminReq(b, body), res));
    PromoRedemption.create = real.redemptionCreate;
    e = await entries(b);
    s = await Booking.findById(b._id).lean();
    let p = await PromoCode.findById(promo._id).lean();
    check(res.code === 500 && e.length === 2 && e[1].status === 'failed' && /error/.test(e[1].reason), 'error after the claim: failed marker appended');
    check(s.promo === null && s.discount === 0 && s.totalPrice === 2000 && p.redemptionCount === 0, 'error after the claim: apply undone (booking and counters untouched)');

    // success: one entry, nothing else
    b = await fresh();
    res = fakeRes();
    await applyPromo(adminReq(b, body), res);
    e = await entries(b);
    check(res.code === 200 && e.length === 1 && e[0].action === 'edit' && e[0].status === 'recorded' && e[0].after.totalPrice === 1800, 'successful admin apply: exactly one edit entry');

    // already has a promo / unknown code: nothing was attempted, nothing is written
    res = fakeRes();
    await applyPromo(adminReq(b, body), res);
    check(res.code === 400 && (await entries(b)).length === 1, 'admin apply on a booking that already has a promo: 400, no entry');
    const b2 = await fresh();
    res = fakeRes();
    await applyPromo(adminReq(b2, { code: 'NOSUCHCODE' + sfx }), res);
    check(res.code === 400 && (await entries(b2)).length === 0, 'admin apply of an unknown code: 400, no entry');
    // owner apply writes nothing
    res = fakeRes();
    await applyPromo(ownerReq(b2, body), res);
    check(res.code === 200 && (await entries(b2)).length === 0, 'owner apply: 200, no entry');

    // rejection after the entry (exhausted): failed marker
    const full = await mkPromo(10);
    await PromoCode.updateOne({ _id: full._id }, { $set: { redemptionCount: 50 } });
    const b3 = await fresh();
    res = fakeRes();
    await applyPromo(adminReq(b3, { code: full.code }), res);
    e = await entries(b3);
    s = await Booking.findById(b3._id).lean();
    check(res.code === 400 && e.length === 2 && e[0].status === 'recorded' && e[1].status === 'failed' && s.promo === null && s.totalPrice === 2000, 'exhausted code: 400, recorded + failed, booking untouched');

    // concurrent re-price: corrective edit entry + superseded marker, none updated
    b = await fresh();
    let calls = 0;
    Booking.findOneAndUpdate = function (...a) {
      calls++;
      if (calls === 2) {
        return {
          populate: async () => {
            await real.findOneAndUpdate.call(Booking, { _id: b._id }, { $set: { returnDate: new Date(b.date.getTime() + 3 * 86400000) } });
            return null;
          }
        };
      }
      return real.findOneAndUpdate.apply(this, a);
    };
    res = fakeRes();
    await applyPromo(adminReq(b, body), res);
    Booking.findOneAndUpdate = real.findOneAndUpdate;
    e = await entries(b);
    s = await Booking.findById(b._id).lean();
    check(res.code === 200 && s.discount === 300 && s.totalPrice === 2700, `re-priced apply lands at the final price (${res.code}, ${s.discount}, ${s.totalPrice})`);
    const kinds = e.map((x) => `${x.action}:${x.status}`).sort().join();
    check(kinds === 'edit:failed,edit:recorded,edit:recorded', `re-priced apply: intent entry, corrective edit, superseded marker (${kinds})`);
    const corrective = e.find((x) => x.status === 'recorded' && x.after.discount === 300);
    check(corrective && corrective.before.promo === null && corrective.before.totalPrice === 2000 && corrective.after.totalPrice === 2700, 'corrective entry carries what actually landed');
    check(e.find((x) => x.status === 'recorded' && x.after.discount === 200), 'the first (intent) entry is unchanged');
  } finally {
    restore();
    await Booking.deleteMany({ _id: { $in: bookings } });
    await PromoRedemption.deleteMany({ promo: { $in: promos } });
    await PromoCode.deleteMany({ _id: { $in: promos } });
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
