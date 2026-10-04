#!/bin/bash
set -euo pipefail

ROOT_DIR="$(cd "$(dirname "$0")/.." && pwd)"
# shellcheck source=lib/common.sh
source "$ROOT_DIR/lib/common.sh"

load_env
ensure_dir "$LOG_ROOT/launchd"
LOG_FILE="$LOG_ROOT/launchd/start-stack.log"

{
    echo "$(date '+%Y-%m-%d %H:%M:%S') starting Stackarr stack"
    wait_for_stackarr_storage
    write_compose_env_file
    wait_for_docker_runtime "${STACKARR_DOCKER_WAIT_SECONDS:-600}"
    if start_existing_database_for_runtime_config && load_postgres_runtime_config_through_database; then
        write_compose_env_file
    fi
    # Never use bootstrap flags to reconcile an installed PostgreSQL stack.
    if database_mode_is_postgres && docker inspect database >/dev/null 2>&1; then
        load_postgres_runtime_config || fail "Unable to load authoritative PostgreSQL runtime settings; startup cancelled"
        write_compose_env_file
    fi
    ensure_database_if_required

    if [[ "$(lowercase "${STACKARR_DATABASE_MODE:-}")" == "postgres" ]] && load_postgres_runtime_config; then
        write_compose_env_file
    fi
    profile_args=()
    while IFS= read -r profile_arg; do
        profile_args+=("$profile_arg")
    done < <(compose_profile_args)
    "$ROOT_DIR/scripts/naming.sh" prestart
    stackarr_compose "${profile_args[@]}" up -d --remove-orphans
    remove_database_init_sidecar
    refresh_stackarr_web_storage_mounts "${profile_args[@]}"
    remove_inactive_torrent_client_container
    remove_disabled_optional_containers
    "$ROOT_DIR/scripts/naming.sh" apply --wait --skip-tmm
    "$ROOT_DIR/scripts/downloads.sh" apply --wait
    "$ROOT_DIR/scripts/requests.sh" apply --wait
    echo "$(date '+%Y-%m-%d %H:%M:%S') Stackarr stack up"
} >> "$LOG_FILE" 2>&1
