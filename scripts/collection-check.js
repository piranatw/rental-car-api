// Pure guard (no server, no database) for __tests__/rental.postman_collection.json. Fails on:
//  - a duplicate top-level folder name;
//  - a duplicate item name within the same folder path;
//  - a folder named in PASS_A_FOLDERS, PASS_B_FOLDERS or the Disputes phases that does not exist exactly once.
// The folder-name lists are read by parsing scripts/run-newman.sh (the single source of truth):
// the PASS_A_FOLDERS=(...) / PASS_B_FOLDERS=(...) arrays and every quoted "Disputes <n> ..." phase name.
// With no argument it checks the main collection and then __tests__/demo.postman_collection.json.
// A collection whose file name contains "demo" is not run by run-newman.sh, so it only gets the duplicate checks
// (sibling names, and every request name unique across the whole collection: setNextRequest finds requests by name).
// Usage: node scripts/collection-check.js [collection.json]
const fs = require('fs');
const path = require('path');

const root = path.join(__dirname, '..');
const collectionPath = process.argv[2] || path.join(root, '__tests__', 'rental.postman_collection.json');
const script = fs.readFileSync(path.join(__dirname, 'run-newman.sh'), 'utf8');
const col = JSON.parse(fs.readFileSync(collectionPath, 'utf8'));

const dupOnly = path.basename(collectionPath).includes('demo');
const problems = [];

const arrayOf = (name) => {
  const m = new RegExp(`^${name}=\\(([^)]*)\\)`, 'm').exec(script);
  if (!m) { problems.push(`could not find ${name} in scripts/run-newman.sh`); return []; }
  return m[1].trim().split(/\s+/).filter(Boolean);
};
const phases = [...new Set(script.match(/"Disputes \d[^"]*"/g) || [])].map((s) => s.slice(1, -1));

// Walk the tree: duplicate sibling names, and a count of every folder name.
const folderCount = new Map();
const walk = (items, trail) => {
  const seen = new Set();
  for (const it of items) {
    const here = trail.concat(it.name);
    if (seen.has(it.name)) problems.push(`duplicate name "${it.name}" in ${trail.length ? trail.join(' / ') : 'the collection root (duplicate top-level folder)'}`);
    seen.add(it.name);
    if (Array.isArray(it.item)) {
      folderCount.set(it.name, (folderCount.get(it.name) || 0) + 1);
      walk(it.item, here);
    }
  }
};
walk(col.item || [], []);
if (dupOnly) {
  const names = new Map();
  const all = (items) => items.forEach((it) => { if (Array.isArray(it.item)) all(it.item); else names.set(it.name, (names.get(it.name) || 0) + 1); });
  all(col.item || []);
  for (const [n, c] of names) if (c > 1) problems.push(`request name "${n}" is used ${c} times in the collection`);
}

if (!dupOnly) checkRunLists();
function checkRunLists() {
const topLevel = new Set((col.item || []).filter((i) => Array.isArray(i.item)).map((i) => i.name));
for (const f of [...arrayOf('PASS_A_FOLDERS'), ...arrayOf('PASS_B_FOLDERS')]) {
  const n = folderCount.get(f) || 0;
  if (n !== 1 || !topLevel.has(f)) problems.push(`folder "${f}" named in run-newman.sh must exist exactly once as a top-level folder (found ${n})`);
}
if (phases.length === 0) problems.push('no Disputes phase names found in scripts/run-newman.sh');
for (const f of phases) {
  const n = folderCount.get(f) || 0;
  if (n !== 1) problems.push(`Disputes phase "${f}" must exist exactly once (found ${n})`);
}
const topDisputes = (col.item || []).filter((i) => i.name === 'Disputes').length;
if (topDisputes !== 1) problems.push(`top-level folder "Disputes" must exist exactly once (found ${topDisputes})`);
// A folder that exists but is not named in any run list never runs: every top-level folder must be
// accounted for (PASS_A_FOLDERS, PASS_B_FOLDERS, or the Disputes group that run_disputes drives).
const accounted = new Set([...arrayOf('PASS_A_FOLDERS'), ...arrayOf('PASS_B_FOLDERS'), 'Disputes']);
for (const name of topLevel) {
  if (!accounted.has(name)) problems.push(`top-level folder "${name}" exists in the collection but is not named in PASS_A_FOLDERS or PASS_B_FOLDERS in scripts/run-newman.sh, so it would never run`);
}

}

if (problems.length) {
  for (const p of problems) console.error('collection-check: ' + p);
  console.error(`collection-check: ${problems.length} problem(s)`);
  process.exit(1);
}
console.log(`collection-check: ok (${path.basename(collectionPath)})`);
if (!process.argv[2]) {
  const r = require('child_process').spawnSync(process.execPath, [__filename, path.join(root, '__tests__', 'demo.postman_collection.json')], { stdio: 'inherit' });
  process.exit(r.status === null ? 1 : r.status);
}
