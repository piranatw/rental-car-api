const crypto = require('crypto');
const jwt = require('jsonwebtoken');
const bcrypt = require('bcryptjs');
const User = require('../models/User');
const RevokedToken = require('../models/RevokedToken');

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

const MAX_ATTEMPTS = () => Number(process.env.LOGIN_MAX_ATTEMPTS) || 5;
const LOCK_MINUTES = () => Number(process.env.LOGIN_LOCK_MINUTES) || 15;

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
    const user = await User.findOne({ email: email.toLowerCase().trim() })
      .select('+password +failedLoginAttempts +lockUntil');
    if (!user) {
      await bcrypt.compare(password, DUMMY_HASH);
      return invalidCredentials(res);
    }

    // Locked: reject before comparing the password and leave the counter alone.
    if (user.lockUntil && user.lockUntil > new Date()) {
      await bcrypt.compare(password, DUMMY_HASH);
      return invalidCredentials(res);
    }
    // Expired lock: start counting from zero again (only the request that still sees this lock resets it).
    if (user.lockUntil) {
      await User.updateOne(
        { _id: user._id, lockUntil: user.lockUntil },
        { $set: { failedLoginAttempts: 0 }, $unset: { lockUntil: 1 } }
      );
      user.failedLoginAttempts = 0;
    }

    if (!(await user.matchPassword(password))) {
      // Atomic increment; never read-modify-write in JS.
      const updated = await User.findOneAndUpdate(
        { _id: user._id },
        { $inc: { failedLoginAttempts: 1 } },
        { new: true }
      ).select('+failedLoginAttempts');
      if (updated && updated.failedLoginAttempts >= MAX_ATTEMPTS()) {
        await User.updateOne(
          { _id: user._id, lockUntil: { $exists: false } },
          { $set: { lockUntil: new Date(Date.now() + LOCK_MINUTES() * 60 * 1000) } }
        );
      }
      return invalidCredentials(res);
    }

    if (user.failedLoginAttempts > 0) {
      await User.updateOne(
        { _id: user._id },
        { $set: { failedLoginAttempts: 0 }, $unset: { lockUntil: 1 } }
      );
    }
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
