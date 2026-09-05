#!/bin/sh
set -eu

psql_super() {
    PGPASSWORD="${DATABASE_SUPERUSER_PASSWORD}" psql \
        -v ON_ERROR_STOP=1 \
        -h "${DATABASE_HOST:-database}" \
        -p "${DATABASE_CONTAINER_PORT:-5432}" \
        -U "${DATABASE_SUPERUSER:-postgres}" \
        -d "${DATABASE_NAME:-postgres}" \
        "$@"
}

ensure_app_schema() {
    app_db="$1"
    app_user="$2"
    app_schema="$3"

    PGPASSWORD="${DATABASE_SUPERUSER_PASSWORD}" psql \
        -v ON_ERROR_STOP=1 \
        -h "${DATABASE_HOST:-database}" \
        -p "${DATABASE_CONTAINER_PORT:-5432}" \
        -U "${DATABASE_SUPERUSER:-postgres}" \
        -d "$app_db" \
        -v app_user="$app_user" \
        -v app_schema="$app_schema" <<'SQL'
SELECT set_config('stackarr.app_user', :'app_user', false);
SELECT set_config('stackarr.app_schema', :'app_schema', false);

SELECT format('CREATE SCHEMA IF NOT EXISTS %I AUTHORIZATION %I', :'app_schema', :'app_user')
\gexec

SELECT format('ALTER SCHEMA %I OWNER TO %I', :'app_schema', :'app_user')
\gexec

SELECT format('GRANT USAGE, CREATE ON SCHEMA %I TO %I', :'app_schema', :'app_user')
\gexec

DO $stackarr$
DECLARE
    object_record record;
BEGIN
    FOR object_record IN
        SELECT n.nspname, c.relname, c.relkind
        FROM pg_class c
        JOIN pg_namespace n ON n.oid = c.relnamespace
        WHERE n.nspname = current_setting('stackarr.app_schema')
          AND c.relkind IN ('r', 'p', 'S', 'v', 'm', 'f')
        ORDER BY n.nspname, c.relname
    LOOP
        IF object_record.relkind = 'S' THEN
            EXECUTE format(
                'ALTER SEQUENCE %I.%I OWNER TO %I',
                object_record.nspname,
                object_record.relname,
                current_setting('stackarr.app_user')
            );
        ELSIF object_record.relkind = 'v' THEN
            BEGIN
                EXECUTE format(
                    'ALTER VIEW %I.%I OWNER TO %I',
                    object_record.nspname,
                    object_record.relname,
                    current_setting('stackarr.app_user')
                );
            EXCEPTION WHEN OTHERS THEN
                EXECUTE format(
                    'ALTER MATERIALIZED VIEW %I.%I OWNER TO %I',
                    object_record.nspname,
                    object_record.relname,
                    current_setting('stackarr.app_user')
                );
            END;
        ELSIF object_record.relkind = 'm' THEN
            EXECUTE format(
                'ALTER MATERIALIZED VIEW %I.%I OWNER TO %I',
                object_record.nspname,
                object_record.relname,
                current_setting('stackarr.app_user')
            );
        ELSE
            EXECUTE format(
                'ALTER TABLE %I.%I OWNER TO %I',
                object_record.nspname,
                object_record.relname,
                current_setting('stackarr.app_user')
            );
        END IF;
    END LOOP;
END
$stackarr$;

SELECT format('GRANT ALL PRIVILEGES ON ALL TABLES IN SCHEMA %I TO %I', :'app_schema', :'app_user')
\gexec

SELECT format('GRANT ALL PRIVILEGES ON ALL SEQUENCES IN SCHEMA %I TO %I', :'app_schema', :'app_user')
\gexec

SELECT format('ALTER DEFAULT PRIVILEGES IN SCHEMA %I GRANT ALL ON TABLES TO %I', :'app_schema', :'app_user')
\gexec

SELECT format('ALTER DEFAULT PRIVILEGES IN SCHEMA %I GRANT ALL ON SEQUENCES TO %I', :'app_schema', :'app_user')
\gexec
SQL
}

ensure_app_database() {
    app_db="$1"
    app_user="$2"
    app_password="${3:-$DATABASE_SUPERUSER_PASSWORD}"
    extensions="${4:-}"
    managed_schemas="${5:-}"

    psql_super \
        -v app_db="$app_db" \
        -v app_user="$app_user" \
        -v app_password="$app_password" <<'SQL'
SELECT format('CREATE ROLE %I LOGIN PASSWORD %L', :'app_user', :'app_password')
WHERE NOT EXISTS (SELECT 1 FROM pg_roles WHERE rolname = :'app_user')
\gexec

SELECT format('ALTER ROLE %I LOGIN PASSWORD %L', :'app_user', :'app_password')
\gexec

SELECT format('CREATE DATABASE %I OWNER %I', :'app_db', :'app_user')
WHERE NOT EXISTS (SELECT 1 FROM pg_database WHERE datname = :'app_db')
\gexec

SELECT format('GRANT ALL PRIVILEGES ON DATABASE %I TO %I', :'app_db', :'app_user')
\gexec
SQL

    ensure_app_schema "$app_db" "$app_user" "public"

    if [ -n "$managed_schemas" ]; then
        for app_schema in $managed_schemas; do
            ensure_app_schema "$app_db" "$app_user" "$app_schema"
        done
    fi

    if [ -n "$extensions" ]; then
        for extension in $extensions; do
            PGPASSWORD="${DATABASE_SUPERUSER_PASSWORD}" psql \
                -v ON_ERROR_STOP=1 \
                -h "${DATABASE_HOST:-database}" \
                -p "${DATABASE_CONTAINER_PORT:-5432}" \
                -U "${DATABASE_SUPERUSER:-postgres}" \
                -d "$app_db" \
                -c "CREATE EXTENSION IF NOT EXISTS \"$extension\";"
        done
    fi
}

flag_enabled() {
    case "$(printf '%s' "${1:-false}" | tr '[:upper:]' '[:lower:]')" in
        1|true|yes|on)
            return 0
            ;;
        *)
            return 1
            ;;
    esac
}

postgres_mode_enabled() {
    case "$(printf '%s' "${STACKARR_DATABASE_MODE:-app-default}" | tr '[:upper:]' '[:lower:]')" in
        postgres|postgresql|pg)
            return 0
            ;;
        *)
            return 1
            ;;
    esac
}

ensure_servarr_databases() {
    main_db="$1"
    log_db="$2"
    app_user="$3"
    app_password="$4"

    ensure_app_database "$main_db" "$app_user" "$app_password" ""
    ensure_app_database "$log_db" "$app_user" "$app_password" ""
}

immich_database_extensions() {
    vector_extension="$(printf '%s' "${IMMICH_DB_VECTOR_EXTENSION:-pgvector}" | tr '[:upper:]' '[:lower:]')"

    case "$vector_extension" in
        vectorchord|vchord)
            printf '%s\n' "cube earthdistance vector vchord"
            ;;
        pgvector|vector|"")
            printf '%s\n' "cube earthdistance vector"
            ;;
        *)
            printf '%s\n' "$vector_extension"
            ;;
    esac
}

: "${DATABASE_SUPERUSER_PASSWORD:?DATABASE_SUPERUSER_PASSWORD is required}"

if postgres_mode_enabled; then
    ensure_servarr_databases "${STACKARR_POSTGRES_MAIN_DATABASE:-${STACKARR_POSTGRES_DATABASE:-stackarr-main}}" "${STACKARR_POSTGRES_LOG_DATABASE:-stackarr-log}" "${STACKARR_POSTGRES_USER:-stackarr}" "${STACKARR_POSTGRES_PASSWORD:-$DATABASE_SUPERUSER_PASSWORD}"
    ensure_servarr_databases "${PROWLARR_POSTGRES_MAIN_DATABASE:-prowlarr-main}" "${PROWLARR_POSTGRES_LOG_DATABASE:-prowlarr-log}" "${PROWLARR_POSTGRES_USER:-prowlarr}" "${PROWLARR_POSTGRES_PASSWORD:-$DATABASE_SUPERUSER_PASSWORD}"

    if flag_enabled "${ENABLE_MOVIES:-true}"; then
        ensure_servarr_databases "${RADARR_POSTGRES_MAIN_DATABASE:-radarr-main}" "${RADARR_POSTGRES_LOG_DATABASE:-radarr-log}" "${RADARR_POSTGRES_USER:-radarr}" "${RADARR_POSTGRES_PASSWORD:-$DATABASE_SUPERUSER_PASSWORD}"
    fi

    if flag_enabled "${ENABLE_TV_SHOWS:-true}"; then
        ensure_servarr_databases "${SONARR_POSTGRES_MAIN_DATABASE:-sonarr-main}" "${SONARR_POSTGRES_LOG_DATABASE:-sonarr-log}" "${SONARR_POSTGRES_USER:-sonarr}" "${SONARR_POSTGRES_PASSWORD:-$DATABASE_SUPERUSER_PASSWORD}"
    fi

    if flag_enabled "${ENABLE_4K_SERVARR:-false}"; then
        if flag_enabled "${ENABLE_MOVIES:-true}"; then
            ensure_servarr_databases "${RADARR4K_POSTGRES_MAIN_DATABASE:-radarr4k-main}" "${RADARR4K_POSTGRES_LOG_DATABASE:-radarr4k-log}" "${RADARR4K_POSTGRES_USER:-radarr4k}" "${RADARR4K_POSTGRES_PASSWORD:-$DATABASE_SUPERUSER_PASSWORD}"
        fi
        if flag_enabled "${ENABLE_TV_SHOWS:-true}"; then
            ensure_servarr_databases "${SONARR4K_POSTGRES_MAIN_DATABASE:-sonarr4k-main}" "${SONARR4K_POSTGRES_LOG_DATABASE:-sonarr4k-log}" "${SONARR4K_POSTGRES_USER:-sonarr4k}" "${SONARR4K_POSTGRES_PASSWORD:-$DATABASE_SUPERUSER_PASSWORD}"
        fi
    fi

    if flag_enabled "${ENABLE_LIDARR:-true}"; then
        ensure_servarr_databases "${LIDARR_POSTGRES_MAIN_DATABASE:-lidarr-main}" "${LIDARR_POSTGRES_LOG_DATABASE:-lidarr-log}" "${LIDARR_POSTGRES_USER:-lidarr}" "${LIDARR_POSTGRES_PASSWORD:-$DATABASE_SUPERUSER_PASSWORD}"
    fi

    if flag_enabled "${ENABLE_BAZARR:-true}"; then
        ensure_app_database "${BAZARR_POSTGRES_DATABASE:-bazarr}" "${BAZARR_POSTGRES_USER:-bazarr}" "${BAZARR_POSTGRES_PASSWORD:-$DATABASE_SUPERUSER_PASSWORD}" ""
    fi
fi

if flag_enabled "${ENABLE_BOOKORBIT:-false}"; then
    ensure_app_database "${BOOKORBIT_POSTGRES_DATABASE:-bookorbit}" "${BOOKORBIT_POSTGRES_USER:-bookorbit}" "${BOOKORBIT_POSTGRES_PASSWORD:-$DATABASE_SUPERUSER_PASSWORD}" "uuid-ossp pg_trgm vector"
fi

if flag_enabled "${ENABLE_IMMICH:-false}"; then
    ensure_app_database "${IMMICH_DB_DATABASE_NAME:-immich}" "${IMMICH_DB_USERNAME:-immich}" "${IMMICH_DB_PASSWORD:-$DATABASE_SUPERUSER_PASSWORD}" "$(immich_database_extensions)"
fi

if flag_enabled "${ENABLE_ROMM:-false}"; then
    ensure_app_database "${ROMM_DB_NAME:-romm}" "${ROMM_DB_USER:-romm}" "${ROMM_DB_PASSWORD:-$DATABASE_SUPERUSER_PASSWORD}" ""
fi

if flag_enabled "${ENABLE_SEERR:-false}"; then
    ensure_app_database "${SEERR_POSTGRES_DATABASE:-seerr}" "${SEERR_POSTGRES_USER:-seerr}" "${SEERR_POSTGRES_PASSWORD:-$DATABASE_SUPERUSER_PASSWORD}" ""
fi

if flag_enabled "${ENABLE_PULSARR:-false}" && [ "$(printf '%s' "${PULSARR_DB_TYPE:-sqlite}" | tr '[:upper:]' '[:lower:]')" = "postgres" ]; then
    ensure_app_database "${PULSARR_POSTGRES_DATABASE:-pulsarr}" "${PULSARR_POSTGRES_USER:-pulsarr}" "${PULSARR_POSTGRES_PASSWORD:-$DATABASE_SUPERUSER_PASSWORD}" ""
fi

if flag_enabled "${ENABLE_CLEANUPARR:-false}" && [ "$(printf '%s' "${CLEANUPARR_DATABASE_PROVIDER:-sqlite}" | tr '[:upper:]' '[:lower:]')" = "postgres" ]; then
    ensure_app_database "${CLEANUPARR_POSTGRES_DATABASE:-cleanuparr}" "${CLEANUPARR_POSTGRES_USER:-cleanuparr}" "${CLEANUPARR_POSTGRES_PASSWORD:-$DATABASE_SUPERUSER_PASSWORD}" ""
fi

if flag_enabled "${ENABLE_TRACEARR:-false}"; then
    ensure_app_database "${TRACEARR_POSTGRES_DATABASE:-tracearr}" "${TRACEARR_POSTGRES_USER:-tracearr}" "${TRACEARR_POSTGRES_PASSWORD:-${TRACEARR_DB_PASSWORD:-$DATABASE_SUPERUSER_PASSWORD}}" "timescaledb" "drizzle"
fi
