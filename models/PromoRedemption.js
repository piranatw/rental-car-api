const mongoose = require('mongoose');

const PromoRedemptionSchema = new mongoose.Schema({
  promo: { type: mongoose.Schema.ObjectId, ref: 'PromoCode', required: true, index: true },
  user: { type: mongoose.Schema.ObjectId, ref: 'User', required: true },
  booking: { type: mongoose.Schema.ObjectId, ref: 'Booking', required: true },
  createdAt: { type: Date, default: Date.now }
});

module.exports = mongoose.model('PromoRedemption', PromoRedemptionSchema);
