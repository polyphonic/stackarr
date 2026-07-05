#!/bin/bash
set -euo pipefail

ROOT_DIR="$(cd "$(dirname "$0")/.." && pwd)"
# shellcheck source=lib/common.sh
source "$ROOT_DIR/lib/common.sh"

usage() {
    cat <<'EOF'
Usage:
  stackarr immich status
  stackarr immich url
  stackarr immich open
  stackarr immich enable
  stackarr immich disable
EOF
}

print_immich_status() {
    if optional_service_enabled immich; then
        ok "Immich is enabled"
    else
        warn "Immich is disabled"
    fi

    echo "URL: ${IMMICH_URL:-http://127.0.0.1:${IMMICH_WEB_PORT:-2283}}"
    echo "Upload location: ${IMMICH_UPLOAD_LOCATION:-$MEDIA_ROOT/Pictures}"
    echo "Database: shared Postgres database ${IMMICH_DB_DATABASE_NAME:-immich} as ${IMMICH_DB_USERNAME:-immich}"
    echo "Redis: shared redis service"

    if command -v docker >/dev/null 2>&1 && docker info >/dev/null 2>&1; then
        stackarr_compose --profile database --profile immich ps immich immich-ml database redis || true
    else
        warn "Docker runtime is not ready; container status skipped"
    fi
}

open_immich() {
    local url="${IMMICH_URL:-http://127.0.0.1:${IMMICH_WEB_PORT:-2283}}"
    case "$(uname -s 2>/dev/null || true)" in
        Darwin)
            open "$url"
            ;;
        *)
            echo "$url"
            ;;
    esac
}

set_immich_enabled() {
    local enabled="$1"
    set_env_value ENABLE_IMMICH "$enabled"
    set_env_value IMMICH_URL "${IMMICH_URL:-http://127.0.0.1:${IMMICH_WEB_PORT:-2283}}"
    set_env_value IMMICH_BIND_IP "${IMMICH_BIND_IP:-127.0.0.1}"
    set_env_value IMMICH_WEB_PORT "${IMMICH_WEB_PORT:-2283}"
    set_env_value IMMICH_UPLOAD_LOCATION "${IMMICH_UPLOAD_LOCATION:-$MEDIA_ROOT/Pictures}"
    set_env_value IMMICH_DB_USERNAME "${IMMICH_DB_USERNAME:-immich}"
    set_env_value IMMICH_DB_DATABASE_NAME "${IMMICH_DB_DATABASE_NAME:-immich}"
    set_env_value IMMICH_DB_VECTOR_EXTENSION "${IMMICH_DB_VECTOR_EXTENSION:-pgvector}"
    if [[ "$enabled" == "true" && -z "${IMMICH_DB_PASSWORD:-}" ]]; then
        set_env_value IMMICH_DB_PASSWORD "$(random_secret 24)"
    fi
    ok "Immich ENABLE_IMMICH=$enabled saved"
    warn "Run 'stackarr up' to apply the service profile. Use 'stackarr cloudflare install --route <hostname>=immich' to publish it."
}

load_env
subcommand="${1:-status}"
case "$subcommand" in
    status)
        print_immich_status
        ;;
    url)
        echo "${IMMICH_URL:-http://127.0.0.1:${IMMICH_WEB_PORT:-2283}}"
        ;;
    open)
        open_immich
        ;;
    enable)
        set_immich_enabled true
        ;;
    disable)
        set_immich_enabled false
        ;;
    help|--help|-h)
        usage
        ;;
    *)
        usage
        exit 1
        ;;
esac
