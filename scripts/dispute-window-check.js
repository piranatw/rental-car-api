// Pure unit check (no server, no database) of the 7-day dispute window arithmetic.
// isWithinWindow(createdAt, now): allowed when (now - createdAt) <= 7 days, inclusive, integer ms.
// Usage: node scripts/dispute-window-check.js        Exits non-zero on any failure.
const { WINDOW_MS, isWithinWindow } = require('../controllers/inspections');

const failures = [];
const check = (ok, label) => {
  if (!ok) { console.log(`FAIL ${label}`); failures.push(label); }
};

const NOW = Date.UTC(2026, 10, 15, 12, 0, 0, 0);
const at = (ageMs) => new Date(NOW - ageMs);

check(WINDOW_MS === 604800000, 'WINDOW_MS is 604800000');
check(isWithinWindow(at(WINDOW_MS), NOW) === true, 'exactly 7 days -> allowed (inclusive)');
check(isWithinWindow(at(WINDOW_MS + 1), NOW) === false, '7 days + 1 ms -> closed');
check(isWithinWindow(at(WINDOW_MS - 1), NOW) === true, '7 days - 1 ms -> allowed');
check(isWithinWindow(at(0), NOW) === true, 'age 0 -> allowed');
check(isWithinWindow(new Date(NOW + 5000), NOW) === true, 'createdAt in the future -> allowed');
check(isWithinWindow(at(30 * 86400000), NOW) === false, '30 days -> closed');

// Dense sweep around the boundary: allowed exactly while age <= WINDOW_MS.
for (let d = -2000; d <= 2000; d++) {
  const age = WINDOW_MS + d;
  check(isWithinWindow(at(age), NOW) === (d <= 0), `sweep age = 7 days ${d >= 0 ? '+' : '-'} ${Math.abs(d)} ms`);
}

// Never throws, never mutates its arguments.
const c = new Date(NOW - WINDOW_MS);
const before = c.getTime();
let threw = false;
try { isWithinWindow(c, NOW); isWithinWindow(new Date(0), NOW); isWithinWindow(new Date(NaN), NOW); isWithinWindow(new Date(8.64e15), NOW); } catch (e) { threw = true; }
check(!threw, 'never throws on epoch 0, Invalid Date, max Date');
check(c.getTime() === before, 'does not mutate the createdAt Date');
check(isWithinWindow(new Date(NaN), NOW) === false, 'Invalid Date -> not allowed');

if (failures.length) {
  console.error(`dispute-window-check: ${failures.length} failure(s)`);
  process.exit(1);
}
console.log('dispute-window-check: all checks passed');
