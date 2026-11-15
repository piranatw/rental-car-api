// Index + latency check for GET /api/v1/stats on a LARGE collection.
// Usage: node scripts/stats-index-check.js   (MONGO_URI env, database name must end with _test)
// Works on its own scratch database: the MONGO_URI database name with `_test` replaced by
// `_scratch_stats`. It is dropped before loading and ALWAYS dropped afterwards. No other database is
// read or written. It loads 100,000 synthetic bookings over 36 months and 32 providers, builds the
// model's indexes, then
//   1. fails on a COLLSCAN, or on a missing IXSCAN of the { date, provider } index, in the winning
//      plan of the $match of the controller's own pipeline (buildStatsPipeline), and
//   2. calls the real getStats handler for a 3-year, a one-month and a one-day range; each must
//      answer 200 in < 3000 ms, and total == sum(perProvider) == sum(perMonth) == a plain count.
const mongoose = require('mongoose');
const Booking = require('../models/Booking');
const Provider = require('../models/Provider');
const { getStats, buildStatsPipeline } = require('../controllers/stats');

const uri = process.env.MONGO_URI || '';
const [noq, qs] = uri.split('?');
if (!noq.endsWith('_test')) {
  console.error('Refusing to run: MONGO_URI database name must end with _test');
  process.exit(1);
}
const scratchUri = noq.slice(0, -'_test'.length) + '_scratch_stats' + (qs ? `?${qs}` : '');
const scratchName = scratchUri.split('?')[0].split('/').pop();
if (!scratchName.endsWith('_scratch_stats')) {
  console.error('Refusing to run: derived database name must end with _scratch_stats');
  process.exit(1);
}

const TOTAL = 100000;
const PROVIDER_COUNT = 32;
const FIRST_DAY = Date.UTC(2023, 0, 1);
const DAYS = 1096; // 2023-01-01 .. 2025-12-31 (36 months)
const USER = new mongoose.Types.ObjectId('aaaaaaaaaaaaaaaaaaaa0001');

const failures = [];
const check = (ok, label) => {
  console.log(`${ok ? 'PASS' : 'FAIL'} ${label}`);
  if (!ok) failures.push(label);
};

// Every stage / index name found in a winning plan.
const walk = (plan, out = { stages: [], indexes: [] }) => {
  if (!plan || typeof plan !== 'object') return out;
  if (plan.stage) out.stages.push(plan.stage);
  if (plan.indexName) out.indexes.push(plan.indexName);
  walk(plan.inputStage, out);
  (plan.inputStages || []).forEach((s) => walk(s, out));
  walk(plan.queryPlan, out);
  return out;
};

const fakeRes = () => ({
  code: null, body: null,
  status(c) { this.code = c; return this; },
  json(b) { this.body = b; return this; }
});

const sum = (a) => a.reduce((s, x) => s + x.count, 0);

(async () => {
  await mongoose.connect(scratchUri, { serverSelectionTimeoutMS: 3000 });
  if (mongoose.connection.name !== scratchName) throw new Error('connected to an unexpected database');
  try {
    await mongoose.connection.dropDatabase();
    const providers = await Provider.insertMany(Array.from({ length: PROVIDER_COUNT }, (_, n) => ({
      name: `Scratch Provider ${String(n).padStart(2, '0')}`, address: 'Scratch Road', tel: '020000000', lateFeePerHour: 100, dailyRate: 1000
    })));
    for (let start = 0; start < TOTAL; start += 10000) {
      const docs = [];
      for (let i = start; i < start + 10000; i++) {
        const date = new Date(FIRST_DAY + ((i * 7919) % DAYS) * 86400000);
        docs.push({
          user: USER,
          // skewed: low-numbered providers are booked more often
          provider: providers[Math.floor(Math.sqrt((i * 31) % (PROVIDER_COUNT * PROVIDER_COUNT)))]._id,
          date, returnDate: date, totalPrice: 1000, discount: 0, promo: null, createdAt: new Date()
        });
      }
      await Booking.collection.insertMany(docs, { ordered: false });
    }
    await Booking.init();
    await Provider.init();
    console.log(`Scratch database loaded with ${await Booking.countDocuments({})} bookings, ${PROVIDER_COUNT} providers`);

    const ranges = {
      'three years': ['2023-01-01', '2025-12-31'],
      'one month': ['2024-06-01', '2024-06-30'],
      'one day': ['2024-06-15', '2024-06-15']
    };

    // 1. plan of the range $match. Raw explain command: aggregate().explain() refuses the URI's write concern.
    for (const [name, [from, to]] of Object.entries(ranges)) {
      const pipeline = buildStatsPipeline(new Date(`${from}T00:00:00.000Z`), new Date(`${to}T23:59:59.999Z`));
      const explain = await mongoose.connection.db.command({
        explain: { aggregate: Booking.collection.name, pipeline, cursor: {} },
        verbosity: 'queryPlanner'
      });
      // Depending on the server version the plan sits at the top or in the first $cursor stage.
      const planner = explain.queryPlanner || explain.stages[0].$cursor.queryPlanner;
      const found = walk(planner.winningPlan);
      const bad = found.stages.includes('COLLSCAN') || !found.stages.includes('IXSCAN') || !found.indexes.includes('date_1_provider_1');
      check(!bad, `${name}: winning plan ${found.stages.join(' > ')} on ${found.indexes.join(',') || 'no index'} (needs IXSCAN on date_1_provider_1, no COLLSCAN)`);
    }

    // 2. the real handler
    const admin = { role: 'admin', _id: new mongoose.Types.ObjectId('cccccccccccccccccccc0001') };
    for (const [name, [from, to]] of Object.entries(ranges)) {
      const res = fakeRes();
      const t = Date.now();
      await getStats({ query: { from, to }, user: admin }, res);
      const ms = Date.now() - t;
      const d = res.body && res.body.data;
      const plain = await Booking.countDocuments({
        date: { $gte: new Date(`${from}T00:00:00.000Z`), $lte: new Date(`${to}T23:59:59.999Z`) }
      });
      const ok = res.code === 200 && !!d && ms < 3000;
      check(ok, `${name}: status ${res.code}, total ${d && d.total}, ${d && d.perProvider.length} providers, ${d && d.perMonth.length} months, ${ms} ms (< 3000)`);
      check(!!d && d.total > 0 && d.total === plain && sum(d.perProvider) === d.total && sum(d.perMonth) === d.total,
        `${name}: total == sum(perProvider) == sum(perMonth) == plain count ${plain}`);
    }
  } finally {
    try { await mongoose.connection.dropDatabase(); } catch (e) { console.error('scratch drop failed: ' + e.message); }
    await mongoose.disconnect();
  }
  if (failures.length) {
    console.error(`stats-index-check: ${failures.length} violation(s)`);
    process.exit(1);
  }
})().catch((e) => {
  console.error('stats-index-check error: ' + e.message);
  process.exit(1);
});
