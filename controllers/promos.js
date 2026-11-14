const PromoCode = require('../models/PromoCode');
const PromoRedemption = require('../models/PromoRedemption');
const Booking = require('../models/Booking');
const Provider = require('../models/Provider');
const { loadOwnedBooking, computeSubtotal } = require('./bookings');

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

const round2 = (n) => Math.round(n * 100) / 100;

// Pure: percentage -> subtotal * value / 100, fixed -> value; clamped to [0, subtotal], 2 decimals.
const computeDiscount = (promo, subtotal) => {
  const raw = promo.type === 'percentage' ? (subtotal * promo.value) / 100 : promo.value;
  return round2(Math.min(Math.max(raw, 0), subtotal));
};

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

const unreservePromo = (promoId, userId) =>
  PromoCode.updateOne({ _id: promoId }, { $inc: { redemptionCount: -1, [`usage.${userId}`]: -1 } });

const releaseClaim = (bookingId, promoId) =>
  Booking.updateOne({ _id: bookingId, promo: promoId }, { $set: { promo: null } });

// Chooses the exact rejection message after the atomic reservation matched nothing.
const rejectionMessage = async (promoId, userId, now) => {
  const p = await PromoCode.findById(promoId).lean();
  if (!p) return MSG.notFound;
  if (now < p.validFrom) return MSG.notYet;
  if (now > p.validTo) return MSG.expired;
  if (p.redemptionCount >= p.maxRedemptions) return MSG.exhausted;
  return MSG.perUser;
};

// POST /api/v1/bookings/:id/promo  { code }
exports.applyPromo = async (req, res) => {
  let claimed = null; // { bookingId, promoId }
  let reserved = null; // { promoId, userId }
  let redemption = null;
  const undo = async () => {
    // Reverse order of acquisition; each step is a conditional, idempotent write.
    if (redemption) await PromoRedemption.deleteOne({ _id: redemption._id });
    if (reserved) await unreservePromo(reserved.promoId, reserved.userId);
    if (claimed) await releaseClaim(claimed.bookingId, claimed.promoId);
    redemption = reserved = claimed = null;
  };
  try {
    const code = normaliseCode((req.body || {}).code);
    if (!code) return fail(res, 400, 'Please provide a promo code');

    const booking = await loadOwnedBooking(req, res);
    if (!booking) return;
    if (booking.promo) return fail(res, 400, MSG.hasPromo);

    const provider = await Provider.findById(booking.provider._id || booking.provider);
    if (!provider) return fail(res, 404, 'Provider not found');
    const subtotal = computeSubtotal(provider.dailyRate, booking.date, booking.returnDate);
    if (!(subtotal > 0)) return fail(res, 400, MSG.noPrice);

    const promo = await PromoCode.findOne({ code }).lean();
    if (!promo) return fail(res, 400, MSG.notFound);

    // The redemption counts against the booking's owner, also when an admin applies it.
    const userId = booking.user.toString();

    // (b) Claim the booking first: a duplicate apply never reaches the counter.
    const claim = await Booking.findOneAndUpdate(
      { _id: booking._id, promo: null },
      { $set: { promo: promo._id } },
      { new: true }
    );
    if (!claim) return fail(res, 400, MSG.hasPromo);
    claimed = { bookingId: booking._id, promoId: promo._id };

    // (c) Reserve the promo with one conditional atomic update.
    const now = new Date();
    const reservedDoc = await reservePromo(promo, userId, now);
    if (!reservedDoc) {
      const message = await rejectionMessage(promo._id, userId, now);
      await undo(); // (d) release the claim only
      return fail(res, 400, message);
    }
    reserved = { promoId: promo._id, userId };

    // (e) Record the redemption.
    redemption = await PromoRedemption.create({ promo: promo._id, user: booking.user, booking: booking._id });

    // (f) Finalise the booking.
    const discount = computeDiscount(promo, subtotal);
    const updated = await Booking.findOneAndUpdate(
      { _id: booking._id, promo: promo._id },
      { $set: { discount, totalPrice: Math.max(0, round2(subtotal - discount)) } },
      { new: true }
    ).populate(PROVIDER_POPULATE);
    if (!updated) {
      await undo();
      return fail(res, 404, 'Booking not found');
    }
    claimed = reserved = redemption = null; // success: nothing to undo
    res.status(200).json({ success: true, data: updated });
  } catch (err) {
    try {
      await undo();
    } catch (undoErr) {
      console.error('promo undo failed: ' + undoErr.message);
    }
    handleError(err, res);
  }
};

exports.computeDiscount = computeDiscount;
