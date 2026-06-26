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

ensure_app_database() {
    app_db="$1"
    app_user="$2"
    app_password="${3:-$DATABASE_SUPERUSER_PASSWORD}"
    extensions="${4:-}"

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

    PGPASSWORD="${DATABASE_SUPERUSER_PASSWORD}" psql \
        -v ON_ERROR_STOP=1 \
        -h "${DATABASE_HOST:-database}" \
        -p "${DATABASE_CONTAINER_PORT:-5432}" \
        -U "${DATABASE_SUPERUSER:-postgres}" \
        -d "$app_db" \
        -v app_user="$app_user" <<'SQL'
SELECT format('ALTER SCHEMA public OWNER TO %I', :'app_user')
\gexec

SELECT format('GRANT USAGE, CREATE ON SCHEMA public TO %I', :'app_user')
\gexec

SELECT format('ALTER DEFAULT PRIVILEGES IN SCHEMA public GRANT ALL ON TABLES TO %I', :'app_user')
\gexec

SELECT format('ALTER DEFAULT PRIVILEGES IN SCHEMA public GRANT ALL ON SEQUENCES TO %I', :'app_user')
\gexec
SQL

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

if flag_enabled "${ENABLE_SEERR:-false}"; then
    ensure_app_database "${SEERR_POSTGRES_DATABASE:-seerr}" "${SEERR_POSTGRES_USER:-seerr}" "${SEERR_POSTGRES_PASSWORD:-$DATABASE_SUPERUSER_PASSWORD}" ""
fi

if flag_enabled "${ENABLE_PULSARR:-false}" && [ "$(printf '%s' "${PULSARR_DB_TYPE:-sqlite}" | tr '[:upper:]' '[:lower:]')" = "postgres" ]; then
    ensure_app_database "${PULSARR_POSTGRES_DATABASE:-pulsarr}" "${PULSARR_POSTGRES_USER:-pulsarr}" "${PULSARR_POSTGRES_PASSWORD:-$DATABASE_SUPERUSER_PASSWORD}" ""
fi
