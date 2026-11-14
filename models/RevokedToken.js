const mongoose = require('mongoose');

// Stores only the sha256 hash of a revoked JWT; rows expire when the JWT would have.
const RevokedTokenSchema = new mongoose.Schema({
  tokenHash: {
    type: String,
    required: true,
    unique: true
  },
  expiresAt: {
    type: Date,
    required: true,
    index: { expireAfterSeconds: 0 }
  }
});

module.exports = mongoose.model('RevokedToken', RevokedTokenSchema);
