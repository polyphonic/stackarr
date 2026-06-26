#!/bin/bash
set -euo pipefail

ROOT_DIR="$(cd "$(dirname "$0")/.." && pwd)"
# shellcheck source=lib/common.sh
source "$ROOT_DIR/lib/common.sh"

MODE="${1:-plan}"
if [[ "$MODE" == "plan" || "$MODE" == "run" ]]; then
    shift || true
else
    MODE="plan"
fi

SOURCE_ROOT=""
ASSUME_YES=false
STOP_SOURCE=true
OVERWRITE=false
MIGRATION_STAMP="$(date +%Y%m%d-%H%M%S)"
MIGRATION_ENTRIES=()
RUNNING_CONTAINERS=()

while [[ $# -gt 0 ]]; do
    case "$1" in
        --source-root)
            shift || fail "--source-root requires a path"
            SOURCE_ROOT="${1:-}"
            ;;
        --source-root=*)
            SOURCE_ROOT="${1#--source-root=}"
            ;;
        --yes|-y)
            ASSUME_YES=true
            ;;
        --no-stop-source)
            STOP_SOURCE=false
            ;;
        --overwrite)
            OVERWRITE=true
            ;;
        --help|-h)
            cat <<'EOF'
Usage: stackarr migrate plan [--source-root PATH]
       stackarr migrate run [--source-root PATH] --yes [--no-stop-source] [--overwrite]

Migrates supported existing media-stack config directories into Stackarr.

Discovery:
  - Docker containers for supported services, excluding the Stackarr compose project.
  - Conventional folders under --source-root and --source-root/config.

Supported targets:
  Radarr, Radarr 4K, Sonarr, Sonarr 4K, Prowlarr, Lidarr, Bazarr, Seerr/Overseerr/Jellyseerr,
  Pulsarr, Transmission, qBittorrent, Plex, Jellyfin, TinyMediaManager, Recyclarr, Tidarr,
  and BookOrbit.
EOF
            exit 0
            ;;
        *)
            fail "Unknown migrate option: $1"
            ;;
    esac
    shift
done

load_env

normalize_service_name() {
    local raw
    raw="$(lowercase "$1")"
    raw="${raw//_/-}"
    raw="${raw//./-}"

    case "$raw" in
        *radarr*4k*|*radarr*uhd*|*radarr-ultra*|radarr4k)
            printf '%s\n' "radarr4k"
            ;;
        *sonarr*4k*|*sonarr*uhd*|*sonarr-ultra*|sonarr4k)
            printf '%s\n' "sonarr4k"
            ;;
        *prowlarr*)
            printf '%s\n' "prowlarr"
            ;;
        *radarr*)
            printf '%s\n' "radarr"
            ;;
        *sonarr*)
            printf '%s\n' "sonarr"
            ;;
        *lidarr*)
            printf '%s\n' "lidarr"
            ;;
        *bazarr*)
            printf '%s\n' "bazarr"
            ;;
        *jellyseerr*|*overseerr*|*seerr*)
            printf '%s\n' "seerr"
            ;;
        *pulsarr*)
            printf '%s\n' "pulsarr"
            ;;
        *transmission*)
            printf '%s\n' "transmission"
            ;;
        *qbittorrent*|*qbit*)
            printf '%s\n' "qbittorrent"
            ;;
        *tiny-media-manager*|*tinymediamanager*|*tinymm*)
            printf '%s\n' "tinymediamanager"
            ;;
        *recyclarr*)
            printf '%s\n' "recyclarr"
            ;;
        *flaresolverr*)
            printf '%s\n' "flaresolverr"
            ;;
        *tidarr*)
            printf '%s\n' "tidarr"
            ;;
        *bookorbit*)
            printf '%s\n' "bookorbit"
            ;;
        *plex*)
            printf '%s\n' "plex"
            ;;
        *jellyfin*)
            printf '%s\n' "jellyfin"
            ;;
        *)
            return 1
            ;;
    esac
}

service_target_rel() {
    case "$1" in
        bookorbit)
            printf '%s\n' "bookorbit/app"
            ;;
        *)
            printf '%s\n' "$1"
            ;;
    esac
}

entry_exists_for_service() {
    local service="$1"
    local entry existing

    [[ "${#MIGRATION_ENTRIES[@]}" -gt 0 ]] || return 1

    for entry in "${MIGRATION_ENTRIES[@]}"; do
        IFS='|' read -r existing _ <<< "$entry"
        if [[ "$existing" == "$service" ]]; then
            return 0
        fi
    done

    return 1
}

add_migration_entry() {
    local service="$1"
    local method="$2"
    local source="${3:-}"
    local container="${4:-}"
    local container_path="${5:-}"
    local target_rel

    target_rel="$(service_target_rel "$service")"
    if entry_exists_for_service "$service"; then
        warn "Migration already has a source for $service; skipping duplicate from ${source:-$container:$container_path}"
        return 0
    fi

    MIGRATION_ENTRIES+=("$service|$method|$source|$container|$container_path|$target_rel")
}

discover_source_root() {
    local candidate service base

    [[ -n "$SOURCE_ROOT" ]] || return 0
    [[ -d "$SOURCE_ROOT" ]] || fail "Source root not found: $SOURCE_ROOT"

    for base in "$SOURCE_ROOT" "$SOURCE_ROOT/config"; do
        [[ -d "$base" ]] || continue
        shopt -s nullglob
        for candidate in "$base"/*; do
            [[ -d "$candidate" ]] || continue
            service="$(normalize_service_name "$(basename "$candidate")" || true)"
            [[ -n "$service" ]] || continue
            add_migration_entry "$service" "path" "$candidate" "" ""
        done
        shopt -u nullglob
    done
}

docker_config_destination() {
    command -v node >/dev/null 2>&1 || return 1
    node "$ROOT_DIR/scripts/migrate-docker-inspect.cjs"
}

discover_docker() {
    local container inspect output service container_path status

    command -v docker >/dev/null 2>&1 || {
        warn "Docker is unavailable; skipping Docker stack discovery"
        return 0
    }

    if ! docker info >/dev/null 2>&1; then
        warn "Docker is not reachable; skipping Docker stack discovery"
        return 0
    fi

    while IFS= read -r container; do
        [[ -n "$container" ]] || continue
        inspect="$(docker inspect "$container" 2>/dev/null || true)"
        [[ -n "$inspect" ]] || continue
        set +e
        output="$(printf '%s' "$inspect" | docker_config_destination "$container" 2>/dev/null)"
        status=$?
        set -e
        [[ "$status" -eq 0 && -n "$output" ]] || continue
        IFS='|' read -r service container_path <<< "$output"
        add_migration_entry "$service" "docker" "" "$container" "$container_path"
    done < <(docker ps -a --format '{{.Names}}')
}

render_plan() {
    local entry service method source container container_path target_rel source_label

    print_header "Stackarr Migration Plan"

    if [[ "${#MIGRATION_ENTRIES[@]}" -eq 0 ]]; then
        warn "No supported existing stack services were discovered."
        return 0
    fi

    for entry in "${MIGRATION_ENTRIES[@]}"; do
        IFS='|' read -r service method source container container_path target_rel <<< "$entry"
        if [[ "$method" == "docker" ]]; then
            source_label="$container:$container_path"
        else
            source_label="$source"
        fi
        printf 'MIGRATE %s from %s to %s\n' "$service" "$source_label" "$CONFIG_ROOT/$target_rel"
    done

    if [[ "$MODE" == "run" && "$STOP_SOURCE" == true ]]; then
        warn "Confirmed migration stops discovered source containers while copying their config/database files."
    elif [[ "$MODE" == "run" ]]; then
        warn "Source containers will not be stopped; live SQLite files may be inconsistent."
    fi
}

target_has_content() {
    local target="$1"

    [[ -d "$target" ]] || return 1
    shopt -s nullglob dotglob
    local entries=("$target"/*)
    shopt -u nullglob dotglob
    [[ "${#entries[@]}" -gt 0 ]]
}

prepare_target() {
    local target="$1"
    local safety

    if target_has_content "$target"; then
        if [[ "$OVERWRITE" != true ]]; then
            safety="${target}.migration-safety-$MIGRATION_STAMP"
            mv "$target" "$safety"
            warn "Existing target moved to $safety"
        fi
    fi

    mkdir -p "$target"
}

copy_tree_for_migration() {
    local src="$1"
    local dst="$2"

    prepare_target "$dst"
    if command -v rsync >/dev/null 2>&1; then
        rsync -a "$src/" "$dst/"
    else
        cp -R "$src/." "$dst/"
    fi
}

docker_container_running() {
    [[ "$(docker inspect -f '{{.State.Running}}' "$1" 2>/dev/null || true)" == "true" ]]
}

maybe_stop_source_containers() {
    local entry service method source container container_path target_rel seen=" "

    [[ "$STOP_SOURCE" == true ]] || return 0
    command -v docker >/dev/null 2>&1 || return 0

    for entry in "${MIGRATION_ENTRIES[@]}"; do
        IFS='|' read -r service method source container container_path target_rel <<< "$entry"
        [[ "$method" == "docker" && -n "$container" ]] || continue
        [[ "$seen" == *" $container "* ]] && continue
        seen="$seen$container "
        if docker_container_running "$container"; then
            docker stop "$container" >/dev/null
            RUNNING_CONTAINERS+=("$container")
            warn "Stopped source container $container for a consistent copy"
        fi
    done
}

restart_source_containers() {
    local container

    [[ "${#RUNNING_CONTAINERS[@]}" -gt 0 ]] || return 0

    for container in "${RUNNING_CONTAINERS[@]}"; do
        docker start "$container" >/dev/null 2>&1 || warn "Could not restart source container $container"
    done
}

copy_docker_config() {
    local container="$1"
    local container_path="$2"
    local target="$3"
    local tmp

    command -v docker >/dev/null 2>&1 || fail "Docker is required for Docker-discovered migration sources"
    tmp="$(mktemp -d)"
    mkdir -p "$tmp/config"
    docker cp "$container:$container_path/." "$tmp/config/"
    copy_tree_for_migration "$tmp/config" "$target"
    rm -rf "$tmp"
}

copy_entries() {
    local entry service method source container container_path target_rel target

    ensure_dir "$CONFIG_ROOT"
    trap restart_source_containers EXIT
    maybe_stop_source_containers

    for entry in "${MIGRATION_ENTRIES[@]}"; do
        IFS='|' read -r service method source container container_path target_rel <<< "$entry"
        target="$CONFIG_ROOT/$target_rel"
        if [[ "$method" == "docker" ]]; then
            copy_docker_config "$container" "$container_path" "$target"
        else
            copy_tree_for_migration "$source" "$target"
        fi
        ok "Migrated $service config"
    done

    restart_source_containers
    RUNNING_CONTAINERS=()
    trap - EXIT
}

detected_services_csv() {
    local entry service services=()

    for entry in "${MIGRATION_ENTRIES[@]}"; do
        IFS='|' read -r service _ <<< "$entry"
        services+=("$service")
    done

    local IFS=,
    printf '%s\n' "${services[*]}"
}

write_detected_runtime_config() {
    local services patch_file api_patch_file service

    services="$(detected_services_csv)"
    patch_file="$(mktemp)"
    api_patch_file="$(mktemp)"

    python3 - "$services" "$patch_file" <<'PY'
import json
import sys

services = {item for item in sys.argv[1].split(",") if item}
patch = {
    "STACKARR_DATABASE_MODE": "app-default",
}

def flag(key, condition):
    if condition:
        patch[key] = "true"

flag("ENABLE_MOVIES", bool({"radarr", "radarr4k"} & services))
flag("ENABLE_TV_SHOWS", bool({"sonarr", "sonarr4k"} & services))
flag("ENABLE_4K_SERVARR", bool({"radarr4k", "sonarr4k"} & services))
flag("ENABLE_BAZARR", "bazarr" in services)
flag("ENABLE_LIDARR", "lidarr" in services)
flag("ENABLE_BOOKORBIT", "bookorbit" in services)
flag("ENABLE_TINYMEDIAMANAGER", "tinymediamanager" in services)
flag("ENABLE_RECYCLARR", "recyclarr" in services)
flag("ENABLE_FLARESOLVERR", "flaresolverr" in services)
flag("ENABLE_TIDARR", "tidarr" in services)
flag("ENABLE_SEERR", "seerr" in services)
flag("ENABLE_PULSARR", "pulsarr" in services)

if "qbittorrent" in services:
    patch["PREFERRED_TORRENT_CLIENT"] = "qbittorrent"
elif "transmission" in services:
    patch["PREFERRED_TORRENT_CLIENT"] = "transmission"

if "plex" in services:
    patch["PLEX_INSTALL_MODE"] = "docker"
if "jellyfin" in services:
    patch["JELLYFIN_INSTALL_MODE"] = "docker"

with open(sys.argv[2], "w", encoding="utf-8") as handle:
    json.dump(patch, handle)
PY

    python3 - "$CONFIG_ROOT" "$api_patch_file" <<'PY'
import json
import re
import sys
from pathlib import Path

root = Path(sys.argv[1])
targets = {
    "PROWLARR_API_KEY": root / "prowlarr" / "config.xml",
    "RADARR_API_KEY": root / "radarr" / "config.xml",
    "RADARR4K_API_KEY": root / "radarr4k" / "config.xml",
    "SONARR_API_KEY": root / "sonarr" / "config.xml",
    "SONARR4K_API_KEY": root / "sonarr4k" / "config.xml",
    "LIDARR_API_KEY": root / "lidarr" / "config.xml",
}
patch = {}
for key, file_path in targets.items():
    if not file_path.exists():
        continue
    text = file_path.read_text(errors="ignore")
    match = re.search(r"<ApiKey>([^<]+)</ApiKey>", text)
    if match:
        patch[key] = match.group(1).strip()

seerr_settings = root / "seerr" / "settings.json"
if seerr_settings.exists():
    try:
        data = json.loads(seerr_settings.read_text(encoding="utf-8"))
        api_key = ((data.get("main") or {}).get("apiKey") or "").strip()
        if api_key:
            patch["SEERR_API_KEY"] = api_key
    except Exception:
        pass

with open(sys.argv[2], "w", encoding="utf-8") as handle:
    json.dump(patch, handle)
PY

    STACKARR_DATABASE_FILE="${STACKARR_DATABASE_FILE:-$CONFIG_ROOT/stackarr.db}" node "$ROOT_DIR/scripts/runtime-config-write.cjs" "$patch_file"
    STACKARR_DATABASE_FILE="${STACKARR_DATABASE_FILE:-$CONFIG_ROOT/stackarr.db}" node "$ROOT_DIR/scripts/runtime-config-write.cjs" "$api_patch_file"
    STACKARR_DATABASE_FILE="${STACKARR_DATABASE_FILE:-$CONFIG_ROOT/stackarr.db}" node "$ROOT_DIR/scripts/json-setting-patch.cjs" \
        stackarr.settings '{"setup":{"onboardingComplete":true,"installMode":"migrate"}}'
    rm -f "$patch_file" "$api_patch_file"

    load_env
    write_compose_env_file

    for service in ${services//,/ }; do
        [[ -n "$service" ]] || continue
        ok "Enabled migrated service: $service"
    done
}

discover_source_root
discover_docker
render_plan

if [[ "$MODE" != "run" ]]; then
    exit 0
fi

[[ "${#MIGRATION_ENTRIES[@]}" -gt 0 ]] || fail "No supported services were discovered to migrate"

if [[ "$ASSUME_YES" != true ]]; then
    confirm "Migrate the discovered stack into Stackarr now" no || exit 1
fi

copy_entries
write_detected_runtime_config
ok "Migration complete. Run 'bin/stackarr up' and 'bin/stackarr configure' after reviewing the migrated settings."
