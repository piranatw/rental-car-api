const mongoose = require('mongoose');
const AuditLog = require('../models/AuditLog');
const { parsePaging } = require('../utils/paging');

const OBJECT_ID = /^[0-9a-fA-F]{24}$/;
const DATE_ONLY = /^(\d{4})-(\d{2})-(\d{2})$/;
const DATE_TIME = /^(\d{4})-(\d{2})-(\d{2})T\d{2}:\d{2}(:\d{2}(\.\d{1,9})?)?(Z|[+-]\d{2}:\d{2})$/;
const EDIT_KEYS = ['date', 'returnDate', 'provider', 'discount', 'totalPrice'];

const fail = (res, status, message) => res.status(status).json({ success: false, message });

// ---- writers ----------------------------------------------------------------------------------

// Appends one entry. Callers only invoke this when req.user.role === 'admin'.
const recordAudit = async ({ admin, action, booking, before = null, after = null, status, reason }) => {
  await AuditLog.create({
    admin, action, booking, before, after,
    ...(status ? { status } : {}),
    ...(reason ? { reason } : {})
  });
};

// One 'view' entry per booking id, inserted in one round trip (append-only insertMany).
const recordViews = async (admin, bookingIds) => {
  if (bookingIds.length === 0) return;
  await AuditLog.insertMany(bookingIds.map((booking) => ({ admin, action: 'view', booking })));
};

// A mutation that did not happen: a NEW entry; the entry written before it is never touched.
// Best effort: the caller is already answering with an error.
const recordFailure = async (entry, reason) => {
  try {
    await recordAudit({ ...entry, status: 'failed', reason });
  } catch (err) {
    console.error(`audit failure marker not written: ${err.message}`);
  }
};

// Stored values compared the way they are stored: dates by time, ids by string, numbers by value.
const normalise = (v) => {
  if (v instanceof Date) return v.getTime();
  if (v !== null && typeof v === 'object') return String(v);
  return v;
};

// Keys whose value differs between two snapshots -> { before, after } of those keys, else null.
const diffFields = (before, after, keys = EDIT_KEYS) => {
  const b = {};
  const a = {};
  for (const key of keys) {
    if (normalise(before[key]) !== normalise(after[key])) {
      b[key] = before[key];
      a[key] = after[key];
    }
  }
  return Object.keys(b).length ? { before: b, after: a } : null;
};

// ---- GET /api/v1/audit ------------------------------------------------------------------------

const daysInMonth = (y, m) => new Date(Date.UTC(y, m, 0)).getUTCDate();

// Date-only values are UTC days; as `to` they cover the whole day. Date-times need a zone.
const parseDateParam = (value, isTo) => {
  if (typeof value !== 'string') return null;
  const m = DATE_ONLY.exec(value) || DATE_TIME.exec(value);
  if (!m) return null;
  const [y, mo, d] = [Number(m[1]), Number(m[2]), Number(m[3])];
  if (mo < 1 || mo > 12 || d < 1 || d > daysInMonth(y, mo)) return null;
  const dateOnly = DATE_ONLY.test(value);
  const date = new Date(dateOnly ? `${value}T00:00:00.000Z` : value);
  if (Number.isNaN(date.getTime())) return null;
  return dateOnly && isTo ? new Date(date.getTime() + 86400000 - 1) : date;
};

// -> { error } or { filter, page, limit }. Nothing is clamped and nothing throws.
const parseAuditQuery = (query) => {
  const paging = parsePaging(query);
  if (paging.error) return { error: paging.error };

  const filter = {};
  for (const key of ['admin', 'booking']) {
    if (query[key] === undefined) continue;
    if (typeof query[key] !== 'string' || !OBJECT_ID.test(query[key])) {
      return { error: `${key} must be a valid id` };
    }
    filter[key] = new mongoose.Types.ObjectId(query[key]);
  }

  let from = null;
  let to = null;
  if (query.from !== undefined) {
    from = parseDateParam(query.from, false);
    if (!from) return { error: 'from must be an ISO date' };
  }
  if (query.to !== undefined) {
    to = parseDateParam(query.to, true);
    if (!to) return { error: 'to must be an ISO date' };
  }
  if (from && to && from > to) return { error: 'from must not be after to' };
  if (from || to) {
    filter.timestamp = { ...(from ? { $gte: from } : {}), ...(to ? { $lte: to } : {}) };
  }
  return { filter, page: paging.page, limit: paging.limit };
};

// Fixed sort: newest first, _id breaks ties so pages never overlap or skip.
const SORT = { timestamp: -1, _id: -1 };

exports.getAuditLogs = async (req, res) => {
  try {
    const parsed = parseAuditQuery(req.query);
    if (parsed.error) return fail(res, 400, parsed.error);
    const { filter, page, limit } = parsed;
    const [data, total] = await Promise.all([
      AuditLog.find(filter)
        .sort(SORT)
        .skip((page - 1) * limit)
        .limit(limit)
        .select('admin action booking timestamp before after status reason')
        .lean(),
      AuditLog.countDocuments(filter)
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
    console.error(err.message);
    fail(res, 500, 'Server error');
  }
};

exports.recordAudit = recordAudit;
exports.recordViews = recordViews;
exports.recordFailure = recordFailure;
exports.diffFields = diffFields;
exports.parseAuditQuery = parseAuditQuery;
exports.EDIT_KEYS = EDIT_KEYS;
