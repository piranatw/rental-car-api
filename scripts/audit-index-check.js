// Index + deep-page check for GET /api/v1/audit on a LARGE log.
// Usage: node scripts/audit-index-check.js   (MONGO_URI env, database name must end with _test)
// Works on its own scratch database: the MONGO_URI database name with `_test` replaced by
// `_scratch_audit`. It is dropped before loading and ALWAYS dropped afterwards. No other database is
// read or written. It loads 100,000 synthetic entries, builds the model's indexes, then
//   1. fails on any blocking SORT stage or COLLSCAN in the winning plan of the controller's exact
//      query shape (unfiltered, admin, booking, timestamp range) with a deep skip, and
//   2. calls the real getAuditLogs for deep pages, each must answer 200 in < 3000 ms.
const mongoose = require('mongoose');
const AuditLog = require('../models/AuditLog');
const { parseAuditQuery, getAuditLogs, SORT } = require('../controllers/audit');

const uri = process.env.MONGO_URI || '';
const [noq, qs] = uri.split('?');
if (!noq.endsWith('_test')) {
  console.error('Refusing to run: MONGO_URI database name must end with _test');
  process.exit(1);
}
const scratchUri = noq.slice(0, -'_test'.length) + '_scratch_audit' + (qs ? `?${qs}` : '');
const scratchName = scratchUri.split('?')[0].split('/').pop();
if (!scratchName.endsWith('_scratch_audit')) {
  console.error('Refusing to run: derived database name must end with _scratch_audit');
  process.exit(1);
}

const TOTAL = 100000;
const ADMINS = Array.from({ length: 5 }, (_, n) => new mongoose.Types.ObjectId(`aaaaaaaaaaaaaaaaaaaa${String(n + 1).padStart(4, '0')}`));
const BOOKINGS = Array.from({ length: 10 }, (_, n) => new mongoose.Types.ObjectId(`bbbbbbbbbbbbbbbbbbbb${String(n + 1).padStart(4, '0')}`));
const ACTIONS = ['view', 'edit', 'delete'];

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
          admin: ADMINS[i % ADMINS.length],
          action: ACTIONS[i % 3],
          booking: BOOKINGS[i % BOOKINGS.length],
          // three entries share each minute, so the _id tie-break matters
          timestamp: new Date(now - 3600000 - Math.floor(i / 3) * 60000),
          before: null, after: null, status: 'recorded'
        });
      }
      await AuditLog.collection.insertMany(docs, { ordered: false });
    }
    await AuditLog.syncIndexes();
    console.log(`Scratch database loaded with ${await AuditLog.countDocuments({})} entries`);

    const day = 86400000;
    const queries = {
      unfiltered: {},
      'admin filter': { admin: ADMINS[0].toString() },
      'booking filter': { booking: BOOKINGS[0].toString() },
      'timestamp range': { from: new Date(now - 40 * day).toISOString(), to: new Date(now - 10 * day).toISOString() }
    };
    for (const [name, query] of Object.entries(queries)) {
      const parsed = parseAuditQuery({ ...query, limit: '100' });
      if (parsed.error) throw new Error(`${name}: ${parsed.error}`);
      const explain = await AuditLog.find(parsed.filter)
        .sort(SORT)
        .skip(5000)
        .limit(100)
        .explain('queryPlanner');
      const found = stages(explain.queryPlanner.winningPlan);
      const bad = found.includes('SORT') || found.includes('COLLSCAN') || !found.includes('IXSCAN');
      check(!bad, `${name}: winning plan ${found.join(' > ')} (needs IXSCAN, no SORT, no COLLSCAN)`);
    }

    const pages = [
      ['unfiltered deep page 1000 limit 100', { page: '1000', limit: '100' }],
      ['admin filtered page 100 limit 100', { admin: ADMINS[0].toString(), page: '100', limit: '100' }],
      ['booking filtered page 50 limit 100', { booking: BOOKINGS[0].toString(), page: '50', limit: '100' }],
      ['range filtered page 300 limit 100', { ...queries['timestamp range'], page: '300', limit: '100' }]
    ];
    for (const [name, query] of pages) {
      const res = fakeRes();
      const t = Date.now();
      await getAuditLogs({ query }, res);
      const ms = Date.now() - t;
      const ok = res.code === 200 && res.body && res.body.success === true && ms < 3000;
      check(ok, `${name}: status ${res.code}, ${res.body && res.body.count} rows of ${res.body && res.body.total}, ${ms} ms (< 3000)${res.code !== 200 && res.body ? ' ' + res.body.message : ''}`);
    }
  } finally {
    try { await mongoose.connection.dropDatabase(); } catch (e) { console.error('scratch drop failed: ' + e.message); }
    await mongoose.disconnect();
  }
  if (failures.length) {
    console.error(`audit-index-check: ${failures.length} violation(s)`);
    process.exit(1);
  }
})().catch((e) => {
  console.error('audit-index-check error: ' + e.message);
  process.exit(1);
});
