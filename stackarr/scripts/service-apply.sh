#!/bin/bash
set -euo pipefail

ROOT_DIR="$(cd "$(dirname "$0")/.." && pwd)"
# shellcheck source=lib/common.sh
source "$ROOT_DIR/lib/common.sh"

usage() {
    cat <<'EOF'
Usage:
  stackarr service apply <compose-service> [compose-service...]
EOF
}

runtime_service_profile() {
    case "$1" in
        app) printf 'stackarr\n' ;;
        radarr) printf 'movies\n' ;;
        sonarr) printf 'tv\n' ;;
        immich-ml) printf 'immich\n' ;;
        youtarr-db) printf 'youtarr\n' ;;
        *) printf '%s\n' "$1" ;;
    esac
}

runtime_service_enabled() {
    case "$1" in
        app) stackarr_web_enabled ;;
        database) database_required ;;
        transmission|qbittorrent) torrent_client_enabled "$1" ;;
        plex) [[ "$(lowercase "${PLEX_INSTALL_MODE:-native}")" == "docker" ]] ;;
        jellyfin) [[ "$(lowercase "${JELLYFIN_INSTALL_MODE:-disabled}")" == "docker" ]] ;;
        radarr) optional_service_enabled movies ;;
        sonarr) optional_service_enabled tv ;;
        immich-ml) optional_service_enabled immich ;;
        youtarr-db) optional_service_enabled youtarr ;;
        redis)
            optional_service_enabled immich || optional_service_enabled romm || optional_service_enabled tracearr
            ;;
        *) optional_service_enabled "$1" ;;
    esac
}

validate_runtime_service() {
    case "$1" in
        database|transmission|qbittorrent|prowlarr|sonarr|sonarr4k|radarr|radarr4k|bazarr|tinymediamanager|pulsarr|maintainerr|cleanuparr|agregarr|tracearr|redis|seerr|plex|jellyfin|recyclarr|flaresolverr|lidarr|tidarr|bookorbit|romm|questarr|youtarr|youtarr-db|immich|immich-ml)
            return 0
            ;;
        *)
            fail "Unsupported managed Compose service: $1"
            ;;
    esac
}

apply_service_runtime() {
    [[ "$#" -gt 0 ]] || {
        usage
        exit 1
    }

    print_header "Stackarr Service Runtime Apply"
    load_env
    write_compose_env_file
    ensure_docker_runtime
    ensure_database_if_required

    local profile_args=()
    local service profile
    local youtarr_db_requested=false
    while IFS= read -r profile; do
        profile_args+=("$profile")
    done < <(compose_profile_args)

    for service in "$@"; do
        if [[ "$service" == "youtarr-db" ]]; then
            youtarr_db_requested=true
            break
        fi
    done

    if [[ "$youtarr_db_requested" == "true" ]]; then
        validate_runtime_service youtarr-db
        if runtime_service_enabled youtarr-db; then
            stackarr_compose "${profile_args[@]}" up -d --wait --force-recreate youtarr-db
            ok "youtarr-db container settings applied"
        else
            stackarr_compose --profile youtarr rm -f -s youtarr-db >/dev/null 2>&1 || true
            ok "youtarr-db is disabled; its stale container was removed"
        fi
    fi

    for service in "$@"; do
        [[ "$service" == "youtarr-db" ]] && continue
        validate_runtime_service "$service"
        profile="$(runtime_service_profile "$service")"

        if ! runtime_service_enabled "$service"; then
            stackarr_compose --profile "$profile" rm -f -s "$service" >/dev/null 2>&1 || true
            if [[ "$service" == "youtarr" ]]; then
                stackarr_compose --profile youtarr rm -f -s youtarr-db >/dev/null 2>&1 || true
            fi
            ok "$service is disabled; its stale container was removed"
            continue
        fi

        case "$service" in
            romm|immich|immich-ml|tracearr)
                stackarr_compose "${profile_args[@]}" up -d redis
                ;;
            questarr)
                if [[ "${QUESTARR_ROMM_IMPORT_ENABLED:-false}" == "true" ]]; then
                    stackarr_compose "${profile_args[@]}" up -d --wait clamav
                else
                    stackarr_compose --profile questarr-import rm -f -s clamav >/dev/null 2>&1 || true
                fi
                ;;
            youtarr)
                ensure_dir "$YOUTARR_OUTPUT_ROOT"
                ensure_dir "$YOUTARR_CONFIG_ROOT"
                ensure_dir "$YOUTARR_JOBS_ROOT"
                ensure_dir "$YOUTARR_IMAGES_ROOT"
                stackarr_compose "${profile_args[@]}" up -d --wait youtarr-db
                ;;
        esac

        if [[ "$service" == "database" ]]; then
            ok "database runtime settings reconciled"
            continue
        fi

        stackarr_compose "${profile_args[@]}" up -d --force-recreate --no-deps "$service"
        ok "$service container settings applied"
    done
}

case "${1:-help}" in
    apply)
        shift
        apply_service_runtime "$@"
        ;;
    help|--help|-h)
        usage
        ;;
    *)
        usage
        exit 1
        ;;
esac
