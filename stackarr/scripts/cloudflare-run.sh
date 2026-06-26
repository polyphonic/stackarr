#!/bin/bash
set -euo pipefail

ROOT_DIR="$(cd "$(dirname "$0")/.." && pwd)"
# shellcheck source=lib/common.sh
source "$ROOT_DIR/lib/common.sh"

load_env

DEFAULT_TOKEN_FILE="$STATE_ROOT/cloudflared-token"
LOG_DIR="$LOG_ROOT/cloudflared"

TOKEN_FILE="${CLOUDFLARED_TOKEN_FILE:-$DEFAULT_TOKEN_FILE}"
if [[ ! -f "$TOKEN_FILE" && -n "${CLOUDFLARE_TUNNEL_TOKEN:-}" ]]; then
    mkdir -p "$(dirname "$TOKEN_FILE")"
    umask 077
    printf '%s\n' "$CLOUDFLARE_TUNNEL_TOKEN" > "$TOKEN_FILE"
fi
[[ -f "$TOKEN_FILE" ]] || fail "Missing Cloudflare tunnel token. Run 'stackarr cloudflare install' first."

if [[ -n "${CLOUDFLARED_BIN:-}" && -x "${CLOUDFLARED_BIN:-}" ]]; then
    CLOUDFLARED_CMD="$CLOUDFLARED_BIN"
else
    CLOUDFLARED_CMD="$(find_cloudflared_bin || true)"
fi

[[ -n "${CLOUDFLARED_CMD:-}" ]] || fail "cloudflared is not installed. Run 'brew install cloudflared' first."

ensure_dir "$LOG_DIR"

exec "$CLOUDFLARED_CMD" \
    tunnel \
    --no-autoupdate \
    --metrics "127.0.0.1:${CLOUDFLARED_METRICS_PORT:-42183}" \
    --loglevel info \
    --logfile "$LOG_DIR/cloudflared.log" \
    run \
    --token-file "$TOKEN_FILE"
