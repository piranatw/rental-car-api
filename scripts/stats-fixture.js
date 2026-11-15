// Deterministic data set for the Stats Postman folder. Shared by scripts/seed-stats.js (which inserts it)
// and by the folder's expected values, which are hard-coded constants in the collection and were
// derived from expected() below. Every booking date is in the year 2090, a year no other folder uses,
// so the global counts of the shared _test database never change another folder's assertions.
//
// Provider order below is the CREATION order, so provider ids ascend in this order. C is created before B
// on purpose: the tie B = C must be broken by name (B first), not by id or creation order.
// E = F = 400: the tie sits on the top-5 cut, so F is excluded by the name tie-break.
// Months 03 and 08 never have a booking (perMonth must omit them). Two providers have no bookings.
const PROVIDERS = [
  { name: 'Stats Provider A', count: 1400 },
  { name: 'Stats Provider C', count: 1000 },
  { name: 'Stats Provider B', count: 1000 },
  { name: 'Stats Provider D', count: 800 },
  { name: 'Stats Provider E', count: 400 },
  { name: 'Stats Provider F', count: 400 },
  { name: 'Stats Provider Zero 1', count: 0 },
  { name: 'Stats Provider Zero 2', count: 0 }
];

// Month/year edges. Filler bookings never fall on day 1 or after day 27, so a range around one of
// these instants contains exactly the special booking(s) listed here.
const SPECIALS = [
  { provider: 'Stats Provider D', iso: '2090-01-01T00:00:00.000Z' }, // first ms of the year
  { provider: 'Stats Provider A', iso: '2090-01-31T23:59:59.999Z' }, // last ms of January
  { provider: 'Stats Provider B', iso: '2090-02-01T00:00:00.000Z' }, // first ms of February
  { provider: 'Stats Provider A', iso: '2090-04-30T23:59:59.999Z' }, // last ms of April
  { provider: 'Stats Provider B', iso: '2090-05-01T00:00:00.000Z' }, // first ms of May
  { provider: 'Stats Provider C', iso: '2090-12-31T23:59:59.999Z' } // last ms of the year
];

const MONTHS_USED = [1, 2, 4, 5, 6, 7, 9, 10, 11, 12];

// -> [{ provider: name, date: Date }], exactly sum(PROVIDERS.count) rows.
const buildBookings = () => {
  const rows = SPECIALS.map((s) => ({ provider: s.provider, date: new Date(s.iso) }));
  let i = 0;
  for (const p of PROVIDERS) {
    const need = p.count - SPECIALS.filter((s) => s.provider === p.name).length;
    for (let k = 0; k < need; k++, i++) {
      const month = MONTHS_USED[i % MONTHS_USED.length];
      const day = 2 + (Math.floor(i / MONTHS_USED.length) % 26);
      rows.push({ provider: p.name, date: new Date(Date.UTC(2090, month - 1, day)) });
    }
  }
  return rows;
};

// Plain loops: this is the oracle, the API under test must never be the thing that computes it.
const expected = () => {
  const rows = buildBookings();
  const perProvider = new Map();
  const perMonth = new Map();
  const perDay = new Map();
  for (const r of rows) {
    perProvider.set(r.provider, (perProvider.get(r.provider) || 0) + 1);
    const month = r.date.toISOString().slice(0, 7);
    perMonth.set(month, (perMonth.get(month) || 0) + 1);
    const day = r.date.toISOString().slice(0, 10);
    perDay.set(day, (perDay.get(day) || 0) + 1);
  }
  return {
    total: rows.length,
    perProvider: [...perProvider].map(([name, count]) => ({ name, count }))
      .sort((a, b) => b.count - a.count || (a.name < b.name ? -1 : 1)),
    perMonth: [...perMonth].map(([month, count]) => ({ month, count })).sort((a, b) => (a.month < b.month ? -1 : 1)),
    perDay: Object.fromEntries(perDay)
  };
};

module.exports = { PROVIDERS, SPECIALS, buildBookings, expected };
