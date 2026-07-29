#!/bin/bash
set -euo pipefail

ROOT_DIR="$(cd "$(dirname "$0")/.." && pwd)"
# shellcheck source=lib/common.sh
source "$ROOT_DIR/lib/common.sh"

usage() {
    cat <<'EOF'
Usage:
  stackarr questarr status
  stackarr questarr url
  stackarr questarr open
  stackarr questarr enable
  stackarr questarr disable
  stackarr questarr apply
  stackarr questarr configure
EOF
}

questarr_url() {
    printf '%s\n' "${QUESTARR_URL:-http://127.0.0.1:${QUESTARR_WEB_PORT:-7584}}"
}

print_status() {
    if optional_service_enabled questarr; then ok "Questarr is enabled"; else warn "Questarr is disabled"; fi
    echo "URL: $(questarr_url)"
    echo "Downloads: ${DOWNLOADS_ROOT} -> /downloads"
    echo "Optional game destination: ${QUESTARR_LIBRARY_ROOT:-${ROMM_LIBRARY_ROOT:-$GAMES_ROOT}} -> /games"
    echo "Database: SQLite at ${QUESTARR_DATA_ROOT:-$CONFIG_ROOT/questarr}/sqlite.db (current Questarr releases do not support PostgreSQL)"
    if [[ -n "${QUESTARR_IGDB_CLIENT_ID:-}" && -n "${QUESTARR_IGDB_CLIENT_SECRET:-}" ]]; then echo "IGDB: configured"; else echo "IGDB: needs setup"; fi

    if command -v docker >/dev/null 2>&1 && docker info >/dev/null 2>&1; then
        stackarr_compose --profile questarr ps questarr || true
    else
        warn "Docker runtime is not ready; container status skipped"
    fi
}

set_enabled() {
    local enabled="$1"
    set_env_value ENABLE_QUESTARR "$enabled"
    set_env_value QUESTARR_URL "${QUESTARR_URL:-http://127.0.0.1:${QUESTARR_WEB_PORT:-7584}}"
    set_env_value QUESTARR_APP_URL "${QUESTARR_APP_URL:-${QUESTARR_URL:-http://127.0.0.1:7584}}"
    set_env_value QUESTARR_ALLOWED_ORIGINS "${QUESTARR_ALLOWED_ORIGINS:-${QUESTARR_URL:-http://127.0.0.1:7584},http://localhost:${QUESTARR_WEB_PORT:-7584}}"
    set_env_value QUESTARR_BIND_IP "${QUESTARR_BIND_IP:-127.0.0.1}"
    set_env_value QUESTARR_WEB_PORT "${QUESTARR_WEB_PORT:-7584}"
    set_env_value QUESTARR_CONTAINER_PORT "${QUESTARR_CONTAINER_PORT:-5000}"
    set_env_value QUESTARR_DATA_ROOT "${QUESTARR_DATA_ROOT:-$CONFIG_ROOT/questarr}"
    set_env_value QUESTARR_LIBRARY_ROOT "${QUESTARR_LIBRARY_ROOT:-${ROMM_LIBRARY_ROOT:-$GAMES_ROOT}}"
    set_env_value QUESTARR_SQLITE_DB_PATH "${QUESTARR_SQLITE_DB_PATH:-/app/data/sqlite.db}"
    set_env_value QUESTARR_IGDB_CLIENT_ID "${QUESTARR_IGDB_CLIENT_ID:-${ROMM_IGDB_CLIENT_ID:-}}"
    set_env_value QUESTARR_IGDB_CLIENT_SECRET "${QUESTARR_IGDB_CLIENT_SECRET:-${ROMM_IGDB_CLIENT_SECRET:-}}"
    set_env_value QUESTARR_JWT_SECRET "${QUESTARR_JWT_SECRET:-$(random_secret 32)}"
    set_env_value QUESTARR_IMAGE "${QUESTARR_IMAGE:-ghcr.io/doezer/questarr:latest}"
    write_compose_env_file
    ok "Questarr ENABLE_QUESTARR=$enabled saved"
    warn "Run 'stackarr questarr apply' to reconcile the container, then 'stackarr questarr configure' to connect Questarr."
}

configure_questarr() {
    local prowlarr_key
    prowlarr_key="$(parse_api_key_xml "$CONFIG_ROOT/prowlarr/config.xml" || true)"
    [[ -n "$prowlarr_key" ]] || fail "Prowlarr API key is unavailable; start Prowlarr before configuring Questarr"
    export PROWLARR_API_KEY="$prowlarr_key"
    node "$ROOT_DIR/scripts/questarr-configure.cjs"
}

load_env
case "${1:-help}" in
    status) print_status ;;
    url) questarr_url ;;
    open)
        if [[ "$(uname -s 2>/dev/null || true)" == "Darwin" ]]; then open "$(questarr_url)"; else questarr_url; fi
        ;;
    enable) set_enabled true ;;
    disable) set_enabled false ;;
    apply) exec "$ROOT_DIR/scripts/service-apply.sh" apply questarr ;;
    configure) configure_questarr ;;
    help|--help|-h) usage ;;
    *) usage; exit 1 ;;
esac
