// Errors raised before a controller runs (body parsing) and unknown routes must answer in the JSON envelope.
const test = require('node:test');
const assert = require('node:assert/strict');

const app = require('../../server');

const withServer = async (fn) => {
  const server = await new Promise((resolve) => {
    const s = app.listen(0, '127.0.0.1', () => resolve(s));
  });
  try {
    await fn(`http://127.0.0.1:${server.address().port}`);
  } finally {
    await new Promise((resolve) => server.close(resolve));
  }
};

const post = (base, path, body, headers = { 'Content-Type': 'application/json' }) =>
  fetch(base + path, { method: 'POST', headers, body });

test('an unknown path answers 404 in the JSON envelope', async () => {
  await withServer(async (base) => {
    for (const path of ['/nothing', '/api/v1/nothing', '/api/v2/providers', '/api/v1/auth/nothing']) {
      const res = await fetch(base + path);
      assert.equal(res.status, 404, path);
      assert.match(res.headers.get('content-type'), /application\/json/, path);
      assert.deepEqual(await res.json(), { success: false, message: 'Route not found' }, path);
    }
  });
});

test('an unknown method on a known path is also a JSON 404', async () => {
  await withServer(async (base) => {
    for (const method of ['PATCH', 'DELETE', 'PUT']) {
      const res = await fetch(`${base}/api/v1/auth/me`, { method });
      assert.equal(res.status, 404, method);
      assert.equal((await res.json()).message, 'Route not found', method);
    }
  });
});

test('malformed JSON answers 400 in the JSON envelope, not an HTML page', async () => {
  await withServer(async (base) => {
    for (const body of ['{bad', '{"email":', '[1,', "{'a':1}", '{"a":1}}']) {
      const res = await post(base, '/api/v1/auth/login', body);
      assert.equal(res.status, 400, body);
      assert.match(res.headers.get('content-type'), /application\/json/, body);
      assert.deepEqual(await res.json(), { success: false, message: 'Request body is not valid JSON' }, body);
    }
  });
});

test('a body over the size limit answers 413 in the JSON envelope', async () => {
  await withServer(async (base) => {
    const res = await post(base, '/api/v1/auth/register', JSON.stringify({ name: 'x'.repeat(200000) }));
    assert.equal(res.status, 413);
    assert.deepEqual(await res.json(), { success: false, message: 'Request body is too large' });
  });
});

test('an error page never leaks a stack trace or the framework name', async () => {
  await withServer(async (base) => {
    const res = await post(base, '/api/v1/auth/login', '{bad');
    const text = await res.text();
    assert.doesNotMatch(text, /SyntaxError|node_modules|at JSON\.parse|Express/);
  });
});

test('the docs and a real route are not swallowed by the 404 handler', async () => {
  await withServer(async (base) => {
    assert.equal((await fetch(`${base}/api-docs/`)).status, 200);
    assert.equal((await fetch(`${base}/api/v1/auth/me`)).status, 401);
  });
});
