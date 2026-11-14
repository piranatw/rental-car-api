const mongoose = require('mongoose');

// Append-only: entries are created once and never modified or removed through Mongoose.
const AuditLogSchema = new mongoose.Schema(
  {
    admin: { type: mongoose.Schema.ObjectId, ref: 'User', required: true },
    action: {
      type: String,
      required: true,
      enum: { values: ['view', 'edit', 'delete'], message: 'action must be view, edit or delete' }
    },
    // Plain ObjectId, not a populated ref: it stays meaningful after the booking is deleted.
    booking: { type: mongoose.Schema.ObjectId, required: true },
    // Server clock only (no route accepts a client value); immutable after creation.
    timestamp: { type: Date, default: Date.now, immutable: true },
    before: { type: mongoose.Schema.Types.Mixed, default: null },
    after: { type: mongoose.Schema.Types.Mixed, default: null },
    // 'failed' marks an attempted edit/delete whose mutation did not happen; it is a NEW entry.
    status: { type: String, enum: ['recorded', 'failed'], default: 'recorded' },
    reason: { type: String }
  },
  { strict: 'throw', timestamps: false, versionKey: false, minimize: false }
);

// Each index ends in _id: the fixed sort (timestamp desc, _id desc) is then served in index order.
AuditLogSchema.index({ admin: 1, timestamp: -1, _id: -1 });
AuditLogSchema.index({ booking: 1, timestamp: -1, _id: -1 });
AuditLogSchema.index({ timestamp: -1, _id: -1 });

const refuse = (what) => new Error(`Audit entries are append-only: ${what} is not allowed`);

// Query middleware (Model.x / doc.x): every update, replace and delete path.
['updateOne', 'replaceOne', 'deleteOne'].forEach((op) => {
  AuditLogSchema.pre(op, { document: true, query: true }, function (next) {
    next(refuse(op));
  });
});
['updateMany', 'findOneAndUpdate', 'findOneAndReplace', 'deleteMany', 'findOneAndDelete'].forEach((op) => {
  AuditLogSchema.pre(op, function (next) {
    next(refuse(op));
  });
});

// save() may only insert.
AuditLogSchema.pre('save', function (next) {
  next(this.isNew ? undefined : refuse('save() on an existing entry'));
});

// bulkWrite (also used by bulkSave): only insertOne is allowed.
AuditLogSchema.pre('bulkWrite', function (next, ops) {
  const bad = (ops || []).find((op) => Object.keys(op)[0] !== 'insertOne');
  next(bad ? refuse(`bulkWrite ${Object.keys(bad)[0]}`) : undefined);
});

module.exports = mongoose.model('AuditLog', AuditLogSchema);
