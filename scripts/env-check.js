// Unit-style check of the lockout env validator.
const { getMaxAttempts, getLockMinutes } = require('../config/lockConfig');
let bad = 0;
const eq = (got, want, label) => {
  const ok = got === want;
  console.log(`${ok ? 'PASS' : 'FAIL'} ${label} -> ${got}`);
  if (!ok) bad++;
};
for (const v of [undefined, '', 'abc', '-1', '0', '2.5', 'Infinity', 'NaN', ' ']) {
  eq(getMaxAttempts({ LOGIN_MAX_ATTEMPTS: v }), 5, `LOGIN_MAX_ATTEMPTS=${JSON.stringify(v)} uses default 5`);
  eq(getLockMinutes({ LOGIN_LOCK_MINUTES: v }), 15, `LOGIN_LOCK_MINUTES=${JSON.stringify(v)} uses default 15`);
}
eq(getMaxAttempts({ LOGIN_MAX_ATTEMPTS: '3' }), 3, "LOGIN_MAX_ATTEMPTS='3'");
eq(getLockMinutes({ LOGIN_LOCK_MINUTES: '3' }), 3, "LOGIN_LOCK_MINUTES='3'");
process.exit(bad ? 1 : 0);
