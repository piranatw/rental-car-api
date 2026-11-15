const mongoose = require('mongoose');

const CATEGORIES = ['billing', 'vehicle issue', 'other'];
const STATUSES = ['open', 'in progress', 'resolved'];

// Author, role and createdAt are set by the controller from req.user and the server clock only.
const CommentSchema = new mongoose.Schema(
  {
    author: { type: mongoose.Schema.ObjectId, ref: 'User', required: true },
    role: { type: String, enum: ['user', 'admin'], required: true },
    text: { type: String, required: true },
    createdAt: { type: Date, required: true }
  },
  { versionKey: false }
);

const TicketSchema = new mongoose.Schema(
  {
    user: { type: mongoose.Schema.ObjectId, ref: 'User', required: true },
    // Plain ObjectId, never populated: a ticket stays readable after its booking is deleted.
    booking: { type: mongoose.Schema.ObjectId, required: true },
    category: { type: String, required: true, enum: CATEGORIES },
    subject: { type: String, required: true },
    description: { type: String, required: true },
    status: { type: String, enum: STATUSES, default: 'open' },
    comments: { type: [CommentSchema], default: [] },
    createdAt: { type: Date, default: Date.now }
  },
  { versionKey: false }
);

// Every index ends in createdAt desc, _id desc: the list sort is then served in index order.
TicketSchema.index({ user: 1, createdAt: -1, _id: -1 });
TicketSchema.index({ status: 1, createdAt: -1, _id: -1 });
TicketSchema.index({ category: 1, createdAt: -1, _id: -1 });
TicketSchema.index({ createdAt: -1, _id: -1 });

const Ticket = mongoose.model('Ticket', TicketSchema);
Ticket.CATEGORIES = CATEGORIES;
Ticket.STATUSES = STATUSES;

module.exports = Ticket;
