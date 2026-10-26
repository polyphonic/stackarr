#!/bin/bash
# Loaded by common.sh. No probing or writes until a caller explicitly runs a guard.
stackarr_storage_policy_file() {
    local state_root="${STATE_ROOT:-${APP_ROOT:-$(default_app_root)}/state}"
    printf '%s\n' "${STACKARR_STORAGE_POLICY:-$state_root/storage-policy.json}"
}

stackarr_storage_guard() {
    local policy
    policy="$(stackarr_storage_policy_file)"
    if [[ -z "${STACKARR_STORAGE_POLICY:-}" && ! -e "$policy" && ! -L "$policy" && ! -e "${policy%/*}/storage-enrollment.json" && ! -L "${policy%/*}/storage-enrollment.json" && ! -e "${policy%/*}/storage-migration.json" && ! -L "${policy%/*}/storage-migration.json" ]]; then
        return 0
    fi
    [[ -f "$policy" && ! -L "$policy" ]] || fail 'External storage policy is unavailable; refusing an unguarded operation'
    export STACKARR_STORAGE_POLICY="$policy"
    require_command node
    if stackarr_runtime_is_container; then
        node "$ROOT_DIR/scripts/storage-control.cjs" guest-check "$policy" || fail 'External storage host verification failed'
    else
        node "$ROOT_DIR/scripts/storage-control.cjs" host-check "$policy" || fail 'External storage identity verification failed'
    fi
}

prepare_storage_compose_override() {
    local project_dir="$1" source_file="$2" target
    [[ -n "${STACKARR_STORAGE_POLICY:-}" ]] || return 0
    target="$project_dir/storage-override.json"
    [[ "$project_dir" != "$ROOT_DIR" ]] || fail 'Guarded storage requires an installed generated Compose project'
    if ! node "$ROOT_DIR/scripts/storage-control.cjs" override "$STACKARR_STORAGE_POLICY" "$source_file" "$project_dir" > "$target.tmp.$$"; then
        rm -f "$target.tmp.$$"
        fail 'Cannot generate guarded Compose topology'
    fi
    chmod 600 "$target.tmp.$$"
    mv "$target.tmp.$$" "$target"
}
