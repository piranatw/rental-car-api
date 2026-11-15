#!/usr/bin/env bash
# Presentation helper: starts a TEST-mode server (limiter off), runs one concurrency proof script
# against it, stops the server, and exits with the script's exit code.
# Usage:  source config/test-env.sh && bash scripts/demo-race.sh <promo|ticket|dispute|inspection|lock|all>
# The scripts write throwaway data into the *_test database only (each refuses any other name).
set -u
cd "$(dirname "$0")/.."

which="${1:-}"
case "$which" in
  promo) scripts=(promo-race.js) ;;
  ticket) scripts=(ticket-race-check.js) ;;
  dispute) scripts=(dispute-race-check.js) ;;
  inspection) scripts=(inspection-race-check.js) ;;
  lock) scripts=(lock-race-check.js) ;;
  all) scripts=(promo-race.js ticket-race-check.js dispute-race-check.js inspection-race-check.js lock-race-check.js) ;;
  *) echo "Usage: bash scripts/demo-race.sh <promo|ticket|dispute|inspection|lock|all>" >&2; exit 2 ;;
esac

if [ -z "${MONGO_URI:-}" ]; then
  echo "MONGO_URI is not set. Run: source config/test-env.sh" >&2
  exit 1
fi
_noq="${MONGO_URI%%\?*}"
case "${_noq##*/}" in
  *_test) ;;
  *) echo "Refusing to run: the database name in MONGO_URI must end with _test." >&2; exit 1 ;;
esac
if [ -z "${adminEmail:-}" ] || [ -z "${adminPassword:-}" ]; then
  echo "adminEmail and adminPassword must be set. Run: source config/test-env.sh" >&2
  exit 1
fi

export PORT="${PORT:-5051}"
export NODE_ENV=test
export SEED_ADMIN_EMAIL="$adminEmail"
export SEED_ADMIN_PASSWORD="$adminPassword"
unset RATE_LIMIT_FORCE

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
[ "$ready" -eq 1 ] || { echo "Server did not open port $PORT in time" >&2; exit 1; }

rc=0
for s in "${scripts[@]}"; do
  echo "=== node scripts/$s ==="
  node "scripts/$s" || rc=1
done
exit "$rc"
