// Audit log immutability check. Usage: node scripts/audit-immutability-check.js
// Needs MONGO_URI (database name ending _test), adminEmail/adminPassword and a running API on PORT
// (run-newman.sh runs it while the pass A server is up).
//   (i)  every route mounted under /api/v1/audit is GET-only (inspects the express app, no listener)
//   (ii) POST/PUT/PATCH/DELETE on /api/v1/audit and /api/v1/audit/:id are 404 over HTTP for admin,
//        a regular user and an unauthenticated caller (no 401/403/405 leak of a route)
//   (iii) every Mongoose modification path throws on a real entry and the entry stays unchanged.
// Out of scope: direct driver access (AuditLog.collection.*) bypasses Mongoose middleware by design.
const mongoose = require('mongoose');

const noq = (process.env.MONGO_URI || '').split('?')[0];
if (!noq.endsWith('_test')) {
  console.error('Refusing to run: MONGO_URI database name must end with _test');
  process.exit(1);
}

const app = require('../server');
const AuditLog = require('../models/AuditLog');

const failures = [];
const check = (ok, label) => {
  console.log(`${ok ? 'PASS' : 'FAIL'} ${label}`);
  if (!ok) failures.push(label);
};

const base = `http://localhost:${process.env.PORT || 5050}`;
const call = async (method, path, token, body) => {
  const res = await fetch(base + path, {
    method,
    headers: { ...(token ? { Authorization: `Bearer ${token}` } : {}), ...(body ? { 'Content-Type': 'application/json' } : {}) },
    body: body ? JSON.stringify(body) : undefined
  });
  let json = null;
  try { json = await res.json(); } catch (e) { /* HTML 404 body */ }
  return { status: res.status, json };
};

// (i) static route table
const checkRouteTable = () => {
  const stack = (app._router && app._router.stack) || [];
  let mounts = 0;
  for (const layer of stack) {
    if (layer.name !== 'router') continue;
    const hit = layer.regexp.test('/api/v1/audit') || layer.regexp.test('/api/v1/audit/x');
    if (!hit) continue;
    mounts++;
    for (const l of layer.handle.stack) {
      if (!l.route) { check(false, `non-route layer under /audit: ${l.name}`); continue; }
      const methods = Object.keys(l.route.methods).filter((m) => l.route.methods[m]);
      check(methods.length === 1 && methods[0] === 'get', `route ${l.route.path} under /audit allows only: ${methods.join(',')}`);
    }
  }
  check(mounts === 1, `exactly one router mounted at /api/v1/audit (${mounts})`);
  // No top-level app.METHOD route may answer under /api/v1/audit either.
  const direct = stack.filter((l) => l.route && /audit/.test(String(l.route.path)));
  check(direct.length === 0, 'no top-level route mentions /audit');
};

// (ii) HTTP probe
const checkHttp = async () => {
  const email = process.env.adminEmail;
  const password = process.env.adminPassword;
  const login = await call('POST', '/api/v1/auth/login', null, { email, password });
  if (login.status !== 200) throw new Error(`admin login failed (${login.status})`);
  const adminT = login.json.token;
  const sfx = Date.now().toString(36) + Math.floor(Math.random() * 1e6).toString(36);
  const reg = await call('POST', '/api/v1/auth/register', null, {
    name: 'immut', telephone: '0812345678', email: `immut${sfx}@example.com`, password: 'secret123'
  });
  if (reg.status !== 201) throw new Error(`user register failed (${reg.status})`);
  const userT = reg.json.token;

  const id = new mongoose.Types.ObjectId().toString();
  const principals = [['admin', adminT], ['user', userT], ['anonymous', null]];
  for (const [who, tok] of principals) {
    for (const method of ['POST', 'PUT', 'PATCH', 'DELETE']) {
      for (const path of ['/api/v1/audit', `/api/v1/audit/${id}`]) {
        const r = await call(method, path, tok, method === 'DELETE' ? null : { action: 'view' });
        check(r.status === 404, `${who} ${method} ${path.replace(id, ':id')} -> ${r.status} (expect 404)`);
      }
    }
  }
  const one = await call('GET', `/api/v1/audit/${id}`, adminT);
  check(one.status === 404, `admin GET /api/v1/audit/:id -> ${one.status} (no such route, expect 404)`);
};

// (iii) every Mongoose modification path
const checkModel = async () => {
  const admin = new mongoose.Types.ObjectId();
  const booking = new mongoose.Types.ObjectId();
  const entry = await AuditLog.create({
    admin, action: 'edit', booking, before: { totalPrice: 1 }, after: { totalPrice: 2 }, reason: 'immutability-check'
  });
  const original = JSON.stringify(await AuditLog.findById(entry._id).lean());
  const totalBefore = await AuditLog.countDocuments({});
  const id = entry._id;
  const upd = { $set: { action: 'delete', 'after.totalPrice': 999 } };

  const attempts = {
    'Model.updateOne': () => AuditLog.updateOne({ _id: id }, upd),
    'Model.updateMany': () => AuditLog.updateMany({ _id: id }, upd),
    'Model.findOneAndUpdate': () => AuditLog.findOneAndUpdate({ _id: id }, upd),
    'Model.findByIdAndUpdate': () => AuditLog.findByIdAndUpdate(id, upd),
    'Model.replaceOne': () => AuditLog.replaceOne({ _id: id }, { admin, action: 'view', booking }),
    'Model.findOneAndReplace': () => AuditLog.findOneAndReplace({ _id: id }, { admin, action: 'view', booking }),
    'Model.deleteOne': () => AuditLog.deleteOne({ _id: id }),
    'Model.deleteMany': () => AuditLog.deleteMany({ _id: id }),
    'Model.findOneAndDelete': () => AuditLog.findOneAndDelete({ _id: id }),
    'Model.findByIdAndDelete': () => AuditLog.findByIdAndDelete(id),
    'doc.save (modified existing)': async () => { const d = await AuditLog.findById(id); d.action = 'delete'; d.after = { totalPrice: 999 }; return d.save(); },
    'doc.save (untouched existing)': async () => (await AuditLog.findById(id)).save(),
    'doc.deleteOne': async () => (await AuditLog.findById(id)).deleteOne(),
    'doc.updateOne': async () => (await AuditLog.findById(id)).updateOne(upd),
    'doc.replaceOne': async () => (await AuditLog.findById(id)).replaceOne({ admin, action: 'view', booking }),
    'bulkWrite updateOne': () => AuditLog.bulkWrite([{ updateOne: { filter: { _id: id }, update: upd } }]),
    'bulkWrite updateMany': () => AuditLog.bulkWrite([{ updateMany: { filter: { _id: id }, update: upd } }]),
    'bulkWrite replaceOne': () => AuditLog.bulkWrite([{ replaceOne: { filter: { _id: id }, replacement: { admin, action: 'view', booking } } }]),
    'bulkWrite deleteOne': () => AuditLog.bulkWrite([{ deleteOne: { filter: { _id: id } } }]),
    'bulkWrite deleteMany': () => AuditLog.bulkWrite([{ deleteMany: { filter: { _id: id } } }]),
    'bulkWrite insertOne mixed with deleteOne': () => AuditLog.bulkWrite([
      { insertOne: { document: { admin, action: 'view', booking } } },
      { deleteOne: { filter: { _id: id } } }
    ]),
    'bulkWrite upsert via updateOne': () => AuditLog.bulkWrite([{ updateOne: { filter: { _id: id }, update: upd, upsert: true } }]),
    'bulkSave of a modified existing doc': async () => { const d = await AuditLog.findById(id); d.action = 'delete'; return AuditLog.bulkSave([d]); },
    'insertMany with the existing _id (re-insert)': () => AuditLog.insertMany([{ _id: id, admin, action: 'delete', booking }]),
    'create with the existing _id': () => AuditLog.create({ _id: id, admin, action: 'delete', booking }),
    'new doc with existing _id .save()': () => new AuditLog({ _id: id, admin, action: 'delete', booking }).save()
  };
  for (const [name, fn] of Object.entries(attempts)) {
    let threw = false;
    try { await fn(); } catch (e) { threw = true; }
    check(threw, `${name} throws`);
  }
  const after = JSON.stringify(await AuditLog.findById(id).lean());
  check(after === original, 'entry is byte-for-byte unchanged after every attempt');
  check((await AuditLog.countDocuments({})) === totalBefore, 'no entry was added or removed by the blocked attempts');

  // The allowed path: append-only inserts.
  const extra = await AuditLog.bulkWrite([{ insertOne: { document: { admin, action: 'view', booking, reason: 'immutability-check' } } }]);
  check(extra.insertedCount === 1, 'bulkWrite insertOne (append) is still allowed');
  // timestamp is server-set: no body-supplied value is read by any route, and the field is immutable.
  const fresh = await AuditLog.create({ admin, action: 'view', booking });
  check(Math.abs(Date.now() - fresh.timestamp.getTime()) < 5000, 'timestamp defaults to the server clock');
  let strictThrew = false;
  try { await AuditLog.create({ admin, action: 'view', booking, bogus: 1 }); } catch (e) { strictThrew = true; }
  check(strictThrew, 'unknown fields are rejected (strict: throw)');
  let enumThrew = false;
  try { await AuditLog.create({ admin, action: 'promo', booking }); } catch (e) { enumThrew = true; }
  check(enumThrew, 'action outside view/edit/delete is rejected by the model');
};

(async () => {
  checkRouteTable();
  await checkHttp();
  await mongoose.connect(process.env.MONGO_URI, { serverSelectionTimeoutMS: 3000 });
  try {
    await checkModel();
  } finally {
    await mongoose.disconnect();
  }
  if (failures.length) {
    console.error(`audit-immutability-check: ${failures.length} violation(s)`);
    process.exit(1);
  }
  console.log('audit-immutability-check: all checks passed');
})().catch((e) => {
  console.error('audit-immutability-check error: ' + e.message);
  process.exit(1);
});
