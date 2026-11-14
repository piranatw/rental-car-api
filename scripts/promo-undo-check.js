// Undo path check: a failure in the LAST undo step must never cause a double release.
// Direct DB check (no HTTP). Usage: node scripts/promo-undo-check.js   (MONGO_URI env, _test database)
const mongoose = require('mongoose');
const PromoCode = require('../models/PromoCode');
const PromoRedemption = require('../models/PromoRedemption');
const Booking = require('../models/Booking');
const { undoApply, undoSteps, rejectionMessage } = require('../controllers/promos');

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
const boom = () => { throw new Error('injected failure'); };
// The inline undo and the catch-block retry both go through undoApply; either may throw or return errors.
const run = async (state, steps) => {
  try { const errs = await undoApply(state, steps); return Array.isArray(errs) ? errs : []; } catch (e) { return [e]; }
};

(async () => {
  await mongoose.connect(process.env.MONGO_URI, { serverSelectionTimeoutMS: 3000 });
  const ids = { promos: [], bookings: [] };
  const fixture = async (count) => {
    const uid = new mongoose.Types.ObjectId();
    const promo = await PromoCode.create({
      code: `UNDO${Date.now().toString(36)}${Math.floor(Math.random() * 1e9).toString(36)}`.toUpperCase(),
      type: 'percentage', value: 10, validFrom: new Date(Date.now() - 1000), validTo: new Date(Date.now() + 86400000), maxRedemptions: 5
    });
    await PromoCode.updateOne({ _id: promo._id }, { $set: { redemptionCount: count, [`usage.${uid}`]: count } });
    const booking = await Booking.create({
      user: uid, provider: new mongoose.Types.ObjectId(), date: new Date(), returnDate: new Date(Date.now() + 86400000),
      totalPrice: 900, discount: 100, promo: promo._id
    });
    const redemption = await PromoRedemption.create({ promo: promo._id, user: uid, booking: booking._id });
    ids.promos.push(promo._id); ids.bookings.push(booking._id);
    return {
      uid, promo, booking,
      state: { claimed: { bookingId: booking._id, promoId: promo._id }, reserved: { promoId: promo._id, userId: uid.toString() }, redemption }
    };
  };
  const read = async (f) => ({
    p: await PromoCode.findById(f.promo._id).lean(),
    rows: await PromoRedemption.countDocuments({ promo: f.promo._id }),
    b: await Booking.findById(f.booking._id).lean()
  });
  try {
    // 1. Last step (release claim) fails once, then the catch-block retry runs the undo again.
    let f = await fixture(1);
    const failing = { ...undoSteps, releaseClaim: boom };
    await run(f.state, failing);
    await run(f.state, undoSteps);
    let s = await read(f);
    check(s.p.redemptionCount === 0 && s.p.usage[f.uid] === 0, `last-step failure then retry: redemptionCount=${s.p.redemptionCount}, user usage=${s.p.usage[f.uid]} (both must be 0)`);
    check(s.rows === 0, `redemption row removed once (${s.rows} left)`);
    check(s.b.promo === null && s.b.discount === 0 && s.b.totalPrice === 1000, `claim released on retry and price restored (promo=${s.b.promo}, discount=${s.b.discount}, total=${s.b.totalPrice})`);

    // 2. The last step keeps failing: counters still released exactly once and the failure is reported.
    f = await fixture(1);
    const e1 = await run(f.state, failing);
    const e2 = await run(f.state, failing);
    s = await read(f);
    check(s.p.redemptionCount === 0 && s.p.usage[f.uid] === 0, `repeated last-step failure: redemptionCount=${s.p.redemptionCount}, user usage=${s.p.usage[f.uid]} (both must be 0)`);
    check(e1.length === 1 && e2.length === 1, `each failing run reports its failure (${e1.length}, ${e2.length})`);

    // 3. An earlier step failing must not skip the later ones.
    f = await fixture(1);
    await run(f.state, { ...undoSteps, deleteRedemption: boom });
    s = await read(f);
    check(s.p.redemptionCount === 0 && s.b.promo === null, `first-step failure: later steps still ran (redemptionCount=${s.p.redemptionCount}, promo=${s.b.promo})`);

    // 4. The counter can never be driven below zero.
    f = await fixture(0);
    await run({ claimed: null, redemption: null, reserved: { promoId: f.promo._id, userId: f.uid.toString() } }, undoSteps);
    s = await read(f);
    check(s.p.redemptionCount === 0 && s.p.usage[f.uid] === 0, `unreserve on zero counters stays at zero (${s.p.redemptionCount}, ${s.p.usage[f.uid]})`);

    // 5. rejectionMessage never blames a per-user limit that does not exist.
    const now = new Date();
    const window = { validFrom: new Date(now - 1000), validTo: new Date(now.getTime() + 86400000) };
    const uidStr = new mongoose.Types.ObjectId().toString();
    const noLimit = { ...window, maxRedemptions: 5, redemptionCount: 4, usage: { [uidStr]: 9 } };
    check(rejectionMessage(noLimit, uidStr, now) === null, 'no perUserLimit, count below max: no per-user message (unexplained -> null)');
    check(rejectionMessage({ ...noLimit, perUserLimit: 2 }, uidStr, now) === 'You have reached the per-user limit for this promo code', 'perUserLimit 2 with usage 9: per-user message');
    check(rejectionMessage({ ...noLimit, perUserLimit: 2, usage: {} }, uidStr, now) === null, 'perUserLimit 2 with no usage: unexplained -> null');
    check(rejectionMessage({ ...noLimit, redemptionCount: 5 }, uidStr, now) === 'Promo code has reached its maximum redemptions', 'count at max: exhausted message');
  } finally {
    await PromoRedemption.deleteMany({ promo: { $in: ids.promos } });
    await Booking.deleteMany({ _id: { $in: ids.bookings } });
    await PromoCode.deleteMany({ _id: { $in: ids.promos } });
    await mongoose.disconnect();
  }
  if (failures.length) {
    console.error(`promo-undo-check: ${failures.length} violation(s)`);
    process.exit(1);
  }
})().catch((e) => {
  console.error('promo-undo-check error: ' + e.message);
  process.exit(1);
});
