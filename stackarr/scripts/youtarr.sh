#!/bin/bash
set -euo pipefail

ROOT_DIR="$(cd "$(dirname "$0")/.." && pwd)"
# shellcheck source=lib/common.sh
source "$ROOT_DIR/lib/common.sh"

usage() {
    cat <<'EOF'
Usage:
  stackarr youtarr status
  stackarr youtarr url
  stackarr youtarr open
  stackarr youtarr enable
  stackarr youtarr disable
  stackarr youtarr apply
EOF
}

youtarr_url() {
    printf '%s\n' "${YOUTARR_URL:-http://127.0.0.1:${YOUTARR_WEB_PORT:-3087}}"
}

print_status() {
    if optional_service_enabled youtarr; then ok "Youtarr is enabled"; else warn "Youtarr is disabled"; fi
    echo "URL: $(youtarr_url)"
    echo "YouTube library: ${YOUTARR_OUTPUT_ROOT:-$MEDIA_ROOT/YouTube} -> /usr/src/app/data"
    echo "Database: MariaDB in the Compose-managed youtarr-db-data volume"
    if [[ -n "${YOUTARR_PLEX_URL:-}" ]]; then echo "Plex: ${YOUTARR_PLEX_URL}"; else echo "Plex: not configured"; fi

    if command -v docker >/dev/null 2>&1 && docker info >/dev/null 2>&1; then
        stackarr_compose --profile youtarr ps youtarr youtarr-db || true
    else
        warn "Docker runtime is not ready; container status skipped"
    fi
}

set_enabled() {
    local enabled="$1"
    local admin_username admin_password
    load_env
    admin_username="${YOUTARR_ADMIN_USERNAME:-${USERNAME:-admin}}"
    admin_password="${YOUTARR_ADMIN_PASSWORD:-${PASSWORD:-$(random_secret 24)}}"
    [[ "${#admin_username}" -le 32 ]] || fail "Youtarr usernames must be 32 characters or fewer"
    [[ "${#admin_password}" -le 64 ]] || fail "Youtarr passwords must be 64 characters or fewer"
    set_env_value ENABLE_YOUTARR "$enabled"
    set_env_value YOUTARR_BIND_IP "${YOUTARR_BIND_IP:-127.0.0.1}"
    set_env_value YOUTARR_WEB_PORT "${YOUTARR_WEB_PORT:-3087}"
    set_env_value YOUTARR_CONTAINER_PORT "${YOUTARR_CONTAINER_PORT:-3011}"
    set_env_value YOUTARR_OUTPUT_ROOT "${YOUTARR_OUTPUT_ROOT:-$MEDIA_ROOT/YouTube}"
    set_env_value YOUTARR_CONFIG_ROOT "${YOUTARR_CONFIG_ROOT:-$CONFIG_ROOT/youtarr/config}"
    set_env_value YOUTARR_JOBS_ROOT "${YOUTARR_JOBS_ROOT:-$CONFIG_ROOT/youtarr/jobs}"
    set_env_value YOUTARR_IMAGES_ROOT "${YOUTARR_IMAGES_ROOT:-$CONFIG_ROOT/youtarr/images}"
    set_env_value YOUTARR_DB_PASSWORD "${YOUTARR_DB_PASSWORD:-$(random_secret 24)}"
    set_env_value YOUTARR_DB_ROOT_PASSWORD "${YOUTARR_DB_ROOT_PASSWORD:-$(random_secret 24)}"
    set_env_value YOUTARR_ADMIN_USERNAME "$admin_username"
    set_env_value YOUTARR_ADMIN_PASSWORD "$admin_password"
    set_env_value YOUTARR_IMAGE "${YOUTARR_IMAGE:-dialmaster/youtarr:latest}"
    set_env_value YOUTARR_DB_IMAGE "${YOUTARR_DB_IMAGE:-mariadb:10.11}"
    write_compose_env_file
    ok "Youtarr ENABLE_YOUTARR=$enabled saved"
    warn "Run 'stackarr youtarr apply' to reconcile Youtarr and its database."
}

load_env
case "${1:-help}" in
    status) print_status ;;
    url) youtarr_url ;;
    open)
        if [[ "$(uname -s 2>/dev/null || true)" == "Darwin" ]]; then open "$(youtarr_url)"; else youtarr_url; fi
        ;;
    enable) set_enabled true ;;
    disable) set_enabled false ;;
    apply) exec "$ROOT_DIR/scripts/service-apply.sh" apply youtarr ;;
    help|--help|-h) usage ;;
    *) usage; exit 1 ;;
esac