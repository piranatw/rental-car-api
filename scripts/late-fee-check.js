// Pure check of calcLateFee / scheduledReturnInstant: no server, no database.
// For every minute offset from -90 to +300 around the scheduled instant (plus the millisecond
// neighbours of each whole hour) and several rates, the result must equal an independent BigInt
// formula, never be NaN or negative, and the Date arguments must not be mutated.
// Usage: node scripts/late-fee-check.js   (exits non-zero on any violation)
const { calcLateFee, scheduledReturnInstant } = require('../controllers/inspections');

const failures = [];
const fail = (msg) => { if (failures.length < 20) console.error('FAIL ' + msg); failures.push(msg); };

// Independent reference: BigInt milliseconds and BigInt cents, string-built decimal result.
const refAnchorMs = (returnDate) => {
  const d = returnDate;
  return BigInt(Date.UTC(d.getUTCFullYear(), d.getUTCMonth(), d.getUTCDate())) + 86400000n - 1n;
};
const refHours = (actualMs, anchorMs) => {
  const over = BigInt(actualMs) - anchorMs;
  return over <= 0n ? 0n : (over + 3599999n) / 3600000n;
};
const refFee = (hours, rateText) => {
  const [w, f = ''] = rateText.split('.');
  const cents = BigInt(w) * 100n + BigInt((f + '00').slice(0, 2));
  const total = cents * hours;
  const s = total.toString().padStart(3, '0');
  return Number(s.slice(0, -2) + '.' + s.slice(-2));
};

const RATES = ['0', '200', '33.33', '0.05', '149.95'];
const RETURN_DATES = [
  new Date('2031-07-03T00:00:00.000Z'),
  new Date('2031-07-03T13:45:10.000Z'), // not midnight: the UTC calendar day still decides
  new Date('2032-02-29T00:00:00.000Z'),
  new Date('2031-12-31T00:00:00.000Z')
];

// the anchor itself
RETURN_DATES.forEach((rd) => {
  const a = scheduledReturnInstant(rd);
  if (!(a instanceof Date) || a.getTime() !== Number(refAnchorMs(rd))) fail(`scheduledReturnInstant(${rd.toISOString()}) = ${a}`);
});
if (scheduledReturnInstant(new Date('2031-07-03T00:00:00.000Z')).toISOString() !== '2031-07-03T23:59:59.999Z') fail('anchor is not 23:59:59.999Z');

let n = 0;
const checkOne = (rd, actualMs, rateText) => {
  const actual = new Date(actualMs);
  const rdCopy = rd.getTime();
  const acCopy = actual.getTime();
  const r = calcLateFee(rd, actual, Number(rateText));
  n += 1;
  const h = refHours(actualMs, refAnchorMs(rd));
  const f = refFee(h, rateText);
  const tag = `returnDate=${rd.toISOString()} actual=${actual.toISOString()} rate=${rateText}`;
  if (!r || typeof r.lateHours !== 'number' || typeof r.lateFee !== 'number') return fail(`non-number result ${tag}`);
  if (Number.isNaN(r.lateHours) || Number.isNaN(r.lateFee)) return fail(`NaN ${tag}`);
  if (r.lateHours < 0 || r.lateFee < 0) return fail(`negative ${tag}`);
  if (r.lateHours !== Number(h)) fail(`lateHours ${r.lateHours} != ${h} ${tag}`);
  if (r.lateFee !== f) fail(`lateFee ${r.lateFee} != ${f} ${tag}`);
  if (rd.getTime() !== rdCopy || actual.getTime() !== acCopy) fail(`argument mutated ${tag}`);
};

RETURN_DATES.forEach((rd) => {
  const anchor = Number(refAnchorMs(rd));
  RATES.forEach((rate) => {
    for (let m = -90; m <= 300; m++) {
      const base = anchor + m * 60000;
      checkOne(rd, base, rate);
      checkOne(rd, base - 1, rate);
      checkOne(rd, base + 1, rate);
    }
  });
});

// Absolute spot checks written out by hand (the boundary matrix of the task).
const rd = new Date('2031-07-03T00:00:00.000Z');
const spot = [
  ['2031-07-03T14:00:00Z', 0, 0], ['2031-07-03T23:59:59.999Z', 0, 0], ['2031-07-04T00:00:00.000Z', 1, 200],
  ['2031-07-04T00:59:59.999Z', 1, 200], ['2031-07-04T01:00:00.000Z', 2, 400], ['2031-07-04T01:59:59.999Z', 2, 400],
  ['2031-07-04T02:00:00.000Z', 3, 600], ['2031-07-01T10:00:00Z', 0, 0]
];
spot.forEach(([at, h, f]) => {
  const r = calcLateFee(rd, new Date(at), 200);
  if (r.lateHours !== h || r.lateFee !== f) fail(`spot ${at}: got ${JSON.stringify(r)} want ${h}, ${f}`);
});
const d3 = calcLateFee(rd, new Date('2031-07-04T02:59:59.999Z'), 33.33);
if (d3.lateHours !== 3 || d3.lateFee !== 99.99) fail(`33.33 x 3 h gave ${JSON.stringify(d3)}`);
const z = calcLateFee(rd, new Date('2031-07-04T02:59:59.999Z'), 0);
if (z.lateHours !== 3 || z.lateFee !== 0) fail(`zero rate gave ${JSON.stringify(z)}`);

if (failures.length) {
  console.error(`late-fee-check: ${failures.length} violation(s) in ${n} generated cases`);
  process.exit(1);
}
console.log(`late-fee-check: ${n} generated cases + spot checks, all exact`);
