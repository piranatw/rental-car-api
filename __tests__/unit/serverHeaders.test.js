// Loads the real app (it does not connect to a database on import) and checks the headers and the docs route.
const test = require('node:test');
const assert = require('node:assert/strict');

const app = require('../../server');

const listen = () =>
  new Promise((resolve) => {
    const s = app.listen(0, '127.0.0.1', () => resolve(s));
  });

test('responses carry the helmet security headers and hide Express', async () => {
  const server = await listen();
  try {
    const res = await fetch(`http://127.0.0.1:${server.address().port}/no-such-route`);
    assert.equal(res.status, 404);
    assert.equal(res.headers.get('x-powered-by'), null);
    assert.equal(res.headers.get('x-content-type-options'), 'nosniff');
    assert.ok(res.headers.get('x-frame-options'));
    assert.ok(res.headers.get('strict-transport-security'));
    assert.ok(res.headers.get('content-security-policy'));
  } finally {
    await new Promise((resolve) => server.close(resolve));
  }
});

test('the Swagger UI page is served at /api-docs and lists the API title', async () => {
  const server = await listen();
  try {
    const base = `http://127.0.0.1:${server.address().port}`;
    const page = await fetch(`${base}/api-docs/`);
    assert.equal(page.status, 200);
    assert.match(page.headers.get('content-type'), /text\/html/);
    const init = await fetch(`${base}/api-docs/swagger-ui-init.js`);
    assert.equal(init.status, 200);
    const text = await init.text();
    assert.match(text, /Rental Car Booking API/);
    assert.match(text, /\/api\/v1\/bookings\/\{id\}\/inspection\/dispute/);
  } finally {
    await new Promise((resolve) => server.close(resolve));
  }
});
