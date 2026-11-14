const mongoose = require('mongoose');

const ProviderSchema = new mongoose.Schema({
  name: {
    type: String,
    required: [true, 'Please add a name'],
    trim: true
  },
  address: {
    type: String,
    required: [true, 'Please add an address']
  },
  tel: {
    type: String,
    required: [true, 'Please add a telephone number']
  },
  lateFeePerHour: {
    type: Number,
    min: [0, 'lateFeePerHour must be at least 0'],
    default: 0
  },
  dailyRate: {
    type: Number,
    min: [0, 'dailyRate must be at least 0'],
    default: 0
  }
});

module.exports = mongoose.model('Provider', ProviderSchema);
