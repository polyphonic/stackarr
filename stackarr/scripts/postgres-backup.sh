#!/bin/bash
set -euo pipefail
umask 077
ROOT_DIR="$(cd "$(dirname "$0")/.." && pwd)"
# shellcheck source=lib/common.sh
source "$ROOT_DIR/lib/common.sh"

operation="${1:-}"
case "$operation" in
    status|test|run-due|list) [[ $# -eq 1 ]] || fail "Unexpected PostgreSQL backup arguments" ;;
    run) [[ $# -eq 1 || ( $# -eq 2 && "$2" == --no-prune ) ]] || fail "Unexpected PostgreSQL backup arguments" ;;
    export)
        usage="Usage: stackarr postgres-backup export --output PATH [--previous | --generation UUID]"
        [[ $# -ge 3 && "$2" == --output && -n "$3" ]] || fail "$usage"
        case $# in
            3) ;;
            4) [[ "$4" == --previous ]] || fail "$usage" ;;
            5) [[ "$4" == --generation && "$5" =~ ^[[:xdigit:]]{8}-[[:xdigit:]]{4}-[[:xdigit:]]{4}-[[:xdigit:]]{4}-[[:xdigit:]]{12}$ ]] || fail "$usage" ;;
            *) fail "$usage" ;;
        esac
        ;;
    *) fail "Usage: stackarr postgres-backup status|test|run [--no-prune]|run-due|list|export --output PATH [--previous | --generation UUID]" ;;
esac

# List/export retain target-only recovery even without a readable source configuration.
if [[ "$operation" == list || "$operation" == export ]]; then
    load_env
else
    load_env strict
fi
# Only configuration is read from the controller. Status never contacts the target.
if [[ "$operation" != export && "$operation" != list ]] && { database_mode_is_postgres || [[ -n "${STACKARR_DATABASE_URL:-}" ]]; } && ! load_postgres_runtime_config; then
    fail "Unable to load authoritative PostgreSQL runtime settings; backup cancelled"
fi
if [[ "$operation" != status ]]; then
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
    if [[ "$operation" == run || "$operation" == run-due || "$operation" == test ]]; then
        case "${POSTGRES_DEPLOYMENT_MODE:-managed}" in
            managed|independent|external) ;;
            *) fail "Unsupported PostgreSQL deployment mode; backup cancelled" ;;
        esac
    fi
    maintenance_lock_enter "$ROOT_DIR/scripts/postgres-backup.sh" "$@"
    if [[ "$operation" == run || "$operation" == run-due || "$operation" == export || ( "$operation" == test && "${POSTGRES_DEPLOYMENT_MODE:-}" != managed ) ]]; then
        # No dump, target write, or temp directory until both mounts are proven.
        python3 "$ROOT_DIR/scripts/postgres-backup.py" guard-staging
        verify_backup_mounts
    fi
    if [[ "$operation" == run || "$operation" == run-due || "$operation" == test ]]; then
        if [[ "${POSTGRES_DEPLOYMENT_MODE:-}" == independent ]]; then
            # The host-only native endpoint never uses the container address.
            export POSTGRES_DEPLOYMENT_MODE POSTGRES_HOST_ADDRESS POSTGRES_HOST_PORT POSTGRES_INSTANCE_ID POSTGRES_HOST_CLIENT_BIN
            export DATABASE_SUPERUSER DATABASE_SUPERUSER_PASSWORD
            export STACKARR_PG_BACKUP_SOURCE_EXCLUSIONS="${STACKARR_PG_BACKUP_SOURCE_EXCLUSIONS:-}"
            unset STACKARR_PG_BACKUP_SOURCE_CONTAINER
        elif [[ "${POSTGRES_DEPLOYMENT_MODE:-}" == external ]]; then
            # External source capabilities are explicit and never fall back to Docker
            # or the generated managed superuser/password defaults.
            export POSTGRES_DEPLOYMENT_MODE
            export STACKARR_PG_BACKUP_SOURCE_HOST="${STACKARR_PG_BACKUP_SOURCE_HOST:-}"
            export STACKARR_PG_BACKUP_SOURCE_PORT="${STACKARR_PG_BACKUP_SOURCE_PORT:-}"
            export STACKARR_PG_BACKUP_SOURCE_INSTANCE_ID="${STACKARR_PG_BACKUP_SOURCE_INSTANCE_ID:-}"
            export STACKARR_PG_BACKUP_SOURCE_CLIENT_BIN="${STACKARR_PG_BACKUP_SOURCE_CLIENT_BIN:-}"
            export STACKARR_PG_BACKUP_SOURCE_CLIENT_MAJOR="${STACKARR_PG_BACKUP_SOURCE_CLIENT_MAJOR:-}"
            export STACKARR_PG_BACKUP_SOURCE_USER="${STACKARR_PG_BACKUP_SOURCE_USER:-}"
            export STACKARR_PG_BACKUP_SOURCE_PASSWORD="${STACKARR_PG_BACKUP_SOURCE_PASSWORD:-}"
            export STACKARR_PG_BACKUP_SOURCE_TLS_MODE="${STACKARR_PG_BACKUP_SOURCE_TLS_MODE:-}"
            export STACKARR_PG_BACKUP_SOURCE_TLS_ROOT_CERT="${STACKARR_PG_BACKUP_SOURCE_TLS_ROOT_CERT:-}"
            export STACKARR_PG_BACKUP_SOURCE_EXCLUSIONS="${STACKARR_PG_BACKUP_SOURCE_EXCLUSIONS:-}"
            unset STACKARR_PG_BACKUP_SOURCE_CONTAINER
        else
            ensure_docker_runtime
            source_container="$(stackarr_compose ps -q database)"
            [[ "$source_container" =~ ^[[:xdigit:]]+$ ]] || fail "Managed PostgreSQL database is not running"
            export STACKARR_PG_BACKUP_SOURCE_CONTAINER="$source_container"
        fi
    fi
fi

exec python3 "$ROOT_DIR/scripts/postgres-backup.py" "$@"
