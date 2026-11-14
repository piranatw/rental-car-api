// Leaf module: pure pricing helpers, no other dependencies.
const DAY_MS = 86400000;

const round2 = (n) => Math.round(n * 100) / 100;

// dailyRate x whole days, at least one day (returnDate may equal date), rounded to cents.
const computeSubtotal = (dailyRate, date, returnDate) =>
  round2(dailyRate * Math.max(1, Math.ceil((returnDate - date) / DAY_MS)));

// Percentage -> subtotal * value / 100, fixed -> value; clamped to [0, subtotal], 2 decimals.
const computeDiscount = (promo, subtotal) => {
  const raw = promo.type === 'percentage' ? (subtotal * promo.value) / 100 : promo.value;
  return round2(Math.min(Math.max(raw, 0), subtotal));
};

// The one writer-side price rule: every place that stores discount/totalPrice uses this.
const priceOf = (promo, subtotal) => {
  if (!promo) return { discount: 0, totalPrice: round2(subtotal) };
  const discount = computeDiscount(promo, subtotal);
  return { discount, totalPrice: round2(Math.max(0, subtotal - discount)) };
};

module.exports = { DAY_MS, round2, computeSubtotal, computeDiscount, priceOf };
