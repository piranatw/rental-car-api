#!/usr/bin/env bash
# Runs the Newman suite against a freshly dropped TEST database.
# Requires MONGO_URI (database name must end in _test); `source config/test-env.sh` first.
set -u
cd "$(dirname "$0")/.."

if [ -z "${MONGO_URI:-}" ]; then
  echo "MONGO_URI is not set. Run: source config/test-env.sh" >&2
  exit 1
fi

# Database name = last path segment before '?'
_noq="${MONGO_URI%%\?*}"
_db="${_noq##*/}"
case "$_db" in
  *_test) ;;
  *)
    echo "Refusing to run: the database name in MONGO_URI must end with _test (tests drop the database)." >&2
    exit 1
    ;;
esac

export PORT="${PORT:-5050}"
export NODE_ENV=test

# Seed credentials come from the same values the Postman environment uses.
if [ -n "${adminEmail:-}" ] && [ -n "${adminPassword:-}" ]; then
  export SEED_ADMIN_EMAIL="$adminEmail"
  export SEED_ADMIN_PASSWORD="$adminPassword"
else
  echo "adminEmail and adminPassword must be set. Run: source config/test-env.sh" >&2
  exit 1
fi

# Start clean: drop the test database (name check above already passed).
node -e "
const mongoose = require('mongoose');
mongoose.connect(process.env.MONGO_URI, { serverSelectionTimeoutMS: 3000 })
  .then(() => mongoose.connection.dropDatabase())
  .then(() => mongoose.disconnect())
  .catch((e) => { console.error('Could not drop test database: ' + e.message); process.exit(1); });
" || exit 1

node server.js > /tmp/rental-api-test-server.log 2>&1 &
SERVER_PID=$!
trap 'kill "$SERVER_PID" 2>/dev/null' EXIT

ready=0
for _ in $(seq 1 50); do
  if ! kill -0 "$SERVER_PID" 2>/dev/null; then
    echo "Server exited early; see /tmp/rental-api-test-server.log" >&2
    exit 1
  fi
  if (exec 3<>"/dev/tcp/127.0.0.1/$PORT") 2>/dev/null; then ready=1; break; fi
  sleep 0.2
done
if [ "$ready" -ne 1 ]; then
  echo "Server did not open port $PORT in time" >&2
  exit 1
fi

npx newman run __tests__/rental.postman_collection.json \
  -e __tests__/rental.postman_environment.json \
  --env-var "baseUrl=http://localhost:$PORT" \
  --env-var "adminEmail=$adminEmail" \
  --env-var "adminPassword=$adminPassword" \
  --reporters cli,json --reporter-json-export newman-report.json
rc=$?

kill "$SERVER_PID" 2>/dev/null
wait "$SERVER_PID" 2>/dev/null
exit "$rc"
