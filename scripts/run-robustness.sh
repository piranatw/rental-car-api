#!/usr/bin/env bash
# Runs the robustness collection (malformed input, injection, odd ids, ...) against a fresh TEST database.
# Requires MONGO_URI (database name must end in _test), adminEmail and adminPassword: `source config/test-env.sh` first.
set -u
cd "$(dirname "$0")/.."

if [ -z "${MONGO_URI:-}" ]; then
  echo "MONGO_URI is not set. Run: source config/test-env.sh" >&2
  exit 1
fi
_noq="${MONGO_URI%%\?*}"
_db="${_noq##*/}"
case "$_db" in
  *_test) ;;
  *)
    echo "Refusing to run: the database name in MONGO_URI must end with _test (the run drops it)." >&2
    exit 1
    ;;
esac
if [ -z "${adminEmail:-}" ] || [ -z "${adminPassword:-}" ]; then
  echo "adminEmail and adminPassword must be set. Run: source config/test-env.sh" >&2
  exit 1
fi

export PORT="${PORT:-5050}"
export NODE_ENV=test
export SEED_ADMIN_EMAIL="$adminEmail"
export SEED_ADMIN_PASSWORD="$adminPassword"

node -e "
const mongoose = require('mongoose');
mongoose.connect(process.env.MONGO_URI, { serverSelectionTimeoutMS: 3000 })
  .then(() => mongoose.connection.dropDatabase())
  .then(() => mongoose.disconnect())
  .catch((e) => { console.error('Could not drop test database: ' + e.message); process.exit(1); });
" || exit 1

log="$(mktemp)"
node server.js > "$log" 2>&1 &
pid=$!
trap 'kill "$pid" 2>/dev/null; wait "$pid" 2>/dev/null; rm -f "$log"' EXIT

ready=0
for _ in $(seq 1 50); do
  if ! kill -0 "$pid" 2>/dev/null; then echo "Server exited early:" >&2; cat "$log" >&2; exit 1; fi
  if (exec 3<>"/dev/tcp/127.0.0.1/$PORT") 2>/dev/null; then ready=1; break; fi
  sleep 0.2
done
if [ "$ready" -ne 1 ]; then echo "Server did not open port $PORT in time" >&2; exit 1; fi

npx newman run __tests__/robustness.postman_collection.json \
  --env-var "baseUrl=http://localhost:$PORT" \
  --env-var "adminEmail=$adminEmail" --env-var "adminPassword=$adminPassword" \
  --reporters cli,json --reporter-json-export newman-report-robustness.json
