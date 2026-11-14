const crypto = require('crypto');
const jwt = require('jsonwebtoken');
const bcrypt = require('bcryptjs');
const User = require('../models/User');
const RevokedToken = require('../models/RevokedToken');
const { getMaxAttempts, getLockMinutes } = require('../config/lockConfig');

const sendTokenResponse = (user, statusCode, res) => {
  const token = user.getSignedJwtToken();
  const days = Number(process.env.JWT_COOKIE_EXPIRE) || 30;
  const options = {
    expires: new Date(Date.now() + days * 24 * 60 * 60 * 1000),
    httpOnly: true
  };
  if (process.env.NODE_ENV === 'production') options.secure = true;

  res.status(statusCode).cookie('token', token, options).json({
    success: true,
    token,
    data: {
      id: user.id,
      name: user.name,
      email: user.email,
      telephone: user.telephone,
      role: user.role
    }
  });
};

// POST /api/v1/auth/register
exports.register = async (req, res) => {
  try {
    const { name, telephone, email, password } = req.body || {};
    // role is never taken from the client
    const user = await User.create({ name, telephone, email, password, role: 'user' });
    sendTokenResponse(user, 201, res);
  } catch (err) {
    if (err.code === 11000) {
      return res.status(400).json({ success: false, message: 'Email already registered' });
    }
    if (err.name === 'ValidationError') {
      const message = Object.values(err.errors).map((e) => e.message).join(', ');
      return res.status(400).json({ success: false, message });
    }
    console.error(err.message);
    res.status(500).json({ success: false, message: 'Server error' });
  }
};

// bcrypt hash (cost 10) of a random throwaway string. Compared against when the email is
// unknown or the account is locked, so those paths cost the same as a real password check.
const DUMMY_HASH = '$2b$10$mzRPTVctRjcvo2PiV9PqNeNNX56PBJj/.CV79Iaokx9hgjoW7lLRS';

// One response for wrong password, unknown email and locked account: nothing to enumerate.
const invalidCredentials = (res) =>
  res.status(401).json({ success: false, message: 'Invalid credentials' });

// POST /api/v1/auth/login
exports.login = async (req, res) => {
  try {
    const { email, password } = req.body || {};
    if (typeof email !== 'string' || typeof password !== 'string' || !email || !password) {
      return res.status(400).json({ success: false, message: 'Please provide an email and password' });
    }
    const max = getMaxAttempts();
    const now = new Date();
    const lockDate = new Date(now.getTime() + getLockMinutes() * 60 * 1000);

    // Reserve this attempt with ONE atomic write BEFORE comparing the password. The update is
    // an aggregation pipeline, so MongoDB evaluates it against the current document under the
    // document lock; concurrent logins for the same account are serialised and each one sees
    // the result of the previous. Per account state, in a single update:
    //   lockUntil > now        -> nothing changes (locked)
    //   lockUntil <= now       -> unlocked: counter restarts at 0, then +1, lockUntil removed
    //   no lock                -> counter + 1
    //   new counter >= max     -> lockUntil = now + LOGIN_LOCK_MINUTES, in this same update
    // new:false returns the document as it was BEFORE the update, which tells us exactly
    // whether the account was already locked and which attempt number we reserved. An unknown
    // email matches nothing but costs the same single write round trip.
    const isLocked = { $and: [{ $eq: [{ $type: '$lockUntil' }, 'date'] }, { $gt: ['$lockUntil', now] }] };
    const pre = await User.findOneAndUpdate(
      { email: email.toLowerCase().trim() },
      [
        {
          $set: {
            failedLoginAttempts: {
              $cond: [
                isLocked,
                '$failedLoginAttempts',
                {
                  $add: [
                    { $cond: [{ $eq: [{ $type: '$lockUntil' }, 'date'] }, 0, { $ifNull: ['$failedLoginAttempts', 0] }] },
                    1
                  ]
                }
              ]
            }
          }
        },
        {
          $set: {
            lockUntil: {
              $cond: [isLocked, '$lockUntil', { $cond: [{ $gte: ['$failedLoginAttempts', max] }, lockDate, '$$REMOVE'] }]
            }
          }
        }
      ],
      { new: false }
    ).select('+password +failedLoginAttempts +lockUntil');

    const wasLocked = !!(pre && pre.lockUntil && pre.lockUntil > now);
    const reserved = pre ? (pre.lockUntil ? 0 : pre.failedLoginAttempts || 0) + 1 : 0;

    // Unknown email, locked account, or no attempt budget left: dummy compare, same response.
    if (!pre || wasLocked || reserved > max) {
      await bcrypt.compare(password, DUMMY_HASH);
      return invalidCredentials(res);
    }
    // At most `max` real comparisons can happen per lock window. A wrong password is
    // already counted by the reservation above.
    if (!(await pre.matchPassword(password))) {
      return invalidCredentials(res);
    }
    // Correct password: reset only if no other attempt was reserved since ours
    // (never wipes a counter or lock another request just advanced).
    await User.updateOne(
      { _id: pre._id, failedLoginAttempts: reserved },
      { $set: { failedLoginAttempts: 0 }, $unset: { lockUntil: 1 } }
    );
    const user = pre;
    sendTokenResponse(user, 200, res);
  } catch (err) {
    console.error(err.message);
    res.status(500).json({ success: false, message: 'Server error' });
  }
};

// GET /api/v1/auth/me
exports.getMe = async (req, res) => {
  res.status(200).json({ success: true, data: req.user });
};

// POST /api/v1/auth/logout
// protect has already verified the bearer token and confirmed it is not revoked.
exports.logout = async (req, res) => {
  try {
    const token = req.headers.authorization.split(' ')[1];
    const { exp } = jwt.decode(token);
    // Upsert so a concurrent logout of the same token still ends in 200.
    await RevokedToken.updateOne(
      { tokenHash: crypto.createHash('sha256').update(token).digest('hex') },
      { $setOnInsert: { expiresAt: new Date(exp * 1000) } },
      { upsert: true }
    );
    res.clearCookie('token');
    res.status(200).json({ success: true, data: {} });
  } catch (err) {
    console.error(err.message);
    res.status(500).json({ success: false, message: 'Server error' });
  }
};
