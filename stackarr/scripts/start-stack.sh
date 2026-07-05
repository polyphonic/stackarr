#!/bin/bash
set -euo pipefail

ROOT_DIR="$(cd "$(dirname "$0")/.." && pwd)"
# shellcheck source=lib/common.sh
source "$ROOT_DIR/lib/common.sh"

load_env
write_compose_env_file
ensure_dir "$LOG_ROOT/launchd"
LOG_FILE="$LOG_ROOT/launchd/start-stack.log"

{
    echo "$(date '+%Y-%m-%d %H:%M:%S') starting Stackarr stack"
    wait_for_stackarr_storage
    ensure_docker_runtime
    ensure_database_if_required
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
