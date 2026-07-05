#!/bin/bash
set -euo pipefail

ROOT_DIR="$(cd "$(dirname "$0")/.." && pwd)"
# shellcheck source=lib/common.sh
source "$ROOT_DIR/lib/common.sh"

print_header "Stackarr Update"
load_env
write_compose_env_file
wait_for_stackarr_storage
ensure_docker_runtime
ensure_database_if_required

profile_args=()
while IFS= read -r profile_arg; do
    profile_args+=("$profile_arg")
done < <(compose_profile_args)

ok "Pulling latest images for Stackarr services"
stackarr_compose "${profile_args[@]}" pull

"$ROOT_DIR/scripts/naming.sh" prestart || true
stackarr_compose "${profile_args[@]}" up -d --remove-orphans
remove_database_init_sidecar
refresh_stackarr_web_storage_mounts "${profile_args[@]}"
remove_inactive_torrent_client_container
"$ROOT_DIR/scripts/naming.sh" apply --wait --skip-tmm || true
"$ROOT_DIR/scripts/downloads.sh" apply --wait || true
"$ROOT_DIR/scripts/requests.sh" apply --wait || true
if stackarr_compose --profile maintenance run --rm image-cleanup; then
    ok "Dangling Docker images cleaned"
else
    warn "Dangling Docker image cleanup failed; run 'docker image prune -f --filter dangling=true' manually if disk usage grows"
fi

ok "Stackarr services updated"
warn "Review service status with 'docker compose -f stackarr/docker-compose.yml ps' if any app reports a problem after an image refresh"
