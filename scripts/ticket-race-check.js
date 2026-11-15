// Concurrency checks for ticket comments. Talks to the running test server over HTTP
// (Promise.all) and creates its own throwaway users, bookings and tickets in the _test database.
//   (i)   one admin status flip to 'resolved' fired together with 20 user comments, repeated over
//         several fresh tickets: no comment may be stored after the flip (the flip response is the
//         ticket as it was at that instant, so the final comments must equal that snapshot), every
//         comment answered 200 is stored, none answered 400 is stored, a later comment is 400,
//         and the ticket ends resolved;
//   (ii)  30 parallel comments on an open ticket: all 200, all 30 stored, distinct _id and createdAt;
//   (iii) the 200-comment cap: a ticket holding 199 comments gets 10 parallel comments: exactly one
//         200, nine 400 and exactly 200 stored.
// Usage: node scripts/ticket-race-check.js   (MONGO_URI, PORT, adminEmail, adminPassword in env; server up)
// Prints counts only. Any 429 or 5xx aborts the run; any violation exits non-zero.
const mongoose = require('mongoose');
const User = require('../models/User');
const Provider = require('../models/Provider');
const Booking = require('../models/Booking');
const Ticket = require('../models/Ticket');

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
const ROUNDS = 25;
const suffix = `${Date.now().toString(36)}${Math.floor(Math.random() * 1e6).toString(36)}`;
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

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

const iso = (days) => new Date(Date.now() + days * 86400000).toISOString();

(async () => {
  await mongoose.connect(process.env.MONGO_URI, { serverSelectionTimeoutMS: 3000 });
  const userIds = [];
  let providerId = null;
  try {
    const login = await call('POST', '/api/v1/auth/login', null, { email: process.env.adminEmail, password: process.env.adminPassword });
    if (login.status !== 200) throw new Error('admin login failed: ' + login.status);
    const admin = { token: login.body.token };

    const prov = await call('POST', '/api/v1/providers', admin.token, {
      name: 'Ticket Race Provider', address: '4 Race Road', tel: '020000004', dailyRate: 1000
    });
    if (prov.status !== 201) throw new Error('provider create failed: ' + prov.status);
    providerId = prov.body.data._id;

    const reg = await call('POST', '/api/v1/auth/register', null, {
      name: 'Race', telephone: '0811111111', email: `ticketrace${suffix}@example.com`, password: PW
    });
    if (reg.status !== 201) throw new Error('register failed: ' + reg.status);
    userIds.push(reg.body.data.id);
    const user = { token: reg.body.token, id: reg.body.data.id };
    const bk = await call('POST', `/api/v1/providers/${providerId}/bookings`, user.token, { date: iso(10), returnDate: iso(12) });
    if (bk.status !== 201) throw new Error('booking create failed: ' + bk.status);

    const newTicket = async () => {
      const r = await call('POST', '/api/v1/tickets', user.token, {
        booking: bk.body.data._id, category: 'other', subject: `race ${suffix}`, description: 'race'
      });
      if (r.status !== 201) throw new Error('ticket create failed: ' + r.status);
      return r.body.data._id;
    };
    const comment = (id, text) => call('POST', `/api/v1/tickets/${id}/comments`, user.token, { text });
    const stored = async (id) => {
      const r = await call('GET', `/api/v1/tickets/${id}`, admin.token);
      if (r.status !== 200) throw new Error('ticket read failed: ' + r.status);
      return r.body.data;
    };

    // (i) status flip racing 20 comments, over several fresh tickets.
    {
      let afterFlip = 0;
      let ackedMissing = 0;
      let rejectedStored = 0;
      let notResolved = 0;
      let lateNot400 = 0;
      let odd = 0;
      let acked = 0;
      let rejected = 0;
      for (let round = 0; round < ROUNDS; round++) {
        const id = await newTicket();
        const texts = Array.from({ length: 20 }, (_, i) => `r${round}c${i}`);
        // The flip starts 0-5 ms into the burst so it lands among the comments.
        const flip = (async () => {
          await sleep(round % 6);
          return call('PUT', `/api/v1/tickets/${id}/status`, admin.token, { status: 'resolved' });
        })();
        const [flipRes, ...results] = await Promise.all([flip, ...texts.map((t) => comment(id, t))]);
        if (flipRes.status !== 200) throw new Error('status flip failed: ' + flipRes.status);
        const atFlip = new Set(flipRes.body.data.comments.map((c) => c._id));
        const final = await stored(id);
        const finalTexts = new Set(final.comments.map((c) => c.text));
        // Anything in the final list that was not in the ticket when the flip applied came after it.
        afterFlip += final.comments.filter((c) => !atFlip.has(c._id)).length;
        results.forEach((r, i) => {
          if (r.status === 200) {
            acked += 1;
            if (!finalTexts.has(texts[i])) ackedMissing += 1;
          } else if (r.status === 400 && r.body && r.body.message === 'Ticket is resolved') {
            rejected += 1;
            if (finalTexts.has(texts[i])) rejectedStored += 1;
          } else {
            odd += 1;
          }
        });
        if (final.status !== 'resolved') notResolved += 1;
        const late = await comment(id, 'after the flip');
        if (late.status !== 400 || late.body.message !== 'Ticket is resolved') lateNot400 += 1;
      }
      console.log(`(i) ${ROUNDS} rounds x (1 flip + 20 comments): ${acked} acknowledged, ${rejected} rejected as resolved`);
      check(odd === 0, `(i) every comment answered 200 or 400 'Ticket is resolved' (${odd} other)`);
      check(afterFlip === 0, `(i) comments stored after the status flip: ${afterFlip} (must be 0)`);
      check(ackedMissing === 0, `(i) acknowledged comments missing from the ticket: ${ackedMissing} (must be 0)`);
      check(rejectedStored === 0, `(i) rejected comments present in the ticket: ${rejectedStored} (must be 0)`);
      check(notResolved === 0, `(i) tickets not ending resolved: ${notResolved} (must be 0)`);
      check(lateNot400 === 0, `(i) comments admitted after the flip settled: ${lateNot400} (must be 0)`);
    }

    // (ii) 30 parallel comments on an open ticket: no lost update.
    {
      const id = await newTicket();
      const texts = Array.from({ length: 30 }, (_, i) => `p${i}`);
      const rs = await Promise.all(texts.map((t) => comment(id, t)));
      const ok = rs.filter((r) => r.status === 200).length;
      const final = await stored(id);
      const ids = new Set(final.comments.map((c) => c._id));
      const stamps = new Set(final.comments.map((c) => c.createdAt));
      const have = new Set(final.comments.map((c) => c.text));
      console.log(`(ii) 30 parallel comments: ${ok} x 200, ${final.comments.length} stored`);
      check(ok === 30, `(ii) all 30 answered 200 (${ok})`);
      check(final.comments.length === 30 && texts.every((t) => have.has(t)), `(ii) all 30 stored, none lost (${final.comments.length} stored)`);
      check(ids.size === 30 && stamps.size === 30, `(ii) distinct _id (${ids.size}) and createdAt (${stamps.size})`);
    }

    // (iii) the 200-comment cap under 10 parallel comments from 199.
    {
      const id = await newTicket();
      const seeded = Array.from({ length: 199 }, (_, i) => ({
        _id: new mongoose.Types.ObjectId(), author: new mongoose.Types.ObjectId(user.id), role: 'user',
        text: `seed${i}`, createdAt: new Date(Date.now() - (200 - i) * 1000)
      }));
      await Ticket.collection.updateOne({ _id: new mongoose.Types.ObjectId(id) }, { $set: { comments: seeded } });
      const rs = await Promise.all(Array.from({ length: 10 }, (_, i) => comment(id, `cap${i}`)));
      const ok = rs.filter((r) => r.status === 200).length;
      const capped = rs.filter((r) => r.status === 400 && r.body.message === 'Ticket has reached the maximum number of comments').length;
      const final = await stored(id);
      console.log(`(iii) 10 parallel comments at 199: ${ok} x 200, ${capped} x cap-reached, ${final.comments.length} stored`);
      check(ok === 1 && capped === 9, `(iii) exactly one 200 and nine 400 (${ok} x 200, ${capped} x 400)`);
      check(final.comments.length === 200, `(iii) exactly 200 comments stored (${final.comments.length})`);
    }
  } catch (e) {
    console.error('ticket-race-check error: ' + e.message);
    failures.push('error: ' + e.message);
  } finally {
    try {
      await Ticket.deleteMany({ user: { $in: userIds } });
      await Booking.deleteMany({ $or: [{ user: { $in: userIds } }, { provider: providerId }] });
      await User.deleteMany({ _id: { $in: userIds } });
      if (providerId) await Provider.deleteOne({ _id: providerId });
    } catch (e) {
      console.error('cleanup error: ' + e.message);
    }
    await mongoose.disconnect();
  }
  if (failures.length) {
    console.error(`ticket-race-check: ${failures.length} violation(s)`);
    process.exit(1);
  }
})();
