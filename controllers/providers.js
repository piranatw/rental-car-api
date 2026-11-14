const mongoose = require('mongoose');
const Provider = require('../models/Provider');
const Booking = require('../models/Booking');

const FIELDS = ['name', 'address', 'tel', 'lateFeePerHour', 'dailyRate'];

const pick = (body) => {
  const out = {};
  FIELDS.forEach((f) => {
    if (body[f] !== undefined) out[f] = body[f];
  });
  return out;
};

const handleError = (err, res) => {
  if (err.name === 'ValidationError' || err.name === 'CastError') {
    const message = err.errors
      ? Object.values(err.errors).map((e) => e.message).join(', ')
      : err.message;
    return res.status(400).json({ success: false, message });
  }
  console.error(err.message);
  return res.status(500).json({ success: false, message: 'Server error' });
};

const notFound = (res) =>
  res.status(404).json({ success: false, message: 'Provider not found' });

// GET /api/v1/providers
exports.getProviders = async (req, res) => {
  try {
    const providers = await Provider.find();
    res.status(200).json({ success: true, count: providers.length, data: providers });
  } catch (err) {
    handleError(err, res);
  }
};

// GET /api/v1/providers/:id
exports.getProvider = async (req, res) => {
  try {
    if (!mongoose.isValidObjectId(req.params.id)) return notFound(res);
    const provider = await Provider.findById(req.params.id);
    if (!provider) return notFound(res);
    res.status(200).json({ success: true, data: provider });
  } catch (err) {
    handleError(err, res);
  }
};

// POST /api/v1/providers (admin)
exports.createProvider = async (req, res) => {
  try {
    const provider = await Provider.create(pick(req.body));
    res.status(201).json({ success: true, data: provider });
  } catch (err) {
    handleError(err, res);
  }
};

// PUT /api/v1/providers/:id (admin)
exports.updateProvider = async (req, res) => {
  try {
    if (!mongoose.isValidObjectId(req.params.id)) return notFound(res);
    const provider = await Provider.findById(req.params.id);
    if (!provider) return notFound(res);
    provider.set(pick(req.body));
    await provider.save();
    res.status(200).json({ success: true, data: provider });
  } catch (err) {
    handleError(err, res);
  }
};

// DELETE /api/v1/providers/:id (admin); refused with 409 while the provider has any bookings.
exports.deleteProvider = async (req, res) => {
  try {
    if (!mongoose.isValidObjectId(req.params.id)) return notFound(res);
    const provider = await Provider.findById(req.params.id);
    if (!provider) return notFound(res);
    if (await Booking.exists({ provider: provider._id })) {
      return res.status(409).json({ success: false, message: 'Provider has bookings and cannot be deleted' });
    }
    await provider.deleteOne();
    res.status(200).json({ success: true, data: {} });
  } catch (err) {
    handleError(err, res);
  }
};
