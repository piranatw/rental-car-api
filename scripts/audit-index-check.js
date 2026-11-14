// Index check: the admin, booking and timestamp-range audit queries must be served by an index.
// Usage: node scripts/audit-index-check.js   (MONGO_URI env, _test database, after scripts/seed-audit.js)
const mongoose = require('mongoose');
const AuditLog = require('../models/AuditLog');
const { parseAuditQuery } = require('../controllers/audit');

const noq = (process.env.MONGO_URI || '').split('?')[0];
if (!noq.endsWith('_test')) {
  console.error('Refusing to run: MONGO_URI database name must end with _test');
  process.exit(1);
}

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
  stages(plan.shards && plan.shards[0] && plan.shards[0].winningPlan, out);
  return out;
};

(async () => {
  await mongoose.connect(process.env.MONGO_URI, { serverSelectionTimeoutMS: 3000 });
  try {
    const day = 86400000;
    const queries = {
      'admin filter': { admin: 'aaaaaaaaaaaaaaaaaaaa0001' },
      'booking filter': { booking: 'bbbbbbbbbbbbbbbbbbbb0001' },
      'timestamp range': { from: new Date(Date.now() - 30 * day).toISOString(), to: new Date(Date.now() - 10 * day).toISOString() }
    };
    for (const [name, query] of Object.entries(queries)) {
      const parsed = parseAuditQuery({ ...query, limit: '25' });
      if (parsed.error) throw new Error(`${name}: ${parsed.error}`);
      const explain = await AuditLog.find(parsed.filter)
        .sort({ timestamp: -1, _id: -1 })
        .skip((parsed.page - 1) * parsed.limit)
        .limit(parsed.limit)
        .explain('queryPlanner');
      const found = stages(explain.queryPlanner.winningPlan);
      check(found.includes('IXSCAN') && !found.includes('COLLSCAN'), `${name}: winning plan ${found.join(' > ')} (needs IXSCAN, no COLLSCAN)`);
    }
  } finally {
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
