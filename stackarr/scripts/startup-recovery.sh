#!/bin/bash
set -euo pipefail

ROOT_DIR="$(cd "$(dirname "$0")/.." && pwd)"
source "$ROOT_DIR/lib/common.sh"

# Docker restart policies bypass Compose's health ordering. Run independently
# of the optional maintenance scheduler on every controller start, then exit.
attempts="${STACKARR_STARTUP_RECOVERY_ATTEMPTS:-60}"
interval="${STACKARR_STARTUP_RECOVERY_INTERVAL_SECONDS:-5}"
[[ "$attempts" =~ ^[1-9][0-9]*$ ]] || exit 1
[[ "$interval" =~ ^[0-9]+([.][0-9]+)?$ ]] || exit 1
STACKARR_RECOVERY_STATE_DIR="$(mktemp -d "${TMPDIR:-/tmp}/stackarr-startup-recovery.XXXXXX")"
export STACKARR_RECOVERY_STATE_DIR
sleep_pid=""
cleanup() {
    [[ -z "$sleep_pid" ]] || kill "$sleep_pid" 2>/dev/null || true
    rm -rf "$STACKARR_RECOVERY_STATE_DIR"
}
trap cleanup EXIT
trap 'exit 0' INT TERM

for ((attempt = 0; attempt < attempts; attempt++)); do
    # load_env fails closed while authoritative settings are unavailable.
    # Keep that exit in a subshell so the next probe can retry after recovery.
    (load_env && recover_database_startup_failures) || true
    (( attempt + 1 < attempts )) || break
    sleep "$interval" &
    sleep_pid="$!"
    wait "$sleep_pid" || true
    sleep_pid=""
done
