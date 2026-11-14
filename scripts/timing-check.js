// Timing oracle check: wrong password on a real unlocked account must cost the same as an
// unknown email (and a locked account). Talks to the running test server over HTTP.
// Usage: node scripts/timing-check.js   (PORT in env; server already up)
const base = `http://localhost:${process.env.PORT || 5050}`;
const SAMPLES = 40;
const PW = 'secret123';
const BAD = 'wrongpass1';

const post = async (path, body) => {
  const t0 = performance.now();
  const res = await fetch(base + path, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(body)
  });
  await res.text();
  const ms = performance.now() - t0;
  if (res.status === 429) throw new Error('Got 429: the IP limiter is active (is RATE_LIMIT_FORCE exported?)');
  return { status: res.status, ms };
};
const login = (email, password) => post('/api/v1/auth/login', { email, password });
const median = (a) => [...a].sort((x, y) => x - y)[Math.floor(a.length / 2)];
const uniq = (tag) => `timing${tag}${Date.now()}${Math.floor(Math.random() * 1e9)}@example.com`;
const register = async (email) => {
  const r = await post('/api/v1/auth/register', { name: 'Timing', telephone: '0811111111', email, password: PW });
  if (r.status !== 201) throw new Error('register failed: ' + r.status);
};

(async () => {
  const lockedEmail = uniq('locked');
  await register(lockedEmail);
  for (let i = 0; i < 5; i++) await login(lockedEmail, BAD);
  // warm-up
  for (let i = 0; i < 5; i++) { await login(uniq('warm'), BAD); await login(lockedEmail, PW); }

  const unknown = [], locked = [], wrong = [];
  for (let i = 0; i < SAMPLES; i++) {
    const fresh = uniq('real');
    await register(fresh); // fresh user per sample so it never reaches the lock
    const a = await login(uniq('ghost'), BAD);
    const b = await login(lockedEmail, PW);
    const c = await login(fresh, BAD);
    if (a.status !== 401 || b.status !== 401 || c.status !== 401) throw new Error(`unexpected status ${a.status}/${b.status}/${c.status}`);
    unknown.push(a.ms); locked.push(b.ms); wrong.push(c.ms);
  }
  const mu = median(unknown), ml = median(locked), mw = median(wrong);
  console.log(`median ms  unknown email: ${mu.toFixed(1)}  locked account: ${ml.toFixed(1)}  wrong password (real, unlocked): ${mw.toFixed(1)}`);
  const allowed = Math.max(15, mu * 0.15);
  const gap = mw - mu;
  const lockedGap = Math.abs(ml - mu);
  const ok = gap <= allowed && lockedGap <= allowed;
  console.log(`${ok ? 'PASS' : 'FAIL'} wrong-password minus unknown = ${gap.toFixed(1)} ms, locked minus unknown = ${(ml - mu).toFixed(1)} ms (allowed ${allowed.toFixed(1)} ms)`);
  process.exit(ok ? 0 : 1);
})().catch((e) => {
  console.error('timing-check error: ' + e.message);
  process.exit(1);
});
