#!/bin/bash
set -euo pipefail

# Scheduler and MCP are retryable workers, never a reason to terminate the web
# controller. Keep their child PID so shutdown cannot orphan a worker.
name="$1"
shift
child=""
sleep_pid=""
stop() {
    trap - INT TERM
    [[ -z "$sleep_pid" ]] || kill "$sleep_pid" 2>/dev/null || true
    [[ -z "$child" ]] || kill "$child" 2>/dev/null || true
    [[ -z "$child" ]] || wait "$child" 2>/dev/null || true
    exit 0
}
trap stop INT TERM
while true; do
    "$@" &
    child="$!"
    wait "$child" || true
    child=""
    printf '[stackarr-controller] %s worker exited; retrying\n' "$name" >&2
    sleep "${STACKARR_WORKER_RETRY_SECONDS:-5}" &
    sleep_pid="$!"
    wait "$sleep_pid" || true
    sleep_pid=""
done