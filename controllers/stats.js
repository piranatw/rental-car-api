const Booking = require('../models/Booking');
const Provider = require('../models/Provider');

const DATE_ONLY = /^(\d{4})-(\d{2})-(\d{2})$/;
const DATE_TIME = /^(\d{4})-(\d{2})-(\d{2})T([01]\d|2[0-3]):[0-5]\d(:[0-5]\d(\.\d{1,9})?)?(Z|[+-]([01]\d|2[0-3]):[0-5]\d)$/;
const DAY_MS = 86400000;
const MAX_SPAN_MS = 3653 * DAY_MS; // 10 years
const BASIS = 'booking.date';
const UNKNOWN_PROVIDER = '(unknown provider)';

const fail = (res, status, message) => res.status(status).json({ success: false, message });

const daysInMonth = (y, m) => new Date(Date.UTC(y, m, 0)).getUTCDate();

// One query value -> Date or null. Only a single string is accepted: arrays (repeated params) and
// objects (?from[$gt]=x with the extended query parser) are rejected before anything reaches Mongo.
// A date-only value is a UTC day: the start of it as `from`, its last millisecond as `to`.
const parseBound = (value, isTo) => {
  if (typeof value !== 'string') return null;
  const m = DATE_ONLY.exec(value) || DATE_TIME.exec(value);
  if (!m) return null;
  const [y, mo, d] = [Number(m[1]), Number(m[2]), Number(m[3])];
  if (mo < 1 || mo > 12 || d < 1 || d > daysInMonth(y, mo)) return null;
  const dateOnly = DATE_ONLY.test(value);
  const date = new Date(dateOnly ? `${value}T00:00:00.000Z` : value);
  if (Number.isNaN(date.getTime())) return null;
  return dateOnly && isTo ? new Date(date.getTime() + DAY_MS - 1) : date;
};

const FORMAT = 'a single ISO 8601 value: YYYY-MM-DD, or a date-time with a zone (Z or +hh:mm)';

// -> { error } or { from: Date, to: Date }. Never throws.
const parseRange = (query) => {
  const q = query || {};
  for (const key of ['from', 'to']) {
    if (q[key] === undefined) return { error: `${key} is required` };
  }
  const from = parseBound(q.from, false);
  if (!from) return { error: `from must be ${FORMAT}` };
  const to = parseBound(q.to, true);
  if (!to) return { error: `to must be ${FORMAT}` };
  if (to < from) return { error: 'to must not be before from' };
  if (to - from > MAX_SPAN_MS) return { error: 'the range must not be longer than 10 years (3653 days)' };
  return { from, to };
};

// The whole report in one aggregation; every figure is counted by MongoDB.
// $match uses the { date, provider } index; $facet fans the matched bookings into the three counts.
// perProvider: count DESC, name ASC, id ASC. A provider that no longer exists keeps its count.
const buildStatsPipeline = (from, to) => [
  { $match: { date: { $gte: from, $lte: to } } },
  {
    $facet: {
      total: [{ $count: 'n' }],
      perProvider: [
        { $group: { _id: '$provider', count: { $sum: 1 } } },
        { $lookup: { from: Provider.collection.name, localField: '_id', foreignField: '_id', as: 'found' } },
        {
          $project: {
            _id: 0,
            provider: { $toString: '$_id' },
            name: { $ifNull: [{ $arrayElemAt: ['$found.name', 0] }, UNKNOWN_PROVIDER] },
            count: 1
          }
        },
        { $sort: { count: -1, name: 1, provider: 1 } }
      ],
      perMonth: [
        { $group: { _id: { $dateToString: { format: '%Y-%m', date: '$date', timezone: 'UTC' } }, count: { $sum: 1 } } },
        { $sort: { _id: 1 } },
        { $project: { _id: 0, month: '$_id', count: 1 } }
      ]
    }
  },
  {
    $project: {
      total: { $ifNull: [{ $arrayElemAt: ['$total.n', 0] }, 0] },
      perProvider: 1,
      perMonth: 1,
      top5: { $slice: ['$perProvider', 5] }
    }
  }
];

// GET /api/v1/stats?from=&to=   (admin only; not written to the audit log)
const getStats = async (req, res) => {
  const parsed = parseRange(req.query);
  if (parsed.error) return fail(res, 400, parsed.error);
  try {
    const [report] = await Booking.aggregate(buildStatsPipeline(parsed.from, parsed.to));
    return res.status(200).json({
      success: true,
      data: {
        range: { from: parsed.from.toISOString(), to: parsed.to.toISOString() },
        basis: BASIS,
        total: report.total,
        perProvider: report.perProvider,
        perMonth: report.perMonth,
        top5: report.top5
      }
    });
  } catch (err) {
    console.error(err.message);
    return fail(res, 500, 'Server error');
  }
};

module.exports = { getStats, parseRange, buildStatsPipeline };
