// Schema rules checked with validateSync(), which needs no database connection.
const test = require('node:test');
const assert = require('node:assert/strict');
const mongoose = require('mongoose');
const bcrypt = require('bcryptjs');
const jwt = require('jsonwebtoken');

process.env.JWT_SECRET = 'unit-test-secret';
process.env.JWT_EXPIRE = '1h';

const User = require('../../models/User');
const Provider = require('../../models/Provider');
const Booking = require('../../models/Booking');
const PromoCode = require('../../models/PromoCode');
const Ticket = require('../../models/Ticket');
const Inspection = require('../../models/Inspection');
const RevokedToken = require('../../models/RevokedToken');

const oid = () => new mongoose.Types.ObjectId();
const messages = (doc) => {
  const err = doc.validateSync();
  return err ? Object.values(err.errors).map((e) => e.message) : [];
};

// ---------- User ----------
const validUser = (over = {}) => ({ name: 'Somchai', telephone: '0812345678', email: 'a@b.co', password: 'secret1', ...over });

test('a complete user is valid and defaults to role user', () => {
  const u = new User(validUser());
  assert.deepEqual(messages(u), []);
  assert.equal(u.role, 'user');
  assert.equal(u.failedLoginAttempts, 0);
});

test('user: each required field has its own message', () => {
  const msgs = messages(new User({}));
  for (const expected of ['Please add a name', 'Please add a telephone number', 'Please add an email', 'Please add a password']) {
    assert.ok(msgs.includes(expected), expected);
  }
});

test('user: the email is lower-cased and trimmed', () => {
  assert.equal(new User(validUser({ email: '  Somchai@Example.COM ' })).email, 'somchai@example.com');
});

test('user: malformed emails are rejected', () => {
  for (const email of ['plain', 'a@b', '@b.co', 'a b@c.co', 'a@b .co']) {
    assert.deepEqual(messages(new User(validUser({ email }))), ['Please add a valid email'], email);
  }
});

test('user: a password shorter than 6 characters is rejected', () => {
  assert.deepEqual(messages(new User(validUser({ password: '12345' }))), ['Password must be at least 6 characters']);
  assert.deepEqual(messages(new User(validUser({ password: '123456' }))), []);
});

test('user: only user and admin are valid roles', () => {
  assert.deepEqual(messages(new User(validUser({ role: 'admin' }))), []);
  assert.equal(messages(new User(validUser({ role: 'superuser' }))).length, 1);
});

test('user: password and lockout fields are excluded from queries by default', () => {
  for (const field of ['password', 'failedLoginAttempts', 'lockUntil']) {
    assert.equal(User.schema.path(field).options.select, false, field);
  }
});

test('user: matchPassword compares against the stored bcrypt hash', async () => {
  const u = new User(validUser());
  u.password = await bcrypt.hash('secret1', 4);
  assert.equal(await u.matchPassword('secret1'), true);
  assert.equal(await u.matchPassword('secret2'), false);
  assert.equal(await u.matchPassword(''), false);
});

test('user: the signed token carries the id and a unique jti', () => {
  const u = new User(validUser());
  const a = jwt.verify(u.getSignedJwtToken(), process.env.JWT_SECRET);
  const b = jwt.verify(u.getSignedJwtToken(), process.env.JWT_SECRET);
  assert.equal(a.id, String(u._id));
  assert.ok(a.jti && b.jti);
  assert.notEqual(a.jti, b.jti, 'two tokens for the same user must differ');
  assert.ok(a.exp > a.iat);
});

// ---------- Provider ----------
const validProvider = (over = {}) => ({ name: 'Alpha', address: '1 Road', tel: '020000001', ...over });

test('provider: only name, address and tel are required, rates default to 0', () => {
  const p = new Provider(validProvider());
  assert.deepEqual(messages(p), []);
  assert.equal(p.dailyRate, 0);
  assert.equal(p.lateFeePerHour, 0);
});

test('provider: required field messages', () => {
  const msgs = messages(new Provider({}));
  assert.deepEqual(msgs.sort(), ['Please add a name', 'Please add a telephone number', 'Please add an address'].sort());
});

test('provider: negative rates are rejected, zero is allowed', () => {
  assert.deepEqual(messages(new Provider(validProvider({ dailyRate: -1 }))), ['dailyRate must be at least 0']);
  assert.deepEqual(messages(new Provider(validProvider({ lateFeePerHour: -0.5 }))), ['lateFeePerHour must be at least 0']);
  assert.deepEqual(messages(new Provider(validProvider({ dailyRate: 0, lateFeePerHour: 0 }))), []);
});

test('provider: the name is trimmed', () => {
  assert.equal(new Provider(validProvider({ name: '  Alpha Rentals  ' })).name, 'Alpha Rentals');
});

// ---------- Booking ----------
const validBooking = (over = {}) => ({
  user: oid(),
  provider: oid(),
  date: new Date('2026-12-01T00:00:00Z'),
  returnDate: new Date('2026-12-03T00:00:00Z'),
  ...over
});

test('booking: a complete booking is valid with no promo and no discount', () => {
  const b = new Booking(validBooking());
  assert.deepEqual(messages(b), []);
  assert.equal(b.promo, null);
  assert.equal(b.discount, 0);
  assert.equal(b.totalPrice, 0);
});

test('booking: the return date may equal the pickup date but not precede it', () => {
  const same = new Date('2026-12-01T00:00:00Z');
  assert.deepEqual(messages(new Booking(validBooking({ date: same, returnDate: same }))), []);
  assert.deepEqual(
    messages(new Booking(validBooking({ returnDate: new Date('2026-11-30T23:59:59Z') }))),
    ['returnDate must not be before date']
  );
});

test('booking: dates, user and provider are required', () => {
  const msgs = messages(new Booking({}));
  assert.ok(msgs.includes('Please add a pickup date'));
  assert.ok(msgs.includes('Please add a return date'));
  assert.ok(msgs.some((m) => /user/i.test(m)));
  assert.ok(msgs.some((m) => /provider/i.test(m)));
});

test('booking: a negative total price is rejected', () => {
  assert.equal(messages(new Booking(validBooking({ totalPrice: -1 }))).length, 1);
});

test('booking: an index on date and provider serves the statistics report', () => {
  const keys = Booking.schema.indexes().map(([k]) => Object.keys(k).join(','));
  assert.ok(keys.includes('date,provider'));
});

// ---------- PromoCode ----------
const validPromo = (over = {}) => ({
  code: 'save10',
  type: 'percentage',
  value: 10,
  validFrom: new Date('2026-01-01'),
  validTo: new Date('2026-12-31'),
  maxRedemptions: 5,
  ...over
});

test('promo: a complete code is valid and stored upper-case', () => {
  const p = new PromoCode(validPromo({ code: '  save10 ' }));
  assert.deepEqual(messages(p), []);
  assert.equal(p.code, 'SAVE10');
  assert.equal(p.redemptionCount, 0);
});

test('promo: type must be percentage or fixed', () => {
  assert.deepEqual(messages(new PromoCode(validPromo({ type: 'bogus' }))), ['type must be percentage or fixed']);
  assert.deepEqual(messages(new PromoCode(validPromo({ type: 'fixed', value: 50 }))), []);
});

test('promo: the value must be above 0, and a percentage at most 100', () => {
  assert.deepEqual(messages(new PromoCode(validPromo({ value: 0 }))), ['value must be greater than 0']);
  assert.deepEqual(messages(new PromoCode(validPromo({ value: -5 }))), ['value must be greater than 0']);
  assert.deepEqual(messages(new PromoCode(validPromo({ value: 100.01 }))), ['A percentage value must not exceed 100']);
  assert.deepEqual(messages(new PromoCode(validPromo({ value: 100 }))), []);
  assert.deepEqual(messages(new PromoCode(validPromo({ type: 'fixed', value: 5000 }))), []);
});

test('promo: validTo must not be before validFrom', () => {
  assert.deepEqual(
    messages(new PromoCode(validPromo({ validFrom: new Date('2026-06-02'), validTo: new Date('2026-06-01') }))),
    ['validTo must not be before validFrom']
  );
  const day = new Date('2026-06-01');
  assert.deepEqual(messages(new PromoCode(validPromo({ validFrom: day, validTo: day }))), []);
});

test('promo: maxRedemptions is an integer of at least 1', () => {
  assert.deepEqual(messages(new PromoCode(validPromo({ maxRedemptions: 0 }))), ['maxRedemptions must be at least 1']);
  assert.deepEqual(messages(new PromoCode(validPromo({ maxRedemptions: 2.5 }))), ['maxRedemptions must be an integer']);
});

test('promo: perUserLimit is optional, but an integer of at least 1 when given', () => {
  assert.deepEqual(messages(new PromoCode(validPromo())), []);
  assert.deepEqual(messages(new PromoCode(validPromo({ perUserLimit: 1 }))), []);
  assert.deepEqual(messages(new PromoCode(validPromo({ perUserLimit: 0 }))), ['perUserLimit must be at least 1']);
  assert.deepEqual(messages(new PromoCode(validPromo({ perUserLimit: 1.5 }))), ['perUserLimit must be an integer']);
});

test('promo: usage starts as an empty object, not omitted', () => {
  const p = new PromoCode(validPromo());
  assert.deepEqual(p.usage, {});
  assert.deepEqual(p.toObject({ minimize: false }).usage, {});
});

// ---------- Ticket ----------
const validTicket = (over = {}) => ({
  user: oid(),
  booking: oid(),
  category: 'billing',
  subject: 'Question',
  description: 'Why?',
  ...over
});

test('ticket: a complete ticket is open with an empty thread', () => {
  const t = new Ticket(validTicket());
  assert.deepEqual(messages(t), []);
  assert.equal(t.status, 'open');
  assert.equal(t.comments.length, 0);
});

test('ticket: exposes its allowed categories and statuses', () => {
  assert.deepEqual(Ticket.CATEGORIES, ['billing', 'vehicle issue', 'other']);
  assert.deepEqual(Ticket.STATUSES, ['open', 'in progress', 'resolved']);
});

test('ticket: category and status are limited to their lists', () => {
  assert.equal(messages(new Ticket(validTicket({ category: 'refund' }))).length, 1);
  assert.equal(messages(new Ticket(validTicket({ status: 'closed' }))).length, 1);
  for (const status of Ticket.STATUSES) assert.deepEqual(messages(new Ticket(validTicket({ status }))), []);
});

test('ticket: a comment needs author, role, text and a time', () => {
  const t = new Ticket(validTicket({ comments: [{}] }));
  assert.equal(messages(t).length, 4);
  const ok = new Ticket(validTicket({ comments: [{ author: oid(), role: 'admin', text: 'Hi', createdAt: new Date() }] }));
  assert.deepEqual(messages(ok), []);
});

test('ticket: a comment role other than user or admin is rejected', () => {
  const t = new Ticket(validTicket({ comments: [{ author: oid(), role: 'guest', text: 'Hi', createdAt: new Date() }] }));
  assert.equal(messages(t).length, 1);
});

test('ticket: every list index ends in createdAt desc, _id desc', () => {
  const indexes = Ticket.schema.indexes().map(([k]) => Object.entries(k));
  assert.equal(indexes.length, 4);
  for (const idx of indexes) {
    assert.deepEqual(idx.slice(-2), [['createdAt', -1], ['_id', -1]]);
  }
});

// ---------- Inspection ----------
const validInspection = (over = {}) => ({
  booking: oid(),
  actualReturnTime: new Date('2026-12-05T09:30:00Z'),
  odometer: 45210,
  fuelLevel: 40,
  ...over
});

test('inspection: a complete report is valid and has no dispute', () => {
  const i = new Inspection(validInspection());
  assert.deepEqual(messages(i), []);
  assert.equal(i.dispute, null);
  assert.equal(i.damageNotes, '');
});

test('inspection: odometer is limited to 0 to 10,000,000', () => {
  assert.deepEqual(messages(new Inspection(validInspection({ odometer: -1 }))), ['odometer must be at least 0']);
  assert.deepEqual(messages(new Inspection(validInspection({ odometer: 10000001 }))), ['odometer must be at most 10000000']);
  assert.deepEqual(messages(new Inspection(validInspection({ odometer: 0 }))), []);
  assert.deepEqual(messages(new Inspection(validInspection({ odometer: 10000000 }))), []);
});

test('inspection: fuel level is limited to 0 to 100', () => {
  assert.deepEqual(messages(new Inspection(validInspection({ fuelLevel: -0.1 }))), ['fuelLevel must be at least 0']);
  assert.deepEqual(messages(new Inspection(validInspection({ fuelLevel: 100.1 }))), ['fuelLevel must be at most 100']);
  assert.deepEqual(messages(new Inspection(validInspection({ fuelLevel: 100 }))), []);
});

test('inspection: damage notes are capped at 5000 characters', () => {
  assert.deepEqual(messages(new Inspection(validInspection({ damageNotes: 'x'.repeat(5000) }))), []);
  assert.deepEqual(messages(new Inspection(validInspection({ damageNotes: 'x'.repeat(5001) }))), [
    'damageNotes must be at most 5000 characters'
  ]);
});

test('inspection: booking, return time, odometer and fuel are required', () => {
  const msgs = messages(new Inspection({}));
  for (const expected of ['Please add actualReturnTime', 'Please add the odometer reading', 'Please add the fuel level']) {
    assert.ok(msgs.includes(expected), expected);
  }
  assert.ok(msgs.some((m) => /booking/i.test(m)));
});

test('inspection: the booking field is unique, one report per booking', () => {
  assert.equal(Inspection.schema.path('booking').options.unique, true);
});

test('inspection: a dispute needs a comment, a time and a valid status', () => {
  const bad = new Inspection(validInspection({ dispute: { status: 'pending' } }));
  assert.ok(messages(bad).length >= 3);
  const ok = new Inspection(validInspection({ dispute: { comment: 'Was there', createdAt: new Date(), status: 'open' } }));
  assert.deepEqual(messages(ok), []);
  assert.equal(ok.dispute.resolvedAt, null);
  assert.equal(ok.dispute.resolutionNote, '');
});

// ---------- RevokedToken ----------
test('revoked token: stores only a hash and expires by itself', () => {
  assert.deepEqual(messages(new RevokedToken({})).sort(), [
    'Path `expiresAt` is required.',
    'Path `tokenHash` is required.'
  ]);
  assert.equal(RevokedToken.schema.path('tokenHash').options.unique, true);
  const ttl = RevokedToken.schema.indexes().find(([k]) => k.expiresAt);
  assert.equal(ttl[1].expireAfterSeconds, 0);
});
