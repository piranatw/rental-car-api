// protect and authorize with the database calls replaced by stubs, so no MongoDB is needed.
const test = require('node:test');
const assert = require('node:assert/strict');
const crypto = require('crypto');
const jwt = require('jsonwebtoken');

process.env.JWT_SECRET = 'unit-test-secret';

const User = require('../../models/User');
const RevokedToken = require('../../models/RevokedToken');
const { protect, authorize } = require('../../middleware/auth');

const fakeRes = () => {
  const res = { statusCode: null, body: null };
  res.status = (code) => {
    res.statusCode = code;
    return res;
  };
  res.json = (body) => {
    res.body = body;
    return res;
  };
  return res;
};

const run = async (headers) => {
  const req = { headers };
  const res = fakeRes();
  let nextCalled = false;
  await protect(req, res, () => {
    nextCalled = true;
  });
  return { req, res, nextCalled };
};

const stub = (t, { revoked = false, user = { _id: 'u1', role: 'user' } } = {}) => {
  t.mock.method(RevokedToken, 'exists', async () => (revoked ? { _id: 'r1' } : null));
  t.mock.method(User, 'findById', async () => user);
};

const UNAUTHORIZED = { success: false, message: 'Not authorized to access this route' };

test('protect refuses a request without an Authorization header', async () => {
  const { res, nextCalled } = await run({});
  assert.equal(res.statusCode, 401);
  assert.deepEqual(res.body, UNAUTHORIZED);
  assert.equal(nextCalled, false);
});

test('protect refuses a header that is not a Bearer token', async () => {
  for (const header of ['Basic abc', 'abc', 'bearer abc', 'Token abc']) {
    const { res, nextCalled } = await run({ authorization: header });
    assert.equal(res.statusCode, 401, header);
    assert.equal(nextCalled, false, header);
  }
});

test('protect refuses an empty or "null" token', async () => {
  for (const header of ['Bearer ', 'Bearer null']) {
    const { res, nextCalled } = await run({ authorization: header });
    assert.equal(res.statusCode, 401, header);
    assert.equal(nextCalled, false, header);
  }
});

test('protect refuses a garbage token', async (t) => {
  stub(t);
  const { res, nextCalled } = await run({ authorization: 'Bearer not.a.jwt' });
  assert.equal(res.statusCode, 401);
  assert.equal(nextCalled, false);
});

test('protect refuses a token signed with another secret', async (t) => {
  stub(t);
  const token = jwt.sign({ id: 'u1' }, 'some-other-secret');
  const { res, nextCalled } = await run({ authorization: `Bearer ${token}` });
  assert.equal(res.statusCode, 401);
  assert.equal(nextCalled, false);
});

test('protect refuses an expired token', async (t) => {
  stub(t);
  const token = jwt.sign({ id: 'u1' }, process.env.JWT_SECRET, { expiresIn: -10 });
  const { res, nextCalled } = await run({ authorization: `Bearer ${token}` });
  assert.equal(res.statusCode, 401);
  assert.equal(nextCalled, false);
});

test('protect refuses a revoked token and looks it up by its sha256 hash', async (t) => {
  stub(t, { revoked: true });
  const token = jwt.sign({ id: 'u1' }, process.env.JWT_SECRET, { expiresIn: '1h' });
  const { res, nextCalled } = await run({ authorization: `Bearer ${token}` });
  assert.equal(res.statusCode, 401);
  assert.equal(nextCalled, false);
  const expectedHash = crypto.createHash('sha256').update(token).digest('hex');
  assert.deepEqual(RevokedToken.exists.mock.calls[0].arguments[0], { tokenHash: expectedHash });
});

test('protect refuses a valid token whose user no longer exists', async (t) => {
  stub(t, { user: null });
  const token = jwt.sign({ id: 'gone' }, process.env.JWT_SECRET, { expiresIn: '1h' });
  const { res, nextCalled } = await run({ authorization: `Bearer ${token}` });
  assert.equal(res.statusCode, 401);
  assert.equal(nextCalled, false);
});

test('protect attaches the user and calls next for a valid token', async (t) => {
  const user = { _id: 'u1', role: 'user' };
  stub(t, { user });
  const token = jwt.sign({ id: 'u1' }, process.env.JWT_SECRET, { expiresIn: '1h' });
  const { req, res, nextCalled } = await run({ authorization: `Bearer ${token}` });
  assert.equal(nextCalled, true);
  assert.equal(res.statusCode, null);
  assert.equal(req.user, user);
  assert.equal(User.findById.mock.calls[0].arguments[0], 'u1');
});

test('every 401 from protect has the same body, whatever the reason', async (t) => {
  stub(t, { user: null });
  const valid = jwt.sign({ id: 'x' }, process.env.JWT_SECRET, { expiresIn: '1h' });
  const bodies = [];
  for (const headers of [{}, { authorization: 'Bearer null' }, { authorization: 'Bearer junk' }, { authorization: `Bearer ${valid}` }]) {
    bodies.push((await run(headers)).res.body);
  }
  for (const b of bodies) assert.deepEqual(b, UNAUTHORIZED);
});

test('authorize lets a listed role through', () => {
  const res = fakeRes();
  let called = false;
  authorize('admin')({ user: { role: 'admin' } }, res, () => {
    called = true;
  });
  assert.equal(called, true);
  assert.equal(res.statusCode, null);
});

test('authorize refuses an unlisted role with 403 and names the role', () => {
  const res = fakeRes();
  let called = false;
  authorize('admin')({ user: { role: 'user' } }, res, () => {
    called = true;
  });
  assert.equal(called, false);
  assert.equal(res.statusCode, 403);
  assert.deepEqual(res.body, {
    success: false,
    message: 'User role user is not authorized to access this route'
  });
});

test('authorize accepts any of several roles', () => {
  const allowed = authorize('user', 'admin');
  for (const role of ['user', 'admin']) {
    let called = false;
    allowed({ user: { role } }, fakeRes(), () => {
      called = true;
    });
    assert.equal(called, true, role);
  }
});
