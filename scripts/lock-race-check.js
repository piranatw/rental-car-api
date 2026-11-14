// Concurrency checks for login lockout: parallel guesses must never exceed the attempt budget.
// Talks to the running test server over HTTP (Promise.all) and reads the _test database.
// Usage: node scripts/lock-race-check.js   (MONGO_URI and PORT in env; server already up)
const mongoose = require('mongoose');
const User = require('../models/User');

const base = `http://localhost:${process.env.PORT || 5050}`;
const noq = (process.env.MONGO_URI || '').split('?')[0];
if (!noq.endsWith('_test')) {
  console.error('Refusing to run: MONGO_URI database name must end with _test');
  process.exit(1);
}
const GENERIC = '{"success":false,"message":"Invalid credentials"}';
const PW = 'secret123';
const BAD = 'wrongpass1';

const post = async (path, body) => {
  const res = await fetch(base + path, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(body)
  });
  if (res.status === 429) throw new Error('Got 429: the IP limiter is active (is RATE_LIMIT_FORCE exported?)');
  return { status: res.status, text: await res.text() };
};
const login = (email, password) => post('/api/v1/auth/login', { email, password });

const failures = [];
const check = (ok, label) => {
  console.log(`${ok ? 'PASS' : 'FAIL'} ${label}`);
  if (!ok) failures.push(label);
};

const newUser = async (tag) => {
  const email = `lockrace${tag}${Date.now()}${Math.floor(Math.random() * 1e6)}@example.com`;
  const r = await post('/api/v1/auth/register', { name: 'Race', telephone: '0811111111', email, password: PW });
  if (r.status !== 201) throw new Error('register failed: ' + r.status);
  return email;
};
const state = (email) => User.findOne({ email }).select('+failedLoginAttempts +lockUntil').lean();
const allPlain401 = (rs) => rs.every((r) => r.status === 401 && r.text === GENERIC);

(async () => {
  await mongoose.connect(process.env.MONGO_URI, { serverSelectionTimeoutMS: 3000 });
  const created = [];
  try {
    // 1. 20 parallel wrong guesses on a fresh account.
    let email = await newUser('a'); created.push(email);
    let rs = await Promise.all(Array.from({ length: 20 }, () => login(email, BAD)));
    check(allPlain401(rs), '20 parallel wrong logins: every response is the plain generic 401');
    let s = await state(email);
    check(s.failedLoginAttempts === 5 && s.lockUntil && s.lockUntil > new Date(), `20 parallel wrong logins: counter is exactly 5 and account locked (counter=${s.failedLoginAttempts})`);
    let r = await login(email, PW);
    check(r.status === 401 && r.text === GENERIC, 'following correct-password login is the plain 401 (locked)');

    // 2. Lock duration with default LOGIN_LOCK_MINUTES (15), after 5 sequential wrong logins.
    email = await newUser('b'); created.push(email);
    for (let i = 0; i < 5; i++) await login(email, BAD);
    s = await state(email);
    const delta = s.lockUntil ? s.lockUntil.getTime() - Date.now() : NaN;
    check(Math.abs(delta - 15 * 60 * 1000) <= 5000, `lockUntil is 15 minutes +/- 5 s from now (delta=${Math.round(delta / 1000)} s)`);

    // 3. Locked account: burst including the correct password yields no 200.
    rs = await Promise.all(Array.from({ length: 20 }, (_, i) => login(email, i % 4 === 0 ? PW : BAD)));
    check(rs.filter((x) => x.status === 200).length === 0 && allPlain401(rs), 'locked account: burst of 20 incl. 5 correct passwords returns 0 x 200, all plain 401');

    // 4. Account at 4 failures: only ONE attempt budget is left. 19 wrong guesses are sent first and
    //    the correct password last, so it can only be reserved after the budget is spent; a
    //    stale-snapshot implementation would still compare it and answer 200.
    email = await newUser('c'); created.push(email);
    for (let i = 0; i < 4; i++) await login(email, BAD);
    rs = await Promise.all(Array.from({ length: 20 }, (_, i) => login(email, i === 19 ? PW : BAD)));
    const ok = rs.filter((x) => x.status === 200).length;
    check(ok === 0, `account at 4 failures: correct password sent last in a burst of 20 gets no 200 (got ${ok})`);
    check(allPlain401(rs), 'account at 4 failures: every response in the burst is the plain 401');
  } finally {
    await User.deleteMany({ email: { $in: created } });
    await mongoose.disconnect();
  }
  if (failures.length) process.exit(1);
})().catch((e) => {
  console.error('lock-race-check error: ' + e.message);
  process.exit(1);
});
