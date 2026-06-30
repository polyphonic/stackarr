#!/bin/bash
set -euo pipefail

ROOT_DIR="$(cd "$(dirname "$0")/.." && pwd)"
# shellcheck source=lib/common.sh
source "$ROOT_DIR/lib/common.sh"

print_header "Stackarr Up"
load_env
write_compose_env_file
wait_for_stackarr_storage
ensure_docker_runtime

ensure_database_if_required

profile_args=()
while IFS= read -r profile_arg; do
    profile_args+=("$profile_arg")
done < <(compose_profile_args)
"$ROOT_DIR/scripts/naming.sh" prestart || true
stackarr_compose "${profile_args[@]}" up -d --remove-orphans
stackarr_compose rm -f -s database-init >/dev/null 2>&1 || true
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
