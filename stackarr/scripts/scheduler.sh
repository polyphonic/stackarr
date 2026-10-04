#!/bin/bash
set -euo pipefail

ROOT_DIR="$(cd "$(dirname "$0")/.." && pwd)"
# shellcheck source=lib/common.sh
source "$ROOT_DIR/lib/common.sh"

INTERVAL_SECONDS="${STACKARR_SCHEDULER_INTERVAL_SECONDS:-60}"

log_scheduler() {
    printf '[stackarr-scheduler] %s\n' "$*"
}

weekday_number() {
    case "$(lowercase "${1:-Sun}")" in
        sun|sunday|0|7)
            printf '0\n'
            ;;
        mon|monday|1)
            printf '1\n'
            ;;
        tue|tues|tuesday|2)
            printf '2\n'
            ;;
        wed|wednesday|3)
            printf '3\n'
            ;;
        thu|thur|thurs|thursday|4)
            printf '4\n'
            ;;
        fri|friday|5)
            printf '5\n'
            ;;
        sat|saturday|6)
            printf '6\n'
            ;;
        *)
            return 1
            ;;
    esac
}

time_number() {
    local value="${1:-00:00}"
    [[ "$value" =~ ^([01][0-9]|2[0-3]):([0-5][0-9])$ ]] || return 1
    printf '%s%s\n' "${value%%:*}" "${value##*:}"
}

last_stamp_file() {
    local job="$1"
    printf '%s/scheduler/%s.last\n' "$STATE_ROOT" "$job"
}

job_lock_dir() {
    local job="$1"
    printf '%s/scheduler/%s.lock\n' "$STATE_ROOT" "$job"
}

already_ran() {
    local job="$1"
    local stamp="$2"
    local file
    file="$(last_stamp_file "$job")"
    [[ -f "$file" ]] && [[ "$(cat "$file" 2>/dev/null || true)" == "$stamp" ]]
}

mark_ran() {
    local job="$1"
    local stamp="$2"
    ensure_dir "$STATE_ROOT/scheduler"
    printf '%s\n' "$stamp" >"$(last_stamp_file "$job")"
}

due_daily_or_weekly() {
    local job="$1"
    local schedule="$2"
    local configured_time="$3"
    local configured_weekday="${4:-Sun}"
    local now_date now_weekday now_time configured_time_number configured_weekday_number stamp
    local now_time_number configured_time_decimal

    now_date="$(date '+%F')"
    now_weekday="$(date '+%w')"
    now_time="$(date '+%H%M')"
    configured_time_number="$(time_number "$configured_time")" || {
        log_scheduler "$job skipped: invalid time '$configured_time'"
        return 1
    }

    case "$(lowercase "$schedule")" in
        daily)
            stamp="$now_date"
            ;;
        weekly)
            configured_weekday_number="$(weekday_number "$configured_weekday")" || {
                log_scheduler "$job skipped: invalid weekday '$configured_weekday'"
                return 1
            }
            [[ "$now_weekday" == "$configured_weekday_number" ]] || return 1
            stamp="$now_date"
            ;;
        *)
            log_scheduler "$job skipped: invalid schedule '$schedule'"
            return 1
            ;;
    esac

    now_time_number=$((10#$now_time))
    configured_time_decimal=$((10#$configured_time_number))
    (( now_time_number >= configured_time_decimal )) || return 1
    already_ran "$job" "$stamp" && return 1
    printf '%s\n' "$stamp"
}

run_with_lock() {
    local job="$1"
    local stamp="$2"
    local lock result
    lock="$(job_lock_dir "$job")"
    ensure_dir "$lock"

    # The lock directory is persistent (including legacy empty .lock directories).
    # flock is held by the supervisor across the whole job and stamp write. Unlike
    # PID checks, kernel locks work across host/container PID namespaces and cannot
    # mistake a recycled PID for the original owner.
    if python3 - "$lock/active" "$ROOT_DIR/scripts/scheduler.sh" "$job" "$stamp" <<'PY'
import fcntl
import subprocess
import sys

with open(sys.argv[1], "a+") as lock:
    try:
        fcntl.flock(lock, fcntl.LOCK_EX | fcntl.LOCK_NB)
    except BlockingIOError:
        print(f"[stackarr-scheduler] {sys.argv[3]} already running", flush=True)
        sys.exit(0)
    # Inherit the same open file description so a surviving job keeps the lock
    # even if its scheduler/supervisor is killed during a controller restart.
    child = subprocess.Popen(
        ["bash", sys.argv[2], "--locked-job", sys.argv[3], sys.argv[4]],
        pass_fds=(lock.fileno(),),
    )
    sys.exit(child.wait())
PY
    then
        return 0
    else
        result=$?
    fi
    log_scheduler "$job lock supervisor failed ($result)"
    return "$result"
}

run_locked_job() {
    local job="$1" stamp="$2"
    load_env || return 1
    # Recheck under the lock: both host and container schedulers may have seen
    # the same due stamp before either acquired it.
    already_ran "$job" "$stamp" && return 0
    log_scheduler "running $job"
    case "$job" in
        backup) if run_backup_job; then log_scheduler "$job completed"; else log_scheduler "$job failed"; fi ;;
        update) if run_update_job; then log_scheduler "$job completed"; else log_scheduler "$job failed"; fi ;;
        *) return 2 ;;
    esac
    mark_ran "$job" "$stamp"
}

run_backup_job() {
    STACKARR_RUN_SOURCE=scheduled "$ROOT_DIR/bin/stackarr" backup run
}

run_update_job() {
    local task_id exit_code log_exit
    local -a statuses
    task_id="$(STACKARR_DATABASE_FILE="$STACKARR_DATABASE_FILE" node "$ROOT_DIR/scripts/task-log.cjs" create --command Update --label "Update apps")"

    # Persist each line as it arrives; a controller restart must not discard the
    # entire buffered update log. Keep pipeline statuses separate from set -e.
    set +e
    STACKARR_RUN_SOURCE=scheduled "$ROOT_DIR/bin/stackarr" update services 2>&1 |
        while IFS= read -r line || [[ -n "$line" ]]; do
            # Keep each CLI argument bounded even for a command with no newlines.
            if (( ${#line} > 8192 )); then line="${line:0:8192} [line truncated]"; fi
            STACKARR_DATABASE_FILE="$STACKARR_DATABASE_FILE" node "$ROOT_DIR/scripts/task-log.cjs" append "$task_id" "$line"$'\n' || exit 1
        done
    statuses=("${PIPESTATUS[@]}")
    exit_code=${statuses[0]} log_exit=${statuses[1]}
    set -e
    if (( log_exit != 0 && exit_code == 0 )); then exit_code=1; fi

    if [[ "$exit_code" -eq 0 ]]; then
        STACKARR_DATABASE_FILE="$STACKARR_DATABASE_FILE" node "$ROOT_DIR/scripts/task-log.cjs" update "$task_id" --status completed --exit-code 0 --ended-now
        return 0
    fi

    STACKARR_DATABASE_FILE="$STACKARR_DATABASE_FILE" node "$ROOT_DIR/scripts/task-log.cjs" update "$task_id" --status failed --exit-code "$exit_code" --ended-now
    return "$exit_code"
}

run_agent_routines() {
    STACKARR_RUN_SOURCE=scheduled "$ROOT_DIR/bin/stackarr" routines run-due || log_scheduler "agent routines check failed"
}

run_questarr_romm_import() {
    local minute slot
    minute="$(date '+%M')"
    slot="$(date '+%F-%H')-$((10#$minute / 10))"
    already_ran "questarr-romm-import" "$slot" && return 0
    mark_ran "questarr-romm-import" "$slot"

    STACKARR_RUN_SOURCE=scheduled "$ROOT_DIR/bin/stackarr" questarr romm-library sync --yes --limit 20 || log_scheduler "RomM owned-library sync failed"
    STACKARR_RUN_SOURCE=scheduled "$ROOT_DIR/bin/stackarr" questarr romm-import run --yes || log_scheduler "Questarr RomM import failed"
}

if [[ "${1:-}" == "--locked-job" ]]; then
    [[ $# -eq 3 ]] || exit 2
    run_locked_job "$2" "$3"
    exit $?
fi

log_scheduler "started"

while true; do
    if load_env; then
        export TZ="$TIMEZONE"
        ensure_dir "$STATE_ROOT/scheduler"

        if flag_enabled "${ENABLE_BACKUP:-true}"; then
            if backup_stamp="$(due_daily_or_weekly backup "${BACKUP_SCHEDULE:-weekly}" "${BACKUP_TIME:-02:00}" "${BACKUP_WEEKDAY:-Sun}")"; then
                run_with_lock backup "$backup_stamp"
            fi
        fi

        if flag_enabled "${ENABLE_SCHEDULED_UPDATES:-false}"; then
            if update_stamp="$(due_daily_or_weekly update weekly "${UPDATE_TIME:-04:30}" "${UPDATE_WEEKDAY:-Sun}")"; then
                run_with_lock update "$update_stamp"
            fi
        fi

        if [[ "${1:-}" == "--run-once" ]]; then exit 0; fi
        run_agent_routines

        if flag_enabled "${QUESTARR_ROMM_IMPORT_ENABLED:-false}"; then
            run_questarr_romm_import
        fi
    else
        log_scheduler "runtime config not ready"
    fi

    sleep "$INTERVAL_SECONDS"
done
