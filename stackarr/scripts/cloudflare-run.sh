#!/bin/bash
set -euo pipefail

ROOT_DIR="$(cd "$(dirname "$0")/.." && pwd)"
# shellcheck source=lib/common.sh
source "$ROOT_DIR/lib/common.sh"

load_env

DEFAULT_TOKEN_FILE="$STATE_ROOT/cloudflared-token"
LOG_DIR="$LOG_ROOT/cloudflared"

TOKEN_FILE="${CLOUDFLARED_TOKEN_FILE:-$DEFAULT_TOKEN_FILE}"
[[ -f "$TOKEN_FILE" ]] || fail "Missing Cloudflare connector token. Run 'stackarr cloudflare install --api-token <token>' first."

CLOUDFLARED_CMD="$(managed_cloudflared_bin)"
[[ -x "$CLOUDFLARED_CMD" ]] || fail "Stackarr-managed cloudflared is missing. Run 'stackarr cloudflare start' to install it in app data."

ensure_dir "$LOG_DIR"

exec "$CLOUDFLARED_CMD" \
    tunnel \
    --no-autoupdate \
    --metrics "127.0.0.1:${CLOUDFLARED_METRICS_PORT:-42183}" \
    --loglevel info \
    --logfile "$LOG_DIR/cloudflared.log" \
    run \
    --token-file "$TOKEN_FILE"
