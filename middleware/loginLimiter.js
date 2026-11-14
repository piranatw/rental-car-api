const { rateLimit } = require('express-rate-limit');

// 10 login requests per minute per client IP, counted regardless of outcome and
// independent of the email, so it reveals nothing about which accounts exist.
// The key is the socket address: `trust proxy` is deliberately NOT enabled, so
// X-Forwarded-For cannot be used to dodge or poison the limit.
const loginLimiter = rateLimit({
  windowMs: 60 * 1000,
  limit: 10,
  standardHeaders: false,
  legacyHeaders: false,
  // The header is expected and ignored on purpose (see above); silence the library's warning.
  validate: { xForwardedForHeader: false },
  // The Newman suite logs in many times per minute; only the RateLimit429 pass forces it on.
  skip: () => process.env.NODE_ENV === 'test' && process.env.RATE_LIMIT_FORCE !== '1',
  handler: (req, res) => {
    const resetTime = req.rateLimit && req.rateLimit.resetTime;
    const retryAfter = Math.max(1, Math.ceil(((resetTime ? resetTime.getTime() : Date.now() + 60000) - Date.now()) / 1000));
    res.set('Retry-After', String(retryAfter));
    res.status(429).json({
      success: false,
      message: 'Too many login attempts from this IP, please try again later',
      retryAfter
    });
  }
});

module.exports = { loginLimiter };
