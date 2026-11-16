// Starts a tiny Express app with the real limiter on an ephemeral port and sends requests to it.
const test = require('node:test');
const assert = require('node:assert/strict');
const express = require('express');

const withLimiter = async (env, fn) => {
  const saved = { NODE_ENV: process.env.NODE_ENV, RATE_LIMIT_FORCE: process.env.RATE_LIMIT_FORCE };
  Object.assign(process.env, env);
  for (const [k, v] of Object.entries(env)) if (v === undefined) delete process.env[k];
  // A fresh module instance per test, so each test starts with an empty counter.
  delete require.cache[require.resolve('../../middleware/loginLimiter')];
  const { loginLimiter } = require('../../middleware/loginLimiter');
  const app = express();
  app.post('/login', loginLimiter, (req, res) => res.status(200).json({ success: true }));
  const server = await new Promise((resolve) => {
    const s = app.listen(0, '127.0.0.1', () => resolve(s));
  });
  const url = `http://127.0.0.1:${server.address().port}/login`;
  try {
    await fn(url);
  } finally {
    await new Promise((resolve) => server.close(resolve));
    for (const [k, v] of Object.entries(saved)) {
      if (v === undefined) delete process.env[k];
      else process.env[k] = v;
    }
  }
};

test('the first 10 requests pass and the 11th gets 429 with Retry-After', async () => {
  await withLimiter({ NODE_ENV: 'development', RATE_LIMIT_FORCE: undefined }, async (url) => {
    for (let i = 1; i <= 10; i++) {
      const res = await fetch(url, { method: 'POST' });
      assert.equal(res.status, 200, `request ${i}`);
    }
    const blocked = await fetch(url, { method: 'POST' });
    assert.equal(blocked.status, 429);
    const retryHeader = Number(blocked.headers.get('retry-after'));
    assert.ok(Number.isInteger(retryHeader) && retryHeader >= 1 && retryHeader <= 60, `Retry-After ${retryHeader}`);
    const body = await blocked.json();
    assert.equal(body.success, false);
    assert.equal(body.message, 'Too many login attempts from this IP, please try again later');
    assert.equal(body.retryAfter, retryHeader);
  });
});

test('X-Forwarded-For cannot be used to dodge the limit', async () => {
  await withLimiter({ NODE_ENV: 'development', RATE_LIMIT_FORCE: undefined }, async (url) => {
    for (let i = 1; i <= 10; i++) {
      const res = await fetch(url, { method: 'POST', headers: { 'X-Forwarded-For': `10.0.0.${i}` } });
      assert.equal(res.status, 200);
    }
    const blocked = await fetch(url, { method: 'POST', headers: { 'X-Forwarded-For': '10.9.9.9' } });
    assert.equal(blocked.status, 429);
  });
});

test('the limiter does not send the draft RateLimit headers', async () => {
  await withLimiter({ NODE_ENV: 'development', RATE_LIMIT_FORCE: undefined }, async (url) => {
    const res = await fetch(url, { method: 'POST' });
    assert.equal(res.headers.get('ratelimit'), null);
    assert.equal(res.headers.get('x-ratelimit-limit'), null);
  });
});

test('under NODE_ENV=test the limiter is skipped', async () => {
  await withLimiter({ NODE_ENV: 'test', RATE_LIMIT_FORCE: undefined }, async (url) => {
    for (let i = 1; i <= 15; i++) {
      const res = await fetch(url, { method: 'POST' });
      assert.equal(res.status, 200, `request ${i}`);
    }
  });
});

test('RATE_LIMIT_FORCE=1 turns the limiter back on under NODE_ENV=test', async () => {
  await withLimiter({ NODE_ENV: 'test', RATE_LIMIT_FORCE: '1' }, async (url) => {
    for (let i = 1; i <= 10; i++) await fetch(url, { method: 'POST' });
    const blocked = await fetch(url, { method: 'POST' });
    assert.equal(blocked.status, 429);
  });
});
