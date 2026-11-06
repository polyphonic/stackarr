#!/bin/bash
# Read-only host discovery. Never call load_env or stackarr_compose: both can mutate.
set -euo pipefail
ROOT_DIR="$(cd "$(dirname "$0")/.." && pwd)"
source "$ROOT_DIR/lib/common.sh"
[[ $# -eq 1 && "$1" == /* && "$1" != *$'\n'* && "$1" != *$'\r'* ]] || fail 'Expected one absolute policy path'
case "/$1/" in */../*|*/./*) fail 'Noncanonical policy path' ;; esac
[[ "${STACKARR_RUNTIME:-}" != docker && "${STACKARR_RUNTIME:-}" != docker-updater && ! -f /.dockerenv && ! -f /run/.containerenv ]] || fail 'Host required'
requested_policy="$1"
load_compose_runtime_env
configure_docker_environment
reader="$ROOT_DIR/scripts/storage-config-read.cjs"
# Select the running controller by exact installed project and service labels.
# Feed our bounded read-only reader over stdin. No shell or caller path runs in it.
project="${STACKARR_CAPACITY_PROJECT:-stackarr}"
[[ "$project" =~ ^[a-z0-9][a-z0-9_-]*$ ]] || fail 'Invalid project'
ids="$(docker ps -q --filter "label=com.docker.compose.project=$project" --filter 'label=com.docker.compose.service=app' 2>/dev/null)" || ids=''
[[ -z "$ids" || "$ids" =~ ^[a-f0-9]{12,64}$ ]] || fail 'One authoritative controller required'
if [[ -n "$ids" ]]; then
    config="$(docker exec -i "$ids" node - --capacity-discovery < "$reader")" || fail 'Authoritative controller configuration unavailable'
elif [[ "${STACKARR_DATABASE_MODE:-}" == postgres || -n "${STACKARR_DATABASE_URL:-}" ]]; then
    fail 'One authoritative controller required'
else
    # Portable SQLite fallback is raw: the host must never read native preferences.
    db_file="${CONFIG_ROOT:-$(default_app_root)/config}/stackarr.db"
    config="$(STACKARR_DATABASE_FILE="$db_file" node "$reader")" || fail 'Authoritative SQLite record absent'
fi
[[ -f "$requested_policy" && -f "$ROOT_DIR/scripts/storage-discovery.cjs" ]] || fail 'Host capacity installation incomplete'
# The discovery bundle consumes the complete authoritative record, not merged
# ambient/bootstrap settings. Removed optional keys cannot retain old authority.
printf '%s' "$config" | STACKARR_COMPOSE_PROJECT_NAME="${STACKARR_CAPACITY_PROJECT:-stackarr}" STACKARR_CAPACITY_POLICY="$requested_policy" STACKARR_REPO_ROOT="$ROOT_DIR" node "$ROOT_DIR/scripts/storage-discovery.cjs"
