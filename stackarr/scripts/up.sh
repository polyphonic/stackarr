#!/bin/bash
set -euo pipefail

ROOT_DIR="$(cd "$(dirname "$0")/.." && pwd)"
# shellcheck source=lib/common.sh
source "$ROOT_DIR/lib/common.sh"

print_header "Stackarr Up"
load_env
wait_for_stackarr_storage
write_compose_env_file
if optional_service_enabled youtarr; then
    ensure_dir "$YOUTARR_OUTPUT_ROOT"
    ensure_dir "$YOUTARR_CONFIG_ROOT"
    ensure_dir "$YOUTARR_JOBS_ROOT"
    ensure_dir "$YOUTARR_IMAGES_ROOT"
fi
if [[ "${STACKARR_RUN_SOURCE:-}" == "startup" ]]; then
    wait_for_docker_runtime "${STACKARR_DOCKER_WAIT_SECONDS:-600}"
else
    ensure_docker_runtime
fi

if start_existing_database_for_runtime_config && load_postgres_runtime_config_through_database; then
    # Persist only non-secret topology after loading credentials into this process.
    write_compose_env_file
fi

ensure_database_if_required

# The controller may have been unavailable while load_env ran. Once the
# database is healthy, refresh authoritative settings directly through its
# loopback port before selecting profiles or recreating containers.
if [[ "$(lowercase "${STACKARR_DATABASE_MODE:-}")" == "postgres" ]] && load_postgres_runtime_config; then
    write_compose_env_file
fi

profile_args=()
while IFS= read -r profile_arg; do
    profile_args+=("$profile_arg")
done < <(compose_profile_args)
"$ROOT_DIR/scripts/naming.sh" prestart || true
stackarr_compose "${profile_args[@]}" up -d --remove-orphans
recover_database_startup_failures
remove_database_init_sidecar
refresh_stackarr_web_storage_mounts "${profile_args[@]}"
remove_inactive_torrent_client_container
remove_disabled_optional_containers
"$ROOT_DIR/scripts/naming.sh" apply --wait --skip-tmm || true
"$ROOT_DIR/scripts/downloads.sh" apply --wait || true
if flag_enabled "${STACKARR_CONFIGURE_SEERR:-false}"; then
    "$ROOT_DIR/scripts/requests.sh" apply --wait || true
else
    warn "Seerr request presets were not applied because STACKARR_CONFIGURE_SEERR is false"
fi
"$ROOT_DIR/scripts/bookorbit.sh" credentials apply --wait || true
ok "Stackarr services are starting"
warn "Run 'bin/stackarr configure' after first boot or after image resets"
ok "Repo-managed naming and download presets were re-applied"
