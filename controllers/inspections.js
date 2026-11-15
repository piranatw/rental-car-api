const mongoose = require('mongoose');
const Booking = require('../models/Booking');
const Provider = require('../models/Provider');
const Inspection = require('../models/Inspection');
const { round2, DAY_MS } = require('../utils/pricing');

const HOUR_MS = 3600000;
const MAX_FUTURE_MS = 24 * HOUR_MS;
const MAX_ODOMETER = 10000000;
const MAX_NOTES = 5000;

const fail = (res, status, message) => res.status(status).json({ success: false, message });

// Booking.returnDate is a calendar date (stored as 00:00 UTC of that day). The car is due back by
// the END of that UTC day: returning at any moment on the return date is on time.
const scheduledReturnInstant = (returnDate) => {
  const t = returnDate.getTime();
  return new Date(t - (((t % DAY_MS) + DAY_MS) % DAY_MS) + DAY_MS - 1);
};

// Integer-millisecond arithmetic: every started hour after the scheduled instant counts in full.
const calcLateFee = (returnDate, actualReturn, feePerHour) => {
  const overdueMs = actualReturn.getTime() - scheduledReturnInstant(returnDate).getTime();
  const lateHours = overdueMs <= 0 ? 0 : Math.ceil(overdueMs / HOUR_MS);
  return { lateHours, lateFee: round2(lateHours * feePerHour) };
};

const ISO_ZONED = /^(\d{4})-(\d{2})-(\d{2})T(\d{2}):(\d{2})(?::(\d{2})(?:\.\d{1,3})?)?(Z|[+-](\d{2}):(\d{2}))$/;
const FORMAT_MSG = 'actualReturnTime must be an ISO 8601 date-time with a zone designator (Z or +hh:mm)';

// Returns { date } or { error }. A real calendar instant only: Date() alone would roll 30 Feb over.
const parseActualReturn = (value) => {
  if (typeof value !== 'string') return { error: FORMAT_MSG };
  const m = ISO_ZONED.exec(value);
  if (!m) return { error: FORMAT_MSG };
  const [y, mo, d, h, mi] = [m[1], m[2], m[3], m[4], m[5]].map(Number);
  const s = m[6] === undefined ? 0 : Number(m[6]);
  const daysInMonth = new Date(Date.UTC(y, mo, 0)).getUTCDate();
  const offH = m[8] === undefined ? 0 : Number(m[8]);
  const offM = m[9] === undefined ? 0 : Number(m[9]);
  if (mo < 1 || mo > 12 || d < 1 || d > daysInMonth || h > 23 || mi > 59 || s > 59 || offH > 23 || offM > 59) {
    return { error: 'actualReturnTime is not a valid date-time' };
  }
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return { error: 'actualReturnTime is not a valid date-time' };
  return { date };
};

const isNum = (v, min, max) => typeof v === 'number' && Number.isFinite(v) && v >= min && v <= max;

// Returns { value } or { error }. Only the four client fields are read; everything else is ignored.
const parseBody = (body, booking, now) => {
  const b = body && typeof body === 'object' ? body : {};
  const when = parseActualReturn(b.actualReturnTime);
  if (when.error) return { error: when.error };
  if (when.date < booking.date) return { error: 'actualReturnTime must not be before the pickup date' };
  if (when.date.getTime() > now + MAX_FUTURE_MS) return { error: 'actualReturnTime must not be more than 24 hours in the future' };
  if (!isNum(b.odometer, 0, MAX_ODOMETER)) return { error: `odometer must be a number between 0 and ${MAX_ODOMETER}` };
  if (!isNum(b.fuelLevel, 0, 100)) return { error: 'fuelLevel must be a number between 0 and 100' };
  let damageNotes = '';
  if (b.damageNotes !== undefined) {
    if (typeof b.damageNotes !== 'string' || b.damageNotes.length > MAX_NOTES) {
      return { error: `damageNotes must be a string of at most ${MAX_NOTES} characters` };
    }
    damageNotes = b.damageNotes;
  }
  return { value: { actualReturnTime: when.date, odometer: b.odometer, fuelLevel: b.fuelLevel, damageNotes } };
};

// POST /api/v1/bookings/:id/inspection  (admin only, enforced by the route)
const createInspection = async (req, res) => {
  try {
    if (!mongoose.isValidObjectId(req.params.id)) return fail(res, 404, 'Booking not found');
    const booking = await Booking.findById(req.params.id).lean();
    if (!booking) return fail(res, 404, 'Booking not found');
    const provider = await Provider.findById(booking.provider).lean();
    if (!provider) return fail(res, 404, 'Provider not found');

    const parsed = parseBody(req.body, booking, Date.now());
    if (parsed.error) return fail(res, 400, parsed.error);

    // The rate is read now and stored with the inspection: a later rate change never alters it.
    const feePerHour = Number.isFinite(provider.lateFeePerHour) ? provider.lateFeePerHour : 0;
    const { lateHours, lateFee } = calcLateFee(booking.returnDate, parsed.value.actualReturnTime, feePerHour);

    await Inspection.init(); // the unique index must exist before a racing create can be trusted
    try {
      const inspection = await Inspection.create({
        ...parsed.value,
        booking: booking._id,
        scheduledReturnAt: scheduledReturnInstant(booking.returnDate),
        lateHours,
        lateFee,
        feePerHourUsed: feePerHour,
        recordedBy: req.user._id
      });
      return res.status(201).json({ success: true, data: inspection });
    } catch (err) {
      if (err && err.code === 11000) return fail(res, 409, 'Inspection already recorded for this booking');
      throw err;
    }
  } catch (err) {
    console.error(err.message);
    return fail(res, 500, 'Server error');
  }
};

// GET /api/v1/bookings/:id/inspection  (the booking's owner, or any admin)
// If the booking has since been deleted an admin can still read the stored report; the owner gets 404.
const getInspection = async (req, res) => {
  try {
    if (!mongoose.isValidObjectId(req.params.id)) return fail(res, 404, 'Booking not found');
    const isAdmin = req.user.role === 'admin';
    const booking = await Booking.findById(req.params.id).select('user').lean();
    if (!booking && !isAdmin) return fail(res, 404, 'Booking not found');
    if (booking && booking.user.toString() !== req.user.id && !isAdmin) {
      return fail(res, 403, 'Not authorized to access this booking');
    }
    const inspection = await Inspection.findOne({ booking: req.params.id });
    if (!inspection) return fail(res, 404, booking ? 'Inspection not found for this booking' : 'Booking not found');
    return res.status(200).json({ success: true, data: inspection });
  } catch (err) {
    console.error(err.message);
    return fail(res, 500, 'Server error');
  }
};

// ---- Disputes -------------------------------------------------------------------------------------

const WINDOW_MS = 7 * 24 * HOUR_MS;
const MAX_TEXT = 2000;

// Pure: a dispute is allowed while (now - createdAt) <= 7 days, inclusive, in integer milliseconds.
// Mirrors the atomic filter { createdAt: { $gte: now - WINDOW_MS } } used by submitDispute.
const isWithinWindow = (createdAt, now) => now - createdAt.getTime() <= WINDOW_MS;

// Returns { value } or { error }. A non-empty comment: string, trimmed, 1..2000 characters.
const parseComment = (body) => {
  const c = body && typeof body === 'object' ? body.comment : undefined;
  if (typeof c !== 'string') return { error: 'comment must be a string' };
  const v = c.trim();
  if (v.length < 1 || v.length > MAX_TEXT) return { error: `comment must be between 1 and ${MAX_TEXT} characters` };
  return { value: v };
};

// Optional resolutionNote: a string if present, trimmed, at most 2000 characters ('' allowed).
const parseNote = (body) => {
  const n = body && typeof body === 'object' ? body.resolutionNote : undefined;
  if (n === undefined) return { value: '' };
  if (typeof n !== 'string') return { error: 'resolutionNote must be a string' };
  const v = n.trim();
  if (v.length > MAX_TEXT) return { error: `resolutionNote must be at most ${MAX_TEXT} characters` };
  return { value: v };
};

// POST /api/v1/bookings/:id/inspection/dispute  (the booking's OWNER only; an admin cannot dispute for a user)
// One atomic findOneAndUpdate decides the single winner and the window; a follow-up read only explains a miss.
const submitDispute = async (req, res) => {
  try {
    if (!mongoose.isValidObjectId(req.params.id)) return fail(res, 404, 'Booking not found');
    const booking = await Booking.findById(req.params.id).select('user').lean();
    if (!booking) return fail(res, 404, 'Booking not found');
    const exists = await Inspection.exists({ booking: booking._id });
    if (!exists) return fail(res, 404, 'Inspection not found for this booking');
    if (booking.user.toString() !== req.user.id) return fail(res, 403, 'Not authorized to dispute this inspection');
    const parsed = parseComment(req.body);
    if (parsed.error) return fail(res, 400, parsed.error);

    const now = Date.now();
    const updated = await Inspection.findOneAndUpdate(
      { booking: booking._id, dispute: null, createdAt: { $gte: new Date(now - WINDOW_MS) } },
      { $set: { dispute: { comment: parsed.value, createdAt: new Date(now), status: 'open', resolutionNote: '', resolvedAt: null, resolvedBy: null } } },
      { new: true }
    );
    if (updated) return res.status(200).json({ success: true, data: updated });

    // Nothing matched: one read decides why. Already disputed wins over window passed.
    const current = await Inspection.findOne({ booking: booking._id }).select('dispute createdAt').lean();
    if (current && current.dispute) return fail(res, 400, 'A dispute has already been submitted');
    if (current && !isWithinWindow(current.createdAt, now)) return fail(res, 400, 'Dispute window of 7 days has passed');
    return fail(res, 409, 'Inspection changed concurrently, please retry');
  } catch (err) {
    console.error(err.message);
    return fail(res, 500, 'Server error');
  }
};

// PUT /api/v1/bookings/:id/inspection/dispute  (admin only, enforced by the route)
// The filter 'dispute.status': 'open' makes closing a dispute a single-winner compare-and-set.
const resolveDispute = async (req, res) => {
  try {
    if (!mongoose.isValidObjectId(req.params.id)) return fail(res, 404, 'Booking not found');
    const booking = await Booking.findById(req.params.id).select('_id').lean();
    if (!booking) return fail(res, 404, 'Booking not found');
    const exists = await Inspection.exists({ booking: booking._id });
    if (!exists) return fail(res, 404, 'Inspection not found for this booking');
    const status = req.body && typeof req.body === 'object' ? req.body.status : undefined;
    if (status !== 'resolved' && status !== 'dismissed') return fail(res, 400, 'status must be resolved or dismissed');
    const note = parseNote(req.body);
    if (note.error) return fail(res, 400, note.error);

    const updated = await Inspection.findOneAndUpdate(
      { booking: booking._id, 'dispute.status': 'open' },
      { $set: { 'dispute.status': status, 'dispute.resolutionNote': note.value, 'dispute.resolvedAt': new Date(), 'dispute.resolvedBy': req.user._id } },
      { new: true }
    );
    if (updated) return res.status(200).json({ success: true, data: updated });

    const current = await Inspection.findOne({ booking: booking._id }).select('dispute').lean();
    if (current && !current.dispute) return fail(res, 404, 'Dispute not found for this inspection');
    if (current && current.dispute && current.dispute.status !== 'open') return fail(res, 400, 'Dispute has already been closed');
    return fail(res, 409, 'Inspection changed concurrently, please retry');
  } catch (err) {
    console.error(err.message);
    return fail(res, 500, 'Server error');
  }
};

module.exports = {
  calcLateFee, scheduledReturnInstant, createInspection, getInspection,
  WINDOW_MS, isWithinWindow, submitDispute, resolveDispute
};
