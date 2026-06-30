#!/bin/bash
set -euo pipefail

ROOT_DIR="$(cd "$(dirname "$0")/.." && pwd)"
SCHEDULER_PID=""
SERVER_PID=""

shutdown() {
    trap - INT TERM
    if [[ -n "$SCHEDULER_PID" ]]; then
        kill "$SCHEDULER_PID" 2>/dev/null || true
    fi
    if [[ -n "$SERVER_PID" ]]; then
        kill "$SERVER_PID" 2>/dev/null || true
    fi
    wait "$SCHEDULER_PID" 2>/dev/null || true
    wait "$SERVER_PID" 2>/dev/null || true
}

trap shutdown INT TERM

case "${STACKARR_SCHEDULER_ENABLED:-true}" in
    0|false|False|FALSE|no|No|NO|off|Off|OFF)
        ;;
    *)
        "$ROOT_DIR/scripts/scheduler.sh" &
        SCHEDULER_PID="$!"
        ;;
esac

node apps/frontend/server.js &
SERVER_PID="$!"

if [[ -n "$SCHEDULER_PID" ]]; then
    wait -n "$SERVER_PID" "$SCHEDULER_PID"
else
    wait "$SERVER_PID"
fi
STATUS="$?"
shutdown
exit "$STATUS"
