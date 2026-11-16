const test = require('node:test');
const assert = require('node:assert/strict');
const { getMaxAttempts, getLockMinutes } = require('../../config/lockConfig');

test('defaults are 5 attempts and 15 minutes', () => {
  assert.equal(getMaxAttempts({}), 5);
  assert.equal(getLockMinutes({}), 15);
});

test('positive integers from the environment are used', () => {
  assert.equal(getMaxAttempts({ LOGIN_MAX_ATTEMPTS: '3' }), 3);
  assert.equal(getLockMinutes({ LOGIN_LOCK_MINUTES: '30' }), 30);
  assert.equal(getMaxAttempts({ LOGIN_MAX_ATTEMPTS: '1' }), 1);
});

test('anything that is not a positive integer falls back to the default', () => {
  for (const bad of ['', 'abc', '0', '-2', '2.5', 'Infinity', 'NaN', ' ', '1e999']) {
    assert.equal(getMaxAttempts({ LOGIN_MAX_ATTEMPTS: bad }), 5, `attempts=${JSON.stringify(bad)}`);
    assert.equal(getLockMinutes({ LOGIN_LOCK_MINUTES: bad }), 15, `minutes=${JSON.stringify(bad)}`);
  }
});

test('the two settings are independent', () => {
  const env = { LOGIN_MAX_ATTEMPTS: '8' };
  assert.equal(getMaxAttempts(env), 8);
  assert.equal(getLockMinutes(env), 15);
});

test('with no argument the process environment is read', () => {
  const before = { a: process.env.LOGIN_MAX_ATTEMPTS, m: process.env.LOGIN_LOCK_MINUTES };
  try {
    process.env.LOGIN_MAX_ATTEMPTS = '7';
    process.env.LOGIN_LOCK_MINUTES = '2';
    assert.equal(getMaxAttempts(), 7);
    assert.equal(getLockMinutes(), 2);
  } finally {
    for (const [k, v] of [['LOGIN_MAX_ATTEMPTS', before.a], ['LOGIN_LOCK_MINUTES', before.m]]) {
      if (v === undefined) delete process.env[k];
      else process.env[k] = v;
    }
  }
});
