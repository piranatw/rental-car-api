// Leaf module: strict page/limit parsing shared by the admin list endpoints.
const DEFAULT_LIMIT = 20;
const MAX_LIMIT = 100;
const POSITIVE_INT = /^\d+$/;

const readInt = (query, key, fallback) => {
  const raw = query[key];
  if (raw === undefined) return { value: fallback };
  const n = typeof raw === 'string' && POSITIVE_INT.test(raw) ? Number(raw) : NaN;
  if (!Number.isSafeInteger(n) || n < 1) return { error: `${key} must be a positive integer` };
  return { value: n };
};

// Returns { page, limit } or { error }. Never clamps: out-of-range input is an error.
const parsePaging = (query) => {
  const page = readInt(query, 'page', 1);
  if (page.error) return { error: page.error };
  const limit = readInt(query, 'limit', DEFAULT_LIMIT);
  if (limit.error) return { error: limit.error };
  if (limit.value > MAX_LIMIT) return { error: `limit must not exceed ${MAX_LIMIT}` };
  return { page: page.value, limit: limit.value };
};

module.exports = { DEFAULT_LIMIT, MAX_LIMIT, parsePaging };
