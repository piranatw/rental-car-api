const mongoose = require('mongoose');

const PromoCodeSchema = new mongoose.Schema(
  {
    code: {
      type: String,
      required: [true, 'Please add a promo code'],
      unique: true,
      trim: true,
      uppercase: true
    },
    type: {
      type: String,
      required: [true, 'Please add a discount type'],
      enum: { values: ['percentage', 'fixed'], message: 'type must be percentage or fixed' }
    },
    value: {
      type: Number,
      required: [true, 'Please add a discount value'],
      validate: [
        { validator: (v) => v > 0, message: 'value must be greater than 0' },
        {
          validator: function (v) {
            return this.type !== 'percentage' || v <= 100;
          },
          message: 'A percentage value must not exceed 100'
        }
      ]
    },
    validFrom: { type: Date, required: [true, 'Please add validFrom'] },
    validTo: {
      type: Date,
      required: [true, 'Please add validTo'],
      validate: {
        validator: function (v) {
          return !this.validFrom || v >= this.validFrom;
        },
        message: 'validTo must not be before validFrom'
      }
    },
    maxRedemptions: {
      type: Number,
      required: [true, 'Please add maxRedemptions'],
      min: [1, 'maxRedemptions must be at least 1'],
      validate: { validator: Number.isInteger, message: 'maxRedemptions must be an integer' }
    },
    redemptionCount: { type: Number, default: 0, min: 0 },
    perUserLimit: {
      type: Number,
      min: [1, 'perUserLimit must be at least 1'],
      validate: { validator: Number.isInteger, message: 'perUserLimit must be an integer' }
    },
    // Redemptions per user, keyed by the user id string. Only ever changed with atomic $inc.
    usage: { type: mongoose.Schema.Types.Mixed, default: {} }
  },
  { minimize: false }
);

module.exports = mongoose.model('PromoCode', PromoCodeSchema);
