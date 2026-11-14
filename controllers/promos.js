const PromoCode = require('../models/PromoCode');
const PromoRedemption = require('../models/PromoRedemption');
const Booking = require('../models/Booking');
const Provider = require('../models/Provider');
const { loadOwnedBooking } = require('./bookings');
const { computeSubtotal, computeDiscount, priceOf } = require('../utils/pricing');
const { recordAudit, recordFailure, diffFields, PROMO_KEYS } = require('./audit');

const MSG = {
  notFound: 'Promo code not found',
  notYet: 'Promo code is not yet valid',
  expired: 'Promo code has expired',
  exhausted: 'Promo code has reached its maximum redemptions',
  perUser: 'You have reached the per-user limit for this promo code',
  hasPromo: 'Booking already has a promo code',
  noPrice: 'Booking has no price to discount'
};
const PROVIDER_POPULATE = { path: 'provider', select: 'name address tel' };

const fail = (res, status, message) => res.status(status).json({ success: false, message });

const handleError = (err, res) => {
  if (err.name === 'ValidationError' || err.name === 'CastError') {
    const message = err.errors
      ? Object.values(err.errors).map((e) => e.message).join(', ')
      : `Invalid value for ${err.path}`;
    return fail(res, 400, message);
  }
  console.error(err.message);
  return fail(res, 500, 'Server error');
};

const normaliseCode = (value) => (typeof value === 'string' ? value.trim().toUpperCase() : '');

// POST /api/v1/promos (admin)
exports.createPromo = async (req, res) => {
  try {
    const b = req.body || {};
    await PromoCode.init(); // the unique index must exist before the duplicate check can be trusted
    const promo = await PromoCode.create({
      code: b.code,
      type: b.type,
      value: b.value,
      validFrom: b.validFrom,
      validTo: b.validTo,
      maxRedemptions: b.maxRedemptions,
      perUserLimit: b.perUserLimit
    });
    res.status(201).json({ success: true, data: promo });
  } catch (err) {
    if (err.code === 11000) return fail(res, 409, 'Promo code already exists');
    handleError(err, res);
  }
};

// GET /api/v1/promos (admin)
exports.getPromos = async (req, res) => {
  try {
    const promos = await PromoCode.find();
    res.status(200).json({ success: true, count: promos.length, data: promos });
  } catch (err) {
    handleError(err, res);
  }
};

// The ONE atomic reservation: every condition that can reject is in the filter, the counter
// increments are in the update, so concurrent applies cannot exceed any limit.
const reservePromo = (promo, userId, now) => {
  const usageKey = `usage.${userId}`;
  const filter = {
    _id: promo._id,
    validFrom: { $lte: now },
    validTo: { $gte: now },
    $expr: { $lt: ['$redemptionCount', '$maxRedemptions'] }
  };
  if (promo.perUserLimit) {
    // A missing key counts as 0 uses.
    filter.$or = [{ [usageKey]: { $exists: false } }, { [usageKey]: { $lt: promo.perUserLimit } }];
  }
  return PromoCode.findOneAndUpdate(filter, { $inc: { redemptionCount: 1, [usageKey]: 1 } }, { new: true });
};

// Guarded: never takes a counter below 0. An unmatched update (already released) is fine.
const unreservePromo = (promoId, userId) => {
  const usageKey = `usage.${userId}`;
  return PromoCode.updateOne(
    { _id: promoId, redemptionCount: { $gt: 0 }, [usageKey]: { $gt: 0 } },
    { $inc: { redemptionCount: -1, [usageKey]: -1 } }
  );
};

// Pipeline update, one atomic write: drops the promo and folds any discount back into totalPrice
// (a concurrent edit may already have priced the booking with the promo).
const releaseClaim = (bookingId, promoId) =>
  Booking.updateOne(
    { _id: bookingId, promo: promoId },
    [{ $set: { promo: null, totalPrice: { $round: [{ $add: ['$totalPrice', '$discount'] }, 2] }, discount: 0 } }]
  );

const undoSteps = {
  deleteRedemption: (r) => PromoRedemption.deleteOne({ _id: r._id }),
  unreserve: (r) => unreservePromo(r.promoId, r.userId),
  releaseClaim: (c) => releaseClaim(c.bookingId, c.promoId)
};

// Undoes an apply in reverse order of acquisition. Single-shot per handle: each handle is cleared
// the moment its own write succeeded, so no later call (e.g. the catch block after an inline undo)
// can repeat a completed release. Every remaining step runs even if an earlier one throws; the
// failures are returned (a failed step keeps its handle, so only it is retried by a later call).
const undoApply = async (state, steps = undoSteps) => {
  const errors = [];
  const attempt = async (key, fn) => {
    const handle = state[key];
    if (!handle) return;
    try {
      await fn(handle);
      state[key] = null;
    } catch (err) {
      errors.push(err);
    }
  };
  await attempt('redemption', steps.deleteRedemption);
  await attempt('reserved', steps.unreserve);
  await attempt('claimed', steps.releaseClaim);
  return errors;
};

// Pure: the exact rejection message for a promo document as read after a failed reservation, or
// null when nothing in the document explains the failure (e.g. a concurrent undo freed a slot).
const rejectionMessage = (p, userId, now) => {
  if (!p) return MSG.notFound;
  if (now < p.validFrom) return MSG.notYet;
  if (now > p.validTo) return MSG.expired;
  if (p.redemptionCount >= p.maxRedemptions) return MSG.exhausted;
  if (p.perUserLimit && ((p.usage || {})[userId] || 0) >= p.perUserLimit) return MSG.perUser;
  return null;
};

const MAX_FINALISE_ATTEMPTS = 3;

// POST /api/v1/bookings/:id/promo  { code }
exports.applyPromo = async (req, res) => {
  const state = { claimed: null, reserved: null, redemption: null };
  const undo = async () => {
    const errors = await undoApply(state);
    errors.forEach((e) => console.error('promo undo step failed: ' + e.message));
  };
  // Admin applies only: an 'edit' entry is appended BEFORE the claim (the intent, priced from the
  // snapshot about to be used) and is never updated. After it, every outcome other than the success
  // it describes appends a NEW 'failed' entry; a success that landed on a re-priced booking appends
  // a NEW 'edit' entry with what actually landed. Owner applies write nothing.
  let entry = null;
  let preState = null;
  let intendedAfter = null;
  const failAudited = async (status, message, reason) => {
    if (entry) await recordFailure(entry, reason);
    return fail(res, status, message);
  };
  try {
    const code = normaliseCode((req.body || {}).code);
    if (!code) return fail(res, 400, 'Please provide a promo code');

    const booking = await loadOwnedBooking(req, res);
    if (!booking) return;
    if (booking.promo) return fail(res, 400, MSG.hasPromo);

    const provider = await Provider.findById(booking.provider._id || booking.provider);
    if (!provider) return fail(res, 404, 'Provider not found');
    // The exact inputs the subtotal is computed from; step (f) is conditional on them.
    let snap = {
      date: booking.date,
      returnDate: booking.returnDate,
      provider: provider._id,
      subtotal: computeSubtotal(provider.dailyRate, booking.date, booking.returnDate)
    };
    if (!(snap.subtotal > 0)) return fail(res, 400, MSG.noPrice);

    const promo = await PromoCode.findOne({ code }).lean();
    if (!promo) return fail(res, 400, MSG.notFound);

    // The redemption counts against the booking's owner, also when an admin applies it.
    const userId = booking.user.toString();

    if (req.user.role === 'admin') {
      const intended = priceOf(promo, snap.subtotal);
      preState = { promo: null, discount: booking.discount, totalPrice: booking.totalPrice };
      intendedAfter = { promo: promo._id, discount: intended.discount, totalPrice: intended.totalPrice };
      const written = {
        admin: req.user._id,
        action: 'edit',
        booking: booking._id,
        ...diffFields(preState, intendedAfter, PROMO_KEYS)
      };
      await recordAudit(written);
      entry = written;
    }
    // (b) Claim the booking first: a duplicate apply never reaches the counter.
    const claim = await Booking.findOneAndUpdate(
      { _id: booking._id, promo: null },
      { $set: { promo: promo._id } },
      { new: true }
    );
    if (!claim) return failAudited(400, MSG.hasPromo, 'booking already has a promo code (claimed concurrently)');
    state.claimed = { bookingId: booking._id, promoId: promo._id };

    // (c) Reserve the promo with one conditional atomic update.
    const now = new Date();
    let reservedDoc = await reservePromo(promo, userId, now);
    if (!reservedDoc) {
      let message = rejectionMessage(await PromoCode.findById(promo._id).lean(), userId, now);
      if (!message) {
        // Nothing explains the failure: a concurrent undo freed a slot. Retry once, then give up.
        reservedDoc = await reservePromo(promo, userId, now);
        if (!reservedDoc) message = MSG.exhausted;
      }
      if (!reservedDoc) {
        await undo(); // (d) release the claim only
        return failAudited(400, message, message);
      }
    }
    state.reserved = { promoId: promo._id, userId };

    // (e) Record the redemption.
    state.redemption = await PromoRedemption.create({ promo: promo._id, user: booking.user, booking: booking._id });

    // (f) Finalise, pinned to the dates/provider the subtotal came from; if the booking was edited
    // meanwhile, re-read it and price the CURRENT dates instead (bounded retries).
    let updated = null;
    for (let attempt = 0; attempt < MAX_FINALISE_ATTEMPTS && !updated; attempt++) {
      const { discount, totalPrice } = priceOf(promo, snap.subtotal);
      updated = await Booking.findOneAndUpdate(
        { _id: booking._id, promo: promo._id, date: snap.date, returnDate: snap.returnDate, provider: snap.provider },
        { $set: { discount, totalPrice } },
        { new: true }
      ).populate(PROVIDER_POPULATE);
      if (updated) break;
      const fresh = await Booking.findById(booking._id);
      if (!fresh || !fresh.promo || fresh.promo.toString() !== promo._id.toString()) {
        await undo();
        return failAudited(404, 'Booking not found', 'booking changed or removed concurrently, apply undone');
      }
      const freshProvider = await Provider.findById(fresh.provider);
      if (!freshProvider) {
        await undo();
        return failAudited(404, 'Provider not found', 'provider missing, apply undone');
      }
      snap = {
        date: fresh.date,
        returnDate: fresh.returnDate,
        provider: freshProvider._id,
        subtotal: computeSubtotal(freshProvider.dailyRate, fresh.date, fresh.returnDate)
      };
    }
    if (!updated) {
      await undo();
      return failAudited(409, 'Booking was modified concurrently, please retry', 'booking modified concurrently, apply undone');
    }
    if (entry) {
      // Written while the undo handles are still set: if this throws, the whole apply is undone.
      const landed = { promo: promo._id, discount: updated.discount, totalPrice: updated.totalPrice };
      if (diffFields(intendedAfter, landed, PROMO_KEYS)) {
        await recordAudit({
          admin: req.user._id,
          action: 'edit',
          booking: booking._id,
          ...diffFields(preState, landed, PROMO_KEYS)
        });
        await recordFailure(entry, 'superseded: booking re-priced concurrently, see the later edit entry');
      }
    }
    state.claimed = state.reserved = state.redemption = null; // success: nothing to undo
    res.status(200).json({ success: true, data: updated });
  } catch (err) {
    try {
      await undo();
    } catch (undoErr) {
      console.error('promo undo failed: ' + undoErr.message);
    }
    if (entry) await recordFailure(entry, 'apply failed with an error, undo attempted');
    handleError(err, res);
  }
};

exports.computeDiscount = computeDiscount;
exports.undoApply = undoApply;
exports.rejectionMessage = rejectionMessage;
exports.undoSteps = undoSteps;
