const test = require('node:test');
const assert = require('node:assert/strict');
const { DAY_MS, round2, computeSubtotal, computeDiscount, priceOf } = require('../../utils/pricing');

const day = (n) => new Date(Date.UTC(2026, 11, n));

test('round2 keeps two decimals', () => {
  assert.equal(round2(1.005 * 100), 100.5);
  assert.equal(round2(10.126), 10.13);
  assert.equal(round2(10), 10);
  assert.equal(round2(0), 0);
});

test('DAY_MS is one day in milliseconds', () => {
  assert.equal(DAY_MS, 24 * 60 * 60 * 1000);
});

test('computeSubtotal multiplies the daily rate by whole days', () => {
  assert.equal(computeSubtotal(1000, day(1), day(4)), 3000);
  assert.equal(computeSubtotal(2500, day(1), day(2)), 2500);
});

test('computeSubtotal charges at least one day when the dates are equal', () => {
  assert.equal(computeSubtotal(1000, day(1), day(1)), 1000);
});

test('computeSubtotal rounds a partial day up', () => {
  const start = new Date('2026-12-01T00:00:00.000Z');
  const end = new Date('2026-12-02T06:00:00.000Z');
  assert.equal(computeSubtotal(1000, start, end), 2000);
});

test('computeSubtotal rounds the money to cents', () => {
  assert.equal(computeSubtotal(33.333, day(1), day(4)), 100);
  assert.equal(computeSubtotal(0.1, day(1), day(4)), 0.3);
});

test('computeSubtotal of a zero rate is zero', () => {
  assert.equal(computeSubtotal(0, day(1), day(10)), 0);
});

test('computeDiscount percentage is a share of the subtotal', () => {
  assert.equal(computeDiscount({ type: 'percentage', value: 10 }, 3000), 300);
  assert.equal(computeDiscount({ type: 'percentage', value: 33.33 }, 100), 33.33);
  assert.equal(computeDiscount({ type: 'percentage', value: 100 }, 750), 750);
});

test('computeDiscount fixed is the value', () => {
  assert.equal(computeDiscount({ type: 'fixed', value: 250 }, 3000), 250);
});

test('computeDiscount never exceeds the subtotal', () => {
  assert.equal(computeDiscount({ type: 'fixed', value: 5000 }, 3000), 3000);
});

test('computeDiscount never goes below zero', () => {
  assert.equal(computeDiscount({ type: 'fixed', value: -50 }, 3000), 0);
  assert.equal(computeDiscount({ type: 'percentage', value: -5 }, 3000), 0);
});

test('priceOf without a promo has no discount', () => {
  assert.deepEqual(priceOf(null, 3000), { discount: 0, totalPrice: 3000 });
  assert.deepEqual(priceOf(undefined, 1234.567), { discount: 0, totalPrice: 1234.57 });
});

test('priceOf subtracts the discount from the subtotal', () => {
  assert.deepEqual(priceOf({ type: 'percentage', value: 10 }, 3000), { discount: 300, totalPrice: 2700 });
  assert.deepEqual(priceOf({ type: 'fixed', value: 250 }, 3000), { discount: 250, totalPrice: 2750 });
});

test('priceOf never makes the total negative', () => {
  assert.deepEqual(priceOf({ type: 'fixed', value: 9999 }, 1000), { discount: 1000, totalPrice: 0 });
});
