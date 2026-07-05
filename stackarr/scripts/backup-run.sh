#!/bin/bash
set -Eeuo pipefail

ROOT_DIR="$(cd "$(dirname "$0")/.." && pwd)"
# shellcheck source=lib/common.sh
source "$ROOT_DIR/lib/common.sh"

load_env

TASK_LOGGER="$ROOT_DIR/scripts/task-log.cjs"
BACKUP_TASK_ID="${STACKARR_TASK_ID:-}"
BACKUP_TASK_OWNED=false
BACKUP_TASK_FINALIZED=false
TMP_DIR=""

run_task_logger() {
    command -v node >/dev/null 2>&1 || return 1
    [[ -f "$TASK_LOGGER" ]] || return 1
    NODE_NO_WARNINGS=1 node "$TASK_LOGGER" "$@"
}

backup_task_label() {
    case "${STACKARR_RUN_SOURCE:-}" in
        scheduled|launchd)
            printf 'Scheduled backup\n'
            ;;
        *)
            printf 'Run backup\n'
            ;;
    esac
}

backup_task_append() {
    local message="$1"

    [[ "$BACKUP_TASK_OWNED" == true ]] || return 0
    [[ -n "$BACKUP_TASK_ID" ]] || return 0
    run_task_logger append "$BACKUP_TASK_ID" "$message"$'\n' >/dev/null 2>&1 || true
}

backup_task_start() {
    local label output task_id

    [[ -z "$BACKUP_TASK_ID" ]] || return 0
    label="$(backup_task_label)"
    output="$(date '+%Y-%m-%d %H:%M:%S') backup attempt started"$'\n'
    task_id="$(run_task_logger create --label "$label" --output "$output" 2>/dev/null || true)"
    [[ -n "$task_id" ]] || return 0

    BACKUP_TASK_ID="$task_id"
    BACKUP_TASK_OWNED=true
    export STACKARR_TASK_ID="$task_id"
}

backup_task_finish() {
    local exit_code="$1"
    local status message

    [[ "$BACKUP_TASK_OWNED" == true ]] || return 0
    [[ "$BACKUP_TASK_FINALIZED" == false ]] || return 0
    [[ -n "$BACKUP_TASK_ID" ]] || return 0
    BACKUP_TASK_FINALIZED=true

    if [[ "$exit_code" -eq 0 ]]; then
        status="completed"
    else
        status="failed"
    fi

    message="$(date '+%Y-%m-%d %H:%M:%S') backup $status with exit code $exit_code"$'\n'
    run_task_logger update "$BACKUP_TASK_ID" \
        --status "$status" \
        --exit-code "$exit_code" \
        --ended-now \
        --append-output "$message" >/dev/null 2>&1 || true
}

backup_task_error() {
    local exit_code="$1"

    backup_task_append "$(date '+%Y-%m-%d %H:%M:%S') backup failed before completion"
    return "$exit_code"
}

task_ensure_dir() {
    local label="$1"
    local target="$2"
    local error_file message

    error_file="$(mktemp)"
    if mkdir -p "$target" 2>"$error_file"; then
        rm -f "$error_file"
        return 0
    fi

    message="$(cat "$error_file" 2>/dev/null || true)"
    rm -f "$error_file"
    backup_task_append "$(date '+%Y-%m-%d %H:%M:%S') could not access $label: $message"
    fail "Could not access $label: $message"
}

backup_task_start
trap 'backup_task_finish "$?"' EXIT
trap 'backup_task_error "$?"' ERR

if [[ "$(lowercase "${ENABLE_BACKUP:-true}")" =~ ^(0|false|no|off|disabled)$ ]]; then
    skipped_message="$(date '+%Y-%m-%d %H:%M:%S') backup skipped: scheduled backups disabled in Stackarr config"
    echo "$skipped_message"
    backup_task_append "$skipped_message"
    exit 0
fi

task_ensure_dir "backup root" "$BACKUP_ROOT"
task_ensure_dir "log root" "$LOG_ROOT"

if [[ -d "$PLEX_CONFIG_PATH" ]] && is_subpath "$BACKUP_ROOT" "$PLEX_CONFIG_PATH"; then
    fail "BACKUP_ROOT must live outside the Plex Media Server data directory"
fi

BACKUP_STAGING_ROOT="${BACKUP_STAGING_ROOT:-$BACKUP_ROOT/.stackarr-staging}"
task_ensure_dir "backup staging root" "$BACKUP_STAGING_ROOT"

STAMP="$(date +%Y%m%d-%H%M%S)"
TMP_DIR="$(mktemp -d "$BACKUP_STAGING_ROOT/stackarr-backup.XXXXXX")"
BACKUP_NAME="stackarr-backup-$STAMP"
STAGING="$TMP_DIR/$BACKUP_NAME"
LOG_FILE="$LOG_ROOT/backup.log"
BACKUP_INDEX_FILE="$STATE_ROOT/backup-archives.txt"
BACKUP_PROGRESS_INTERVAL="${BACKUP_PROGRESS_INTERVAL:-15}"
PLEX_BACKUP_MODE_NORMALIZED="$(printf '%s' "${PLEX_BACKUP_MODE:-lite}" | tr '[:upper:]' '[:lower:]')"
LITE_CONFIG_EXCLUDES=(
    "MediaCover/"
    "Backups/"
    "backups/"
    "backup/"
    "addons/"
    "Cache/"
    "Caches/"
    "cache/"
    "Sentry/"
    "Logs/"
    "logs/"
    "log/"
    "UpdateLogs/"
    "blocklists/"
    "repair-*/"
    "repair-backups/"
    "restore-safety-*/"
    "recyclarr/resources/"
    "*.log"
    "logs.db*"
    "database/"
    "postgres/"
    "mysql/"
    "romm/redis/"
    "romm/resources/"
    "*.db.bak*"
    "*.db-wal.bak*"
    "*.db-shm.bak*"
    "*.db-journal.bak*"
    "*.db.corrupt*"
    "*.sqlite.bak*"
    "*.sqlite-wal.bak*"
    "*.sqlite-shm.bak*"
    "*.sqlite-journal.bak*"
    "*.sqlite.corrupt*"
    "*.sqlite3.bak*"
    "*.sqlite3-wal.bak*"
    "*.sqlite3-shm.bak*"
    "*.sqlite3-journal.bak*"
    "*.sqlite3.corrupt*"
    "*.db-wal"
    "*.db-shm"
    "*.db-journal"
    "*.sqlite-wal"
    "*.sqlite-shm"
    "*.sqlite-journal"
    "*.pid"
    "*.lock"
)
LITE_CONFIG_POSTGRES_EXCLUDES=(
    "bazarr/*.db"
    "bazarr/db/*.db"
    "lidarr/lidarr.db"
    "lidarr/logs.db"
    "lidarr/xdg/Lidarr/*.db"
    "prowlarr/prowlarr.db"
    "prowlarr/logs.db"
    "pulsarr/db/*.db"
    "radarr/radarr.db"
    "radarr/logs.db"
    "radarr/xdg/Radarr/*.db"
    "radarr4k/radarr.db"
    "radarr4k/logs.db"
    "radarr4k/xdg/Radarr/*.db"
    "sonarr/sonarr.db"
    "sonarr/logs.db"
    "sonarr/xdg/Sonarr/*.db"
    "sonarr4k/sonarr.db"
    "sonarr4k/logs.db"
    "sonarr4k/xdg/Sonarr/*.db"
)
FULL_CONFIG_EXCLUDES=("${LITE_CONFIG_EXCLUDES[@]}")
FULL_PLEX_EXCLUDES=(
    "Codecs/"
    "Crash Reports/"
    "Diagnostics/"
    "Logs/"
    "Scanners/"
    "Plug-in Support/Caches/"
    "Plug-in Support/Databases/*-20??-??-??"
    "Updates/"
)

cleanup() {
    local exit_code="$?"
    if [[ -n "${TMP_DIR:-}" ]]; then
        rm -rf "$TMP_DIR"
    fi
    backup_task_finish "$exit_code"
    return "$exit_code"
}
trap cleanup EXIT

progress() {
    local percent="$1"
    shift
    local message
    message="$(printf 'PROGRESS %s %s' "$percent" "$*")"
    printf '%s\n' "$message"
    backup_task_append "$message"
}

path_size() {
    local target="$1"

    if [[ -e "$target" ]]; then
        du -sh "$target" 2>/dev/null | awk '{print $1}'
        return 0
    fi

    printf '0B\n'
}

with_progress_heartbeat() {
    local percent="$1"
    local label="$2"
    local watch_path="$3"
    local monitor_pid monitor_sleep_pid monitor_sleep_pid_file status
    shift 3

    monitor_sleep_pid_file="$(mktemp)"
    progress "$percent" "$label started"
    (
        trap 'exit 0' TERM INT
        while true; do
            sleep "$BACKUP_PROGRESS_INTERVAL" &
            printf '%s\n' "$!" > "$monitor_sleep_pid_file"
            wait "$!" || exit 0
            progress "$percent" "$label running ($(path_size "$watch_path"))"
        done
    ) &
    monitor_pid=$!

    set +e
    "$@"
    status=$?
    set -e

    monitor_sleep_pid="$(cat "$monitor_sleep_pid_file" 2>/dev/null || true)"
    if [[ -n "$monitor_sleep_pid" ]]; then
        kill "$monitor_sleep_pid" >/dev/null 2>&1 || true
    fi
    kill "$monitor_pid" >/dev/null 2>&1 || true
    wait "$monitor_pid" >/dev/null 2>&1 || true
    rm -f "$monitor_sleep_pid_file"

    if [[ "$status" -eq 0 ]]; then
        progress "$percent" "$label complete ($(path_size "$watch_path"))"
    else
        progress "$percent" "$label failed"
    fi

    return "$status"
}

snapshot_db() {
    local src="$1"
    local dst="$2"
    if command -v sqlite3 >/dev/null 2>&1; then
        local error_file quick_check
        error_file="$(mktemp)"
        if sqlite3 "$src" ".timeout 5000" ".backup '$dst'" >/dev/null 2>"$error_file"; then
            if quick_check="$(sqlite3 "$dst" ".timeout 5000" "PRAGMA quick_check;" 2>>"$error_file")" && [[ "$quick_check" == "ok" ]]; then
                rm -f "$error_file"
                rm -f "${dst}-wal" "${dst}-shm" "${dst}-journal"
                return 0
            fi
            if grep -Eq 'unknown tokenizer|no such collation sequence' "$error_file" && sqlite3 "$dst" ".timeout 5000" "SELECT count(*) FROM sqlite_master;" >/dev/null 2>>"$error_file"; then
                warn "SQLite quick_check skipped for extension-backed database: $src"
                rm -f "$error_file"
                rm -f "${dst}-wal" "${dst}-shm" "${dst}-journal"
                return 0
            fi
            cat "$error_file" >&2
            rm -f "$error_file"
            fail "SQLite backup failed integrity check: $src"
        else
            cat "$error_file" >&2
            rm -f "$error_file" "$dst"
            fail "Could not create a consistent SQLite backup: $src"
        fi
    else
        warn "sqlite3 unavailable; copying $src without a live SQLite snapshot"
        cp "$src" "$dst"
        rm -f "${dst}-wal" "${dst}-shm" "${dst}-journal"
        return 0
    fi
}

copy_tree() {
    local src="$1"
    local dst="$2"
    mkdir -p "$(dirname "$dst")"
    if command -v rsync >/dev/null 2>&1; then
        rsync_copy_tree "$src" "$dst"
    else
        cp -R "$src" "$dst"
    fi
}

copy_tree_excluding() {
    local src="$1"
    local dst="$2"
    shift 2
    mkdir -p "$(dirname "$dst")"
    if command -v rsync >/dev/null 2>&1; then
        local exclude_args=()
        local pattern
        for pattern in "$@"; do
            exclude_args+=(--exclude "$pattern")
        done
        rsync_copy_tree "$src" "$dst" "${exclude_args[@]}"
    else
        fail "rsync is required when backup exclusions are enabled"
    fi
}

copy_file() {
    local src="$1"
    local dst="$2"
    mkdir -p "$(dirname "$dst")"
    cp -p "$src" "$dst"
}

copy_plex_collection_artwork() {
    local src="$PLEX_CONFIG_PATH/Metadata/Collections"
    local dst="$STAGING/plex-native/Metadata/Collections"
    local upload_dir rel

    [[ -d "$src" ]] || return 0

    while IFS= read -r -d '' upload_dir; do
        rel="${upload_dir#$src/}"
        copy_tree "$upload_dir/" "$dst/$rel/"
    done < <(find "$src" -type d -name Uploads -print0 2>/dev/null)
}

copy_stackarr_runtime_config() {
    local db_file
    db_file="$(default_stackarr_database_file)"

    [[ -f "$db_file" ]] || return 0
    mkdir -p "$STAGING/stackarr"
    snapshot_db "$db_file" "$STAGING/stackarr/stackarr.db"
}

database_service_running() {
    command -v docker >/dev/null 2>&1 || return 1
    stackarr_compose ps --services --status running 2>/dev/null | grep -qx 'database'
}

dump_postgres_database() {
    local db_name="$1"
    local output_file="$2"

    stackarr_compose exec -T \
        -e PGPASSWORD="$DATABASE_SUPERUSER_PASSWORD" \
        database pg_dump \
        -U "${DATABASE_SUPERUSER:-postgres}" \
        -d "$db_name" \
        -Fc < /dev/null > "$output_file"
}

dump_postgres_databases() {
    local dump_root="$STAGING/database"
    local db_name
    local db_names

    if ! database_required; then
        return 0
    fi

    if ! database_service_running; then
        fail "Postgres database dumps are required, but the database container is not running"
    fi

    if [[ -z "${DATABASE_SUPERUSER_PASSWORD:-}" ]]; then
        fail "Postgres database dumps are required, but DATABASE_SUPERUSER_PASSWORD is not configured"
    fi

    mkdir -p "$dump_root"

    stackarr_compose exec -T \
        -e PGPASSWORD="$DATABASE_SUPERUSER_PASSWORD" \
        database pg_dumpall \
        -U "${DATABASE_SUPERUSER:-postgres}" \
        --globals-only < /dev/null > "$dump_root/globals.sql"

    db_names="$(
        stackarr_compose exec -T \
            -e PGPASSWORD="$DATABASE_SUPERUSER_PASSWORD" \
            database psql \
            -U "${DATABASE_SUPERUSER:-postgres}" \
            -d "${DATABASE_NAME:-postgres}" \
            -At \
            -c "SELECT datname FROM pg_database WHERE datallowconn AND NOT datistemplate AND datname <> current_database() ORDER BY datname;"
    )"

    while IFS= read -r db_name; do
        [[ -n "$db_name" ]] || continue
        progress 50 "Dumping Postgres database: $db_name"
        dump_postgres_database "$db_name" "$dump_root/$db_name.dump"
    done <<< "$db_names"
}

create_archive() {
    COPYFILE_DISABLE=1 tar -czf "$ARCHIVE_PATH" -C "$TMP_DIR" "$BACKUP_NAME"
}

prune_old_backups() {
    local keep="${BACKUP_RETENTION_COUNT:-52}"
    local listed_file next_index_file archive basename candidate count=0 failed=0

    [[ "$keep" =~ ^[0-9]+$ ]] || fail "BACKUP_RETENTION_COUNT must be a non-negative integer"
    [[ "$keep" -gt 0 ]] || fail "BACKUP_RETENTION_COUNT must be greater than 0"

    ensure_dir "$STATE_ROOT"
    listed_file="$(mktemp)"
    next_index_file="$(mktemp)"

    # Use shell globs instead of /usr/bin/find. LaunchAgent/TCC can allow the
    # Stackarr script to create files in iCloud Drive while denying external
    # tools such as find permission to enumerate that same directory.
    # Also merge the state index by basename so backups remain pruneable after
    # BACKUP_ROOT is moved, for example from iCloud Drive/Plex/Backups to
    # iCloud Drive/Backups/Plex.
    {
        shopt -s nullglob
        for archive in "$BACKUP_ROOT"/stackarr-backup-*.tar.gz; do
            [[ -f "$archive" ]] || continue
            printf '%s\n' "$archive"
        done
        shopt -u nullglob

        if [[ -f "$BACKUP_INDEX_FILE" ]]; then
            while IFS= read -r archive; do
                basename="$(basename "$archive")"
                [[ "$basename" == stackarr-backup-*.tar.gz ]] || continue

                candidate="$BACKUP_ROOT/$basename"
                if [[ -f "$candidate" ]]; then
                    printf '%s\n' "$candidate"
                elif [[ -f "$archive" ]]; then
                    printf '%s\n' "$archive"
                fi
            done < "$BACKUP_INDEX_FILE"
        fi
    } | sort -r | awk '!seen[$0]++' > "$listed_file"

    while IFS= read -r archive; do
        [[ -n "$archive" ]] || continue
        count=$((count + 1))
        if (( count <= keep )); then
            printf '%s\n' "$archive" >> "$next_index_file"
            continue
        fi

        if /bin/rm -f -- "$archive"; then
            echo "$(date '+%Y-%m-%d %H:%M:%S') backup pruned: $(basename "$archive")" >> "$LOG_FILE"
        else
            warn "Could not permanently delete old backup: $archive"
            printf '%s\n' "$archive" >> "$next_index_file"
            failed=$((failed + 1))
        fi
    done < "$listed_file"

    sort -r "$next_index_file" | awk '!seen[$0]++' > "$BACKUP_INDEX_FILE"
    rm -f "$listed_file" "$next_index_file"

    if (( failed > 0 )); then
        fail "Backup completed, but $failed old backup(s) could not be deleted. Verify the backup folder is writable through the Stackarr runtime mount and adjust host folder access if needed."
    fi
}

record_backup_archive() {
    local archive="$1"

    ensure_dir "$STATE_ROOT"
    printf '%s\n' "$archive" >> "$BACKUP_INDEX_FILE"
}

rsync_errors_are_transient() {
    local error_file="$1"

    python3 - "$error_file" <<'PY'
import re
import sys
from pathlib import Path

error_file = Path(sys.argv[1])
allowed = [
    re.compile(r"^rsync\(\d+\): error: .*: open \(2\) .* No such file or directory$"),
    re.compile(r"^rsync\(\d+\): error: mkstempsock: Invalid argument$"),
    re.compile(r"^file has vanished: "),
    re.compile(r"^rsync warning: some files vanished before they could be transferred"),
]

for line in error_file.read_text(errors="replace").splitlines():
    stripped = line.strip()
    if not stripped:
        continue
    if any(pattern.search(stripped) for pattern in allowed):
        continue
    raise SystemExit(1)

raise SystemExit(0)
PY
}

rsync_copy_tree() {
    local src="$1"
    local dst="$2"
    shift 2
    local error_file code

    error_file="$(mktemp)"
    if rsync -a "$@" "$src" "$dst" 2>"$error_file"; then
        rm -f "$error_file"
        return 0
    fi

    code=$?
    if [[ "$code" =~ ^(23|24)$ ]] && rsync_errors_are_transient "$error_file"; then
        warn "Backup copy skipped transient files under $src"
        rm -f "$error_file"
        return 0
    fi

    cat "$error_file" >&2
    rm -f "$error_file"
    return "$code"
}

lite_config_path_excluded() {
    local rel="$1"

    case "$rel" in
        MediaCover/*|*/MediaCover/*|Backups/*|*/Backups/*|backups/*|*/backups/*|backup/*|*/backup/*|addons/*|*/addons/*|Cache/*|*/Cache/*|Caches/*|*/Caches/*|cache/*|*/cache/*|Sentry/*|*/Sentry/*|Logs/*|*/Logs/*|logs/*|*/logs/*|log/*|*/log/*|UpdateLogs/*|*/UpdateLogs/*|blocklists/*|*/blocklists/*|repair-*/*|*/repair-*/*|repair-backups/*|*/repair-backups/*|restore-safety-*/*|*/restore-safety-*/*|recyclarr/resources/*|romm/redis/*|romm/resources/*|database/*|*/database/*|postgres/*|*/postgres/*|mysql/*|*/mysql/*|*.log|logs.db*|*/logs.db*|*.db.bak*|*/*.db.bak*|*.db-wal.bak*|*/*.db-wal.bak*|*.db-shm.bak*|*/*.db-shm.bak*|*.db-journal.bak*|*/*.db-journal.bak*|*.db.corrupt*|*/*.db.corrupt*|*.sqlite.bak*|*/*.sqlite.bak*|*.sqlite-wal.bak*|*/*.sqlite-wal.bak*|*.sqlite-shm.bak*|*/*.sqlite-shm.bak*|*.sqlite-journal.bak*|*/*.sqlite-journal.bak*|*.sqlite.corrupt*|*/*.sqlite.corrupt*|*.sqlite3.bak*|*/*.sqlite3.bak*|*.sqlite3-wal.bak*|*/*.sqlite3-wal.bak*|*.sqlite3-shm.bak*|*/*.sqlite3-shm.bak*|*.sqlite3-journal.bak*|*/*.sqlite3-journal.bak*|*.sqlite3.corrupt*|*/*.sqlite3.corrupt*)
            return 0
            ;;
        *)
            return 1
            ;;
    esac
}

lite_postgres_config_path_excluded() {
    local rel="$1"

    database_mode_is_postgres || return 1

    case "$rel" in
        bazarr/*.db|bazarr/db/*.db|lidarr/lidarr.db|lidarr/logs.db|lidarr/xdg/Lidarr/*.db|prowlarr/prowlarr.db|prowlarr/logs.db|pulsarr/db/*.db|radarr/radarr.db|radarr/logs.db|radarr/xdg/Radarr/*.db|radarr4k/radarr.db|radarr4k/logs.db|radarr4k/xdg/Radarr/*.db|sonarr/sonarr.db|sonarr/logs.db|sonarr/xdg/Sonarr/*.db|sonarr4k/sonarr.db|sonarr4k/logs.db|sonarr4k/xdg/Sonarr/*.db)
            return 0
            ;;
        *)
            return 1
            ;;
    esac
}

non_sqlite_snapshot_path() {
    local rel="$1"

    case "$rel" in
        Backups/*|*/Backups/*|backups/*|*/backups/*|backup/*|*/backup/*|Cache/*|*/Cache/*|Caches/*|*/Caches/*|cache/*|*/cache/*|repair-*/*|*/repair-*/*|repair-backups/*|*/repair-backups/*|restore-safety-*/*|*/restore-safety-*/*|*.db.bak*|*/*.db.bak*|*.db-wal.bak*|*/*.db-wal.bak*|*.db-shm.bak*|*/*.db-shm.bak*|*.db-journal.bak*|*/*.db-journal.bak*|*.db.corrupt*|*/*.db.corrupt*|*.sqlite.bak*|*/*.sqlite.bak*|*.sqlite-wal.bak*|*/*.sqlite-wal.bak*|*.sqlite-shm.bak*|*/*.sqlite-shm.bak*|*.sqlite-journal.bak*|*/*.sqlite-journal.bak*|*.sqlite.corrupt*|*/*.sqlite.corrupt*|*.sqlite3.bak*|*/*.sqlite3.bak*|*.sqlite3-wal.bak*|*/*.sqlite3-wal.bak*|*.sqlite3-shm.bak*|*/*.sqlite3-shm.bak*|*.sqlite3-journal.bak*|*/*.sqlite3-journal.bak*|*.sqlite3.corrupt*|*/*.sqlite3.corrupt*)
            return 0
            ;;
        tinymediamanager/data/*.db|*/tinymediamanager/data/*.db)
            return 0
            ;;
        *)
            return 1
            ;;
    esac
}

snapshot_tree_dbs() {
    local src_root="$1"
    local dst_root="$2"
    local rel dst

    [[ -d "$src_root" ]] || return 0

    find "$src_root" -type f \( -name '*.db' -o -name '*.sqlite' -o -name '*.sqlite3' \) 2>/dev/null | while read -r db; do
        rel="${db#$src_root/}"
        if [[ "$PLEX_BACKUP_MODE_NORMALIZED" == "lite" && "$src_root" == "$CONFIG_ROOT" ]] && lite_config_path_excluded "$rel"; then
            continue
        fi
        if [[ "$src_root" == "$CONFIG_ROOT" ]] && lite_postgres_config_path_excluded "$rel"; then
            continue
        fi
        if non_sqlite_snapshot_path "$rel"; then
            continue
        fi

        dst="$dst_root/$rel"
        mkdir -p "$(dirname "$dst")"
        snapshot_db "$db" "$dst"
    done
}

progress 2 "Preparing backup staging"
mkdir -p "$STAGING/config" "$STAGING/state"
progress 5 "Snapshotting Stackarr runtime config"
copy_stackarr_runtime_config
case "$PLEX_BACKUP_MODE_NORMALIZED" in
    full)
        with_progress_heartbeat 15 "Copying Stackarr app configuration" "$STAGING/config" \
            copy_tree_excluding "$CONFIG_ROOT/" "$STAGING/config/" "${FULL_CONFIG_EXCLUDES[@]}"
        ;;
    lite)
        if database_mode_is_postgres; then
            LITE_CONFIG_EXCLUDES+=("${LITE_CONFIG_POSTGRES_EXCLUDES[@]}")
        fi
        with_progress_heartbeat 15 "Copying Stackarr app configuration" "$STAGING/config" \
            copy_tree_excluding "$CONFIG_ROOT/" "$STAGING/config/" "${LITE_CONFIG_EXCLUDES[@]}"
        ;;
    *)
        fail "PLEX_BACKUP_MODE must be 'full' or 'lite'"
        ;;
esac
with_progress_heartbeat 25 "Copying Stackarr state" "$STAGING/state" copy_tree "$STATE_ROOT/" "$STAGING/state/"
if [[ -d "$ROOT_DIR/state/streamrip" && "$STATE_ROOT" != "$ROOT_DIR/state" ]]; then
    with_progress_heartbeat 28 "Copying Streamrip state" "$STAGING/state/streamrip" \
        copy_tree "$ROOT_DIR/state/streamrip/" "$STAGING/state/streamrip/"
fi
progress 35 "Snapshotting service SQLite databases"
snapshot_tree_dbs "$CONFIG_ROOT" "$STAGING/config"
snapshot_tree_dbs "$ROOT_DIR/state/streamrip" "$STAGING/state/streamrip"
progress 45 "Dumping shared Postgres databases"
dump_postgres_databases

if [[ -d "$PLEX_CONFIG_PATH" ]]; then
    case "$PLEX_BACKUP_MODE_NORMALIZED" in
        full)
            with_progress_heartbeat 65 "Copying Plex data" "$STAGING/plex-native" \
                copy_tree_excluding "$PLEX_CONFIG_PATH/" "$STAGING/plex-native/" "${FULL_PLEX_EXCLUDES[@]}"
            ;;
        lite)
            with_progress_heartbeat 65 "Copying Plex lite data" "$STAGING/plex-native" copy_tree_excluding "$PLEX_CONFIG_PATH/" "$STAGING/plex-native/" \
                "Codecs/" \
                "Crash Reports/" \
                "Diagnostics/" \
                "Logs/" \
                "Media/" \
                "Metadata/" \
                "Scanners/" \
                "Plug-in Support/Caches/" \
                "Plug-in Support/Databases/*-20??-??-??" \
                "Updates/"
            copy_plex_collection_artwork
            ;;
        *)
            fail "PLEX_BACKUP_MODE must be 'full' or 'lite'"
            ;;
    esac
    progress 78 "Snapshotting Plex SQLite databases"
    snapshot_tree_dbs "$PLEX_CONFIG_PATH" "$STAGING/plex-native"
fi

if [[ -f "$PLEX_PREFS_PATH" ]]; then
    progress 82 "Copying Plex macOS preferences"
    copy_file "$PLEX_PREFS_PATH" "$STAGING/plex-macos-preferences/com.plexapp.plexmediaserver.plist"
fi

progress 86 "Writing backup manifest"
cat > "$STAGING/manifest.txt" <<EOF
created_at=$(date '+%Y-%m-%d %H:%M:%S %z')
stackarr_root=$ROOT_DIR
media_root=$MEDIA_ROOT
music_root=$MUSIC_ROOT
downloads_root=$DOWNLOADS_ROOT
backup_root=$BACKUP_ROOT
plex_config_path=$PLEX_CONFIG_PATH
plex_prefs_path=$PLEX_PREFS_PATH
plex_backup_mode=$PLEX_BACKUP_MODE_NORMALIZED
streamrip_runtime_config=stackarr/stackarr.db:stackarr.streamripConfig
streamrip_state_path=state/streamrip
postgres_dump_path=database
postgres_dump_format=globals.sql plus per-database custom-format dumps
EOF

if [[ "$PLEX_BACKUP_MODE_NORMALIZED" == "lite" ]]; then
    cat >> "$STAGING/manifest.txt" <<'EOF'
plex_excluded_rebuildable_paths=Codecs,Crash Reports,Diagnostics,Logs,Media,Metadata,Scanners,Plug-in Support/Caches,dated Plex database snapshots,Updates
plex_lite_included_metadata_paths=Metadata/Collections/*/Uploads
config_excluded_rebuildable_paths=MediaCover,Backups,backups,backup,addons,Cache,Caches,cache,Sentry,Logs,logs,log,UpdateLogs,blocklists,repair-*,repair-backups,restore-safety-*,recyclarr/resources,romm/redis,romm/resources,database,postgres,mysql,*.log,logs.db*,*.db.bak*,*.db.corrupt*,sqlite_wal_shm_journal,*.pid,*.lock
EOF
else
    cat >> "$STAGING/manifest.txt" <<'EOF'
plex_excluded_rebuildable_paths=Codecs,Crash Reports,Diagnostics,Logs,Scanners,Plug-in Support/Caches,dated Plex database snapshots,Updates
config_excluded_rebuildable_paths=MediaCover,Backups,backups,backup,addons,Cache,Caches,cache,Sentry,Logs,logs,log,UpdateLogs,blocklists,repair-*,repair-backups,restore-safety-*,recyclarr/resources,romm/redis,romm/resources,database,postgres,mysql,*.log,logs.db*,*.db.bak*,*.db.corrupt*,sqlite_wal_shm_journal,*.pid,*.lock
EOF
fi

ARCHIVE_PATH="$BACKUP_ROOT/$BACKUP_NAME.tar.gz"
with_progress_heartbeat 92 "Compressing backup archive" "$ARCHIVE_PATH" create_archive
progress 97 "Recording backup archive"
record_backup_archive "$ARCHIVE_PATH"
progress 98 "Pruning old backup archives"
prune_old_backups

echo "$(date '+%Y-%m-%d %H:%M:%S') backup completed: $BACKUP_NAME.tar.gz" >> "$LOG_FILE"
progress 100 "Backup archive created: $ARCHIVE_PATH ($(path_size "$ARCHIVE_PATH"))"
ok "Created $ARCHIVE_PATH"
