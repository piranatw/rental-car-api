// Concurrency checks for promo redemption: parallel applies must never exceed any limit.
// Talks to the running test server over HTTP (Promise.all) and reads the _test database.
// Usage: node scripts/promo-race.js   (MONGO_URI, PORT, adminEmail, adminPassword in env; server up)
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

const PW = 'secret123';
const EXHAUSTED = 'Promo code has reached its maximum redemptions';
const PER_USER = 'You have reached the per-user limit for this promo code';
const HAS_PROMO = 'Booking already has a promo code';
const suffix = `${Date.now().toString(36)}${Math.floor(Math.random() * 1e6).toString(36)}`.toUpperCase();

const call = async (method, path, token, body) => {
  const res = await fetch(base + path, {
    method,
    headers: { 'Content-Type': 'application/json', ...(token ? { Authorization: `Bearer ${token}` } : {}) },
    body: body === undefined ? undefined : JSON.stringify(body)
  });
  if (res.status === 429) throw new Error(`Got 429 on ${method} ${path}: the IP limiter is active (is RATE_LIMIT_FORCE exported?)`);
  if (res.status >= 500) throw new Error(`Got ${res.status} on ${method} ${path}`);
  let json = null;
  try { json = await res.json(); } catch (e) { /* non-JSON body */ }
  return { status: res.status, body: json };
};

const failures = [];
const check = (ok, label) => {
  console.log(`${ok ? 'PASS' : 'FAIL'} ${label}`);
  if (!ok) failures.push(label);
};

const tally = (rs) => {
  const t = { ok: 0, byMsg: {}, other: 0 };
  rs.forEach((r) => {
    if (r.status === 200) t.ok += 1;
    else if (r.status === 400) t.byMsg[r.body && r.body.message] = (t.byMsg[r.body && r.body.message] || 0) + 1;
    else t.other += 1;
  });
  return t;
};

const iso = (offsetDays) => new Date(Date.now() + offsetDays * 86400000).toISOString();

(async () => {
  await mongoose.connect(process.env.MONGO_URI, { serverSelectionTimeoutMS: 3000 });
  const userIds = [];
  const promoIds = [];
  let providerId = null;
  try {
    const login = await call('POST', '/api/v1/auth/login', null, { email: process.env.adminEmail, password: process.env.adminPassword });
    if (login.status !== 200) throw new Error('admin login failed: ' + login.status);
    const admin = { token: login.body.token, id: login.body.data.id };

    const prov = await call('POST', '/api/v1/providers', admin.token, {
      name: 'Race Provider', address: '3 Race Road', tel: '020000003', dailyRate: 1000
    });
    if (prov.status !== 201) throw new Error('provider create failed: ' + prov.status);
    providerId = prov.body.data._id;

    const newUser = async (i) => {
      const email = `promorace${suffix}${i}@example.com`;
      const r = await call('POST', '/api/v1/auth/register', null, { name: 'Race', telephone: '0811111111', email, password: PW });
      if (r.status !== 201) throw new Error('register failed: ' + r.status);
      userIds.push(r.body.data.id);
      return { token: r.body.token, id: r.body.data.id };
    };
    const newBooking = async (token) => {
      const r = await call('POST', `/api/v1/providers/${providerId}/bookings`, token, { date: iso(10), returnDate: iso(12) });
      if (r.status !== 201) throw new Error('booking create failed: ' + r.status);
      return { id: r.body.data._id, subtotal: r.body.data.totalPrice };
    };
    const newPromo = async (tag, maxRedemptions, perUserLimit) => {
      const code = `RACE${tag}${suffix}`;
      const body = { code, type: 'percentage', value: 10, validFrom: iso(-1), validTo: iso(1), maxRedemptions };
      if (perUserLimit) body.perUserLimit = perUserLimit;
      const r = await call('POST', '/api/v1/promos', admin.token, body);
      if (r.status !== 201) throw new Error('promo create failed: ' + r.status);
      promoIds.push(r.body.data._id);
      return { code, id: r.body.data._id };
    };
    const apply = (b, code) => call('POST', `/api/v1/bookings/${b.id}/promo`, b.token, { code });
    // Every booking that got a 400 must be untouched.
    const untouched = async (items, label) => {
      let bad = 0;
      await Promise.all(items.map(async (b) => {
        const r = await call('GET', `/api/v1/bookings/${b.id}`, b.token);
        const d = r.body && r.body.data;
        if (!d || d.promo !== null || d.discount !== 0 || d.totalPrice !== b.subtotal) bad += 1;
      }));
      check(bad === 0, `${label}: every rejected booking keeps promo null, discount 0, totalPrice = subtotal (${items.length} checked, ${bad} changed)`);
    };
    const promoState = async (id) => {
      const d = await PromoCode.findById(id).lean();
      const reds = await PromoRedemption.countDocuments({ promo: id });
      return { count: d.redemptionCount, reds, usage: d.usage || {} };
    };

    // (i) Global limit: maxRedemptions 1, 20 users, one booking each.
    {
      const users = await Promise.all(Array.from({ length: 20 }, (_, i) => newUser(`a${i}`)));
      const bs = await Promise.all(users.map(async (u) => ({ ...u, ...(await newBooking(u.token)) })));
      const promo = await newPromo('A', 1);
      const rs = await Promise.all(bs.map((b) => apply(b, promo.code)));
      const t = tally(rs);
      check(t.ok === 1 && t.byMsg[EXHAUSTED] === 19 && t.other === 0, `(i) 20 parallel applies, max 1: ${t.ok} x 200, ${t.byMsg[EXHAUSTED] || 0} x exhausted, ${t.other} other`);
      const s = await promoState(promo.id);
      check(s.count === 1 && s.reds === 1, `(i) redemptionCount=${s.count}, redemption rows=${s.reds} (both must be 1)`);
      const list = await call('GET', '/api/v1/promos', admin.token);
      const listed = list.body.data.find((p) => p._id === promo.id);
      check(listed && listed.redemptionCount === 1, '(i) GET /promos shows redemptionCount 1');
      await untouched(bs.filter((_, i) => rs[i].status !== 200), '(i)');
    }

    // (ii) maxRedemptions 5, 30 users.
    {
      const users = await Promise.all(Array.from({ length: 30 }, (_, i) => newUser(`b${i}`)));
      const bs = await Promise.all(users.map(async (u) => ({ ...u, ...(await newBooking(u.token)) })));
      const promo = await newPromo('B', 5);
      const rs = await Promise.all(bs.map((b) => apply(b, promo.code)));
      const t = tally(rs);
      check(t.ok === 5 && t.byMsg[EXHAUSTED] === 25 && t.other === 0, `(ii) 30 parallel applies, max 5: ${t.ok} x 200, ${t.byMsg[EXHAUSTED] || 0} x exhausted, ${t.other} other`);
      const s = await promoState(promo.id);
      check(s.count === 5 && s.reds === 5, `(ii) redemptionCount=${s.count}, redemption rows=${s.reds} (both must be 5)`);
      await untouched(bs.filter((_, i) => rs[i].status !== 200), '(ii)');
    }

    // (iii) Per-user limit: one user (the admin has no booking cap), 10 bookings, 10 parallel applies.
    {
      const bs = [];
      for (let i = 0; i < 10; i++) bs.push({ ...admin, ...(await newBooking(admin.token)) });
      const promo = await newPromo('C', 1000, 1);
      const rs = await Promise.all(bs.map((b) => apply(b, promo.code)));
      const t = tally(rs);
      check(t.ok === 1 && t.byMsg[PER_USER] === 9 && t.other === 0, `(iii) 10 parallel applies, perUserLimit 1: ${t.ok} x 200, ${t.byMsg[PER_USER] || 0} x per-user, ${t.other} other`);
      const s = await promoState(promo.id);
      check(s.count === 1 && s.reds === 1 && s.usage[admin.id] === 1, `(iii) redemptionCount=${s.count}, redemption rows=${s.reds}, user usage=${s.usage[admin.id]} (all must be 1)`);
      await untouched(bs.filter((_, i) => rs[i].status !== 200), '(iii)');
    }

    // (iv) Same booking, 10 parallel applies by its owner.
    {
      const u = await newUser('d');
      const b = { ...u, ...(await newBooking(u.token)) };
      const promo = await newPromo('D', 1000);
      const rs = await Promise.all(Array.from({ length: 10 }, () => apply(b, promo.code)));
      const t = tally(rs);
      check(t.ok === 1 && t.byMsg[HAS_PROMO] === 9 && t.other === 0, `(iv) 10 parallel applies to one booking: ${t.ok} x 200, ${t.byMsg[HAS_PROMO] || 0} x already-has-promo, ${t.other} other`);
      const s = await promoState(promo.id);
      check(s.count === 1 && s.reds === 1, `(iv) redemptionCount=${s.count}, redemption rows=${s.reds} (both must be 1)`);
      const g = await call('GET', `/api/v1/bookings/${b.id}`, u.token);
      check(g.body.data.discount === 200 && g.body.data.totalPrice === b.subtotal - 200, '(iv) the booking carries exactly one 10% discount');
    }
  } catch (e) {
    console.error('promo-race error: ' + e.message);
    failures.push('error: ' + e.message);
  } finally {
    try {
      await PromoRedemption.deleteMany({ promo: { $in: promoIds } });
      await PromoCode.deleteMany({ _id: { $in: promoIds } });
      await Booking.deleteMany({ $or: [{ user: { $in: userIds } }, { provider: providerId }] });
      await User.deleteMany({ _id: { $in: userIds } });
      if (providerId) await Provider.deleteOne({ _id: providerId });
    } catch (e) {
      console.error('cleanup error: ' + e.message);
    }
    await mongoose.disconnect();
  }
  if (failures.length) {
    console.error(`promo-race: ${failures.length} violation(s)`);
    process.exit(1);
  }
})();
