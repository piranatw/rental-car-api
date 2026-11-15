// Index + deep-page check for GET /api/v1/tickets on a LARGE collection.
// Usage: node scripts/ticket-index-check.js   (MONGO_URI env, database name must end with _test)
// Works on its own scratch database: the MONGO_URI database name with `_test` replaced by
// `_scratch_tickets`. It is dropped before loading and ALWAYS dropped afterwards. No other database
// is read or written. It loads 60,000 synthetic tickets, builds the model's indexes, then
//   1. fails on any blocking SORT stage, COLLSCAN or missing IXSCAN in the winning plan of the
//      controller's exact query shape (unfiltered, user, status, category, status+category,
//      user+status) with a deep skip, and
//   2. calls the real getTickets handler for deep pages; each must answer 200 in < 3000 ms.
const mongoose = require('mongoose');
const Ticket = require('../models/Ticket');
const { parseListQuery, getTickets, SORT } = require('../controllers/tickets');

const uri = process.env.MONGO_URI || '';
const [noq, qs] = uri.split('?');
if (!noq.endsWith('_test')) {
  console.error('Refusing to run: MONGO_URI database name must end with _test');
  process.exit(1);
}
const scratchUri = noq.slice(0, -'_test'.length) + '_scratch_tickets' + (qs ? `?${qs}` : '');
const scratchName = scratchUri.split('?')[0].split('/').pop();
if (!scratchName.endsWith('_scratch_tickets')) {
  console.error('Refusing to run: derived database name must end with _scratch_tickets');
  process.exit(1);
}

const TOTAL = 60000;
const USERS = Array.from({ length: 5 }, (_, n) => new mongoose.Types.ObjectId(`aaaaaaaaaaaaaaaaaaaa${String(n + 1).padStart(4, '0')}`));
const BOOKING = new mongoose.Types.ObjectId('bbbbbbbbbbbbbbbbbbbb0001');

const failures = [];
const check = (ok, label) => {
  console.log(`${ok ? 'PASS' : 'FAIL'} ${label}`);
  if (!ok) failures.push(label);
};

const stages = (plan, out = []) => {
  if (!plan || typeof plan !== 'object') return out;
  if (plan.stage) out.push(plan.stage);
  stages(plan.inputStage, out);
  (plan.inputStages || []).forEach((s) => stages(s, out));
  stages(plan.queryPlan, out);
  return out;
};

const fakeRes = () => ({
  code: null, body: null,
  status(c) { this.code = c; return this; },
  json(b) { this.body = b; return this; }
});

(async () => {
  await mongoose.connect(scratchUri, { serverSelectionTimeoutMS: 3000 });
  if (mongoose.connection.name !== scratchName) throw new Error('connected to an unexpected database');
  try {
    await mongoose.connection.dropDatabase();
    const now = Date.now();
    for (let start = 0; start < TOTAL; start += 5000) {
      const docs = [];
      for (let i = start; i < start + 5000; i++) {
        docs.push({
          user: USERS[i % USERS.length],
          booking: BOOKING,
          category: Ticket.CATEGORIES[i % 3],
          subject: `subject ${i}`,
          description: 'synthetic',
          status: Ticket.STATUSES[Math.floor(i / 3) % 3],
          comments: [],
          // three tickets share each minute, so the _id tie-break matters
          createdAt: new Date(now - 3600000 - Math.floor(i / 3) * 60000)
        });
      }
      await Ticket.collection.insertMany(docs, { ordered: false });
    }
    await Ticket.syncIndexes();
    console.log(`Scratch database loaded with ${await Ticket.countDocuments({})} tickets`);

    const admin = { role: 'admin', _id: new mongoose.Types.ObjectId('cccccccccccccccccccc0001') };
    const user = { role: 'user', _id: USERS[0] };
    const shapes = {
      unfiltered: { who: admin, query: {} },
      'user filter': { who: user, query: {} },
      'status filter': { who: admin, query: { status: 'open' } },
      'category filter': { who: admin, query: { category: 'billing' } },
      'status+category filter': { who: admin, query: { status: 'in progress', category: 'other' } },
      'user+status filter': { who: user, query: { status: 'open' } }
    };
    for (const [name, { who, query }] of Object.entries(shapes)) {
      const parsed = parseListQuery({ ...query, limit: '100' }, who);
      if (parsed.error) throw new Error(`${name}: ${parsed.error}`);
      const explain = await Ticket.find(parsed.filter)
        .sort(SORT)
        .skip(2000)
        .limit(100)
        .explain('queryPlanner');
      const found = stages(explain.queryPlanner.winningPlan);
      const bad = found.includes('SORT') || found.includes('COLLSCAN') || !found.includes('IXSCAN');
      check(!bad, `${name}: winning plan ${found.join(' > ')} (needs IXSCAN, no SORT, no COLLSCAN)`);
    }

    const pages = [
      ['unfiltered admin page 500 limit 100', admin, { page: '500', limit: '100' }],
      ['user page 100 limit 100', user, { page: '100', limit: '100' }],
      ['status filtered page 100 limit 100', admin, { status: 'open', page: '100', limit: '100' }],
      ['category filtered page 100 limit 100', admin, { category: 'billing', page: '100', limit: '100' }],
      ['status+category page 50 limit 100', admin, { status: 'in progress', category: 'other', page: '50', limit: '100' }]
    ];
    for (const [name, who, query] of pages) {
      const res = fakeRes();
      const t = Date.now();
      await getTickets({ query, user: who }, res);
      const ms = Date.now() - t;
      const ok = res.code === 200 && res.body && res.body.success === true && ms < 3000;
      check(ok, `${name}: status ${res.code}, ${res.body && res.body.count} rows of ${res.body && res.body.total}, ${ms} ms (< 3000)${res.code !== 200 && res.body ? ' ' + res.body.message : ''}`);
    }
  } finally {
    try { await mongoose.connection.dropDatabase(); } catch (e) { console.error('scratch drop failed: ' + e.message); }
    await mongoose.disconnect();
  }
  if (failures.length) {
    console.error(`ticket-index-check: ${failures.length} violation(s)`);
    process.exit(1);
  }
})().catch((e) => {
  console.error('ticket-index-check error: ' + e.message);
  process.exit(1);
});
