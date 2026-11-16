const test = require('node:test');
const assert = require('node:assert/strict');
const { DEFAULT_LIMIT, MAX_LIMIT, parsePaging } = require('../../utils/paging');

test('defaults are page 1 and limit 20', () => {
  assert.equal(DEFAULT_LIMIT, 20);
  assert.equal(MAX_LIMIT, 100);
  assert.deepEqual(parsePaging({}), { page: 1, limit: 20 });
});

test('valid values are returned as numbers', () => {
  assert.deepEqual(parsePaging({ page: '3', limit: '50' }), { page: 3, limit: 50 });
});

test('the maximum limit is accepted', () => {
  assert.deepEqual(parsePaging({ limit: '100' }), { page: 1, limit: 100 });
});

test('a limit over the maximum is rejected, not clamped', () => {
  assert.deepEqual(parsePaging({ limit: '101' }), { error: 'limit must not exceed 100' });
});

test('page must be a positive integer', () => {
  for (const bad of ['0', '-1', '1.5', 'abc', '', ' 2', '2 ', '1e2', '+3']) {
    assert.deepEqual(parsePaging({ page: bad }), { error: 'page must be a positive integer' }, `page=${JSON.stringify(bad)}`);
  }
});

test('limit must be a positive integer', () => {
  for (const bad of ['0', '-5', '2.5', 'ten', '']) {
    assert.deepEqual(parsePaging({ limit: bad }), { error: 'limit must be a positive integer' }, `limit=${JSON.stringify(bad)}`);
  }
});

test('repeated query keys (arrays) are rejected', () => {
  assert.deepEqual(parsePaging({ page: ['1', '2'] }), { error: 'page must be a positive integer' });
  assert.deepEqual(parsePaging({ limit: ['5'] }), { error: 'limit must be a positive integer' });
});

test('numbers beyond the safe integer range are rejected', () => {
  assert.deepEqual(parsePaging({ page: '9007199254740993' }), { error: 'page must be a positive integer' });
});

test('page is checked before limit', () => {
  assert.deepEqual(parsePaging({ page: '0', limit: '0' }), { error: 'page must be a positive integer' });
});
