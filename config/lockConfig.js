// Lockout settings from env. Only positive integers are accepted; anything else
// (empty, text, negative, zero, fractional, Infinity) falls back to the default.
const positiveInt = (value, fallback) => {
  const n = Number(value);
  return value !== undefined && value !== '' && Number.isInteger(n) && n > 0 ? n : fallback;
};

exports.getMaxAttempts = (env = process.env) => positiveInt(env.LOGIN_MAX_ATTEMPTS, 5);
exports.getLockMinutes = (env = process.env) => positiveInt(env.LOGIN_LOCK_MINUTES, 15);
