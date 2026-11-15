const Booking = require('../models/Booking');
const Ticket = require('../models/Ticket');
const { parsePaging } = require('../utils/paging');

const OBJECT_ID = /^[0-9a-fA-F]{24}$/;
const MAX_SUBJECT = 200;
const MAX_DESCRIPTION = 5000;
const MAX_COMMENT = 2000;
const MAX_COMMENTS = 200;
const NOT_FOUND = 'Ticket not found';

// Newest first; _id breaks ties so pages never overlap. Every list index ends in these two keys.
const SORT = { createdAt: -1, _id: -1 };

const fail = (res, status, message) => res.status(status).json({ success: false, message });

const serverError = (err, res) => {
  console.error(err.message);
  return fail(res, 500, 'Server error');
};

// Strings only, trimmed, 1..max characters after trimming. -> { value } or { error }.
const readText = (raw, name, max) => {
  if (typeof raw !== 'string') return { error: `${name} must be a string` };
  const value = raw.trim();
  if (value.length === 0) return { error: `${name} must not be empty` };
  if (value.length > max) return { error: `${name} must be at most ${max} characters` };
  return { value };
};

// Comment timestamps come from the server clock only. Made strictly increasing within the process
// so comments written in the same millisecond still have distinct, ordered createdAt values.
let lastStamp = 0;
const nextStamp = () => {
  lastStamp = Math.max(Date.now(), lastStamp + 1);
  return new Date(lastStamp);
};

const isAdmin = (req) => req.user.role === 'admin';

// ---- POST /api/v1/tickets ---------------------------------------------------------------------

exports.createTicket = async (req, res) => {
  try {
    const body = req.body && typeof req.body === 'object' ? req.body : {};

    if (body.booking === undefined || body.booking === null || body.booking === '') {
      return fail(res, 400, 'booking is required');
    }
    if (typeof body.category !== 'string' || !Ticket.CATEGORIES.includes(body.category)) {
      return fail(res, 400, `category must be one of: ${Ticket.CATEGORIES.join(', ')}`);
    }
    const subject = readText(body.subject, 'subject', MAX_SUBJECT);
    if (subject.error) return fail(res, 400, subject.error);
    const description = readText(body.description, 'description', MAX_DESCRIPTION);
    if (description.error) return fail(res, 400, description.error);

    if (typeof body.booking !== 'string' || !OBJECT_ID.test(body.booking)) {
      return fail(res, 404, 'Booking not found');
    }
    // Direct lookup: the booking must belong to the caller, admins included (no impersonation).
    const booking = await Booking.findById(body.booking).select('user').lean();
    if (!booking) return fail(res, 404, 'Booking not found');
    if (booking.user.toString() !== req.user.id) {
      return fail(res, 403, 'Not authorized to open a ticket for this booking');
    }

    const ticket = await Ticket.create({
      user: req.user._id,
      booking: booking._id,
      category: body.category,
      subject: subject.value,
      description: description.value
    });
    res.status(201).json({ success: true, data: ticket });
  } catch (err) {
    serverError(err, res);
  }
};

// ---- GET /api/v1/tickets ----------------------------------------------------------------------

// -> { error } or { filter, page, limit }. Nothing is clamped; unknown params are ignored.
const parseListQuery = (query, user) => {
  const paging = parsePaging(query);
  if (paging.error) return { error: paging.error };

  const filter = {};
  const enums = { status: Ticket.STATUSES, category: Ticket.CATEGORIES };
  for (const key of Object.keys(enums)) {
    if (query[key] === undefined) continue;
    if (typeof query[key] !== 'string' || !enums[key].includes(query[key])) {
      return { error: `${key} must be one of: ${enums[key].join(', ')}` };
    }
    filter[key] = query[key];
  }
  // Users only ever see their own tickets, whatever else they pass.
  if (user.role !== 'admin') filter.user = user._id;
  return { filter, page: paging.page, limit: paging.limit };
};

exports.getTickets = async (req, res) => {
  try {
    const parsed = parseListQuery(req.query, req.user);
    if (parsed.error) return fail(res, 400, parsed.error);
    const { filter, page, limit } = parsed;
    const [data, total] = await Promise.all([
      Ticket.find(filter).sort(SORT).skip((page - 1) * limit).limit(limit),
      Ticket.countDocuments(filter)
    ]);
    res.status(200).json({
      success: true,
      count: data.length,
      total,
      page,
      pages: Math.ceil(total / limit),
      data
    });
  } catch (err) {
    serverError(err, res);
  }
};

// ---- GET /api/v1/tickets/:id ------------------------------------------------------------------

// Returns the ticket (owner or admin), or sends 404 / 403 itself and returns null.
const loadAccessibleTicket = async (req, res) => {
  if (!OBJECT_ID.test(req.params.id)) {
    fail(res, 404, NOT_FOUND);
    return null;
  }
  const ticket = await Ticket.findById(req.params.id);
  if (!ticket) {
    fail(res, 404, NOT_FOUND);
    return null;
  }
  if (ticket.user.toString() !== req.user.id && !isAdmin(req)) {
    fail(res, 403, 'Not authorized to access this ticket');
    return null;
  }
  return ticket;
};

exports.getTicket = async (req, res) => {
  try {
    const ticket = await loadAccessibleTicket(req, res);
    if (!ticket) return;
    res.status(200).json({ success: true, data: ticket });
  } catch (err) {
    serverError(err, res);
  }
};

// ---- POST /api/v1/tickets/:id/comments --------------------------------------------------------

exports.addComment = async (req, res) => {
  try {
    const ticket = await loadAccessibleTicket(req, res);
    if (!ticket) return;

    const body = req.body && typeof req.body === 'object' ? req.body : {};
    const text = readText(body.text, 'text', MAX_COMMENT);
    if (text.error) return fail(res, 400, text.error);

    // Author, role and time come from the token and the server clock, never from the body.
    const comment = { author: req.user._id, role: req.user.role, text: text.value, createdAt: nextStamp() };

    // The "not resolved" and "under the cap" checks are part of this one atomic update: a status
    // flip or another comment racing this one cannot slip past either rule.
    const updated = await Ticket.findOneAndUpdate(
      {
        _id: ticket._id,
        status: { $ne: 'resolved' },
        [`comments.${MAX_COMMENTS - 1}`]: { $exists: false }
      },
      { $push: { comments: comment } },
      { new: true }
    );
    if (updated) return res.status(200).json({ success: true, data: updated });

    // Matched nothing: one read decides why.
    const current = await Ticket.findById(ticket._id).select('status').lean();
    if (!current) return fail(res, 404, NOT_FOUND);
    if (current.status === 'resolved') return fail(res, 400, 'Ticket is resolved');
    const capped = await Ticket.exists({
      _id: ticket._id,
      [`comments.${MAX_COMMENTS - 1}`]: { $exists: true }
    });
    if (capped) return fail(res, 400, 'Ticket has reached the maximum number of comments');
    // Reopened between the update and the read: nothing was stored, ask the caller to retry.
    return fail(res, 409, 'Ticket changed while commenting, please retry');
  } catch (err) {
    serverError(err, res);
  }
};

// ---- PUT /api/v1/tickets/:id/status (admin) ---------------------------------------------------

exports.setStatus = async (req, res) => {
  try {
    if (!OBJECT_ID.test(req.params.id)) return fail(res, 404, NOT_FOUND);
    const body = req.body && typeof req.body === 'object' ? req.body : {};
    if (typeof body.status !== 'string' || !Ticket.STATUSES.includes(body.status)) {
      return fail(res, 400, `status must be one of: ${Ticket.STATUSES.join(', ')}`);
    }
    const updated = await Ticket.findOneAndUpdate(
      { _id: req.params.id },
      { $set: { status: body.status } },
      { new: true }
    );
    if (!updated) return fail(res, 404, NOT_FOUND);
    res.status(200).json({ success: true, data: updated });
  } catch (err) {
    serverError(err, res);
  }
};

exports.parseListQuery = parseListQuery;
exports.SORT = SORT;
exports.MAX_COMMENTS = MAX_COMMENTS;
