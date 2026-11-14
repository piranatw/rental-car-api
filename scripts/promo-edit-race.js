// Apply vs date-edit race: the final price must always follow the FINAL dates, whatever the interleaving.
// Talks to the running test server over HTTP. Usage: node scripts/promo-edit-race.js
const mongoose = require('mongoose');
const User = require('../models/User');
const Provider = require('../models/Provider');
const Booking = require('../models/Booking');
const PromoCode = require('../models/PromoCode');
const PromoRedemption = require('../models/PromoRedemption');

const base = `http://localhost:${process.env.PORT || 5050}`;
const noq = (process.env.MONGO_URI || '').split('?')[0];
if (!noq.endsWith('_test')) {
  console.error('Refusing to run: MONGO_URI database name must end with _test');
  process.exit(1);
}
if (!process.env.adminEmail || !process.env.adminPassword) {
  console.error('adminEmail and adminPassword must be set. Run: source config/test-env.sh');
  process.exit(1);
}
const ROUNDS = 15;
const RATE = 1000;
const DAY = 86400000;
const suffix = `${Date.now().toString(36)}${Math.floor(Math.random() * 1e6).toString(36)}`.toUpperCase();

const call = async (method, path, token, body) => {
  const res = await fetch(base + path, {
    method,
    headers: { 'Content-Type': 'application/json', ...(token ? { Authorization: `Bearer ${token}` } : {}) },
    body: body === undefined ? undefined : JSON.stringify(body)
  });
  if (res.status === 429) throw new Error(`Got 429 on ${method} ${path}: the IP limiter is active`);
  if (res.status >= 500) throw new Error(`Got ${res.status} on ${method} ${path}`);
  let json = null;
  try { json = await res.json(); } catch (e) { /* non-JSON */ }
  return { status: res.status, body: json };
};
const iso = (d) => new Date(Date.now() + d * DAY).toISOString();
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

const failures = [];
const check = (ok, label) => {
  console.log(`${ok ? 'PASS' : 'FAIL'} ${label}`);
  if (!ok) failures.push(label);
};

(async () => {
  await mongoose.connect(process.env.MONGO_URI, { serverSelectionTimeoutMS: 3000 });
  const userIds = [];
  let providerId = null;
  let promoId = null;
  try {
    const login = await call('POST', '/api/v1/auth/login', null, { email: process.env.adminEmail, password: process.env.adminPassword });
    if (login.status !== 200) throw new Error('admin login failed: ' + login.status);
    const adminToken = login.body.token;
    const prov = await call('POST', '/api/v1/providers', adminToken, { name: 'Edit Race Provider', address: '6 Race Road', tel: '020000006', dailyRate: RATE });
    if (prov.status !== 201) throw new Error('provider create failed: ' + prov.status);
    providerId = prov.body.data._id;
    const code = `EDITRACE${suffix}`;
    const pr = await call('POST', '/api/v1/promos', adminToken, { code, type: 'percentage', value: 10, validFrom: iso(-1), validTo: iso(1), maxRedemptions: 1000 });
    if (pr.status !== 201) throw new Error('promo create failed: ' + pr.status);
    promoId = pr.body.data._id;

    const users = await Promise.all(Array.from({ length: ROUNDS }, async (_, i) => {
      const r = await call('POST', '/api/v1/auth/register', null, { name: 'Edit', telephone: '0811111111', email: `editrace${suffix}${i}@example.com`, password: 'secret123' });
      if (r.status !== 201) throw new Error('register failed: ' + r.status);
      userIds.push(r.body.data.id);
      return r.body.token;
    }));

    let bad = 0;
    let badStatus = 0;
    let badCounters = 0;
    const counterSamples = [];
    const samples = [];
    for (let i = 0; i < ROUNDS; i++) {
      const token = users[i];
      const start = Date.now() + 10 * DAY; // fixed instant: whole-day spans, no ceil() surprises
      const at = (days) => new Date(start + days * DAY).toISOString();
      const b = await call('POST', `/api/v1/providers/${providerId}/bookings`, token, { date: at(0), returnDate: at(2) });
      if (b.status !== 201) throw new Error('booking create failed: ' + b.status);
      const id = b.body.data._id;
      const put = () => call('PUT', `/api/v1/bookings/${id}`, token, { returnDate: at(5) });
      const apply = () => call('POST', `/api/v1/bookings/${id}/promo`, token, { code });
      let rs;
      if (i % 2 === 0) rs = await Promise.all([apply(), put()]);
      else {
        // The edit goes out slightly earlier than the apply.
        const p = put();
        await sleep(i % 4 === 1 ? 0 : 3);
        rs = await Promise.all([apply(), p]);
      }
      const [a, p] = rs;
      const clean = (r) => r.status === 200 || (r.status >= 400 && r.status < 500);
      if (!clean(a) || !clean(p)) badStatus += 1;
      const g = await call('GET', `/api/v1/bookings/${id}`, token);
      const d = g.body.data;
      const days = Math.max(1, Math.ceil((new Date(d.returnDate) - new Date(d.date)) / DAY));
      const subtotal = RATE * days;
      const expDiscount = a.status === 200 ? subtotal * 0.1 : 0;
      const ok = d.promo === (a.status === 200 ? promoId : null) && d.discount === expDiscount && d.totalPrice === subtotal - expDiscount;
      // Counters must agree once the race settles: redemptionCount == redemption rows == sum of usage.
      const pd = await PromoCode.findById(promoId).lean();
      const rows = await PromoRedemption.countDocuments({ promo: promoId });
      const usageSum = Object.values(pd.usage || {}).reduce((x, y) => x + y, 0);
      if (!(pd.redemptionCount === rows && rows === usageSum)) {
        badCounters += 1;
        if (counterSamples.length < 3) counterSamples.push(`round ${i}: count=${pd.redemptionCount} rows=${rows} usageSum=${usageSum}`);
      }
      if (!ok) {
        bad += 1;
        if (samples.length < 3) samples.push(`apply=${a.status} put=${p.status} days=${days} discount=${d.discount} total=${d.totalPrice}`);
      }
    }
    check(badStatus === 0, `${ROUNDS} rounds: apply and edit each answer 200 or a clean 4xx (${badStatus} unclean)`);
    check(bad === 0, `${ROUNDS} rounds: promo, discount and totalPrice always match the FINAL dates (${bad} inconsistent)`);
    check(badCounters === 0, `${ROUNDS} rounds: redemptionCount == redemption rows == sum of usage after every round (${badCounters} mismatches)`);
    counterSamples.forEach((c) => console.log('  counters: ' + c));
    samples.forEach((s) => console.log('  inconsistent: ' + s));
  } catch (e) {
    console.error('promo-edit-race error: ' + e.message);
    failures.push('error: ' + e.message);
  } finally {
    try {
      await PromoRedemption.deleteMany({ promo: promoId });
      await PromoCode.deleteMany({ _id: promoId });
      await Booking.deleteMany({ $or: [{ user: { $in: userIds } }, { provider: providerId }] });
      await User.deleteMany({ _id: { $in: userIds } });
      if (providerId) await Provider.deleteOne({ _id: providerId });
    } catch (e) {
      console.error('cleanup error: ' + e.message);
    }
    await mongoose.disconnect();
  }
  if (failures.length) {
    console.error(`promo-edit-race: ${failures.length} violation(s)`);
    process.exit(1);
  }
})();
