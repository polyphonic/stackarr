#!/bin/bash
set -euo pipefail

ROOT_DIR="$(cd "$(dirname "$0")/.." && pwd)"
# shellcheck source=lib/common.sh
source "$ROOT_DIR/lib/common.sh"

usage() {
    cat <<'EOF'
Usage:
  stackarr bookorbit credentials apply [--wait]
EOF
}

wait_for_bookorbit_database() {
    local attempts="${1:-45}"
    local sleep_seconds="${2:-2}"
    local i

    for ((i = 1; i <= attempts; i++)); do
        if stackarr_compose exec -T \
            -e PGPASSWORD="$BOOKORBIT_POSTGRES_PASSWORD" \
            database pg_isready \
            -U "${BOOKORBIT_POSTGRES_USER:-bookorbit}" \
            -d "${BOOKORBIT_POSTGRES_DATABASE:-bookorbit}" >/dev/null 2>&1; then
            return 0
        fi
        sleep "$sleep_seconds"
    done

    warn "BookOrbit database is not ready yet"
    return 1
}

bookorbit_app_is_running() {
    stackarr_compose ps --services --status running 2>/dev/null | grep -qx 'bookorbit'
}

bookorbit_password_hash() {
    stackarr_compose exec -T \
        -e STACKARR_BOOKORBIT_PASSWORD="$BOOKORBIT_PASSWORD" \
        bookorbit node -e '
const { hash } = require("bcryptjs");
hash(process.env.STACKARR_BOOKORBIT_PASSWORD || "", 12)
  .then((value) => process.stdout.write(value))
  .catch((error) => {
    console.error(error && error.message ? error.message : error);
    process.exit(1);
  });
'
}

apply_bookorbit_credentials() {
    local wait_for_ready="$1"
    local password_hash email

    if ! optional_service_enabled bookorbit; then
        warn "BookOrbit credential sync skipped because BookOrbit is disabled"
        return 0
    fi

    if [[ -z "${USERNAME:-}" || -z "${BOOKORBIT_PASSWORD:-}" ]]; then
        warn "BookOrbit credential sync skipped because USERNAME or BOOKORBIT_PASSWORD is empty"
        return 1
    fi

    if [[ "$wait_for_ready" == "true" ]]; then
        wait_for_bookorbit_database || return 1
    fi

    if ! bookorbit_app_is_running; then
        warn "BookOrbit credential sync skipped because the BookOrbit app container is not running"
        return 1
    fi

    password_hash="$(bookorbit_password_hash)" || {
        warn "BookOrbit password hash could not be generated"
        return 1
    }

    email="${USER_EMAIL:-}"

    stackarr_compose exec -T \
        -e PGPASSWORD="$BOOKORBIT_POSTGRES_PASSWORD" \
        database psql \
        -v ON_ERROR_STOP=1 \
        -U "${BOOKORBIT_POSTGRES_USER:-bookorbit}" \
        -d "${BOOKORBIT_POSTGRES_DATABASE:-bookorbit}" \
        -v username="$USERNAME" \
        -v name="$USERNAME" \
        -v email="$email" \
        -v password_hash="$password_hash" <<'SQL' >/dev/null
BEGIN;

CREATE TEMP TABLE _stackarr_bookorbit_token_users ON COMMIT DROP AS
SELECT id FROM users WHERE false;

CREATE TEMP TABLE _stackarr_bookorbit_target_user ON COMMIT DROP AS
SELECT id FROM users WHERE false;

WITH desired AS (
    SELECT
        :'username'::varchar(100) AS username,
        :'name'::varchar(255) AS name,
        NULLIF(:'email', '')::varchar(255) AS desired_email,
        :'password_hash'::varchar(255) AS password_hash
),
existing AS (
    SELECT id
    FROM users
    WHERE lower(username) = lower((SELECT username FROM desired))
       OR id = (
          SELECT value::integer
          FROM app_settings
          WHERE key = 'stackarr_shared_admin_user_id'
            AND value ~ '^[0-9]+$'
          LIMIT 1
       )
       OR provisioning_method = 'shared'
       OR lower(username) = 'stackarr'
    ORDER BY
        (lower(username) = lower((SELECT username FROM desired))) DESC,
        (provisioning_method = 'shared') DESC,
        is_superuser DESC,
        id
    LIMIT 1
),
email_choice AS (
    SELECT
        CASE
            WHEN desired_email IS NULL THEN NULL
            WHEN EXISTS (
                SELECT 1
                FROM users
                WHERE lower(email) = lower(desired_email)
                  AND id <> COALESCE((SELECT id FROM existing), -1)
                  AND provisioning_method <> 'shared'
                  AND lower(username) <> 'stackarr'
            ) THEN NULL
            ELSE desired_email
        END AS email
    FROM desired
),
updated AS (
    UPDATE users
    SET
        username = desired.username,
        name = desired.name,
        email = email_choice.email,
        password_hash = desired.password_hash,
        active = true,
        is_superuser = true,
        is_default_password = false,
        token_version = users.token_version + 1,
        failed_login_attempts = 0,
        locked_until = NULL,
        provisioning_method = 'local',
        updated_at = now()
    FROM desired, email_choice
    WHERE users.id = (SELECT id FROM existing)
    RETURNING users.id
),
inserted AS (
    INSERT INTO users (
        username,
        name,
        email,
        password_hash,
        active,
        is_superuser,
        is_default_password,
        token_version,
        failed_login_attempts,
        settings,
        avatar_source,
        avatar_version,
        provisioning_method
    )
    SELECT
        desired.username,
        desired.name,
        email_choice.email,
        desired.password_hash,
        true,
        true,
        false,
        1,
        0,
        '{}'::jsonb,
        'none',
        0,
        'local'
    FROM desired, email_choice
    WHERE NOT EXISTS (SELECT 1 FROM existing)
    RETURNING id
),
target_user AS (
    SELECT id FROM updated
    UNION ALL
    SELECT id FROM inserted
),
retired_users AS (
    UPDATE users
    SET
        active = false,
        is_superuser = false,
        token_version = users.token_version + 1,
        updated_at = now()
    WHERE id <> (SELECT id FROM target_user)
      AND (
          provisioning_method = 'shared'
          OR lower(username) = 'stackarr'
      )
    RETURNING id
),
wrote_target AS (
    INSERT INTO _stackarr_bookorbit_target_user
    SELECT id FROM target_user
    RETURNING id
)
INSERT INTO _stackarr_bookorbit_token_users
SELECT id FROM wrote_target
UNION
SELECT id FROM retired_users;

INSERT INTO app_settings (key, value)
VALUES ('initial_setup_completed_at', now()::text)
ON CONFLICT (key) DO UPDATE
SET updated_at = now();

INSERT INTO app_settings (key, value)
SELECT 'stackarr_shared_admin_user_id', id::text
FROM _stackarr_bookorbit_target_user
ON CONFLICT (key) DO UPDATE
SET value = excluded.value,
    updated_at = now();

DELETE FROM refresh_tokens
WHERE user_id IN (
    SELECT id FROM _stackarr_bookorbit_token_users
);

DELETE FROM password_reset_tokens
WHERE user_id IN (
    SELECT id FROM _stackarr_bookorbit_token_users
);

COMMIT;
SQL

    ok "BookOrbit shared admin credentials synced"
}

load_env
ensure_docker_runtime

subcommand="${1:-help}"
case "$subcommand" in
    credentials)
        shift || true
        action="${1:-help}"
        shift || true
        wait_for_ready=false
        case "$action" in
            apply)
                while [[ $# -gt 0 ]]; do
                    case "$1" in
                        --wait)
                            wait_for_ready=true
                            ;;
                        *)
                            usage
                            exit 1
                            ;;
                    esac
                    shift
                done
                apply_bookorbit_credentials "$wait_for_ready"
                ;;
            *)
                usage
                exit 1
                ;;
        esac
        ;;
    *)
        usage
        exit 1
        ;;
esac
