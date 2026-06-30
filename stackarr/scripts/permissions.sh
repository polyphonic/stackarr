#!/bin/bash
set -euo pipefail

ROOT_DIR="$(cd "$(dirname "$0")/.." && pwd)"
# shellcheck source=lib/common.sh
source "$ROOT_DIR/lib/common.sh"

MODE="${1:-audit}"
[[ "$MODE" == "audit" || "$MODE" == "fix" ]] || fail "Usage: permissions.sh audit|fix"

load_env
print_header "Stackarr Permissions ${MODE^}"

FAILS=0
FIXED=0

stat_uid() {
    stat -f '%u' "$1" 2>/dev/null || stat -c '%u' "$1" 2>/dev/null
}

stat_gid() {
    stat -f '%g' "$1" 2>/dev/null || stat -c '%g' "$1" 2>/dev/null
}

note_failure() {
    FAILS=$((FAILS + 1))
    warn "$1"
}

test_path_access() {
    local label="$1"
    local path="$2"
    local mode="$3"
    local real probe

    if [[ ! -d "$path" ]]; then
        note_failure "$label missing: $path"
        return 1
    fi

    real="$(canonical_dir "$path" || true)"
    [[ -n "$real" ]] || real="$path"

    if [[ ! -r "$path" ]]; then
        note_failure "$label is not readable: $real"
        return 1
    fi

    if [[ "$mode" == "rw" ]]; then
        probe="$path/.stackarr-permission-test-$$"
        if : >"$probe" 2>/dev/null; then
            rm -f "$probe"
            ok "$label read/write: $real"
            return 0
        fi
        note_failure "$label is not writable through this mount: $real"
        return 1
    fi

    ok "$label readable: $real"
}

docker_compose_available() {
    command -v docker >/dev/null 2>&1 && docker compose version >/dev/null 2>&1
}

service_running() {
    local service="$1"
    stackarr_compose ps --services --status running 2>/dev/null | grep -Fxq "$service"
}

service_mount_check() {
    local service="$1"
    local label="$2"
    local path="$3"
    local mode="$4"
    local script

    if ! service_running "$service"; then
        warn "$label skipped because $service is not running"
        return 0
    fi

    if [[ "$mode" == "rw" ]]; then
        script="test -d '$path' && test -r '$path' && probe='$path/.stackarr-permission-test-$$' && : > \"\$probe\" && rm -f \"\$probe\""
    else
        script="test -d '$path' && test -r '$path'"
    fi

    if stackarr_compose exec -T "$service" sh -lc "$script" >/dev/null 2>&1; then
        ok "$label $mode through $service:$path"
        return 0
    fi

    note_failure "$label failed through $service:$path"
    return 1
}

audit_docker_mounts() {
    test_path_access "Config root" "$CONFIG_ROOT" rw || true
    test_path_access "State root" "$STATE_ROOT" rw || true
    test_path_access "Log root" "$LOG_ROOT" rw || true
    test_path_access "Downloads root" "$DOWNLOADS_ROOT" rw || true
    test_path_access "Backup root" "$BACKUP_ROOT" rw || true
    test_path_access "Media root" "$MEDIA_ROOT" ro || true
    test_path_access "Music root" "$MUSIC_ROOT" ro || true

    if [[ -n "${PLEX_CONFIG_PATH:-}" && -d "$PLEX_CONFIG_PATH" ]]; then
        test_path_access "Native Plex config" "$PLEX_CONFIG_PATH" ro || true
    fi
    if [[ -n "${JELLYFIN_CONFIG_PATH:-}" && -d "$JELLYFIN_CONFIG_PATH" ]]; then
        test_path_access "Native Jellyfin config" "$JELLYFIN_CONFIG_PATH" ro || true
    fi

    if ! docker_compose_available; then
        note_failure "Docker Compose is not available inside Stackarr, so service bind mounts could not be verified"
        return 0
    fi

    case "$(selected_torrent_client)" in
        qbittorrent)
            service_mount_check qbittorrent "qBittorrent downloads" /downloads rw || true
            ;;
        *)
            service_mount_check transmission "Transmission downloads" /downloads rw || true
            ;;
    esac

    if flag_enabled "${ENABLE_MOVIES:-true}"; then
        service_mount_check radarr "Radarr movies" /movies rw || true
        if flag_enabled "${ENABLE_4K_SERVARR:-false}"; then
            service_mount_check radarr4k "Radarr 4K movies" /movies rw || true
        fi
    fi

    if flag_enabled "${ENABLE_TV_SHOWS:-true}"; then
        service_mount_check sonarr "Sonarr TV" /tv rw || true
        if flag_enabled "${ENABLE_4K_SERVARR:-false}"; then
            service_mount_check sonarr4k "Sonarr 4K TV" /tv rw || true
        fi
    fi

    if flag_enabled "${ENABLE_LIDARR:-true}"; then
        service_mount_check lidarr "Lidarr music library" /music ro || true
        service_mount_check lidarr "Lidarr downloads" /downloads rw || true
    fi
}

audit_host_ownership() {
    local targets=(
        "$MEDIA_ROOT"
        "$MUSIC_ROOT"
        "$CONFIG_ROOT"
        "$STATE_ROOT"
        "$LOG_ROOT"
        "$DOWNLOADS_ROOT"
        "$BACKUP_ROOT"
    )
    local path real uid gid seen
    seen=""

    if [[ -n "${PLEX_CONFIG_PATH:-}" ]]; then
        targets+=("$PLEX_CONFIG_PATH")
    fi

    if [[ "$MODE" == "fix" ]]; then
        warn "Fix mode will run recursive chown on mismatched roots"
        confirm "Continue with fix mode" no || exit 1
    fi

    for path in "${targets[@]}"; do
        [[ -d "$path" ]] || { warn "Missing directory: $path"; continue; }
        real="$(canonical_dir "$path" || true)"
        [[ -n "$real" ]] || continue
        if printf '%s\n' "$seen" | grep -Fxq "$real"; then
            continue
        fi
        seen="$seen
$real"

        uid="$(stat_uid "$real")"
        gid="$(stat_gid "$real")"
        if [[ "$uid" == "$PUID" && "$gid" == "$PGID" ]]; then
            ok "$real owned by $PUID:$PGID"
            continue
        fi

        note_failure "$real owned by $uid:$gid (expected $PUID:$PGID)"

        if [[ "$MODE" == "fix" ]]; then
            echo "Running: sudo chown -R $PUID:$PGID $real"
            sudo chown -R "$PUID:$PGID" "$real"
            ok "$real ownership fixed"
            FIXED=$((FIXED + 1))
        fi
    done
}

if stackarr_runtime_is_container; then
    if [[ "$MODE" == "fix" ]]; then
        fail "Docker fix mode is not automatic. Grant Docker Desktop or OrbStack access to the selected folders, adjust host ACLs if needed, then run 'stackarr permissions audit'."
    fi
    audit_docker_mounts
else
    audit_host_ownership
fi

echo ""
echo "Issues found: $FAILS"
if [[ "$MODE" == "fix" ]]; then
    echo "Issues fixed: $FIXED"
fi

[[ "$FAILS" -eq 0 ]]
