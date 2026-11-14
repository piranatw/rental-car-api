const mongoose = require('mongoose');

const BookingSchema = new mongoose.Schema({
  user: {
    type: mongoose.Schema.ObjectId,
    ref: 'User',
    required: true
  },
  provider: {
    type: mongoose.Schema.ObjectId,
    ref: 'Provider',
    required: true
  },
  date: {
    type: Date,
    required: [true, 'Please add a pickup date']
  },
  returnDate: {
    type: Date,
    required: [true, 'Please add a return date'],
    validate: {
      validator: function (value) {
        return !this.date || value >= this.date;
      },
      message: 'returnDate must not be before date'
    }
  },
  totalPrice: {
    type: Number,
    min: 0,
    default: 0
  },
  promo: {
    type: mongoose.Schema.ObjectId,
    default: null
  },
  discount: {
    type: Number,
    default: 0
  },
  createdAt: {
    type: Date,
    default: Date.now
  }
});

module.exports = mongoose.model('Booking', BookingSchema);
