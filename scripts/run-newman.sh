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

# Pass A: folders run with the IP login limiter skipped (NODE_ENV=test). To add a
# folder to the suite, add its name here -- nothing else needs to change.
PASS_A_FOLDERS=(Auth Bookings LoginProtection Promos Tickets Audit)
# Pass B: folders run on a second server with RATE_LIMIT_FORCE=1 (fresh limiter state).
PASS_B_FOLDERS=(RateLimit429)

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

SERVER_PID=""
stop_server() {
  if [ -n "$SERVER_PID" ]; then
    kill "$SERVER_PID" 2>/dev/null
    wait "$SERVER_PID" 2>/dev/null
    SERVER_PID=""
  fi
}
trap stop_server EXIT

# start_server <log-file> [VAR=value ...]  -- starts node server.js, waits for the port.
start_server() {
  local log="$1"; shift
  env "$@" node server.js > "$log" 2>&1 &
  SERVER_PID=$!
  local ready=0
  for _ in $(seq 1 50); do
    if ! kill -0 "$SERVER_PID" 2>/dev/null; then
      echo "Server exited early; see $log" >&2
      SERVER_PID=""
      return 1
    fi
    if (exec 3<>"/dev/tcp/127.0.0.1/$PORT") 2>/dev/null; then ready=1; break; fi
    sleep 0.2
  done
  if [ "$ready" -ne 1 ]; then
    echo "Server did not open port $PORT in time" >&2
    stop_server
    return 1
  fi
}

# run_folders <report-file> <with-admin:0|1> <folder>...
run_folders() {
  local report="$1" admin="$2"; shift 2
  local args=() f
  for f in "$@"; do args+=(--folder "$f"); done
  local creds=()
  # Pass B skips the admin pre-login: it would consume one of the limiter's 10 slots.
  if [ "$admin" = "1" ]; then creds=(--env-var "adminEmail=$adminEmail" --env-var "adminPassword=$adminPassword"); fi
  npx newman run __tests__/rental.postman_collection.json \
    -e __tests__/rental.postman_environment.json \
    --env-var "baseUrl=http://localhost:$PORT" \
    ${creds[@]+"${creds[@]}"} "${args[@]}" \
    --reporters cli,json --reporter-json-export "$report"
}

overall=0

echo "=== Pass A: ${PASS_A_FOLDERS[*]} (limiter skipped) ==="
start_server /tmp/rental-api-test-server.log || exit 1
echo "=== Seed audit log (5000 entries) ==="
node scripts/seed-audit.js || exit 1
run_folders newman-report.json 1 "${PASS_A_FOLDERS[@]}" || overall=1
echo "=== Lock expiry check ==="
node scripts/lock-expiry-check.js || overall=1
echo "=== Lock race check ==="
node scripts/lock-race-check.js || overall=1
echo "=== Promo race check ==="
node scripts/promo-race.js || overall=1
echo "=== Promo undo check ==="
node scripts/promo-undo-check.js || overall=1
echo "=== Promo edit race check ==="
node scripts/promo-edit-race.js || overall=1
echo "=== Ticket race check ==="
node scripts/ticket-race-check.js || overall=1
echo "=== Ticket index check ==="
node scripts/ticket-index-check.js || overall=1
echo "=== Timing check ==="
node scripts/timing-check.js || overall=1
echo "=== Audit index check ==="
node scripts/audit-index-check.js || overall=1
echo "=== Audit failure/order check ==="
node scripts/audit-failure-check.js || overall=1
echo "=== Audit immutability check ==="
node scripts/audit-immutability-check.js || overall=1
echo "=== Env validator check ==="
node scripts/env-check.js || overall=1
stop_server

echo "=== Pass B: ${PASS_B_FOLDERS[*]} (RATE_LIMIT_FORCE=1, fresh server) ==="
start_server /tmp/rental-api-test-server-b.log RATE_LIMIT_FORCE=1 || exit 1
run_folders newman-report-b.json 0 "${PASS_B_FOLDERS[@]}" || overall=1
stop_server

exit "$overall"
