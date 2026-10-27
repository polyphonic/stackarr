#!/bin/bash
set -euo pipefail
umask 077
ROOT_DIR="$(cd "$(dirname "$0")/.." && pwd)"
# shellcheck source=lib/common.sh
source "$ROOT_DIR/lib/common.sh"

operation="${1:-}"
case "$operation" in
    status|test|run|run-due) [[ $# -eq 1 ]] || fail "Unexpected PostgreSQL backup arguments" ;;
    export) [[ ( $# -eq 3 || ( $# -eq 4 && "$4" == --previous ) ) && "$2" == --output && -n "$3" ]] || fail "Usage: stackarr postgres-backup export --output PATH [--previous]" ;;
    *) fail "Usage: stackarr postgres-backup status|test|run|run-due|export --output PATH" ;;
esac

if [[ "$operation" == status ]]; then
    # Cache-only status must not try to contact the controller or database.
    load_compose_runtime_env
    : "${APP_ROOT:=$(default_app_root)}"
    : "${STATE_ROOT:=$APP_ROOT/state}"
    export STATE_ROOT
else
    load_env
    if [[ "$operation" == run-due ]] && ! flag_enabled "${STACKARR_PG_BACKUP_ENABLED:-false}"; then
        exit 0
    fi
    if [[ "$operation" == run-due ]]; then
        if python3 "$ROOT_DIR/scripts/postgres-backup.py" due; then :; else
            code=$?
            [[ "$code" -eq 3 ]] && exit 0
            exit "$code"
        fi
    fi
    maintenance_lock_enter "$ROOT_DIR/scripts/postgres-backup.sh" "$@"
    if [[ "$operation" == run || "$operation" == run-due || "$operation" == export ]]; then
        # No dump, target write, or temp directory until both mounts are proven.
        verify_backup_mounts
    fi
    if [[ "$operation" == run || "$operation" == run-due || "$operation" == test ]]; then
        ensure_docker_runtime
        source_container="$(stackarr_compose ps -q database)"
        [[ "$source_container" =~ ^[[:xdigit:]]+$ ]] || fail "Managed PostgreSQL database is not running"
        export STACKARR_PG_BACKUP_SOURCE_CONTAINER="$source_container"
    fi
fi

exec python3 "$ROOT_DIR/scripts/postgres-backup.py" "$@"
