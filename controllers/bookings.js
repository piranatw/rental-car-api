const mongoose = require('mongoose');
const Booking = require('../models/Booking');
const Provider = require('../models/Provider');
const PromoCode = require('../models/PromoCode');

// promos.js requires this module, so computeDiscount is resolved at call time.
const computeDiscount = (...args) => require('./promos').computeDiscount(...args);

const MAX_BOOKINGS_PER_USER = 3;
const DAY_MS = 86400000;
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

// dailyRate x whole days, at least one day (returnDate may equal date).
const computeSubtotal = (dailyRate, date, returnDate) =>
  dailyRate * Math.max(1, Math.ceil((returnDate - date) / DAY_MS));

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
exports.getBookings = async (req, res) => {
  try {
    const query = req.user.role === 'admin' ? {} : { user: req.user.id };
    const bookings = await Booking.find(query).populate(PROVIDER_POPULATE);
    res.status(200).json({ success: true, count: bookings.length, data: bookings });
  } catch (err) {
    handleError(err, res);
  }
};

// GET /api/v1/bookings/:id
exports.getBooking = async (req, res) => {
  const booking = await loadOwnedBooking(req, res);
  if (!booking) return;
  res.status(200).json({ success: true, data: booking });
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
      totalPrice: computeSubtotal(provider.dailyRate, date, returnDate),
      discount: 0
    });
    res.status(201).json({ success: true, data: booking });
  } catch (err) {
    handleError(err, res);
  }
};

// PUT /api/v1/bookings/:id  (only date, returnDate, provider are accepted)
exports.updateBooking = async (req, res) => {
  try {
    const booking = await loadOwnedBooking(req, res);
    if (!booking) return;

    const body = req.body || {};
    const touched = ['date', 'returnDate', 'provider'].some((k) => body[k] !== undefined);

    if (body.date !== undefined) {
      const d = parseDate(body.date);
      if (!d) return fail(res, 400, 'Invalid date');
      booking.date = d;
    }
    if (body.returnDate !== undefined) {
      const d = parseDate(body.returnDate);
      if (!d) return fail(res, 400, 'Invalid returnDate');
      booking.returnDate = d;
    }

    let provider;
    if (body.provider !== undefined) {
      if (!mongoose.isValidObjectId(body.provider)) return fail(res, 404, 'Provider not found');
      provider = await Provider.findById(body.provider);
      if (!provider) return fail(res, 404, 'Provider not found');
      booking.provider = provider._id;
    } else if (touched) {
      provider = await Provider.findById(booking.provider._id || booking.provider);
    }

    if (touched) {
      if (!provider) return fail(res, 404, 'Provider not found');
      const subtotal = computeSubtotal(provider.dailyRate, booking.date, booking.returnDate);
      booking.totalPrice = subtotal;
      booking.discount = 0;
      if (booking.promo) {
        // A promo stays attached: re-derive the discount from the new subtotal.
        const promo = await PromoCode.findById(booking.promo).lean();
        if (promo) {
          booking.discount = computeDiscount(promo, subtotal);
          booking.totalPrice = Math.max(0, subtotal - booking.discount);
        }
      }
    }

    await booking.save();
    await booking.populate(PROVIDER_POPULATE);
    res.status(200).json({ success: true, data: booking });
  } catch (err) {
    handleError(err, res);
  }
};

// DELETE /api/v1/bookings/:id
exports.deleteBooking = async (req, res) => {
  try {
    const booking = await loadOwnedBooking(req, res);
    if (!booking) return;
    await booking.deleteOne();
    res.status(200).json({ success: true, data: {} });
  } catch (err) {
    handleError(err, res);
  }
};

exports.loadOwnedBooking = loadOwnedBooking;
exports.computeSubtotal = computeSubtotal;
