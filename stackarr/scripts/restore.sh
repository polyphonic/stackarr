#!/bin/bash
set -euo pipefail

ROOT_DIR="$(cd "$(dirname "$0")/.." && pwd)"
# shellcheck source=lib/common.sh
source "$ROOT_DIR/lib/common.sh"

ARCHIVE=""
FORCE_RUNTIME_CONFIG=false
ASSUME_YES=false
RESTORE_POSTGRES="ask"
RESTORE_NATIVE_PLEX="ask"
RESTORE_PLEX_PREFS="ask"
MARK_ONBOARDING_COMPLETE=false
DELETE_ARCHIVE_AFTER_RESTORE=false

while [[ $# -gt 0 ]]; do
    case "$1" in
        --force-config|--force-env)
            FORCE_RUNTIME_CONFIG=true
            ;;
        --yes|-y|--non-interactive)
            ASSUME_YES=true
            ;;
        --restore-postgres)
            RESTORE_POSTGRES="yes"
            ;;
        --skip-postgres)
            RESTORE_POSTGRES="no"
            ;;
        --restore-native-plex)
            RESTORE_NATIVE_PLEX="yes"
            ;;
        --skip-native-plex)
            RESTORE_NATIVE_PLEX="no"
            ;;
        --restore-plex-preferences)
            RESTORE_PLEX_PREFS="yes"
            ;;
        --skip-plex-preferences)
            RESTORE_PLEX_PREFS="no"
            ;;
        --mark-onboarding-complete)
            MARK_ONBOARDING_COMPLETE=true
            ;;
        --delete-archive-after-restore)
            DELETE_ARCHIVE_AFTER_RESTORE=true
            ;;
        --help|-h)
            cat <<'EOF'
Usage: stackarr backup restore <archive.tar.gz|archive.tgz|archive.zip> [options]

Options:
  --force-config              Replace the Stackarr runtime config database even if one exists.
  --yes, -y                   Run without prompts using explicit restore/skip flags.
  --restore-postgres          Restore shared Postgres dumps without prompting.
  --skip-postgres             Do not restore shared Postgres dumps.
  --restore-native-plex       Restore native Plex config without prompting.
  --skip-native-plex          Do not restore native Plex config.
  --restore-plex-preferences  Restore native macOS Plex preferences without prompting.
  --skip-plex-preferences     Do not restore native macOS Plex preferences.
  --mark-onboarding-complete  Mark the Stackarr setup wizard complete after restore.
  --delete-archive-after-restore
                              Delete the input archive after the restore attempt.
EOF
            exit 0
            ;;
        -*)
            fail "Unknown restore option: $1"
            ;;
        *)
            if [[ -n "$ARCHIVE" ]]; then
                fail "Usage: stackarr backup restore <archive> [options]"
            fi
            ARCHIVE="$1"
            ;;
    esac
    shift
done

if [[ -z "$ARCHIVE" ]]; then
    fail "Usage: stackarr backup restore <archive.tar.gz|archive.tgz|archive.zip> [options]"
fi

[[ -f "$ARCHIVE" ]] || fail "Archive not found: $ARCHIVE"

TMP_DIR="$(mktemp -d)"
cleanup() {
    rm -rf "$TMP_DIR"
    if [[ "$DELETE_ARCHIVE_AFTER_RESTORE" == true ]]; then
        rm -f "$ARCHIVE"
    fi
}
trap cleanup EXIT

print_header "Stackarr Restore"
warn "Restore will overwrite Stackarr config, state, and optionally the native Plex config path and preferences plist."
confirm_restore() {
    local prompt="$1"
    local default="${2:-yes}"
    local mode="${3:-ask}"

    case "$mode" in
        yes)
            return 0
            ;;
        no)
            return 1
            ;;
    esac

    if [[ "$ASSUME_YES" == true ]]; then
        return 0
    fi

    confirm "$prompt" "$default"
}

confirm_restore "Continue with restore" no || exit 1

extract_archive() {
    case "$ARCHIVE" in
        *.tar.gz|*.tgz)
            tar -xzf "$ARCHIVE" -C "$TMP_DIR"
            ;;
        *.zip)
            command -v python3 >/dev/null 2>&1 || fail "python3 is required to restore zip backup archives"
            python3 - "$ARCHIVE" "$TMP_DIR" <<'PY'
import sys
import zipfile
from pathlib import Path, PurePosixPath

archive = Path(sys.argv[1])
target = Path(sys.argv[2]).resolve()

with zipfile.ZipFile(archive) as backup:
    for info in backup.infolist():
        name = info.filename
        path = PurePosixPath(name)
        if path.is_absolute() or ".." in path.parts:
            raise SystemExit(f"Unsafe zip entry: {name}")
    backup.extractall(target)
PY
            ;;
        *)
            fail "Unsupported backup archive format. Use .tar.gz, .tgz, or .zip."
            ;;
    esac
}

find_restore_root() {
    local manifest root

    manifest="$(find "$TMP_DIR" -mindepth 1 -maxdepth 3 -name manifest.txt -type f | head -1)"
    if [[ -n "$manifest" ]]; then
        root="$(dirname "$manifest")"
        printf '%s\n' "$root"
        return 0
    fi

    find "$TMP_DIR" -mindepth 1 -maxdepth 1 -type d ! -name "__MACOSX" | head -1
}

extract_archive
RESTORE_ROOT="$(find_restore_root)"
[[ -n "$RESTORE_ROOT" ]] || fail "Could not unpack restore archive"
RESTORE_MANIFEST="$RESTORE_ROOT/manifest.txt"
RESTORE_PLEX_BACKUP_MODE="full"
DB_FILE="${STACKARR_DATABASE_FILE:-$(default_stackarr_database_file)}"

if [[ -f "$RESTORE_MANIFEST" ]]; then
    RESTORE_PLEX_BACKUP_MODE="$(sed -n 's/^plex_backup_mode=//p' "$RESTORE_MANIFEST" | head -1)"
    [[ -n "$RESTORE_PLEX_BACKUP_MODE" ]] || RESTORE_PLEX_BACKUP_MODE="full"
fi

if [[ -f "$RESTORE_ROOT/stackarr/stackarr.db" && ( ! -f "$DB_FILE" || "$FORCE_RUNTIME_CONFIG" == true ) ]]; then
    mkdir -p "$(dirname "$DB_FILE")"
    cp "$RESTORE_ROOT/stackarr/stackarr.db" "$DB_FILE"
    chmod 600 "$DB_FILE"
    ok "Restored Stackarr runtime config database"
fi

load_env
write_compose_env_file

if command -v docker >/dev/null 2>&1 && stackarr_compose ps -q >/dev/null 2>&1; then
    if confirm_restore "Stop the Stackarr stack before restoring files" yes; then
        ensure_docker_runtime
        stackarr_compose down || true
    fi
fi

restore_tree() {
    local src="$1"
    local dst="$2"
    [[ -d "$src" ]] || return 0
    mkdir -p "$dst"
    if command -v rsync >/dev/null 2>&1; then
        rsync -a "$src/" "$dst/"
    else
        cp -R "$src/." "$dst/"
    fi
}

restore_file() {
    local src="$1"
    local dst="$2"
    [[ -f "$src" ]] || return 0
    mkdir -p "$(dirname "$dst")"
    cp -p "$src" "$dst"
}

postgres_exec() {
    stackarr_compose exec -T \
        -e PGPASSWORD="$DATABASE_SUPERUSER_PASSWORD" \
        database "$@"
}

postgres_owner_for_database() {
    local db_name="$1"

    case "$db_name" in
        "$STACKARR_POSTGRES_DATABASE"|"$STACKARR_POSTGRES_MAIN_DATABASE"|"$STACKARR_POSTGRES_LOG_DATABASE")
            printf '%s\n' "$STACKARR_POSTGRES_USER"
            ;;
        "$BOOKORBIT_POSTGRES_DATABASE")
            printf '%s\n' "$BOOKORBIT_POSTGRES_USER"
            ;;
        "$SEERR_POSTGRES_DATABASE")
            printf '%s\n' "$SEERR_POSTGRES_USER"
            ;;
        "$PULSARR_POSTGRES_DATABASE")
            printf '%s\n' "$PULSARR_POSTGRES_USER"
            ;;
        "$BAZARR_POSTGRES_DATABASE")
            printf '%s\n' "$BAZARR_POSTGRES_USER"
            ;;
        "$PROWLARR_POSTGRES_MAIN_DATABASE"|"$PROWLARR_POSTGRES_LOG_DATABASE")
            printf '%s\n' "$PROWLARR_POSTGRES_USER"
            ;;
        "$RADARR_POSTGRES_MAIN_DATABASE"|"$RADARR_POSTGRES_LOG_DATABASE")
            printf '%s\n' "$RADARR_POSTGRES_USER"
            ;;
        "$RADARR4K_POSTGRES_MAIN_DATABASE"|"$RADARR4K_POSTGRES_LOG_DATABASE")
            printf '%s\n' "$RADARR4K_POSTGRES_USER"
            ;;
        "$SONARR_POSTGRES_MAIN_DATABASE"|"$SONARR_POSTGRES_LOG_DATABASE")
            printf '%s\n' "$SONARR_POSTGRES_USER"
            ;;
        "$SONARR4K_POSTGRES_MAIN_DATABASE"|"$SONARR4K_POSTGRES_LOG_DATABASE")
            printf '%s\n' "$SONARR4K_POSTGRES_USER"
            ;;
        "$LIDARR_POSTGRES_MAIN_DATABASE"|"$LIDARR_POSTGRES_LOG_DATABASE")
            printf '%s\n' "$LIDARR_POSTGRES_USER"
            ;;
        *)
            printf '%s\n' "${DATABASE_SUPERUSER:-postgres}"
            ;;
    esac
}

ensure_postgres_role() {
    local owner="$1"

    postgres_exec psql \
        -v ON_ERROR_STOP=1 \
        -U "${DATABASE_SUPERUSER:-postgres}" \
        -d "${DATABASE_NAME:-postgres}" \
        -v app_user="$owner" \
        -v app_password="${DATABASE_SUPERUSER_PASSWORD:-}" <<'SQL'
SELECT format('CREATE ROLE %I LOGIN PASSWORD %L', :'app_user', :'app_password')
WHERE NOT EXISTS (SELECT 1 FROM pg_roles WHERE rolname = :'app_user')
\gexec

SELECT format('ALTER ROLE %I LOGIN PASSWORD %L', :'app_user', :'app_password')
\gexec
SQL
}

recreate_postgres_database() {
    local db_name="$1"
    local owner="$2"

    postgres_exec psql \
        -v ON_ERROR_STOP=1 \
        -U "${DATABASE_SUPERUSER:-postgres}" \
        -d "${DATABASE_NAME:-postgres}" \
        -v app_db="$db_name" \
        -v app_user="$owner" <<'SQL'
SELECT pg_terminate_backend(pid)
FROM pg_stat_activity
WHERE datname = :'app_db'
  AND pid <> pg_backend_pid();

DROP DATABASE IF EXISTS :"app_db";
CREATE DATABASE :"app_db" OWNER :"app_user";
SQL
}

ensure_postgres_extensions() {
    local db_name="$1"

    case "$db_name" in
        "$BOOKORBIT_POSTGRES_DATABASE")
            postgres_exec psql \
                -v ON_ERROR_STOP=1 \
                -U "${DATABASE_SUPERUSER:-postgres}" \
                -d "$db_name" <<'SQL'
CREATE EXTENSION IF NOT EXISTS "uuid-ossp";
CREATE EXTENSION IF NOT EXISTS "pg_trgm";
CREATE EXTENSION IF NOT EXISTS "vector";
SQL
            ;;
    esac
}

grant_postgres_database_privileges() {
    local db_name="$1"
    local owner="$2"

    postgres_exec psql \
        -v ON_ERROR_STOP=1 \
        -U "${DATABASE_SUPERUSER:-postgres}" \
        -d "$db_name" \
        -v app_user="$owner" <<'SQL'
SELECT format('ALTER SCHEMA public OWNER TO %I', :'app_user')
\gexec

SELECT format('GRANT USAGE, CREATE ON SCHEMA public TO %I', :'app_user')
\gexec

SELECT format('GRANT ALL PRIVILEGES ON ALL TABLES IN SCHEMA public TO %I', :'app_user')
\gexec

SELECT format('GRANT ALL PRIVILEGES ON ALL SEQUENCES IN SCHEMA public TO %I', :'app_user')
\gexec

SELECT format('ALTER DEFAULT PRIVILEGES IN SCHEMA public GRANT ALL ON TABLES TO %I', :'app_user')
\gexec

SELECT format('ALTER DEFAULT PRIVILEGES IN SCHEMA public GRANT ALL ON SEQUENCES TO %I', :'app_user')
\gexec
SQL
}

restore_postgres_databases() {
    local dump_root="$RESTORE_ROOT/database"
    local dump db_name owner restored=0

    [[ -d "$dump_root" ]] || return 0
    shopt -s nullglob
    local dumps=("$dump_root"/*.dump)
    shopt -u nullglob
    (( ${#dumps[@]} > 0 )) || return 0

    command -v docker >/dev/null 2>&1 || {
        warn "Skipped Postgres restore because Docker is unavailable"
        return 0
    }

    if ! confirm_restore "Restore shared Postgres databases from archive and replace matching databases" no "$RESTORE_POSTGRES"; then
        warn "Skipped shared Postgres restore"
        return 0
    fi

    ensure_docker_runtime
    stackarr_compose --profile database up -d database

    for dump in "${dumps[@]}"; do
        db_name="$(basename "$dump" .dump)"
        owner="$(postgres_owner_for_database "$db_name")"

        ensure_postgres_role "$owner"
        recreate_postgres_database "$db_name" "$owner"
        ensure_postgres_extensions "$db_name"
        postgres_exec pg_restore \
            -U "${DATABASE_SUPERUSER:-postgres}" \
            -d "$db_name" \
            --clean \
            --if-exists \
            --no-owner \
            --role "$owner" < "$dump"
        grant_postgres_database_privileges "$db_name" "$owner"
        restored=$((restored + 1))
    done

    ok "Restored $restored shared Postgres database(s)"
}

restore_postgres_databases
restore_tree "$RESTORE_ROOT/config" "$CONFIG_ROOT"
restore_tree "$RESTORE_ROOT/state" "$STATE_ROOT"
ok "Restored Stackarr config and state"
if [[ "$RESTORE_PLEX_BACKUP_MODE" == "lite" ]]; then
    warn "This archive used lite backup mode. Service logs, caches, internal backups, runtime files, Arr cover art, and other excluded assets may regenerate after restore. Plex collection artwork is retained when present."
fi

if [[ -d "$RESTORE_ROOT/plex-native" || -f "$RESTORE_ROOT/plex-macos-preferences/com.plexapp.plexmediaserver.plist" ]]; then
    if pgrep -x "Plex Media Server" >/dev/null 2>&1; then
        warn "Quit Plex Media Server before restoring native Plex data or preferences"
    fi
fi

if [[ -d "$RESTORE_ROOT/plex-native" ]]; then
    if confirm_restore "Restore the native Plex config into $PLEX_CONFIG_PATH" no "$RESTORE_NATIVE_PLEX"; then
        restore_tree "$RESTORE_ROOT/plex-native" "$PLEX_CONFIG_PATH"
        ok "Restored native Plex config"
        if [[ "$RESTORE_PLEX_BACKUP_MODE" == "lite" ]]; then
            warn "Plex will redownload codecs and regenerate metadata, artwork, and other excluded cacheable assets after restore."
        fi
    else
        warn "Skipped native Plex restore"
    fi
fi

if [[ -f "$RESTORE_ROOT/plex-macos-preferences/com.plexapp.plexmediaserver.plist" ]]; then
    if confirm_restore "Restore the macOS Plex preferences plist into $PLEX_PREFS_PATH" no "$RESTORE_PLEX_PREFS"; then
        restore_file "$RESTORE_ROOT/plex-macos-preferences/com.plexapp.plexmediaserver.plist" "$PLEX_PREFS_PATH"
        ok "Restored native Plex preferences plist"
    else
        warn "Skipped native Plex preferences plist restore"
    fi
fi

if [[ "$MARK_ONBOARDING_COMPLETE" == true ]]; then
    STACKARR_DATABASE_FILE="$DB_FILE" node "$ROOT_DIR/scripts/json-setting-patch.cjs" \
        stackarr.settings '{"setup":{"onboardingComplete":true,"installMode":"restore"}}'
    ok "Marked Stackarr onboarding complete"
fi

warn "Run 'bin/stackarr doctor' and 'bin/stackarr up' after restore."
