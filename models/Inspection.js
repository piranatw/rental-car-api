const mongoose = require('mongoose');

// One return inspection per booking (the unique index is the single-winner mechanism).
// lateHours, lateFee, feePerHourUsed, scheduledReturnAt, recordedBy and createdAt are set by the
// server only. `dispute` belongs to the dispute feature and stays null until then.
const InspectionSchema = new mongoose.Schema(
  {
    booking: { type: mongoose.Schema.ObjectId, ref: 'Booking', required: true, unique: true },
    actualReturnTime: { type: Date, required: [true, 'Please add actualReturnTime'] },
    odometer: {
      type: Number,
      required: [true, 'Please add the odometer reading'],
      min: [0, 'odometer must be at least 0'],
      max: [10000000, 'odometer must be at most 10000000']
    },
    fuelLevel: {
      type: Number,
      required: [true, 'Please add the fuel level'],
      min: [0, 'fuelLevel must be at least 0'],
      max: [100, 'fuelLevel must be at most 100']
    },
    damageNotes: { type: String, maxlength: [5000, 'damageNotes must be at most 5000 characters'], default: '' },
    scheduledReturnAt: { type: Date },
    lateHours: { type: Number },
    lateFee: { type: Number },
    feePerHourUsed: { type: Number },
    recordedBy: { type: mongoose.Schema.ObjectId, ref: 'User' },
    createdAt: { type: Date, default: Date.now },
    dispute: { type: mongoose.Schema.Types.Mixed, default: null }
  },
  { strict: true }
);

module.exports = mongoose.model('Inspection', InspectionSchema);
