#!/bin/bash
# The storage control plane stays internal and works when the config disk is missing.
set -euo pipefail
ROOT_DIR="$(cd "$(dirname "$0")/.." && pwd)"
source "$ROOT_DIR/lib/common.sh"
# Read installed path hints only, never the potentially unavailable config DB.
load_compose_runtime_env
POLICY="$(stackarr_storage_policy_file)"
JOURNAL="${POLICY%/*}/storage-migration.json"
CONTROL="$ROOT_DIR/scripts/storage-control.cjs"
MIGRATE="$ROOT_DIR/scripts/storage-migrate.cjs"
command="${1:-help}"
shift || true
case "$command" in
    status|check)
        if [[ ! -f "$POLICY" && ! -L "$POLICY" && ! -e "${POLICY%/*}/storage-enrollment.json" && ! -L "${POLICY%/*}/storage-enrollment.json" && ! -e "$JOURNAL" && ! -L "$JOURNAL" ]]; then
            printf 'External storage protection is not enabled. Existing storage configuration is unchanged.\n'
        else
            node "$CONTROL" host-check "$POLICY"
            printf 'Registered storage identities are ready.\n'
        fi
        ;;
    prepare)
        [[ "${1:-}" == --yes ]] || fail 'Usage: stackarr storage prepare --yes [compose-project]'
        stackarr_runtime_is_container && fail 'Storage preparation must run on the Docker host'
        node "$CONTROL" prepare "$POLICY" "${2:-stackarr}" --yes
        printf 'Managed automatic container restarts are disabled. Install the storage monitor before the next start.\n'
        ;;
    protect)
        [[ $# == 2 && "$2" == --yes ]] || fail 'Usage: stackarr storage protect /absolute/existing/path --yes'
        [[ -f "$POLICY" ]] || fail 'Run storage prepare first'
        stackarr_runtime_is_container && fail 'Volume enrollment must run on the Docker host'
        node "$CONTROL" protect "$POLICY" "$1" --yes
        ;;
    stop|down)
        [[ "${1:-}" == --yes ]] || fail 'Usage: stackarr storage stop|down --yes'
        stackarr_runtime_is_container && fail 'Recovery commands must run on the Docker host'
        node "$CONTROL" "$command" "$POLICY" --yes
        ;;
    migrate)
        stackarr_runtime_is_container && fail 'Migration must run on the Docker host'
        [[ -f "$POLICY" ]] || fail 'Run storage prepare and install the monitor before migration'
        mode="${1:-}"; shift || true
        case "$mode" in
            plan|run)
                [[ $# -ge 2 ]] || fail 'Usage: stackarr storage migrate plan|run SOURCE DESTINATION [--yes]'
                source_path="$1"; destination="$2"; shift 2
                load_compose_runtime_env
                [[ "$source_path" == "${CONFIG_ROOT:-$(default_app_root)/config}" ]] || fail 'SOURCE must be the configured CONFIG_ROOT; native apps, media and whole APP_ROOT moves are not supported'
                exec node "$MIGRATE" "$mode" "$source_path" "$destination" "$JOURNAL" "$POLICY" "$@"
                ;;
            rollback)
                exec node "$MIGRATE" rollback "$JOURNAL" "$POLICY" "$@"
                ;;
            *) fail 'Usage: stackarr storage migrate plan|run|rollback' ;;
        esac
        ;;
    monitor)
        stackarr_runtime_is_container && fail 'The storage monitor must run on the Docker host'
        exec node "$CONTROL" watch "$POLICY"
        ;;
    install)
        [[ "${1:-}" == --yes ]] || fail 'Usage: stackarr storage install --yes'
        stackarr_runtime_is_container && fail 'Install the monitor on the Docker host'
        [[ -f "$POLICY" ]] || fail 'Run storage prepare first'
        # Reuse the installed internal host-runtime owner, never a checkout or an external executable.
        bin="$(install_managed_host_runtime)"
        exec node "$ROOT_DIR/scripts/storage-monitor-install.cjs" "$bin" "$POLICY"
        ;;
    help|--help|-h)
        printf '%s\n' \
            'stackarr storage status|check' \
            'stackarr storage prepare --yes [compose-project]' \
            'stackarr storage protect /absolute/existing/path --yes' \
            'stackarr storage install --yes' \
            'stackarr storage stop --yes' \
            'stackarr storage down --yes' \
            'stackarr storage migrate plan SOURCE DESTINATION' \
            'stackarr storage migrate run SOURCE DESTINATION --yes' \
            'stackarr storage migrate rollback --yes' \
            'stackarr storage monitor' \
            'Keep APP_ROOT/state and host tools internal. Migration moves CONFIG_ROOT only; it never moves media, native Plex, or Docker VM storage.'
        ;;
    *) fail 'Unknown storage command. Run stackarr storage help.' ;;
esac
