#!/bin/bash
set -euo pipefail

ROOT_DIR="$(cd "$(dirname "$0")/.." && pwd)"
# shellcheck source=lib/common.sh
source "$ROOT_DIR/lib/common.sh"

usage() {
    cat <<'EOF'
Usage:
  stackarr security apply
EOF
}

TASK_LOGGER="$ROOT_DIR/scripts/task-log.cjs"

run_security_task_logger() {
    [[ -n "${STACKARR_UPDATE_TASK_ID:-}" ]] || return 0

    if node "$TASK_LOGGER" "$@"; then
        return 0
    fi

    if [[ -n "${STACKARR_TASK_DATABASE_URL:-}" && "${STACKARR_TASK_DATABASE_URL}" != "${STACKARR_DATABASE_URL:-}" ]]; then
        STACKARR_DATABASE_URL="$STACKARR_TASK_DATABASE_URL" node "$TASK_LOGGER" "$@"
        return
    fi

    return 1
}

update_security_task_note() {
    local message="$1"
    run_security_task_logger append "$STACKARR_UPDATE_TASK_ID" "$message"$'\n'
}

finish_security_task() {
    local status="$1"
    local exit_code="$2"
    run_security_task_logger update "$STACKARR_UPDATE_TASK_ID" \
        --status "$status" \
        --exit-code "$exit_code" \
        --ended-now
}

database_running() {
    stackarr_compose ps --services --status running 2>/dev/null | grep -qx 'database'
}

wait_for_database_socket() {
    local attempts="${1:-45}"
    local attempt=1

    while [[ "$attempt" -le "$attempts" ]]; do
        if stackarr_compose exec -T database \
            pg_isready -U "${DATABASE_SUPERUSER:-postgres}" -d "${DATABASE_NAME:-postgres}" >/dev/null 2>&1; then
            ok "Postgres is reachable"
            return 0
        fi
        sleep 2
        attempt=$((attempt + 1))
    done

    warn "Postgres did not become reachable for password rotation"
    return 1
}

rotate_postgres_role() {
    local role="$1"
    local password="$2"
    local label="$3"

    [[ -n "$role" && -n "$password" ]] || return 0

    stackarr_compose exec -T database \
        psql \
        -v ON_ERROR_STOP=1 \
        -U "${DATABASE_SUPERUSER:-postgres}" \
        -d "${DATABASE_NAME:-postgres}" \
        -v app_user="$role" \
        -v app_password="$password" <<'SQL' >/dev/null
SELECT format('ALTER ROLE %I LOGIN PASSWORD %L', :'app_user', :'app_password')
WHERE EXISTS (SELECT 1 FROM pg_roles WHERE rolname = :'app_user')
\gexec
SQL

    ok "$label password rotated"
}

rotate_postgres_roles() {
    if ! database_running; then
        warn "Postgres role rotation skipped because the database container is not running"
        return 0
    fi

    wait_for_database_socket || return 0

    rotate_postgres_role "${DATABASE_SUPERUSER:-postgres}" "${DATABASE_SUPERUSER_PASSWORD:-}" "Postgres superuser"
    rotate_postgres_role "${STACKARR_POSTGRES_USER:-stackarr}" "${STACKARR_POSTGRES_PASSWORD:-}" "Stackarr Postgres"
    rotate_postgres_role "${BOOKORBIT_POSTGRES_USER:-bookorbit}" "${BOOKORBIT_POSTGRES_PASSWORD:-}" "BookOrbit Postgres"
    rotate_postgres_role "${IMMICH_DB_USERNAME:-immich}" "${IMMICH_DB_PASSWORD:-}" "Immich Postgres"
    rotate_postgres_role "${SEERR_POSTGRES_USER:-seerr}" "${SEERR_POSTGRES_PASSWORD:-}" "Seerr Postgres"
    rotate_postgres_role "${PULSARR_POSTGRES_USER:-pulsarr}" "${PULSARR_POSTGRES_PASSWORD:-}" "Pulsarr Postgres"
    rotate_postgres_role "${BAZARR_POSTGRES_USER:-bazarr}" "${BAZARR_POSTGRES_PASSWORD:-}" "Bazarr Postgres"
    rotate_postgres_role "${PROWLARR_POSTGRES_USER:-prowlarr}" "${PROWLARR_POSTGRES_PASSWORD:-}" "Prowlarr Postgres"
    rotate_postgres_role "${RADARR_POSTGRES_USER:-radarr}" "${RADARR_POSTGRES_PASSWORD:-}" "Radarr Postgres"
    rotate_postgres_role "${RADARR4K_POSTGRES_USER:-radarr4k}" "${RADARR4K_POSTGRES_PASSWORD:-}" "Radarr 4K Postgres"
    rotate_postgres_role "${SONARR_POSTGRES_USER:-sonarr}" "${SONARR_POSTGRES_PASSWORD:-}" "Sonarr Postgres"
    rotate_postgres_role "${SONARR4K_POSTGRES_USER:-sonarr4k}" "${SONARR4K_POSTGRES_PASSWORD:-}" "Sonarr 4K Postgres"
    rotate_postgres_role "${LIDARR_POSTGRES_USER:-lidarr}" "${LIDARR_POSTGRES_PASSWORD:-}" "Lidarr Postgres"
}

sync_pulsarr_admin_identity() {
    local admin_count password_hash

    optional_service_enabled pulsarr || return 0

    if [[ -z "${USERNAME:-}" ]]; then
        warn "Pulsarr admin identity sync skipped because USERNAME is empty"
        return 1
    fi

    if [[ -z "${PULSARR_PASSWORD:-}" ]]; then
        warn "Pulsarr admin identity sync skipped because its shared password is empty"
        return 1
    fi

    if ! database_running; then
        warn "Pulsarr admin identity sync skipped because the database container is not running"
        return 1
    fi

    wait_for_database_socket || return 1
    admin_count="$(stackarr_compose exec -T database \
        psql \
        -v ON_ERROR_STOP=1 \
        -U "${DATABASE_SUPERUSER:-postgres}" \
        -d "${PULSARR_POSTGRES_DATABASE:-pulsarr}" \
        -Atqc 'SELECT count(*) FROM admin_users' 2>/dev/null || true)"

    if [[ "$admin_count" != "1" ]]; then
        warn "Pulsarr admin identity sync requires exactly one local admin; found ${admin_count:-unknown}"
        return 1
    fi

    password_hash="$(printf '%s' "$PULSARR_PASSWORD" | stackarr_compose exec -T pulsarr \
        node --input-type=module -e '
            import fs from "node:fs";
            const { scryptHash } = await import("/app/dist/plugins/custom/scrypt.js");
            process.stdout.write(await scryptHash(fs.readFileSync(0, "utf8")));
        ' 2>/dev/null || true)"
    if [[ ${#password_hash} -lt 80 ]]; then
        warn "Pulsarr admin identity sync could not generate a compatible password hash"
        return 1
    fi

    stackarr_compose exec -T database \
        psql \
        -v ON_ERROR_STOP=1 \
        -U "${DATABASE_SUPERUSER:-postgres}" \
        -d "${PULSARR_POSTGRES_DATABASE:-pulsarr}" \
        -v admin_username="$USERNAME" \
        -v admin_password_hash="$password_hash" <<'SQL' >/dev/null
UPDATE admin_users
SET username = :'admin_username', password = :'admin_password_hash', updated_at = NOW();
SQL

    ok "Pulsarr shared admin credentials synced"
}

ensure_database_roles() {
    database_required || return 0

    stackarr_compose --profile database up -d database
    rotate_postgres_roles
    run_shared_database_init
    remove_database_init_sidecar
}

security_service_list() {
    local services=()
    local printed_services=""
    local service

    services+=("$(selected_torrent_client)")
    services+=("prowlarr")

    if optional_service_enabled movies; then
        services+=("radarr")
    fi
    if optional_service_enabled radarr4k; then
        services+=("radarr4k")
    fi
    if optional_service_enabled tv; then
        services+=("sonarr")
    fi
    if optional_service_enabled sonarr4k; then
        services+=("sonarr4k")
    fi
    if optional_service_enabled lidarr; then
        services+=("lidarr")
    fi
    if optional_service_enabled bazarr; then
        services+=("bazarr")
    fi
    if optional_service_enabled tinymediamanager; then
        services+=("tinymediamanager")
    fi
    if optional_service_enabled bookorbit; then
        services+=("bookorbit")
    fi
    if optional_service_enabled immich; then
        services+=("immich")
        services+=("immich-ml")
        services+=("redis")
    fi
    if optional_service_enabled romm; then
        services+=("romm")
        services+=("redis")
    fi
    if optional_service_enabled seerr; then
        services+=("seerr")
    fi
    if optional_service_enabled pulsarr; then
        services+=("pulsarr")
    fi
    if optional_service_enabled tracearr; then
        services+=("tracearr")
        services+=("redis")
    fi
    if optional_service_enabled youtarr; then
        services+=("youtarr")
    fi
    # Stackarr controller stays online because it reads account credentials from runtime storage.
    # Recreating it from its own queued task terminates that task before the
    # remaining credential-dependent services can be reconciled.

    for service in "${services[@]}"; do
        [[ -n "$service" ]] || continue
        case " $printed_services " in
            *" $service "*)
                continue
                ;;
        esac
        printed_services="$printed_services $service"
        printf '%s\n' "$service"
    done
}

recreate_security_services() {
    local profile_args=()
    local services=()
    local service

    while IFS= read -r profile_arg; do
        profile_args+=("$profile_arg")
    done < <(compose_profile_args)

    while IFS= read -r service; do
        [[ -n "$service" ]] || continue
        services+=("$service")
    done < <(security_service_list)

    [[ "${#services[@]}" -gt 0 ]] || return 0

    stackarr_compose "${profile_args[@]}" up -d --force-recreate --no-deps "${services[@]}"
    ok "Security-sensitive services recreated"
}

api_put_json() {
    local label="$1"
    local url="$2"
    local api_key="$3"
    local payload="$4"

    if [[ -z "$api_key" ]]; then
        warn "$label skipped because the API key is unavailable"
        return 0
    fi

    if curl -fsS -X PUT "$url" -H 'Content-Type: application/json' -H "X-Api-Key: $api_key" -d "$payload" >/dev/null; then
        ok "$label"
        return 0
    fi

    warn "$label failed"
    return 1
}

configure_servarr_auth() {
    local label="$1"
    local url="$2"
    local api_key="$3"
    local auth_password="$4"
    local current payload

    if [[ -z "$api_key" ]]; then
        warn "$label skipped because the API key is unavailable"
        return 0
    fi

    if [[ -z "${USERNAME:-}" || -z "$auth_password" ]]; then
        warn "$label skipped because USERNAME or password is empty"
        return 0
    fi

    current="$(curl -fsS "$url" -H "X-Api-Key: $api_key" 2>/dev/null)" || {
        warn "$label settings could not be read"
        return 1
    }

    payload="$(python3 - "$USERNAME" "$auth_password" "$current" <<'PY'
import json
import sys

username = sys.argv[1]
password = sys.argv[2]
data = json.loads(sys.argv[3])

data["authenticationMethod"] = "forms"
data["authenticationRequired"] = "enabled"
data["username"] = username
data["password"] = password
data["passwordConfirmation"] = password

print(json.dumps(data))
PY
)"

    api_put_json "$label" "$url" "$api_key" "$payload" || true
}

configure_bazarr_auth() {
    local file="$CONFIG_ROOT/bazarr/config/config.yaml"
    local target_hash result

    if ! optional_service_enabled bazarr; then
        warn "Bazarr UI auth skipped because Bazarr is disabled"
        return 0
    fi

    if [[ -z "${USERNAME:-}" || -z "${BAZARR_PASSWORD:-}" ]]; then
        warn "Bazarr UI auth skipped because USERNAME or password is empty"
        return 0
    fi

    [[ -f "$file" ]] || {
        warn "Bazarr config file missing at $file"
        return 1
    }

    target_hash="$(python3 - "${BAZARR_PASSWORD:-}" <<'PY'
import hashlib
import sys

print(hashlib.md5(sys.argv[1].encode()).hexdigest())
PY
)"

    result="$(python3 - "$file" "$USERNAME" "$target_hash" <<'PY'
from pathlib import Path
import sys

path = Path(sys.argv[1])
username = sys.argv[2]
password_hash = sys.argv[3]
lines = path.read_text().splitlines()
out = []
in_auth = False
found_type = False
found_username = False
found_password = False
changed = False

def emit_missing():
    global found_type, found_username, found_password, changed
    if not found_type:
        out.append("  type: form")
        changed = True
    if not found_username:
        out.append(f"  username: '{username}'")
        changed = True
    if not found_password:
        out.append(f"  password: '{password_hash}'")
        changed = True

for line in lines:
    stripped = line.strip()

    if not in_auth and stripped == "auth:":
        in_auth = True
        found_type = False
        found_username = False
        found_password = False
        out.append(line)
        continue

    if in_auth and line and not line.startswith(" "):
        emit_missing()
        in_auth = False

    if in_auth:
        if stripped.startswith("type:"):
            found_type = True
            desired = "  type: form"
            out.append(desired)
            changed = changed or line != desired
            continue
        if stripped.startswith("username:"):
            found_username = True
            desired = f"  username: '{username}'"
            out.append(desired)
            changed = changed or line != desired
            continue
        if stripped.startswith("password:"):
            found_password = True
            desired = f"  password: '{password_hash}'"
            out.append(desired)
            changed = changed or line != desired
            continue

    out.append(line)

if in_auth:
    emit_missing()

if changed:
    path.write_text("\n".join(out) + "\n")

print("changed" if changed else "unchanged")
PY
)"

    if [[ "$result" == "changed" ]]; then
        stackarr_compose restart bazarr >/dev/null || true
        ok "Bazarr UI auth configured"
    else
        warn "Bazarr UI auth already configured"
    fi
}

apply_servarr_auth() {
    local radarr_key radarr4k_key sonarr_key sonarr4k_key prowlarr_key lidarr_key

    RADARR_URL="$(service_url radarr "$RADARR_URL" 7878)"
    RADARR_4K_URL="$(service_url radarr4k "$RADARR_4K_URL" 7879)"
    SONARR_URL="$(service_url sonarr "$SONARR_URL" 8989)"
    SONARR_4K_URL="$(service_url sonarr4k "$SONARR_4K_URL" 8990)"
    PROWLARR_URL="$(service_url prowlarr "$PROWLARR_URL" 9696)"
    LIDARR_URL="$(service_url lidarr "$LIDARR_URL" 8686)"

    radarr_key="$(parse_api_key_xml "$CONFIG_ROOT/radarr/config.xml" || true)"
    radarr4k_key="$(parse_api_key_xml "$CONFIG_ROOT/radarr4k/config.xml" || true)"
    sonarr_key="$(parse_api_key_xml "$CONFIG_ROOT/sonarr/config.xml" || true)"
    sonarr4k_key="$(parse_api_key_xml "$CONFIG_ROOT/sonarr4k/config.xml" || true)"
    prowlarr_key="$(parse_api_key_xml "$CONFIG_ROOT/prowlarr/config.xml" || true)"
    lidarr_key="$(parse_api_key_xml "$CONFIG_ROOT/lidarr/config.xml" || true)"

    if optional_service_enabled movies; then
        configure_servarr_auth "Radarr UI auth configured" "$RADARR_URL/api/v3/config/host" "$radarr_key" "$RADARR_PASSWORD"
    fi
    if optional_service_enabled radarr4k; then
        configure_servarr_auth "Radarr 4K UI auth configured" "$RADARR_4K_URL/api/v3/config/host" "$radarr4k_key" "$RADARR4K_PASSWORD"
    fi
    if optional_service_enabled tv; then
        configure_servarr_auth "Sonarr UI auth configured" "$SONARR_URL/api/v3/config/host" "$sonarr_key" "$SONARR_PASSWORD"
    fi
    if optional_service_enabled sonarr4k; then
        configure_servarr_auth "Sonarr 4K UI auth configured" "$SONARR_4K_URL/api/v3/config/host" "$sonarr4k_key" "$SONARR4K_PASSWORD"
    fi
    configure_servarr_auth "Prowlarr UI auth configured" "$PROWLARR_URL/api/v1/config/host" "$prowlarr_key" "$PROWLARR_PASSWORD"
    if optional_service_enabled lidarr; then
        configure_servarr_auth "Lidarr UI auth configured" "$LIDARR_URL/api/v1/config/host" "$lidarr_key" "$LIDARR_PASSWORD"
    fi
}

apply_security() {
    local credential_sync_failed=false

    print_header "Stackarr Security Apply"
    load_env
    write_compose_env_file
    ensure_docker_runtime

    ensure_database_roles
    recreate_security_services
    sync_pulsarr_admin_identity || credential_sync_failed=true
    "$ROOT_DIR/scripts/downloads.sh" apply --wait || true
    apply_servarr_auth || true
    configure_bazarr_auth || true
    "$ROOT_DIR/scripts/bookorbit.sh" credentials apply --wait || true

    if optional_service_enabled cleanuparr; then
        python3 "$ROOT_DIR/scripts/cleanuparr-credentials.py" || credential_sync_failed=true
        CLEANUPARR_URL="http://cleanuparr:${CLEANUPARR_PORT:-11011}" \
            python3 "$ROOT_DIR/scripts/cleanuparr-configure.py" || credential_sync_failed=true
    fi

    if [[ "$credential_sync_failed" == "true" ]]; then
        fail "One or more managed service credentials could not be applied"
    fi

    ok "Security apply completed"
}

start_security_apply_worker() {
    local task_database_url="${1:-}"
    local -a run_args=(--profile maintenance run --quiet-pull -d --rm)
    if [[ -n "${STACKARR_TASK_ID:-}" ]]; then
        run_args+=(-e "STACKARR_UPDATE_TASK_ID=$STACKARR_TASK_ID")
    fi
    if [[ -n "$task_database_url" ]]; then
        run_args+=(-e "STACKARR_TASK_DATABASE_URL=$task_database_url")
    fi

    STACKARR_SECURITY_HANDOFF=true stackarr_compose "${run_args[@]}" app-updater security apply-worker >/dev/null
    printf '%s\n' "STACKARR_TASK_HANDOFF_STARTED Security apply handed to the maintenance worker"
}

apply_security_worker() {
    local worker_task_finished=false

    if [[ "${STACKARR_RUNTIME:-}" != "docker-updater" || "${STACKARR_SECURITY_HANDOFF:-false}" != "true" ]]; then
        fail "Stackarr security apply-worker is an internal maintenance command"
    fi

    finish_failed_worker_task() {
        local exit_code="$?"
        if [[ "$worker_task_finished" != true && -n "${STACKARR_UPDATE_TASK_ID:-}" ]]; then
            set +e
            update_security_task_note "Security apply stopped before verification completed"
            finish_security_task failed "${exit_code:-1}"
        fi
    }
    trap finish_failed_worker_task EXIT

    sleep 2
    # A database password can change during apply_security. Do not use the
    # task database until Postgres has accepted the new credentials.
    apply_security

    update_security_task_note "Recreating the Stackarr controller with current database credentials"
    stackarr_compose --profile stackarr up -d --force-recreate --no-deps app
    wait_for_http "Stackarr" "http://app:${STACKARR_WEB_PORT:-7777}/api/v1/health"

    update_security_task_note "Security credentials applied and Stackarr is healthy"
    finish_security_task completed 0
    worker_task_finished=true
    trap - EXIT
}

case "${1:-help}" in
    apply)
        if [[ "${STACKARR_RUNTIME:-}" == "docker" && -n "${STACKARR_TASK_ID:-}" ]]; then
            task_database_url="${STACKARR_DATABASE_URL:-}"
            load_env
            write_compose_env_file
            ensure_docker_runtime
            start_security_apply_worker "$task_database_url"
        else
            apply_security
        fi
        ;;
    apply-worker)
        apply_security_worker
        ;;
    help|--help|-h)
        usage
        ;;
    *)
        usage
        exit 1
        ;;
esac
