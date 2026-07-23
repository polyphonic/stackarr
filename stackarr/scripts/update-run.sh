#!/bin/bash
set -euo pipefail

ROOT_DIR="$(cd "$(dirname "$0")/.." && pwd)"
# shellcheck source=lib/common.sh
source "$ROOT_DIR/lib/common.sh"

action="${1:-services}"

print_header "Stackarr Update"
load_env
write_compose_env_file
# The controller update does not read media libraries. Requiring every media
# mount here would prevent the isolated updater from ever starting because it
# deliberately mounts only Stackarr's config and runtime state.
case "$action" in
    run|services)
        wait_for_stackarr_storage
        ;;
esac
ensure_docker_runtime

profile_args=()
while IFS= read -r profile_arg; do
    profile_args+=("$profile_arg")
done < <(compose_profile_args)

TASK_LOGGER="$ROOT_DIR/scripts/task-log.cjs"

update_task_note() {
    local message="$1"
    [[ -n "${STACKARR_UPDATE_TASK_ID:-}" ]] || return 0
    node "$TASK_LOGGER" append "$STACKARR_UPDATE_TASK_ID" "$message"$'\n'
}

finish_update_task() {
    local status="$1"
    local exit_code="$2"
    [[ -n "${STACKARR_UPDATE_TASK_ID:-}" ]] || return 0
    node "$TASK_LOGGER" update "$STACKARR_UPDATE_TASK_ID" \
        --status "$status" \
        --exit-code "$exit_code" \
        --ended-now
}

enabled_managed_services() {
    local service
    while IFS= read -r service; do
        case "$service" in
            app|app-updater|database|database-init|image-cleanup)
                ;;
            *)
                printf '%s\n' "$service"
                ;;
        esac
    done < <(stackarr_compose "${profile_args[@]}" config --services)
}

update_managed_services() {
    local -a services=()
    local service

    while IFS= read -r service; do
        [[ -n "$service" ]] && services+=("$service")
    done < <(enabled_managed_services)

    if [[ "${#services[@]}" -eq 0 ]]; then
        warn "No managed app services are enabled"
        return 0
    fi

    ok "Pulling latest images for ${#services[@]} managed services"
    stackarr_compose "${profile_args[@]}" pull --quiet "${services[@]}"

    "$ROOT_DIR/scripts/naming.sh" prestart || true
    stackarr_compose "${profile_args[@]}" up -d --no-deps --remove-orphans "${services[@]}"
    remove_database_init_sidecar
    remove_inactive_torrent_client_container
    "$ROOT_DIR/scripts/naming.sh" apply --wait --skip-tmm || true
    "$ROOT_DIR/scripts/downloads.sh" apply --wait || true
    "$ROOT_DIR/scripts/requests.sh" apply --wait || true
    if stackarr_compose --profile maintenance run --rm image-cleanup; then
        ok "Dangling Docker images cleaned"
    else
        warn "Dangling Docker image cleanup failed; run 'docker image prune -f --filter dangling=true' manually if disk usage grows"
    fi

    ok "Managed services updated; the Stackarr controller was left running"
}

stackarr_image_is_local() {
    [[ "${STACKARR_IMAGE:-}" == *:local ]]
}

start_app_update_worker() {
    # The updater must not start from a stale moving-tag image: an older
    # controller image may not know the app-worker command yet. Compose pulls
    # the worker before it starts, then the worker pulls/recreates the app.
    local -a run_args=(--profile maintenance run --pull always --quiet-pull -d --rm)
    if [[ -n "${STACKARR_TASK_ID:-}" ]]; then
        run_args+=(-e "STACKARR_UPDATE_TASK_ID=$STACKARR_TASK_ID")
    fi

    stackarr_compose "${run_args[@]}" app-updater >/dev/null
    # The dashboard runner recognizes this handoff. The independent worker now
    # owns the task because recreating the app stops the original web process.
    printf '%s\n' "STACKARR_UPDATE_HANDOFF_STARTED Stackarr update handed to the maintenance worker"
}

update_stackarr_app_worker() {
    local health_url
    local worker_task_finished=false

    if [[ "${STACKARR_RUNTIME:-}" != "docker-updater" ]]; then
        fail "Stackarr app-worker is an internal maintenance command"
    fi

    finish_failed_worker_task() {
        local exit_code="$?"
        if [[ "$worker_task_finished" != true && -n "${STACKARR_UPDATE_TASK_ID:-}" ]]; then
            set +e
            update_task_note "Stackarr controller update stopped before health verification completed"
            finish_update_task failed "${exit_code:-1}"
        fi
    }
    trap finish_failed_worker_task EXIT

    # Let the dashboard command finish its final output write before the
    # independent worker begins appending to the same task.
    sleep 2
    update_task_note "Pulling the published Stackarr controller image"

    if ! stackarr_compose --profile stackarr pull --quiet app; then
        update_task_note "Stackarr image pull failed; the running controller was left unchanged"
        finish_update_task failed 1
        worker_task_finished=true
        return 1
    fi

    update_task_note "Reconciling database access before recreating Stackarr"
    if ! ensure_shared_database; then
        update_task_note "Database reconciliation failed; the running controller was left unchanged"
        finish_update_task failed 1
        worker_task_finished=true
        return 1
    fi

    update_task_note "Recreating only the Stackarr controller"
    if ! stackarr_compose --profile stackarr up -d --force-recreate --no-deps app; then
        update_task_note "Stackarr recreation failed"
        finish_update_task failed 1
        worker_task_finished=true
        return 1
    fi

    if [[ -f /.dockerenv || -f /run/.containerenv ]]; then
        health_url="http://app:${STACKARR_WEB_PORT:-7777}/api/v1/health"
    else
        health_url="http://127.0.0.1:${STACKARR_WEB_PORT:-7777}/api/v1/health"
    fi
    wait_for_http "Stackarr" "$health_url"

    update_task_note "Stackarr controller updated and healthy"
    finish_update_task completed 0
    worker_task_finished=true
    trap - EXIT
    ok "Stackarr controller updated"
}

update_stackarr_app() {
    if stackarr_image_is_local; then
        warn "Stackarr uses the local image '$STACKARR_IMAGE'; keeping it in place"
        warn "Rebuild the local image from its source checkout before replacing the controller"
        return 0
    fi

    start_app_update_worker
}

case "$action" in
    run|services)
        update_managed_services
        ;;
    app)
        update_stackarr_app
        ;;
    app-worker)
        update_stackarr_app_worker
        ;;
    *)
        fail "Usage: stackarr update services|app"
        ;;
esac

warn "Review service status from the Stackarr dashboard if an app reports a problem after an image refresh"
