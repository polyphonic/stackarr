#!/bin/bash
set -euo pipefail

ROOT_DIR="$(cd "$(dirname "$0")/.." && pwd)"
# shellcheck source=lib/common.sh
source "$ROOT_DIR/lib/common.sh"

usage() {
    cat <<'EOF'
Usage:
  stackarr romm status
  stackarr romm url
  stackarr romm open
  stackarr romm enable
  stackarr romm disable
  stackarr romm metadata apply
EOF
}

romm_url() {
    printf '%s\n' "${ROMM_URL:-http://127.0.0.1:${ROMM_WEB_PORT:-7583}}"
}

print_romm_status() {
    if optional_service_enabled romm; then
        ok "RomM is enabled"
    else
        warn "RomM is disabled"
    fi

    echo "URL: $(romm_url)"
    echo "Library location: ${ROMM_LIBRARY_ROOT:-${GAMES_ROOT:-$MEDIA_ROOT/Games}}"
    echo "Assets location: ${ROMM_ASSETS_ROOT:-$CONFIG_ROOT/romm/assets}"
    echo "Database: ${ROMM_DB_DRIVER:-postgresql}://${ROMM_DB_USER:-romm}@${ROMM_DB_HOST:-database}:${ROMM_DB_PORT:-5432}/${ROMM_DB_NAME:-romm}"
    echo "Redis: ${ROMM_REDIS_HOST:-redis}:${ROMM_REDIS_PORT:-6379}"
    echo "Public exposure: disabled by default; no Cloudflare route is added unless you explicitly create one"

    if command -v docker >/dev/null 2>&1 && docker info >/dev/null 2>&1; then
        stackarr_compose --profile romm ps romm database redis || true
    else
        warn "Docker runtime is not ready; container status skipped"
    fi
}

open_romm() {
    local url
    url="$(romm_url)"
    case "$(uname -s 2>/dev/null || true)" in
        Darwin)
            open "$url"
            ;;
        *)
            echo "$url"
            ;;
    esac
}

set_romm_enabled() {
    local enabled="$1"
    set_env_value ENABLE_ROMM "$enabled"
    set_env_value GAMES_ROOT "${GAMES_ROOT:-$MEDIA_ROOT/Games}"
    set_env_value ROMM_URL "${ROMM_URL:-http://127.0.0.1:${ROMM_WEB_PORT:-7583}}"
    set_env_value ROMM_BIND_IP "${ROMM_BIND_IP:-127.0.0.1}"
    set_env_value ROMM_WEB_PORT "${ROMM_WEB_PORT:-7583}"
    set_env_value ROMM_CONTAINER_PORT "${ROMM_CONTAINER_PORT:-8080}"
    set_env_value ROMM_LIBRARY_ROOT "${ROMM_LIBRARY_ROOT:-${GAMES_ROOT:-$MEDIA_ROOT/Games}}"
    set_env_value ROMM_ASSETS_ROOT "${ROMM_ASSETS_ROOT:-$CONFIG_ROOT/romm/assets}"
    set_env_value ROMM_CONFIG_ROOT "${ROMM_CONFIG_ROOT:-$CONFIG_ROOT/romm/config}"
    set_env_value ROMM_RESOURCES_ROOT "${ROMM_RESOURCES_ROOT:-$CONFIG_ROOT/romm/resources}"
    set_env_value ROMM_REDIS_DATA_ROOT "${ROMM_REDIS_DATA_ROOT:-$CONFIG_ROOT/romm/redis}"
    set_env_value ROMM_REDIS_HOST "${ROMM_REDIS_HOST:-redis}"
    set_env_value ROMM_REDIS_PORT "${ROMM_REDIS_PORT:-6379}"
    set_env_value ROMM_DB_DATA_LOCATION "${ROMM_DB_DATA_LOCATION:-$CONFIG_ROOT/romm/mysql}"
    set_env_value ROMM_DB_DRIVER "${ROMM_DB_DRIVER:-postgresql}"
    set_env_value ROMM_DB_HOST "${ROMM_DB_HOST:-database}"
    set_env_value ROMM_DB_PORT "${ROMM_DB_PORT:-5432}"
    set_env_value ROMM_DB_NAME "${ROMM_DB_NAME:-romm}"
    set_env_value ROMM_DB_USER "${ROMM_DB_USER:-romm}"
    set_env_value ROMM_DB_QUERY_JSON "${ROMM_DB_QUERY_JSON:-}"
    set_env_value ROMM_AUTO_CONFIGURE "${ROMM_AUTO_CONFIGURE:-false}"
    set_env_value ROMM_ADMIN_USERNAME ""
    set_env_value ROMM_ADMIN_EMAIL ""
    set_env_value ROMM_ADMIN_PASSWORD ""
    set_env_value ROMM_HASHEOUS_API_ENABLED "${ROMM_HASHEOUS_API_ENABLED:-true}"
    set_env_value ROMM_REFRESH_RETROACHIEVEMENTS_CACHE_DAYS "${ROMM_REFRESH_RETROACHIEVEMENTS_CACHE_DAYS:-30}"
    set_env_value ROMM_TGDB_API_ENABLED "${ROMM_TGDB_API_ENABLED:-false}"
    set_env_value ROMM_ENABLE_SCHEDULED_UPDATE_LAUNCHBOX_METADATA "${ROMM_ENABLE_SCHEDULED_UPDATE_LAUNCHBOX_METADATA:-false}"
    set_env_value ROMM_SCHEDULED_UPDATE_LAUNCHBOX_METADATA_CRON "${ROMM_SCHEDULED_UPDATE_LAUNCHBOX_METADATA_CRON:-0 4 * * *}"
    set_env_value ROMM_IMAGE "${ROMM_IMAGE:-rommapp/romm:latest}"
    set_env_value ROMM_DB_IMAGE "${ROMM_DB_IMAGE:-}"

    if [[ "$enabled" == "true" ]]; then
        [[ -n "${ROMM_DB_PASSWORD:-}" ]] || set_env_value ROMM_DB_PASSWORD "$(random_secret 24)"
        [[ -n "${ROMM_AUTH_SECRET_KEY:-}" ]] || set_env_value ROMM_AUTH_SECRET_KEY "$(random_secret 32)"
    fi

    ok "RomM ENABLE_ROMM=$enabled saved"
    warn "Run 'stackarr up' to apply the romm profile. RomM remains local/private unless you explicitly publish it later."
}

apply_romm_metadata_environment() {
    exec "$ROOT_DIR/scripts/service-apply.sh" apply romm
}

load_env
subcommand="${1:-status}"
case "$subcommand" in
    status)
        print_romm_status
        ;;
    url)
        romm_url
        ;;
    open)
        open_romm
        ;;
    enable)
        set_romm_enabled true
        ;;
    disable)
        set_romm_enabled false
        ;;
    metadata)
        case "${2:-help}" in
            apply)
                apply_romm_metadata_environment
                ;;
            *)
                usage
                exit 1
                ;;
        esac
        ;;
    help|--help|-h)
        usage
        ;;
    *)
        usage
        exit 1
        ;;
esac
