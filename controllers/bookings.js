const mongoose = require('mongoose');
const Booking = require('../models/Booking');
const Provider = require('../models/Provider');
const PromoCode = require('../models/PromoCode');
const { computeSubtotal, priceOf } = require('../utils/pricing');
const { parsePaging } = require('../utils/paging');
const { recordAudit, recordViews, recordFailure, diffFields, EDIT_KEYS } = require('./audit');

const MAX_BOOKINGS_PER_USER = 3;
const PROVIDER_POPULATE = { path: 'provider', select: 'name address tel' };

const fail = (res, status, message) =>
  res.status(status).json({ success: false, message });

const handleError = (err, res) => {
  if (err.name === 'ValidationError') {
    const message = Object.values(err.errors).map((e) => e.message).join(', ');
    return fail(res, 400, message);
  }
  if (err.name === 'CastError') {
    return fail(res, 400, `Invalid value for ${err.path}`);
  }
  console.error(err.message);
  return fail(res, 500, 'Server error');
};

const parseDate = (value) => {
  if (value === undefined || value === null || value === '') return null;
  const d = new Date(value);
  return Number.isNaN(d.getTime()) ? null : d;
};

// Returns the booking, or sends 404 / 403 itself and returns null.
const loadOwnedBooking = async (req, res) => {
  try {
    if (!mongoose.isValidObjectId(req.params.id)) {
      fail(res, 404, 'Booking not found');
      return null;
    }
    const booking = await Booking.findById(req.params.id).populate(PROVIDER_POPULATE);
    if (!booking) {
      fail(res, 404, 'Booking not found');
      return null;
    }
    if (booking.user.toString() !== req.user.id && req.user.role !== 'admin') {
      fail(res, 403, 'Not authorized to access this booking');
      return null;
    }
    return booking;
  } catch (err) {
    if (err.name === 'CastError') {
      fail(res, 404, 'Booking not found');
      return null;
    }
    console.error(err.message);
    fail(res, 500, 'Server error');
    return null;
  }
};

// GET /api/v1/bookings
// Users: their own bookings, unpaginated. Admins: one page of all bookings, and one 'view' audit
// entry per returned booking, written before the response is sent.
exports.getBookings = async (req, res) => {
  try {
    if (req.user.role !== 'admin') {
      const bookings = await Booking.find({ user: req.user.id }).populate(PROVIDER_POPULATE);
      return res.status(200).json({ success: true, count: bookings.length, data: bookings });
    }
    const paging = parsePaging(req.query);
    if (paging.error) return fail(res, 400, paging.error);
    const { page, limit } = paging;
    const [bookings, total] = await Promise.all([
      Booking.find({})
        .sort({ _id: 1 })
        .skip((page - 1) * limit)
        .limit(limit)
        .populate(PROVIDER_POPULATE),
      Booking.countDocuments({})
    ]);
    await recordViews(req.user._id, bookings.map((b) => b._id));
    res.status(200).json({
      success: true,
      count: bookings.length,
      total,
      page,
      pages: Math.ceil(total / limit),
      data: bookings
    });
  } catch (err) {
    handleError(err, res);
  }
};

// GET /api/v1/bookings/:id  (an admin's view is logged before the response is sent)
exports.getBooking = async (req, res) => {
  try {
    const booking = await loadOwnedBooking(req, res);
    if (!booking) return;
    if (req.user.role === 'admin') {
      await recordAudit({ admin: req.user._id, action: 'view', booking: booking._id });
    }
    res.status(200).json({ success: true, data: booking });
  } catch (err) {
    handleError(err, res);
  }
};

// POST /api/v1/providers/:providerId/bookings
exports.addBooking = async (req, res) => {
  try {
    const { providerId } = req.params;
    if (!mongoose.isValidObjectId(providerId)) return fail(res, 404, 'Provider not found');
    const provider = await Provider.findById(providerId);
    if (!provider) return fail(res, 404, 'Provider not found');

    const date = parseDate(req.body.date);
    const returnDate = parseDate(req.body.returnDate);
    if (!date || !returnDate) {
      return fail(res, 400, 'Please provide valid date and returnDate');
    }
    if (returnDate < date) return fail(res, 400, 'returnDate must not be before date');

    if (req.user.role !== 'admin') {
      const existing = await Booking.countDocuments({ user: req.user.id });
      if (existing >= MAX_BOOKINGS_PER_USER) {
        return fail(res, 400, `A user can book at most ${MAX_BOOKINGS_PER_USER} cars`);
      }
    }

    const booking = await Booking.create({
      user: req.user.id,
      provider: provider._id,
      date,
      returnDate,
      ...priceOf(null, computeSubtotal(provider.dailyRate, date, returnDate))
    });
    res.status(201).json({ success: true, data: booking });
  } catch (err) {
    handleError(err, res);
  }
};

const MAX_EDIT_ATTEMPTS = 3;

// PUT /api/v1/bookings/:id  (only date, returnDate, provider are accepted)
// The write is pinned to the exact promo/dates/provider/price it was priced from; a concurrent apply
// or edit makes it re-read and re-price (bounded), so price always follows the stored promo and dates.
// For an admin, each attempt first appends an 'edit' entry (changed keys only, the derived discount
// and totalPrice included) and then writes; an attempt whose write does not happen appends a second
// 'failed' entry. Because the write is pinned to the values the entry was computed from, the entry's
// before is exactly the document the successful write replaced.
exports.updateBooking = async (req, res) => {
  try {
    const first = await loadOwnedBooking(req, res);
    if (!first) return;
    const isAdmin = req.user.role === 'admin';

    const body = req.body || {};
    const touched = ['date', 'returnDate', 'provider'].some((k) => body[k] !== undefined);

    let newDate = null;
    let newReturnDate = null;
    if (body.date !== undefined) {
      newDate = parseDate(body.date);
      if (!newDate) return fail(res, 400, 'Invalid date');
    }
    if (body.returnDate !== undefined) {
      newReturnDate = parseDate(body.returnDate);
      if (!newReturnDate) return fail(res, 400, 'Invalid returnDate');
    }
    let newProvider = null;
    if (body.provider !== undefined) {
      if (!mongoose.isValidObjectId(body.provider)) return fail(res, 404, 'Provider not found');
      newProvider = await Provider.findById(body.provider);
      if (!newProvider) return fail(res, 404, 'Provider not found');
    }

    if (!touched) {
      // The response discloses the booking: for an admin that is a view, logged before answering.
      if (isAdmin) await recordAudit({ admin: req.user._id, action: 'view', booking: first._id });
      return res.status(200).json({ success: true, data: first });
    }

    let current = first;
    for (let attempt = 0; attempt < MAX_EDIT_ATTEMPTS; attempt++) {
      const date = newDate || current.date;
      const returnDate = newReturnDate || current.returnDate;
      if (returnDate < date) return fail(res, 400, 'returnDate must not be before date');
      const currentProviderId = current.provider._id || current.provider;
      const provider = newProvider || (await Provider.findById(currentProviderId));
      if (!provider) return fail(res, 404, 'Provider not found');

      const subtotal = computeSubtotal(provider.dailyRate, date, returnDate);
      // A promo stays attached: re-derive the discount from the new subtotal.
      const promo = current.promo ? await PromoCode.findById(current.promo).lean() : null;
      const { discount, totalPrice } = priceOf(promo, subtotal);
      const next = { date, returnDate, provider: provider._id, discount, totalPrice };

      // Entry first: the mutation below can never succeed without it.
      const change = isAdmin
        ? diffFields(
            {
              date: current.date,
              returnDate: current.returnDate,
              provider: currentProviderId,
              discount: current.discount,
              totalPrice: current.totalPrice
            },
            next,
            EDIT_KEYS
          )
        : null;
      const entry = change && { admin: req.user._id, action: 'edit', booking: current._id, ...change };
      if (entry) await recordAudit(entry);

      let doc;
      try {
        doc = await Booking.findOneAndUpdate(
          {
            _id: current._id,
            promo: current.promo || null,
            date: current.date,
            returnDate: current.returnDate,
            provider: currentProviderId,
            discount: current.discount,
            totalPrice: current.totalPrice
          },
          { $set: next },
          { new: true }
        );
      } catch (err) {
        // The write's own acknowledgement failed: it may or may not have been applied.
        if (entry) await recordFailure(entry, 'booking update outcome unknown');
        throw err;
      }
      if (doc) {
        // The write has committed; populate failures must not produce a failed marker.
        const updated = await doc.populate(PROVIDER_POPULATE);
        // Nothing changed (identical values): the response is still a read of the booking.
        if (isAdmin && !entry) await recordAudit({ admin: req.user._id, action: 'view', booking: current._id });
        return res.status(200).json({ success: true, data: updated });
      }
      if (entry) await recordFailure(entry, 'booking modified concurrently');

      current = await Booking.findById(first._id);
      if (!current) return fail(res, 404, 'Booking not found');
    }
    return fail(res, 409, 'Booking was modified concurrently, please retry');
  } catch (err) {
    handleError(err, res);
  }
};

const MAX_DELETE_ATTEMPTS = 2;

// DELETE /api/v1/bookings/:id
// For an admin the 'delete' entry (the removed booking's fields) is written first. The delete is
// pinned to exactly those fields, so the entry's before is the document that was removed; if the
// booking changed or vanished meanwhile a 'failed' entry is appended, then one bounded re-read
// (404 if it is gone, 409 if it keeps changing).
exports.deleteBooking = async (req, res) => {
  try {
    let booking = await loadOwnedBooking(req, res);
    if (!booking) return;
    const isAdmin = req.user.role === 'admin';
    for (let attempt = 0; attempt < MAX_DELETE_ATTEMPTS; attempt++) {
      const fields = {
        user: booking.user,
        provider: booking.provider._id || booking.provider,
        date: booking.date,
        returnDate: booking.returnDate,
        totalPrice: booking.totalPrice,
        discount: booking.discount,
        promo: booking.promo || null
      };
      const entry = isAdmin
        ? { admin: req.user._id, action: 'delete', booking: booking._id, before: fields, after: null }
        : null;
      if (entry) await recordAudit(entry);
      let result;
      try {
        result = await Booking.deleteOne({
          _id: booking._id,
          promo: fields.promo,
          discount: fields.discount,
          totalPrice: fields.totalPrice,
          date: fields.date,
          returnDate: fields.returnDate,
          provider: fields.provider
        });
      } catch (err) {
        if (entry) await recordFailure(entry, 'booking delete outcome unknown');
        throw err;
      }
      if (result && result.deletedCount === 1) return res.status(200).json({ success: true, data: {} });
      if (entry) await recordFailure(entry, 'booking changed or removed concurrently');
      booking = await Booking.findById(booking._id);
      if (!booking) return fail(res, 404, 'Booking not found');
    }
    return fail(res, 409, 'Booking was modified concurrently, please retry');
  } catch (err) {
    handleError(err, res);
  }
};

exports.loadOwnedBooking = loadOwnedBooking;
exports.computeSubtotal = computeSubtotal;
