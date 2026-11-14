// Verifies lock EXPIRY without waiting 15 minutes: plants an expired lock directly in the
// _test database, then logs in over HTTP against the running test server.
// Usage: node scripts/lock-expiry-check.js   (MONGO_URI and PORT in env; server already up)
const mongoose = require('mongoose');
const User = require('../models/User');

const base = `http://localhost:${process.env.PORT || 5050}`;
const noq = (process.env.MONGO_URI || '').split('?')[0];
if (!noq.endsWith('_test')) {
  console.error('Refusing to run: MONGO_URI database name must end with _test');
  process.exit(1);
}

const login = async (email, password) => {
  const res = await fetch(`${base}/api/v1/auth/login`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ email, password })
  });
  return { status: res.status, text: await res.text() };
};

const failures = [];
const check = (ok, label) => {
  console.log(`${ok ? 'PASS' : 'FAIL'} ${label}`);
  if (!ok) failures.push(label);
};

(async () => {
  await mongoose.connect(process.env.MONGO_URI, { serverSelectionTimeoutMS: 3000 });
  const email = `lockexpiry${Date.now()}@example.com`;
  const user = await User.create({ name: 'Lock Expiry', telephone: '0811111111', email, password: 'secret123' });
  const state = () => User.findById(user._id).select('+failedLoginAttempts +lockUntil').lean();
  try {
    // Active lock: the correct password is rejected generically.
    await User.updateOne({ _id: user._id }, { $set: { failedLoginAttempts: 5, lockUntil: new Date(Date.now() + 60000) } });
    let r = await login(email, 'secret123');
    check(r.status === 401 && r.text === '{"success":false,"message":"Invalid credentials"}', 'active lock rejects the correct password with the generic 401');

    // Expired lock + wrong password: counting restarts at 1 (not 6) and the lock is cleared.
    await User.updateOne({ _id: user._id }, { $set: { failedLoginAttempts: 5, lockUntil: new Date(Date.now() - 1000) } });
    r = await login(email, 'wrongpass1');
    let s = await state();
    check(r.status === 401, 'expired lock + wrong password returns 401');
    check(s.failedLoginAttempts === 1 && !s.lockUntil, 'expired lock: counter restarted at 1 and lockUntil cleared');

    // Expired lock + correct password: success and counter reset.
    await User.updateOne({ _id: user._id }, { $set: { failedLoginAttempts: 5, lockUntil: new Date(Date.now() - 1000) } });
    r = await login(email, 'secret123');
    s = await state();
    check(r.status === 200 && JSON.parse(r.text).token, 'expired lock: correct password logs in (200 with token)');
    check(s.failedLoginAttempts === 0 && !s.lockUntil, 'after success counter is 0 and lockUntil is unset');
  } finally {
    await User.deleteOne({ _id: user._id });
    await mongoose.disconnect();
  }
  if (failures.length) process.exit(1);
})().catch((e) => {
  console.error('lock-expiry-check error: ' + e.message);
  process.exit(1);
});
