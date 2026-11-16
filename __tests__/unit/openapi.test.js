// Keeps openapi.yaml honest: it must parse, resolve its $refs and describe every route that routes/*.js registers.
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const path = require('path');
const YAML = require('yaml');

const root = path.join(__dirname, '..', '..');
const spec = YAML.parse(fs.readFileSync(path.join(root, 'openapi.yaml'), 'utf8'));
const METHODS = ['get', 'post', 'put', 'delete', 'patch'];

const operations = [];
for (const [p, item] of Object.entries(spec.paths)) {
  for (const m of METHODS) if (item[m]) operations.push({ path: p, method: m, op: item[m] });
}

const resolve = (ref) => ref.replace(/^#\//, '').split('/').reduce((o, k) => o && o[k], spec);

test('the document declares OpenAPI 3.0 with a title and version', () => {
  assert.match(spec.openapi, /^3\.0\./);
  assert.ok(spec.info.title);
  assert.ok(spec.info.version);
});

test('every $ref points at something that exists', () => {
  const missing = [];
  const walk = (node) => {
    if (Array.isArray(node)) return node.forEach(walk);
    if (node && typeof node === 'object') {
      if (typeof node.$ref === 'string' && resolve(node.$ref) === undefined) missing.push(node.$ref);
      Object.values(node).forEach(walk);
    }
  };
  walk(spec);
  assert.deepEqual(missing, []);
});

test('every operation has a tag, a summary and at least one response', () => {
  for (const { path: p, method, op } of operations) {
    const label = `${method.toUpperCase()} ${p}`;
    assert.ok(op.tags && op.tags.length === 1, `${label} needs exactly one tag`);
    assert.ok(op.summary, `${label} needs a summary`);
    assert.ok(op.responses && Object.keys(op.responses).length > 0, `${label} needs responses`);
  }
});

test('every path parameter in a URL is declared', () => {
  for (const [p, item] of Object.entries(spec.paths)) {
    const names = [...p.matchAll(/\{(\w+)\}/g)].map((m) => m[1]);
    for (const m of METHODS) {
      if (!item[m]) continue;
      const declared = [...(item.parameters || []), ...(item[m].parameters || [])]
        .map((x) => (x.$ref ? resolve(x.$ref) : x))
        .filter((x) => x.in === 'path')
        .map((x) => x.name);
      for (const n of names) assert.ok(declared.includes(n), `${m.toUpperCase()} ${p} must declare {${n}}`);
    }
  }
});

test('routes that need a login do not say they are public', () => {
  const publicOps = operations.filter((o) => Array.isArray(o.op.security) && o.op.security.length === 0);
  const names = publicOps.map((o) => `${o.method.toUpperCase()} ${o.path}`).sort();
  assert.deepEqual(names, [
    'GET /api/v1/providers',
    'GET /api/v1/providers/{id}',
    'POST /api/v1/auth/login',
    'POST /api/v1/auth/register'
  ]);
});

test('the spec lists exactly the routes the code registers', () => {
  const mounts = {
    auth: '/api/v1/auth',
    providers: '/api/v1/providers',
    inspections: '/api/v1/bookings/{id}/inspection',
    bookings: '/api/v1/bookings',
    promos: '/api/v1/promos',
    audit: '/api/v1/audit',
    tickets: '/api/v1/tickets',
    stats: '/api/v1/stats'
  };
  const fromCode = new Set();
  for (const [file, base] of Object.entries(mounts)) {
    const src = fs.readFileSync(path.join(root, 'routes', `${file}.js`), 'utf8');
    // router.get('/x', ...), router.route('/x').get(...).post(...), and chained .get( / .put( / .delete( lines.
    const lines = src.split('\n');
    let currentPath = null;
    for (const line of lines) {
      const direct = line.match(/router\.(get|post|put|delete)\(\s*'([^']*)'/);
      if (direct) {
        fromCode.add(`${direct[1]} ${base}${direct[2] === '/' ? '' : direct[2]}`);
        continue;
      }
      const route = line.match(/\.route\(\s*'([^']*)'\s*\)/);
      if (route) currentPath = route[1];
      if (currentPath !== null) {
        for (const m of line.matchAll(/\.(get|post|put|delete)\(/g)) {
          fromCode.add(`${m[1]} ${base}${currentPath === '/' ? '' : currentPath}`);
        }
      }
    }
  }
  const norm = (s) => s.replace(/:(\w+)/g, '{$1}');
  const codeOps = [...fromCode].map(norm).sort();
  const specOps = operations.map((o) => `${o.method} ${o.path}`).sort();
  assert.equal(specOps.length, 28, 'the API has 28 endpoints');
  assert.deepEqual(specOps, codeOps);
});
