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
  stackarr questarr romm-import status
  stackarr questarr romm-import enable
  stackarr questarr romm-import disable
  stackarr questarr romm-import run [--yes]
  stackarr questarr romm-library sync [--yes] [--limit 20]
EOF
}

questarr_url() {
    printf '%s\n' "${QUESTARR_URL:-http://127.0.0.1:${QUESTARR_WEB_PORT:-7584}}"
}

print_status() {
    if optional_service_enabled questarr; then ok "Questarr is enabled"; else warn "Questarr is disabled"; fi
    echo "URL: $(questarr_url)"
    echo "Downloads: ${DOWNLOADS_ROOT} -> /downloads"
    echo "Stackarr-managed game destination: ${QUESTARR_LIBRARY_ROOT:-${ROMM_LIBRARY_ROOT:-$GAMES_ROOT}} -> /stackarr-romm-library (controller only; Questarr remains download-only)"
    echo "Database: SQLite at ${QUESTARR_DATA_ROOT:-$CONFIG_ROOT/questarr}/sqlite.db (current Questarr releases do not support PostgreSQL)"
    if [[ -n "${QUESTARR_IGDB_CLIENT_ID:-}" && -n "${QUESTARR_IGDB_CLIENT_SECRET:-}" ]]; then echo "IGDB: configured"; else echo "IGDB: needs setup"; fi

    if command -v docker >/dev/null 2>&1 && docker info >/dev/null 2>&1; then
        stackarr_compose --profile questarr ps questarr || true
    else
        warn "Docker runtime is not ready; container status skipped"
    fi
}

print_romm_import_status() {
    if [[ "${QUESTARR_ROMM_IMPORT_ENABLED:-false}" == "true" ]]; then
        ok "Secure Questarr to RomM import is enabled"
    else
        warn "Secure Questarr to RomM import is disabled"
    fi
    echo "Transfer mode: ${QUESTARR_ROMM_TRANSFER_MODE:-hardlink}"
    echo "ClamAV required: ${QUESTARR_ROMM_CLAMAV_ENABLED:-true}"
    echo "Import batch limit: ${QUESTARR_ROMM_IMPORT_LIMIT:-10}"
    echo "RomM filesystem watcher: ${ROMM_ENABLE_RESCAN_ON_FILESYSTEM_CHANGE:-false} (Stackarr triggers targeted scans)"
}

set_romm_import_enabled() {
    local enabled="$1"
    if [[ "$enabled" == "true" && "${ENABLE_ROMM:-false}" != "true" ]]; then
        fail "Enable RomM before enabling Questarr secure import"
    fi
    set_env_value QUESTARR_ROMM_IMPORT_ENABLED "$enabled"
    set_env_value QUESTARR_ROMM_TRANSFER_MODE "${QUESTARR_ROMM_TRANSFER_MODE:-hardlink}"
    set_env_value QUESTARR_ROMM_DOWNLOAD_ROOT "${QUESTARR_ROMM_DOWNLOAD_ROOT:-/downloads}"
    set_env_value QUESTARR_ROMM_LIBRARY_ROOT "${QUESTARR_ROMM_LIBRARY_ROOT:-/stackarr-romm-library}"
    set_env_value QUESTARR_ROMM_CLAMAV_ENABLED "${QUESTARR_ROMM_CLAMAV_ENABLED:-true}"
    set_env_value QUESTARR_ROMM_CLAMAV_HOST "${QUESTARR_ROMM_CLAMAV_HOST:-clamav}"
    set_env_value QUESTARR_ROMM_CLAMAV_PORT "${QUESTARR_ROMM_CLAMAV_PORT:-3310}"
    set_env_value QUESTARR_ROMM_IMPORT_LIMIT "${QUESTARR_ROMM_IMPORT_LIMIT:-10}"
    set_env_value CLAMAV_DATA_ROOT "${CLAMAV_DATA_ROOT:-$CONFIG_ROOT/clamav}"
    local clamav_image="${CLAMAV_IMAGE:-clamav/clamav-debian:stable}"
    if [[ "$clamav_image" == "clamav/clamav:stable" ]]; then
        clamav_image="clamav/clamav-debian:stable"
    fi
    set_env_value CLAMAV_IMAGE "$clamav_image"
    set_env_value ROMM_ENABLE_RESCAN_ON_FILESYSTEM_CHANGE false
    write_compose_env_file
    ok "Questarr secure RomM import enabled=$enabled saved"
    warn "Run 'stackarr questarr apply' to reconcile Questarr and ClamAV."
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
    local definition_source="$ROOT_DIR/config/prowlarr/internetarchive-games.yml"
    local definition_target="$CONFIG_ROOT/prowlarr/Definitions/Custom/internetarchive-stackarr.yml"
    if [[ ! -f "$definition_target" ]] || ! cmp -s "$definition_source" "$definition_target"; then
        ensure_dir "$(dirname "$definition_target")"
        install -m 0644 "$definition_source" "$definition_target"
        if command -v docker >/dev/null 2>&1 && docker info >/dev/null 2>&1; then
            stackarr_compose --profile questarr restart prowlarr >/dev/null
            if [[ -f /.dockerenv ]]; then
                wait_for_http "Prowlarr" "http://prowlarr:9696/ping" 120 2
            else
                wait_for_http "Prowlarr" "http://127.0.0.1:${PROWLARR_PORT:-9696}/ping" 120 2
            fi
        fi
    fi
    prowlarr_key="$(parse_api_key_xml "$CONFIG_ROOT/prowlarr/config.xml" || true)"
    [[ -n "$prowlarr_key" ]] || fail "Prowlarr API key is unavailable; start Prowlarr before configuring Questarr"
    export PROWLARR_API_KEY="$prowlarr_key"
    local configure_url="${QUESTARR_CONFIGURE_URL:-}"
    if [[ -z "$configure_url" ]]; then
        if [[ -f /.dockerenv ]]; then configure_url="http://questarr:5000"
        else configure_url="http://127.0.0.1:${QUESTARR_WEB_PORT:-7584}"
        fi
    fi
    QUESTARR_CONFIGURE_URL="$configure_url" node "$ROOT_DIR/scripts/questarr-configure.cjs"
}

run_romm_import() {
    export STACKARR_DATABASE_FILE="${STACKARR_DATABASE_FILE:-$CONFIG_ROOT/stackarr.db}"
    export STACKARR_REPO_ROOT="$REPO_ROOT"
    export NODE_OPTIONS="${NODE_OPTIONS:+$NODE_OPTIONS }--disable-warning=ExperimentalWarning"
    local mcp_entrypoint="$REPO_ROOT/packages/mcp/dist/index.js"
    [[ -f "$mcp_entrypoint" ]] || fail "Built Stackarr MCP entrypoint is missing: $mcp_entrypoint"
    exec node "$mcp_entrypoint" questarr-romm-import run "$@"
}

run_romm_owned_sync() {
    export STACKARR_DATABASE_FILE="${STACKARR_DATABASE_FILE:-$CONFIG_ROOT/stackarr.db}"
    export STACKARR_REPO_ROOT="$REPO_ROOT"
    export NODE_OPTIONS="${NODE_OPTIONS:+$NODE_OPTIONS }--disable-warning=ExperimentalWarning"
    local mcp_entrypoint="$REPO_ROOT/packages/mcp/dist/index.js"
    [[ -f "$mcp_entrypoint" ]] || fail "Built Stackarr MCP entrypoint is missing: $mcp_entrypoint"
    exec node "$mcp_entrypoint" romm-owned-sync run "$@"
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
    romm-import)
        case "${2:-status}" in
            status) print_romm_import_status ;;
            enable) set_romm_import_enabled true ;;
            disable) set_romm_import_enabled false ;;
            run) shift 2; run_romm_import "$@" ;;
            *) usage; exit 1 ;;
        esac
        ;;
    romm-library)
        case "${2:-sync}" in
            sync) shift 2; run_romm_owned_sync "$@" ;;
            *) usage; exit 1 ;;
        esac
        ;;
    help|--help|-h) usage ;;
    *) usage; exit 1 ;;
esac
