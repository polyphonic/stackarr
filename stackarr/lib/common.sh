#!/bin/bash
set -euo pipefail

ROOT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
if [[ -n "${STACKARR_REPO_ROOT:-}" ]]; then
    REPO_ROOT="$STACKARR_REPO_ROOT"
elif [[ -f "$ROOT_DIR/../package.json" && -d "$ROOT_DIR/../stackarr" ]]; then
    REPO_ROOT="$(cd "$ROOT_DIR/.." && pwd)"
else
    REPO_ROOT="$ROOT_DIR"
fi

RED='[0;31m'
GREEN='[0;32m'
YELLOW='[1;33m'
CYAN='[0;36m'
NC='[0m'

ensure_standard_path() {
    local dir

    for dir in "${HOME:-}/.local/bin" /opt/homebrew/bin /opt/homebrew/sbin /usr/local/bin /usr/local/sbin; do
        [[ -d "$dir" ]] || continue
        case ":${PATH:-}:" in
            *":$dir:"*)
                ;;
            *)
                PATH="$dir:${PATH:-/usr/bin:/bin:/usr/sbin:/sbin}"
                ;;
        esac
    done

    export PATH
}

ensure_standard_path

print_header() {
    echo ""
    echo "=============================="
    echo "  $1"
    echo "=============================="
    echo ""
}

ok() {
    echo -e "${GREEN}OK${NC}    $1"
}

warn() {
    echo -e "${YELLOW}WARN${NC}  $1"
}

fail() {
    echo -e "${RED}FAIL${NC}  $1" >&2
    exit 1
}

require_command() {
    command -v "$1" >/dev/null 2>&1 || fail "Missing command: $1"
}

default_app_root() {
    if [[ -n "${APP_ROOT_DEFAULT_OVERRIDE:-}" ]]; then
        printf '%s\n' "$APP_ROOT_DEFAULT_OVERRIDE"
        return 0
    fi

    case "$(uname -s)" in
        Darwin)
            printf '%s\n' "$HOME/Library/Application Support/Stackarr"
            ;;
        Linux)
            if [[ -n "${XDG_DATA_HOME:-}" ]]; then
                printf '%s\n' "$XDG_DATA_HOME/stackarr"
            else
                printf '%s\n' "$HOME/.local/share/stackarr"
            fi
            ;;
        MINGW*|MSYS*|CYGWIN*)
            if [[ -n "${LOCALAPPDATA:-}" ]]; then
                printf '%s\n' "$LOCALAPPDATA/Stackarr"
            elif [[ -n "${APPDATA:-}" ]]; then
                printf '%s\n' "$APPDATA/Stackarr"
            else
                printf '%s\n' "$HOME/AppData/Local/Stackarr"
            fi
            ;;
        *)
            printf '%s\n' "$HOME/.stackarr"
            ;;
    esac
}

find_stackarr_bin() {
    local candidate=""

    if [[ -n "${STACKARR_CLI_BIN:-}" && -x "$STACKARR_CLI_BIN" ]]; then
        printf '%s\n' "$STACKARR_CLI_BIN"
        return 0
    fi

    if candidate="$(command -v stackarr 2>/dev/null)"; then
        printf '%s\n' "$candidate"
        return 0
    fi

    candidate="$REPO_ROOT/bin/stackarr"
    if [[ -x "$candidate" ]]; then
        printf '%s\n' "$candidate"
        return 0
    fi

    candidate="$ROOT_DIR/bin/stackarr"
    if [[ -x "$candidate" ]]; then
        printf '%s\n' "$candidate"
        return 0
    fi

    return 1
}

find_stackarr_app_bundle_for_bin() {
    local bin_path="${1:-}"
    local candidate=""

    [[ -n "$bin_path" ]] || return 1

    case "$bin_path" in
        *.app/Contents/MacOS/*)
            candidate="${bin_path%%.app/Contents/MacOS/*}.app"
            ;;
        *)
            candidate="$(dirname "$bin_path")/Stackarr.app"
            ;;
    esac

    if [[ -d "$candidate" ]]; then
        printf '%s\n' "$candidate"
        return 0
    fi

    return 1
}

default_stackarr_database_file() {
    if [[ -n "${STACKARR_DATABASE_FILE:-}" ]]; then
        printf '%s\n' "$STACKARR_DATABASE_FILE"
        return 0
    fi

    if [[ -n "${STACKARR_DATA_DIR:-}" ]]; then
        printf '%s/config/stackarr.db\n' "$STACKARR_DATA_DIR"
        return 0
    fi

    if [[ -n "${CONFIG_ROOT:-}" ]]; then
        printf '%s/stackarr.db\n' "$CONFIG_ROOT"
        return 0
    fi

    printf '%s/stackarr/config/stackarr.db\n' "$REPO_ROOT"
}

load_sqlite_runtime_config() {
    local db_file
    db_file="$(default_stackarr_database_file)"
    local exporter="$ROOT_DIR/scripts/runtime-config-export.cjs"
    [[ -n "${STACKARR_DATABASE_URL:-}" || -f "$db_file" ]] || return 0
    [[ -f "$exporter" ]] || return 0
    command -v node >/dev/null 2>&1 || return 0

    local exports
    if ! exports="$(STACKARR_DATABASE_FILE="$db_file" node "$exporter")"; then
        return 0
    fi

    [[ -n "$exports" ]] || return 0
    eval "$exports"
}

load_postgres_runtime_config_through_app() {
    [[ -n "${STACKARR_DATABASE_URL:-}" ]] || return 0
    stackarr_runtime_is_container && return 0

    local exports
    if ! exports="$(stackarr_compose exec -T app sh -lc 'node "$STACKARR_REPO_ROOT/stackarr/scripts/runtime-config-export.cjs"' 2>/dev/null)"; then
        return 0
    fi

    [[ -n "$exports" ]] || return 0
    eval "$exports"
}

load_compose_runtime_env() {
    local env_file="${STACKARR_COMPOSE_ENV_FILE:-}"

    if [[ -z "$env_file" ]]; then
        local app_root_guess state_root_guess project_dir_guess
        app_root_guess="${APP_ROOT:-$(default_app_root)}"
        state_root_guess="${STATE_ROOT:-$app_root_guess/state}"
        project_dir_guess="${STACKARR_COMPOSE_PROJECT_DIR:-$state_root_guess/compose}"
        env_file="$project_dir_guess/.env"
    fi

    [[ -f "$env_file" ]] || return 0
    command -v python3 >/dev/null 2>&1 || return 0

    local exports
    if ! exports="$(python3 - "$env_file" <<'PY'
import json
import os
import re
import sys

env_file = sys.argv[1]
include = re.compile(
    r"^(APP_ROOT|CONFIG_ROOT|STATE_ROOT|LOG_ROOT|MEDIA_ROOT|MUSIC_ROOT|DOWNLOADS_ROOT|BOOKS_ROOT|GAMES_ROOT|BACKUP_ROOT|BACKUP_STAGING_ROOT|"
    r"COMPOSE_PROJECT_NAME|TIMEZONE|PUID|PGID|USERNAME|PASSWORD|USER_EMAIL|PREFERRED_TORRENT_CLIENT|"
    r"STACKARR_.*|ENABLE_.*|PLEX_.*|JELLYFIN_.*|BOOKORBIT_.*|IMMICH_.*|ROMM_.*|QUESTARR_.*|YOUTARR_.*|DATABASE_.*|SEERR_.*|PULSARR_.*|MAINTAINERR_.*|CLEANUPARR_.*|AGREGARR_.*|TRACEARR_.*|BAZARR_.*|"
    r"PROWLARR_.*|RADARR.*|SONARR.*|LIDARR_.*|TIDARR_.*|TINYMEDIAMANAGER_.*|"
    r"TRANSMISSION_.*|QBITTORRENT_.*|RECYCLARR_.*|FLARESOLVERR_.*|"
    r"BACKUP_.*|UPDATE_.*|DOWNLOAD_.*|CLOUDFLARE_.*|CLOUDFLARED_.*)$"
)
context_only = {
    "COMPOSE_PROJECT_NAME",
    "STACKARR_CHANNEL",
    "STACKARR_CLI_BIN",
    "STACKARR_COMPOSE_ENV_FILE",
    "STACKARR_COMPOSE_FILE",
    "STACKARR_COMPOSE_PROJECT_DIR",
    "STACKARR_CONTAINER_NAME",
    "STACKARR_DATABASE_DIR",
    "STACKARR_DATABASE_FILE",
    "STACKARR_PLEX_HOST",
    "STACKARR_REPO_ROOT",
    "STACKARR_REVISION",
    "STACKARR_RUN_SOURCE",
    "STACKARR_RUNTIME",
    "STACKARR_SCHEDULER_ENABLED",
    "STACKARR_TASK_ID",
    "STACKARR_UPDATE_TASK_ID",
    "STACKARR_VERSION",
}

def shell_quote(value):
    return "'" + str(value).replace("'", "'\\''") + "'"

def parse_value(raw):
    raw = raw.strip()
    if len(raw) >= 2 and raw[0] == '"' and raw[-1] == '"':
        return json.loads(raw).replace("$$", "$")
    if len(raw) >= 2 and raw[0] == "'" and raw[-1] == "'":
        return raw[1:-1]
    return raw

try:
    with open(env_file, encoding='utf-8') as handle:
        for line in handle:
            line = line.strip()
            if not line or line.startswith('#') or '=' not in line:
                continue
            key, raw_value = line.split('=', 1)
            key = key.strip()
            if not include.match(key) or key in context_only:
                continue
            if os.environ.get(key):
                continue
            try:
                value = parse_value(raw_value)
            except Exception:
                continue
            print(f"export {key}={shell_quote(value)}")
except FileNotFoundError:
    pass
PY
)"; then
        return 0
    fi

    [[ -n "$exports" ]] || return 0
    eval "$exports"
}

load_browser_link_runtime_settings() {
    local db_file
    db_file="$(default_stackarr_database_file)"
    local exporter="$ROOT_DIR/scripts/settings-export.cjs"

    : "${STACKARR_SERVICE_URL_MODE:=localhost}"
    : "${STACKARR_SERVICE_URL_SCHEME:=https}"
    : "${STACKARR_SERVICE_URL_HOST_SUFFIX:=stack}"
    : "${STACKARR_UNIFY_SERVICE_URLS:=false}"

    [[ -n "${STACKARR_DATABASE_URL:-}" || -f "$db_file" ]] || return 0
    [[ -f "$exporter" ]] || return 0
    command -v node >/dev/null 2>&1 || return 0

    local exports
    if ! exports="$(STACKARR_DATABASE_FILE="$db_file" node "$exporter")"; then
        return 0
    fi

    [[ -n "$exports" ]] || return 0
    eval "$exports"
}

configure_docker_environment() {
    local requested_context="${STACKARR_DOCKER_CONTEXT:-${DOCKER_CONTEXT:-}}"
    local current_context=""

    if [[ -z "$requested_context" && "$(uname -s 2>/dev/null || true)" == "Darwin" && "$(command -v docker || true)" ]]; then
        current_context="$(docker context show 2>/dev/null || true)"
        if [[ "${DOCKER_HOST:-}" == *arcbox* || "$current_context" == *arcbox* ]]; then
            if docker context inspect orbstack >/dev/null 2>&1; then
                requested_context="orbstack"
            fi
        fi
    fi

    if [[ -n "$requested_context" ]]; then
        export DOCKER_CONTEXT="$requested_context"
        unset DOCKER_HOST
    fi
}

is_loopback_url() {
    [[ "${1:-}" =~ ^https?://(127\.0\.0\.1|localhost)(:[0-9]+)?(/.*)?$ ]]
}

browser_service_url() {
    local service="$1"

    if [[ "${STACKARR_SERVICE_URL_MODE:-localhost}" == "portless" ]]; then
        printf '%s://%s.%s\n' "${STACKARR_SERVICE_URL_SCHEME:-https}" "$service" "${STACKARR_SERVICE_URL_HOST_SUFFIX:-stack}"
        return 0
    fi

    return 1
}

apply_browser_link_runtime_defaults() {
    local public_bookorbit_url
    local public_immich_url

    public_bookorbit_url="$(browser_service_url bookorbit || true)"
    public_immich_url="$(browser_service_url immich || true)"

    if [[ -n "$public_bookorbit_url" ]] && is_loopback_url "${BOOKORBIT_URL:-}"; then
        BOOKORBIT_URL="$public_bookorbit_url"
    fi
    if [[ -n "$public_bookorbit_url" ]] && is_loopback_url "${BOOKORBIT_APP_URL:-}"; then
        BOOKORBIT_APP_URL="$public_bookorbit_url"
    fi
    if [[ -n "$public_bookorbit_url" ]] && is_loopback_url "${BOOKORBIT_CLIENT_URL:-}"; then
        BOOKORBIT_CLIENT_URL="$public_bookorbit_url"
    fi
    if [[ -n "$public_immich_url" ]] && is_loopback_url "${IMMICH_URL:-}"; then
        IMMICH_URL="$public_immich_url"
    fi
}

database_pgdata_default() {
    local database_root="${CONFIG_ROOT:-${APP_ROOT:-}/config}/database"

    if [[ -f "$database_root/data/PG_VERSION" ]]; then
        printf '%s\n' "/var/lib/postgresql/data"
        return 0
    fi

    if [[ -f "$database_root/18/docker/PG_VERSION" ]]; then
        printf '%s\n' "/var/lib/postgresql/18/docker"
        return 0
    fi

    printf '%s\n' "/var/lib/postgresql/data"
}

load_env() {
    : "${STACKARR_REPO_ROOT:=$REPO_ROOT}"
    : "${STACKARR_DATABASE_FILE:=$(default_stackarr_database_file)}"
    : "${STACKARR_DATABASE_DIR:=$(dirname "$STACKARR_DATABASE_FILE")}"
    configure_docker_environment
    load_compose_runtime_env
    # Host commands cannot resolve the Compose-only `database` hostname. Read
    # PostgreSQL-backed settings through the running Stackarr controller first.
    load_postgres_runtime_config_through_app
    load_sqlite_runtime_config
    load_browser_link_runtime_settings

    if [[ -z "${APP_ROOT:-}" ]]; then
        if [[ -n "${CONFIG_ROOT:-}" && "$CONFIG_ROOT" == */config ]]; then
            APP_ROOT="${CONFIG_ROOT%/config}"
        elif [[ -n "${CONFIG_ROOT:-}" ]]; then
            APP_ROOT="$(dirname "$CONFIG_ROOT")"
        else
            APP_ROOT="$(default_app_root)"
        fi
    fi

    COMPOSE_PROJECT_NAME="${STACKARR_COMPOSE_PROJECT_NAME:-stackarr}"
    : "${STACKARR_BUNDLE_IDENTIFIER:=com.polyphonic.stackarr}"
    : "${TIMEZONE:=Etc/UTC}"
    : "${PUID:=$(id -u)}"
    : "${PGID:=$(id -g)}"
    : "${MEDIA_ROOT:=$APP_ROOT/media}"
    : "${MUSIC_ROOT:=$MEDIA_ROOT/Music}"
    : "${DOWNLOADS_ROOT:=$APP_ROOT/downloads}"
    : "${CONFIG_ROOT:=$APP_ROOT/config}"
    : "${STATE_ROOT:=$APP_ROOT/state}"
    : "${LOG_ROOT:=$APP_ROOT/logs}"
    : "${PLEX_CONFIG_PATH:=$HOME/Library/Application Support/Plex Media Server}"
    : "${PLEX_PREFS_PATH:=$HOME/Library/Preferences/com.plexapp.plexmediaserver.plist}"
    : "${PLEX_INSTALL_MODE:=native}"
    : "${JELLYFIN_INSTALL_MODE:=disabled}"
    : "${JELLYFIN_CONFIG_PATH:=$HOME/.local/share/jellyfin}"
    : "${ENABLE_MOVIES:=true}"
    : "${ENABLE_TV_SHOWS:=true}"
    : "${ENABLE_4K_SERVARR:=false}"
    : "${ENABLE_BAZARR:=true}"
    : "${ENABLE_LIDARR:=true}"
    : "${ENABLE_BOOKORBIT:=false}"
    : "${ENABLE_IMMICH:=false}"
    : "${ENABLE_ROMM:=false}"
    : "${ENABLE_QUESTARR:=false}"
    : "${ENABLE_YOUTARR:=false}"
    : "${ENABLE_TINYMEDIAMANAGER:=true}"
    : "${ENABLE_RECYCLARR:=true}"
    : "${ENABLE_FLARESOLVERR:=true}"
    : "${ENABLE_TIDARR:=true}"
    : "${ENABLE_SEERR:=false}"
    : "${STACKARR_CONFIGURE_SEERR:=false}"
    : "${ENABLE_PULSARR:=true}"
    : "${ENABLE_MAINTAINERR:=false}"
    : "${ENABLE_CLEANUPARR:=false}"
    : "${ENABLE_AGREGARR:=false}"
    : "${ENABLE_TRACEARR:=false}"
    local video_automation_enabled="false"
    local media_server_enabled="false"
    local arr_enabled="false"
    if flag_enabled "$ENABLE_MOVIES" || flag_enabled "$ENABLE_TV_SHOWS"; then
        video_automation_enabled="true"
    fi
    if [[ "$(lowercase "$PLEX_INSTALL_MODE")" != "disabled" || "$(lowercase "$JELLYFIN_INSTALL_MODE")" != "disabled" ]]; then
        media_server_enabled="true"
    fi
    if flag_enabled "$ENABLE_MOVIES" || flag_enabled "$ENABLE_TV_SHOWS" || flag_enabled "$ENABLE_LIDARR"; then
        arr_enabled="true"
    fi
    if [[ "$(lowercase "$PLEX_INSTALL_MODE")" == "disabled" || "$video_automation_enabled" != "true" ]]; then
        ENABLE_PULSARR="false"
    fi
    if [[ "$(lowercase "$PLEX_INSTALL_MODE")" == "disabled" ]]; then
        ENABLE_AGREGARR="false"
    fi
    if [[ "$media_server_enabled" != "true" || "$video_automation_enabled" != "true" ]]; then
        ENABLE_SEERR="false"
        STACKARR_CONFIGURE_SEERR="false"
    fi
    if [[ "$media_server_enabled" != "true" ]]; then
        ENABLE_MAINTAINERR="false"
        if [[ -z "${TRACEARR_EMBY_SERVER_URL:-}" ]]; then
            ENABLE_TRACEARR="false"
        fi
    fi
    if [[ "$video_automation_enabled" != "true" ]]; then
        ENABLE_4K_SERVARR="false"
        ENABLE_BAZARR="false"
        ENABLE_TINYMEDIAMANAGER="false"
        ENABLE_RECYCLARR="false"
    fi
    if [[ "$arr_enabled" != "true" ]]; then
        ENABLE_CLEANUPARR="false"
        ENABLE_FLARESOLVERR="false"
    fi
    if [[ -z "${STACKARR_DATABASE_MODE:-}" && -n "${STACKARR_DATABASE_URL:-}" ]]; then
        STACKARR_DATABASE_MODE="postgres"
    fi
    : "${STACKARR_DATABASE_MODE:=app-default}"
    case "$(lowercase "$STACKARR_DATABASE_MODE")" in
        postgres|postgresql|pg)
            STACKARR_DATABASE_MODE="postgres"
            ;;
        sqlite|native|app-default|default|app_default)
            STACKARR_DATABASE_MODE="app-default"
            ;;
        *)
            warn "Unknown STACKARR_DATABASE_MODE '$STACKARR_DATABASE_MODE'; using app-default"
            STACKARR_DATABASE_MODE="app-default"
            ;;
    esac
    : "${STACKARR_MOVIE_PROFILE_PRESET:=lite}"
    : "${STACKARR_MOVIE_4K_PROFILE_PRESET:=lite}"
    : "${STACKARR_TV_PROFILE_PRESET:=lite}"
    : "${STACKARR_TV_4K_PROFILE_PRESET:=lite}"
    : "${STACKARR_MUSIC_PROFILE_PRESET:=lossless}"
    : "${STACKARR_MOVIE_DEFAULT_PROFILE:=HD Lite}"
    : "${STACKARR_MOVIE_4K_DEFAULT_PROFILE:=4K Lite}"
    : "${STACKARR_TV_DEFAULT_PROFILE:=HD Lite}"
    : "${STACKARR_TV_4K_DEFAULT_PROFILE:=4K Lite}"
    : "${STACKARR_MUSIC_DEFAULT_PROFILE:=Lossless}"
    : "${STACKARR_API_KEY:=}"
    : "${STACKARR_DOCKER_CONTEXT:=}"
    configure_docker_environment
    : "${USERNAME:=admin}"
    : "${PASSWORD:=}"
    : "${USER_EMAIL:=}"
    : "${TRANSMISSION_PASSWORD:=$PASSWORD}"
    : "${QBITTORRENT_PASSWORD:=$PASSWORD}"
    : "${PROWLARR_PASSWORD:=$PASSWORD}"
    : "${RADARR_PASSWORD:=$PASSWORD}"
    : "${RADARR4K_PASSWORD:=$PASSWORD}"
    : "${SONARR_PASSWORD:=$PASSWORD}"
    : "${SONARR4K_PASSWORD:=$PASSWORD}"
    : "${LIDARR_PASSWORD:=$PASSWORD}"
    : "${BAZARR_PASSWORD:=$PASSWORD}"
    : "${PULSARR_PASSWORD:=$PASSWORD}"
    : "${BOOKORBIT_PASSWORD:=$PASSWORD}"
    : "${TINYMEDIAMANAGER_PASSWORD:=$PASSWORD}"
    : "${TRANSMISSION_URL:=http://127.0.0.1:9091}"
    : "${QBITTORRENT_URL:=http://127.0.0.1:8081}"
    : "${PROWLARR_URL:=http://127.0.0.1:9696}"
    : "${RADARR_URL:=http://127.0.0.1:7878}"
    : "${RADARR_4K_URL:=http://127.0.0.1:7879}"
    : "${RADARR4K_URL:=$RADARR_4K_URL}"
    : "${SONARR_URL:=http://127.0.0.1:8989}"
    : "${SONARR_4K_URL:=http://127.0.0.1:8990}"
    : "${SONARR4K_URL:=$SONARR_4K_URL}"
    : "${LIDARR_URL:=http://127.0.0.1:8686}"
    : "${BOOKORBIT_BIND_IP:=127.0.0.1}"
    : "${BOOKORBIT_WEB_PORT:=7582}"
    : "${BOOKORBIT_CONTAINER_PORT:=${BOOKORBIT_WEB_PORT:-7582}}"
    : "${BOOKORBIT_URL:=http://127.0.0.1:${BOOKORBIT_WEB_PORT}}"
    : "${BOOKORBIT_APP_URL:=$BOOKORBIT_URL}"
    : "${BOOKORBIT_CLIENT_URL:=$BOOKORBIT_URL}"
    : "${BOOKORBIT_POSTGRES_PASSWORD:=}"
    if [[ "${ENABLE_BOOKORBIT}" == "true" || "${ENABLE_BOOKORBIT}" == "1" ]]; then
        : "${BOOKORBIT_JWT_SECRET:=$(random_secret 32)}"
        : "${BOOKORBIT_SETUP_TOKEN:=${PASSWORD:-$(random_secret 32)}}"
    fi
    : "${BOOKS_ROOT:=$MEDIA_ROOT/Books}"
    : "${IMMICH_BIND_IP:=127.0.0.1}"
    : "${IMMICH_WEB_PORT:=2283}"
    : "${IMMICH_CONTAINER_PORT:=2283}"
    : "${IMMICH_URL:=http://127.0.0.1:${IMMICH_WEB_PORT}}"
    : "${IMMICH_UPLOAD_LOCATION:=$MEDIA_ROOT/Pictures}"
    : "${IMMICH_VERSION:=release}"
    : "${IMMICH_DB_USERNAME:=immich}"
    : "${IMMICH_DB_DATABASE_NAME:=immich}"
    : "${IMMICH_DB_VECTOR_EXTENSION:=pgvector}"
    if flag_enabled "${ENABLE_IMMICH:-false}"; then
        : "${IMMICH_DB_PASSWORD:=$(random_secret 24)}"
    else
        : "${IMMICH_DB_PASSWORD:=}"
    fi
    : "${GAMES_ROOT:=$MEDIA_ROOT/Games}"
    : "${ROMM_BIND_IP:=127.0.0.1}"
    : "${ROMM_WEB_PORT:=7583}"
    : "${ROMM_CONTAINER_PORT:=8080}"
    : "${ROMM_URL:=http://127.0.0.1:${ROMM_WEB_PORT}}"
    : "${ROMM_LIBRARY_ROOT:=$GAMES_ROOT}"
    : "${ROMM_STEAM_LIBRARY_ENABLED:=false}"
    : "${ROMM_STEAM_MAC_LIBRARY_ROOT:=}"
    : "${ROMM_STEAM_WINDOWS_LIBRARY_ROOT:=}"
    : "${ROMM_STEAM_LINUX_LIBRARY_ROOT:=}"
    : "${ROMM_ASSETS_ROOT:=$CONFIG_ROOT/romm/assets}"
    : "${ROMM_CONFIG_ROOT:=$CONFIG_ROOT/romm/config}"
    : "${ROMM_RESOURCES_ROOT:=$CONFIG_ROOT/romm/resources}"
    : "${ROMM_REDIS_DATA_ROOT:=$CONFIG_ROOT/romm/redis}"
    : "${ROMM_REDIS_HOST:=redis}"
    : "${ROMM_REDIS_PORT:=6379}"
    : "${ROMM_ENABLE_RESCAN_ON_FILESYSTEM_CHANGE:=false}"
    : "${ROMM_RESCAN_ON_FILESYSTEM_CHANGE_DELAY:=5}"
    : "${ROMM_DB_DATA_LOCATION:=$CONFIG_ROOT/romm/mysql}"
    : "${ROMM_DB_DRIVER:=postgresql}"
    : "${ROMM_DB_HOST:=database}"
    : "${ROMM_DB_PORT:=5432}"
    : "${ROMM_DB_NAME:=romm}"
    : "${ROMM_DB_USER:=romm}"
    : "${ROMM_DB_QUERY_JSON:=}"
    : "${ROMM_AUTO_CONFIGURE:=false}"
    : "${ROMM_ADMIN_USERNAME:=}"
    : "${ROMM_ADMIN_EMAIL:=}"
    : "${ROMM_ADMIN_PASSWORD:=}"
    : "${ROMM_IGDB_CLIENT_ID:=}"
    : "${ROMM_IGDB_CLIENT_SECRET:=}"
    : "${ROMM_MOBYGAMES_API_KEY:=}"
    : "${ROMM_SCREENSCRAPER_USER:=}"
    : "${ROMM_SCREENSCRAPER_PASSWORD:=}"
    : "${ROMM_RETROACHIEVEMENTS_API_KEY:=}"
    : "${ROMM_REFRESH_RETROACHIEVEMENTS_CACHE_DAYS:=30}"
    : "${ROMM_STEAMGRIDDB_API_KEY:=}"
    : "${ROMM_HASHEOUS_API_ENABLED:=true}"
    : "${ROMM_PLAYMATCH_API_ENABLED:=false}"
    : "${ROMM_LAUNCHBOX_API_ENABLED:=false}"
    : "${ROMM_FLASHPOINT_API_ENABLED:=false}"
    : "${ROMM_HLTB_API_ENABLED:=false}"
    : "${ROMM_TGDB_API_ENABLED:=false}"
    : "${ROMM_ENABLE_SCHEDULED_UPDATE_LAUNCHBOX_METADATA:=false}"
    : "${ROMM_SCHEDULED_UPDATE_LAUNCHBOX_METADATA_CRON:=0 4 * * *}"
    if flag_enabled "${ENABLE_ROMM:-false}"; then
        : "${ROMM_DB_PASSWORD:=$(random_secret 24)}"
        : "${ROMM_AUTH_SECRET_KEY:=$(random_secret 32)}"
    else
        : "${ROMM_DB_PASSWORD:=}"
        : "${ROMM_DB_ROOT_PASSWORD:=}"
        : "${ROMM_AUTH_SECRET_KEY:=}"
    fi
    : "${QUESTARR_BIND_IP:=127.0.0.1}"
    : "${QUESTARR_WEB_PORT:=7584}"
    : "${QUESTARR_CONTAINER_PORT:=5000}"
    : "${QUESTARR_URL:=http://127.0.0.1:${QUESTARR_WEB_PORT}}"
    : "${QUESTARR_APP_URL:=$QUESTARR_URL}"
    : "${QUESTARR_ALLOWED_ORIGINS:=$QUESTARR_URL,http://localhost:${QUESTARR_WEB_PORT}}"
    : "${QUESTARR_DATA_ROOT:=$CONFIG_ROOT/questarr}"
    : "${QUESTARR_LIBRARY_ROOT:=$ROMM_LIBRARY_ROOT}"
    : "${QUESTARR_SQLITE_DB_PATH:=/app/data/sqlite.db}"
    : "${QUESTARR_IGDB_CLIENT_ID:=$ROMM_IGDB_CLIENT_ID}"
    : "${QUESTARR_IGDB_CLIENT_SECRET:=$ROMM_IGDB_CLIENT_SECRET}"
    if flag_enabled "${ENABLE_QUESTARR:-false}"; then
        : "${QUESTARR_JWT_SECRET:=$(random_secret 32)}"
    else
        : "${QUESTARR_JWT_SECRET:=}"
    fi
    : "${YOUTARR_BIND_IP:=127.0.0.1}"
    : "${YOUTARR_WEB_PORT:=3087}"
    : "${YOUTARR_CONTAINER_PORT:=3011}"
    : "${YOUTARR_URL:=http://127.0.0.1:${YOUTARR_WEB_PORT}}"
    : "${YOUTARR_OUTPUT_ROOT:=$MEDIA_ROOT/YouTube}"
    : "${YOUTARR_CONFIG_ROOT:=$CONFIG_ROOT/youtarr/config}"
    : "${YOUTARR_JOBS_ROOT:=$CONFIG_ROOT/youtarr/jobs}"
    : "${YOUTARR_IMAGES_ROOT:=$CONFIG_ROOT/youtarr/images}"
    : "${YOUTARR_DB_HOST:=youtarr-db}"
    : "${YOUTARR_DB_PORT:=3306}"
    : "${YOUTARR_DB_NAME:=youtarr}"
    : "${YOUTARR_DB_USER:=youtarr}"
    : "${YOUTARR_LOGIN_ENABLED:=true}"
    : "${YOUTARR_TRUST_PROXY:=false}"
    : "${YOUTARR_LOG_LEVEL:=info}"
    : "${YOUTARR_API_KEY:=}"
    case "$(lowercase "${PLEX_INSTALL_MODE:-native}")" in
        docker) : "${YOUTARR_PLEX_URL:=http://plex:32400}" ;;
        disabled) : "${YOUTARR_PLEX_URL:=}" ;;
        *) : "${YOUTARR_PLEX_URL:=http://host.docker.internal:32400}" ;;
    esac
    if flag_enabled "${ENABLE_YOUTARR:-false}"; then
        : "${YOUTARR_DB_PASSWORD:=$(random_secret 24)}"
        : "${YOUTARR_DB_ROOT_PASSWORD:=$(random_secret 24)}"
        : "${YOUTARR_ADMIN_USERNAME:=${USERNAME:-admin}}"
        : "${YOUTARR_ADMIN_PASSWORD:=${PASSWORD:-$(random_secret 24)}}"
    else
        : "${YOUTARR_DB_PASSWORD:=}"
        : "${YOUTARR_DB_ROOT_PASSWORD:=}"
        : "${YOUTARR_ADMIN_USERNAME:=}"
        : "${YOUTARR_ADMIN_PASSWORD:=}"
    fi
    : "${BAZARR_URL:=http://127.0.0.1:6767}"
    : "${SEERR_URL:=http://127.0.0.1:5055}"
    : "${PULSARR_URL:=http://127.0.0.1:3003}"
    : "${MAINTAINERR_URL:=http://127.0.0.1:6246}"
    : "${CLEANUPARR_BIND_IP:=127.0.0.1}"
    : "${CLEANUPARR_PORT:=11011}"
    : "${CLEANUPARR_URL:=http://127.0.0.1:${CLEANUPARR_PORT}}"
    : "${CLEANUPARR_AUTO_CONFIGURE:=true}"
    : "${CLEANUPARR_MALWARE_CRON:=0/5 * * * * ?}"
    : "${AGREGARR_URL:=http://127.0.0.1:7171}"
    : "${AGREGARR_API_KEY:=}"
    : "${AGREGARR_PLACEHOLDER_FOLDER:=_Trailers}"
    : "${TRACEARR_URL:=http://127.0.0.1:3000}"
    : "${TRACEARR_AUTO_CONFIGURE:=true}"
    : "${TRACEARR_ADMIN_USERNAME:=}"
    : "${TRACEARR_ADMIN_EMAIL:=}"
    : "${TRACEARR_ADMIN_PASSWORD:=}"
    : "${TRACEARR_CLAIM_CODE:=}"
    : "${TRACEARR_PLEX_SERVER_URL:=}"
    : "${TRACEARR_JELLYFIN_SERVER_URL:=}"
    : "${TRACEARR_EMBY_SERVER_URL:=}"
    : "${PLEX_URL:=http://127.0.0.1:32400}"
    : "${JELLYFIN_URL:=http://127.0.0.1:8096}"
    : "${TINYMEDIAMANAGER_URL:=http://127.0.0.1:7878}"
    : "${FLARESOLVERR_URL:=http://127.0.0.1:8191}"
    : "${TIDARR_URL:=http://127.0.0.1:8484}"
    : "${PULSARR_API_KEY:=}"
    : "${TRACEARR_API_KEY:=}"
    : "${ROMM_API_KEY:=}"
    : "${BOOKORBIT_TOKEN:=}"
    : "${BAZARR_API_KEY:=}"
    : "${TINYMEDIAMANAGER_API_KEY:=}"
    : "${TIDARR_API_KEY:=}"
    : "${TRANSMISSION_IMAGE:=lscr.io/linuxserver/transmission:latest}"
    : "${QBITTORRENT_IMAGE:=lscr.io/linuxserver/qbittorrent:latest}"
    : "${RADARR_IMAGE:=lscr.io/linuxserver/radarr:latest}"
    : "${SONARR_IMAGE:=lscr.io/linuxserver/sonarr:latest}"
    : "${PROWLARR_IMAGE:=lscr.io/linuxserver/prowlarr:latest}"
    : "${BAZARR_IMAGE:=lscr.io/linuxserver/bazarr:latest}"
    : "${SEERR_IMAGE:=ghcr.io/seerr-team/seerr:latest}"
    : "${MAINTAINERR_IMAGE:=ghcr.io/maintainerr/maintainerr:latest}"
    : "${CLEANUPARR_IMAGE:=ghcr.io/cleanuparr/cleanuparr:latest}"
    : "${AGREGARR_IMAGE:=agregarr/agregarr:latest}"
    : "${TRACEARR_IMAGE:=ghcr.io/connorgallopo/tracearr:latest}"
    : "${REDIS_IMAGE:=redis:8.8.0-alpine}"
    : "${RECYCLARR_IMAGE:=ghcr.io/recyclarr/recyclarr:latest}"
    : "${FLARESOLVERR_IMAGE:=ghcr.io/flaresolverr/flaresolverr:latest}"
    : "${LIDARR_IMAGE:=lscr.io/linuxserver/lidarr:latest}"
    : "${TIDARR_IMAGE:=cstaelen/tidarr:latest}"
    : "${BOOKORBIT_IMAGE:=ghcr.io/bookorbit/bookorbit:latest}"
    : "${IMMICH_SERVER_IMAGE:=ghcr.io/immich-app/immich-server}"
    : "${IMMICH_MACHINE_LEARNING_IMAGE:=ghcr.io/immich-app/immich-machine-learning}"
    : "${ROMM_IMAGE:=rommapp/romm:latest}"
    : "${QUESTARR_IMAGE:=ghcr.io/doezer/questarr:latest}"
    : "${YOUTARR_IMAGE:=dialmaster/youtarr:latest}"
    : "${YOUTARR_DB_IMAGE:=mariadb:10.11}"
    : "${ROMM_DB_IMAGE:=}"
    if [[ "${ROMM_DB_HOST:-}" == "romm-db" || "${ROMM_DB_HOST:-}" == "mysql" || "${ROMM_DB_HOST:-}" == "mariadb" || -z "${ROMM_DB_HOST:-}" ]]; then
        ROMM_DB_HOST="database"
    fi
    if [[ "${ROMM_DB_DRIVER:-}" == "mysql" || "${ROMM_DB_DRIVER:-}" == "mariadb" || -z "${ROMM_DB_DRIVER:-}" ]]; then
        ROMM_DB_DRIVER="postgresql"
    fi
    if [[ "${ROMM_DB_PORT:-}" == "3306" || -z "${ROMM_DB_PORT:-}" ]]; then
        ROMM_DB_PORT="5432"
    fi
    if [[ "${ROMM_DB_IMAGE:-}" == "mysql:8" || "${ROMM_DB_IMAGE:-}" == "mysql:latest" || "${ROMM_DB_IMAGE:-}" == mariadb:* ]]; then
        ROMM_DB_IMAGE=""
    fi
    : "${DATABASE_IMAGE:=timescale/timescaledb-ha:pg18.1-ts2.25.0}"
    if flag_enabled "${ENABLE_TRACEARR:-false}" && [[ "$DATABASE_IMAGE" == "pgvector/pgvector:pg18-trixie" ]]; then
        DATABASE_IMAGE="timescale/timescaledb-ha:pg18.1-ts2.25.0"
    fi
    : "${DATABASE_PGDATA:=$(database_pgdata_default)}"
    : "${DATABASE_BIND_IP:=127.0.0.1}"
    : "${DATABASE_HOST_PORT:=5433}"
    : "${DATABASE_NAME:=postgres}"
    : "${DATABASE_SUPERUSER:=postgres}"
    : "${DATABASE_SUPERUSER_PASSWORD:=$(random_secret 24)}"
    : "${STACKARR_POSTGRES_MAIN_DATABASE:=${STACKARR_POSTGRES_DATABASE:-stackarr-main}}"
    STACKARR_POSTGRES_DATABASE="$STACKARR_POSTGRES_MAIN_DATABASE"
    : "${STACKARR_POSTGRES_LOG_DATABASE:=stackarr-log}"
    : "${STACKARR_POSTGRES_USER:=stackarr}"
    : "${STACKARR_POSTGRES_PASSWORD:=${DATABASE_SUPERUSER_PASSWORD}}"
    if database_mode_is_postgres; then
        : "${STACKARR_DATABASE_URL:=postgres://$(urlencode_component "$STACKARR_POSTGRES_USER"):$(urlencode_component "$STACKARR_POSTGRES_PASSWORD")@database:5432/$(urlencode_component "$STACKARR_POSTGRES_DATABASE")}"
        : "${STACKARR_LOG_DATABASE_URL:=postgres://$(urlencode_component "$STACKARR_POSTGRES_USER"):$(urlencode_component "$STACKARR_POSTGRES_PASSWORD")@database:5432/$(urlencode_component "$STACKARR_POSTGRES_LOG_DATABASE")}"
    else
        : "${STACKARR_DATABASE_URL:=}"
        : "${STACKARR_LOG_DATABASE_URL:=}"
    fi
    : "${BOOKORBIT_POSTGRES_DATABASE:=bookorbit}"
    : "${BOOKORBIT_POSTGRES_USER:=bookorbit}"
    : "${BOOKORBIT_POSTGRES_PASSWORD:=${DATABASE_SUPERUSER_PASSWORD}}"
    local generated_bookorbit_database_url
    generated_bookorbit_database_url="postgres://$(urlencode_component "$BOOKORBIT_POSTGRES_USER"):$(urlencode_component "$BOOKORBIT_POSTGRES_PASSWORD")@database:5432/$(urlencode_component "$BOOKORBIT_POSTGRES_DATABASE")"
    if bookorbit_database_url_is_managed "${BOOKORBIT_DATABASE_URL:-}" "$BOOKORBIT_POSTGRES_USER" "$BOOKORBIT_POSTGRES_DATABASE"; then
        BOOKORBIT_DATABASE_URL="$generated_bookorbit_database_url"
    fi
    : "${SEERR_POSTGRES_DATABASE:=seerr}"
    : "${SEERR_POSTGRES_USER:=seerr}"
    : "${SEERR_POSTGRES_PASSWORD:=${DATABASE_SUPERUSER_PASSWORD}}"
    : "${PULSARR_POSTGRES_DATABASE:=pulsarr}"
    : "${PULSARR_POSTGRES_USER:=pulsarr}"
    : "${PULSARR_POSTGRES_PASSWORD:=${DATABASE_SUPERUSER_PASSWORD}}"
    if database_mode_is_postgres; then
        : "${PULSARR_DB_TYPE:=postgres}"
        : "${PULSARR_DB_HOST:=database}"
        : "${PULSARR_DB_PORT:=5432}"
        : "${PULSARR_DB_NAME:=$PULSARR_POSTGRES_DATABASE}"
        : "${PULSARR_DB_USER:=$PULSARR_POSTGRES_USER}"
        : "${PULSARR_DB_PASSWORD:=$PULSARR_POSTGRES_PASSWORD}"
    else
        : "${PULSARR_DB_TYPE:=sqlite}"
        : "${PULSARR_DB_HOST:=}"
        : "${PULSARR_DB_PORT:=5432}"
        : "${PULSARR_DB_NAME:=}"
        : "${PULSARR_DB_USER:=}"
        : "${PULSARR_DB_PASSWORD:=}"
    fi
    : "${PULSARR_DB_PATH:=/app/data/db/pulsarr.db}"
    : "${SEERR_DB_TYPE:=postgres}"
    : "${BAZARR_POSTGRES_DATABASE:=bazarr}"
    : "${BAZARR_POSTGRES_USER:=bazarr}"
    : "${BAZARR_POSTGRES_PASSWORD:=${DATABASE_SUPERUSER_PASSWORD}}"
    if database_mode_is_postgres; then
        : "${BAZARR_POSTGRES_ENABLED:=true}"
        : "${BAZARR_POSTGRES_HOST:=database}"
        : "${BAZARR_POSTGRES_PORT:=5432}"
    else
        : "${BAZARR_POSTGRES_ENABLED:=false}"
        : "${BAZARR_POSTGRES_HOST:=}"
        : "${BAZARR_POSTGRES_PORT:=}"
    fi
    : "${PROWLARR_POSTGRES_MAIN_DATABASE:=prowlarr-main}"
    : "${PROWLARR_POSTGRES_LOG_DATABASE:=prowlarr-log}"
    : "${PROWLARR_POSTGRES_USER:=prowlarr}"
    : "${PROWLARR_POSTGRES_PASSWORD:=${DATABASE_SUPERUSER_PASSWORD}}"
    : "${RADARR_POSTGRES_MAIN_DATABASE:=radarr-main}"
    : "${RADARR_POSTGRES_LOG_DATABASE:=radarr-log}"
    : "${RADARR_POSTGRES_USER:=radarr}"
    : "${RADARR_POSTGRES_PASSWORD:=${DATABASE_SUPERUSER_PASSWORD}}"
    : "${RADARR4K_POSTGRES_MAIN_DATABASE:=radarr4k-main}"
    : "${RADARR4K_POSTGRES_LOG_DATABASE:=radarr4k-log}"
    : "${RADARR4K_POSTGRES_USER:=radarr4k}"
    : "${RADARR4K_POSTGRES_PASSWORD:=${DATABASE_SUPERUSER_PASSWORD}}"
    : "${SONARR_POSTGRES_MAIN_DATABASE:=sonarr-main}"
    : "${SONARR_POSTGRES_LOG_DATABASE:=sonarr-log}"
    : "${SONARR_POSTGRES_USER:=sonarr}"
    : "${SONARR_POSTGRES_PASSWORD:=${DATABASE_SUPERUSER_PASSWORD}}"
    : "${SONARR4K_POSTGRES_MAIN_DATABASE:=sonarr4k-main}"
    : "${SONARR4K_POSTGRES_LOG_DATABASE:=sonarr4k-log}"
    : "${SONARR4K_POSTGRES_USER:=sonarr4k}"
    : "${SONARR4K_POSTGRES_PASSWORD:=${DATABASE_SUPERUSER_PASSWORD}}"
    : "${LIDARR_POSTGRES_MAIN_DATABASE:=lidarr-main}"
    : "${LIDARR_POSTGRES_LOG_DATABASE:=lidarr-log}"
    : "${LIDARR_POSTGRES_USER:=lidarr}"
    : "${LIDARR_POSTGRES_PASSWORD:=${DATABASE_SUPERUSER_PASSWORD}}"
    if database_mode_is_postgres; then
        : "${PROWLARR_POSTGRES_HOST:=database}"
        : "${PROWLARR_POSTGRES_PORT:=5432}"
        : "${RADARR_POSTGRES_HOST:=database}"
        : "${RADARR_POSTGRES_PORT:=5432}"
        : "${RADARR4K_POSTGRES_HOST:=database}"
        : "${RADARR4K_POSTGRES_PORT:=5432}"
        : "${SONARR_POSTGRES_HOST:=database}"
        : "${SONARR_POSTGRES_PORT:=5432}"
        : "${SONARR4K_POSTGRES_HOST:=database}"
        : "${SONARR4K_POSTGRES_PORT:=5432}"
        : "${LIDARR_POSTGRES_HOST:=database}"
        : "${LIDARR_POSTGRES_PORT:=5432}"
    else
        : "${PROWLARR_POSTGRES_HOST:=}"
        : "${PROWLARR_POSTGRES_PORT:=}"
        : "${RADARR_POSTGRES_HOST:=}"
        : "${RADARR_POSTGRES_PORT:=}"
        : "${RADARR4K_POSTGRES_HOST:=}"
        : "${RADARR4K_POSTGRES_PORT:=}"
        : "${SONARR_POSTGRES_HOST:=}"
        : "${SONARR_POSTGRES_PORT:=}"
        : "${SONARR4K_POSTGRES_HOST:=}"
        : "${SONARR4K_POSTGRES_PORT:=}"
        : "${LIDARR_POSTGRES_HOST:=}"
        : "${LIDARR_POSTGRES_PORT:=}"
    fi
    : "${TINYMEDIAMANAGER_IMAGE:=tinymediamanager/tinymediamanager:latest}"
    : "${TRANSMISSION_BIND_IP:=127.0.0.1}"
    : "${TRANSMISSION_TORRENT_PORT:=51413}"
    : "${QBITTORRENT_BIND_IP:=127.0.0.1}"
    : "${QBITTORRENT_WEBUI_PORT:=8081}"
    : "${QBITTORRENT_TORRENT_PORT:=6881}"
    : "${PLEX_IMAGE:=lscr.io/linuxserver/plex:latest}"
    : "${PLEX_DOCKER_PORT:=32400}"
    : "${JELLYFIN_IMAGE:=lscr.io/linuxserver/jellyfin:latest}"
    : "${JELLYFIN_DOCKER_PORT:=8096}"
    : "${STACKARR_WEB_ENABLED:=false}"
    : "${STACKARR_IMAGE:=polyphonic/stackarr:alpha}"
    : "${STACKARR_BIND_IP:=127.0.0.1}"
    : "${STACKARR_WEB_PORT:=7777}"
    : "${STACKARR_TELEMETRY_FEATURE_ENABLED:=true}"
    : "${STACKARR_TELEMETRY_ENABLED:=false}"
    : "${STACKARR_TELEMETRY_ENDPOINT:=}"
    : "${STACKARR_TELEMETRY_CHANNEL:=}"
    : "${STACKARR_TELEMETRY_INGEST_KEY:=}"
    : "${PULSARR_IMAGE:=lakker/pulsarr:latest}"
    : "${SEERR_BIND_IP:=0.0.0.0}"
    : "${PULSARR_BIND_IP:=127.0.0.1}"
    : "${PULSARR_PORT:=3003}"
    : "${PULSARR_AUTHENTICATION_METHOD:=requiredExceptLocal}"
    : "${PULSARR_COOKIE_SECURED:=false}"
    : "${MAINTAINERR_BIND_IP:=127.0.0.1}"
    : "${MAINTAINERR_PORT:=6246}"
    : "${AGREGARR_BIND_IP:=127.0.0.1}"
    : "${AGREGARR_PORT:=7171}"
    : "${MAINTAINERR_BASE_PATH:=}"
    : "${MAINTAINERR_GITHUB_TOKEN:=}"
    : "${MAINTAINERR_CLEANUP_PRESETS:=}"
    : "${MAINTAINERR_PLEX_SERVER_URL:=}"
    : "${MAINTAINERR_JELLYFIN_SERVER_URL:=}"
    : "${MAINTAINERR_QBITTORRENT_URL:=}"
    : "${TRACEARR_BIND_IP:=127.0.0.1}"
    : "${TRACEARR_PORT:=3000}"
    : "${TRACEARR_AUTO_CONFIGURE:=true}"
    : "${TRACEARR_ADMIN_USERNAME:=${USERNAME:-stackarr}}"
    : "${TRACEARR_ADMIN_EMAIL:=${USER_EMAIL:-}}"
    : "${TRACEARR_ADMIN_PASSWORD:=${PASSWORD:-}}"
    : "${TRACEARR_CLAIM_CODE:=}"
    : "${TRACEARR_PLEX_SERVER_URL:=}"
    : "${TRACEARR_JELLYFIN_SERVER_URL:=}"
    : "${TRACEARR_EMBY_SERVER_URL:=}"
    : "${TRACEARR_LOG_LEVEL:=info}"
    : "${TRACEARR_CORS_ORIGIN:=*}"
    if flag_enabled "${ENABLE_TRACEARR:-false}"; then
        : "${TRACEARR_DB_PASSWORD:=${DATABASE_SUPERUSER_PASSWORD:-$(random_secret 24)}}"
        : "${TRACEARR_JWT_SECRET:=$(random_hex_secret 32)}"
        : "${TRACEARR_COOKIE_SECRET:=$(random_hex_secret 32)}"
    else
        : "${TRACEARR_DB_PASSWORD:=}"
        : "${TRACEARR_JWT_SECRET:=}"
        : "${TRACEARR_COOKIE_SECRET:=}"
    fi
    : "${TRACEARR_POSTGRES_DATABASE:=tracearr}"
    : "${TRACEARR_POSTGRES_USER:=tracearr}"
    : "${TRACEARR_POSTGRES_PASSWORD:=${TRACEARR_DB_PASSWORD:-$DATABASE_SUPERUSER_PASSWORD}}"
    : "${TRACEARR_DATABASE_URL:=postgres://$(urlencode_component "$TRACEARR_POSTGRES_USER"):$(urlencode_component "$TRACEARR_POSTGRES_PASSWORD")@database:5432/$(urlencode_component "$TRACEARR_POSTGRES_DATABASE")}"
    : "${PREFERRED_TORRENT_CLIENT:=transmission}"
    : "${ENABLE_BACKUP:=true}"
    : "${BACKUP_ROOT:=$APP_ROOT/backups}"
    : "${BACKUP_STAGING_ROOT:=}"
    : "${BACKUP_TIME:=02:00}"
    : "${BACKUP_SCHEDULE:=weekly}"
    : "${BACKUP_WEEKDAY:=Sun}"
    : "${BACKUP_RETENTION_COUNT:=52}"
    : "${BACKUP_ENCRYPTION:=keyfile}"
    : "${ENABLE_SCHEDULED_UPDATES:=false}"
    : "${UPDATE_TIME:=04:30}"
    : "${UPDATE_WEEKDAY:=Sun}"
    : "${DOWNLOAD_INCOMPLETE_NAME:=${TRANSMISSION_INCOMPLETE_NAME:-incomplete}}"
    : "${DOWNLOAD_COMPLETE_NAME:=${TRANSMISSION_COMPLETE_NAME:-complete}}"
    : "${RADARR_CATEGORY:=radarr}"
    : "${RADARR_4K_CATEGORY:=radarr-uhd}"
    : "${SONARR_CATEGORY:=tv-sonarr}"
    : "${SONARR_4K_CATEGORY:=tv-sonarr-uhd}"
    : "${LIDARR_CATEGORY:=lidarr}"
    : "${PLEX_BACKUP_MODE:=lite}"
    : "${CLOUDFLARE_API_TOKEN:=}"
    : "${CLOUDFLARE_ACCOUNT_ID:=}"
    : "${CLOUDFLARE_ZONE_ID:=}"
    : "${CLOUDFLARED_TUNNEL_NAME:=stackarr}"
    : "${CLOUDFLARED_TUNNEL_ID:=}"
    : "${CLOUDFLARED_METRICS_PORT:=42183}"
    : "${CLOUDFLARED_BIN:=}"
    : "${CLOUDFLARED_TOKEN_FILE:=}"
    : "${CLOUDFLARED_KEEP_LAN:=true}"
    : "${CLOUDFLARE_ROUTE_MANAGED:=false}"
    : "${CLOUDFLARE_TUNNEL_ROUTES:=}"
    : "${CLOUDFLARE_ACCESS_ENABLED:=false}"
    : "${CLOUDFLARE_ACCESS_ALLOWED_EMAILS:=}"
    : "${CLOUDFLARE_ACCESS_SESSION_DURATION:=720h}"
    : "${SEERR_ORIGIN_URL:=http://127.0.0.1:5055}"
    apply_browser_link_runtime_defaults
    case "$(lowercase "$PREFERRED_TORRENT_CLIENT")" in
        qbittorrent|qbit|qb)
            PREFERRED_TORRENT_CLIENT="qbittorrent"
            ;;
        *)
            PREFERRED_TORRENT_CLIENT="transmission"
            ;;
    esac
    export STACKARR_REPO_ROOT STACKARR_DATABASE_FILE STACKARR_DATABASE_DIR STACKARR_DATABASE_MODE STACKARR_DATABASE_URL STACKARR_LOG_DATABASE_URL STACKARR_POSTGRES_DATABASE STACKARR_POSTGRES_MAIN_DATABASE STACKARR_POSTGRES_LOG_DATABASE STACKARR_POSTGRES_USER STACKARR_POSTGRES_PASSWORD COMPOSE_PROJECT_NAME TIMEZONE PUID PGID MEDIA_ROOT MUSIC_ROOT DOWNLOADS_ROOT APP_ROOT CONFIG_ROOT STATE_ROOT LOG_ROOT PLEX_CONFIG_PATH PLEX_PREFS_PATH PLEX_INSTALL_MODE JELLYFIN_INSTALL_MODE JELLYFIN_CONFIG_PATH ENABLE_MOVIES ENABLE_TV_SHOWS ENABLE_4K_SERVARR ENABLE_BAZARR ENABLE_LIDARR ENABLE_BOOKORBIT ENABLE_IMMICH ENABLE_ROMM BOOKORBIT_JWT_SECRET BOOKORBIT_SETUP_TOKEN BOOKORBIT_DATABASE_URL BOOKORBIT_POSTGRES_DATABASE BOOKORBIT_POSTGRES_USER BOOKORBIT_POSTGRES_PASSWORD BOOKORBIT_IMAGE BOOKORBIT_BIND_IP BOOKORBIT_WEB_PORT BOOKORBIT_CONTAINER_PORT BOOKORBIT_URL BOOKORBIT_APP_URL BOOKORBIT_CLIENT_URL BOOKS_ROOT DATABASE_IMAGE DATABASE_PGDATA DATABASE_BIND_IP DATABASE_HOST_PORT DATABASE_NAME DATABASE_SUPERUSER DATABASE_SUPERUSER_PASSWORD REDIS_IMAGE SEERR_DB_TYPE SEERR_POSTGRES_DATABASE SEERR_POSTGRES_USER SEERR_POSTGRES_PASSWORD PULSARR_DB_TYPE PULSARR_DB_PATH PULSARR_DB_HOST PULSARR_DB_PORT PULSARR_DB_NAME PULSARR_DB_USER PULSARR_DB_PASSWORD PULSARR_POSTGRES_DATABASE PULSARR_POSTGRES_USER PULSARR_POSTGRES_PASSWORD BAZARR_POSTGRES_ENABLED BAZARR_POSTGRES_HOST BAZARR_POSTGRES_PORT BAZARR_POSTGRES_DATABASE BAZARR_POSTGRES_USER BAZARR_POSTGRES_PASSWORD PROWLARR_POSTGRES_HOST PROWLARR_POSTGRES_PORT PROWLARR_POSTGRES_MAIN_DATABASE PROWLARR_POSTGRES_LOG_DATABASE PROWLARR_POSTGRES_USER PROWLARR_POSTGRES_PASSWORD RADARR_POSTGRES_HOST RADARR_POSTGRES_PORT RADARR_POSTGRES_MAIN_DATABASE RADARR_POSTGRES_LOG_DATABASE RADARR_POSTGRES_USER RADARR_POSTGRES_PASSWORD RADARR4K_POSTGRES_HOST RADARR4K_POSTGRES_PORT RADARR4K_POSTGRES_MAIN_DATABASE RADARR4K_POSTGRES_LOG_DATABASE RADARR4K_POSTGRES_USER RADARR4K_POSTGRES_PASSWORD SONARR_POSTGRES_HOST SONARR_POSTGRES_PORT SONARR_POSTGRES_MAIN_DATABASE SONARR_POSTGRES_LOG_DATABASE SONARR_POSTGRES_USER SONARR_POSTGRES_PASSWORD SONARR4K_POSTGRES_HOST SONARR4K_POSTGRES_PORT SONARR4K_POSTGRES_MAIN_DATABASE SONARR4K_POSTGRES_LOG_DATABASE SONARR4K_POSTGRES_USER SONARR4K_POSTGRES_PASSWORD LIDARR_POSTGRES_HOST LIDARR_POSTGRES_PORT LIDARR_POSTGRES_MAIN_DATABASE LIDARR_POSTGRES_LOG_DATABASE LIDARR_POSTGRES_USER LIDARR_POSTGRES_PASSWORD ENABLE_TINYMEDIAMANAGER ENABLE_RECYCLARR ENABLE_FLARESOLVERR ENABLE_TIDARR ENABLE_SEERR STACKARR_CONFIGURE_SEERR ENABLE_PULSARR ENABLE_TRACEARR STACKARR_MOVIE_PROFILE_PRESET STACKARR_MOVIE_4K_PROFILE_PRESET STACKARR_TV_PROFILE_PRESET STACKARR_TV_4K_PROFILE_PRESET STACKARR_MUSIC_PROFILE_PRESET STACKARR_MOVIE_DEFAULT_PROFILE STACKARR_MOVIE_4K_DEFAULT_PROFILE STACKARR_TV_DEFAULT_PROFILE STACKARR_TV_4K_DEFAULT_PROFILE STACKARR_MUSIC_DEFAULT_PROFILE ENABLE_BACKUP STACKARR_API_KEY STACKARR_DOCKER_CONTEXT USERNAME PASSWORD USER_EMAIL TRANSMISSION_URL QBITTORRENT_URL PROWLARR_URL RADARR_URL RADARR_4K_URL RADARR4K_URL SONARR_URL SONARR_4K_URL SONARR4K_URL LIDARR_URL BAZARR_URL SEERR_URL PULSARR_URL TRACEARR_URL PLEX_URL JELLYFIN_URL TINYMEDIAMANAGER_URL FLARESOLVERR_URL TRANSMISSION_IMAGE QBITTORRENT_IMAGE RADARR_IMAGE SONARR_IMAGE PROWLARR_IMAGE BAZARR_IMAGE SEERR_IMAGE RECYCLARR_IMAGE FLARESOLVERR_IMAGE LIDARR_IMAGE TIDARR_IMAGE TINYMEDIAMANAGER_IMAGE TRANSMISSION_BIND_IP TRANSMISSION_TORRENT_PORT QBITTORRENT_BIND_IP QBITTORRENT_WEBUI_PORT QBITTORRENT_TORRENT_PORT PLEX_IMAGE PLEX_DOCKER_PORT JELLYFIN_IMAGE JELLYFIN_DOCKER_PORT STACKARR_WEB_ENABLED STACKARR_IMAGE STACKARR_BIND_IP STACKARR_WEB_PORT STACKARR_TELEMETRY_FEATURE_ENABLED STACKARR_TELEMETRY_ENABLED STACKARR_TELEMETRY_ENDPOINT STACKARR_TELEMETRY_CHANNEL STACKARR_TELEMETRY_INGEST_KEY PULSARR_IMAGE SEERR_BIND_IP PULSARR_BIND_IP PULSARR_PORT PULSARR_AUTHENTICATION_METHOD PULSARR_COOKIE_SECURED PREFERRED_TORRENT_CLIENT BACKUP_ROOT BACKUP_STAGING_ROOT BACKUP_TIME BACKUP_SCHEDULE BACKUP_WEEKDAY BACKUP_RETENTION_COUNT BACKUP_ENCRYPTION ENABLE_SCHEDULED_UPDATES UPDATE_TIME UPDATE_WEEKDAY DOWNLOAD_INCOMPLETE_NAME DOWNLOAD_COMPLETE_NAME RADARR_CATEGORY RADARR_4K_CATEGORY SONARR_CATEGORY SONARR_4K_CATEGORY LIDARR_CATEGORY PLEX_BACKUP_MODE CLOUDFLARE_API_TOKEN CLOUDFLARE_ACCOUNT_ID CLOUDFLARE_ZONE_ID CLOUDFLARED_TUNNEL_NAME CLOUDFLARED_TUNNEL_ID CLOUDFLARED_METRICS_PORT CLOUDFLARED_BIN CLOUDFLARED_TOKEN_FILE CLOUDFLARED_KEEP_LAN CLOUDFLARE_ROUTE_MANAGED CLOUDFLARE_TUNNEL_ROUTES CLOUDFLARE_ACCESS_ENABLED CLOUDFLARE_ACCESS_ALLOWED_EMAILS CLOUDFLARE_ACCESS_SESSION_DURATION SEERR_ORIGIN_URL STACKARR_SERVICE_URL_MODE STACKARR_SERVICE_URL_SCHEME STACKARR_SERVICE_URL_HOST_SUFFIX STACKARR_UNIFY_SERVICE_URLS
    export ENABLE_MAINTAINERR MAINTAINERR_URL MAINTAINERR_IMAGE MAINTAINERR_BIND_IP MAINTAINERR_PORT MAINTAINERR_BASE_PATH MAINTAINERR_GITHUB_TOKEN MAINTAINERR_CLEANUP_PRESETS MAINTAINERR_PLEX_SERVER_URL MAINTAINERR_JELLYFIN_SERVER_URL MAINTAINERR_QBITTORRENT_URL
    export ENABLE_CLEANUPARR CLEANUPARR_URL CLEANUPARR_IMAGE CLEANUPARR_BIND_IP CLEANUPARR_PORT CLEANUPARR_AUTO_CONFIGURE CLEANUPARR_MALWARE_CRON
    export ENABLE_AGREGARR AGREGARR_URL AGREGARR_API_KEY AGREGARR_IMAGE AGREGARR_BIND_IP AGREGARR_PORT AGREGARR_PLACEHOLDER_FOLDER
    export IMMICH_URL IMMICH_API_KEY IMMICH_SERVER_IMAGE IMMICH_MACHINE_LEARNING_IMAGE IMMICH_BIND_IP IMMICH_WEB_PORT IMMICH_CONTAINER_PORT IMMICH_UPLOAD_LOCATION IMMICH_VERSION IMMICH_DB_USERNAME IMMICH_DB_PASSWORD IMMICH_DB_DATABASE_NAME IMMICH_DB_VECTOR_EXTENSION
    export GAMES_ROOT ROMM_URL ROMM_API_KEY ROMM_IMAGE ROMM_DB_IMAGE ROMM_BIND_IP ROMM_WEB_PORT ROMM_CONTAINER_PORT ROMM_LIBRARY_ROOT ROMM_ASSETS_ROOT ROMM_CONFIG_ROOT ROMM_RESOURCES_ROOT ROMM_REDIS_DATA_ROOT ROMM_REDIS_HOST ROMM_REDIS_PORT ROMM_ENABLE_RESCAN_ON_FILESYSTEM_CHANGE ROMM_RESCAN_ON_FILESYSTEM_CHANGE_DELAY ROMM_DB_DATA_LOCATION ROMM_DB_DRIVER ROMM_DB_HOST ROMM_DB_PORT ROMM_DB_NAME ROMM_DB_USER ROMM_DB_PASSWORD ROMM_DB_ROOT_PASSWORD ROMM_DB_QUERY_JSON ROMM_AUTH_SECRET_KEY ROMM_AUTO_CONFIGURE ROMM_ADMIN_USERNAME ROMM_ADMIN_EMAIL ROMM_ADMIN_PASSWORD ROMM_IGDB_CLIENT_ID ROMM_IGDB_CLIENT_SECRET ROMM_MOBYGAMES_API_KEY ROMM_SCREENSCRAPER_USER ROMM_SCREENSCRAPER_PASSWORD ROMM_RETROACHIEVEMENTS_API_KEY ROMM_REFRESH_RETROACHIEVEMENTS_CACHE_DAYS ROMM_STEAMGRIDDB_API_KEY ROMM_HASHEOUS_API_ENABLED ROMM_PLAYMATCH_API_ENABLED ROMM_LAUNCHBOX_API_ENABLED ROMM_FLASHPOINT_API_ENABLED ROMM_HLTB_API_ENABLED ROMM_TGDB_API_ENABLED ROMM_ENABLE_SCHEDULED_UPDATE_LAUNCHBOX_METADATA ROMM_SCHEDULED_UPDATE_LAUNCHBOX_METADATA_CRON
    export ROMM_STEAM_LIBRARY_ENABLED ROMM_STEAM_MAC_LIBRARY_ROOT ROMM_STEAM_WINDOWS_LIBRARY_ROOT ROMM_STEAM_LINUX_LIBRARY_ROOT
    export ENABLE_QUESTARR QUESTARR_URL QUESTARR_APP_URL QUESTARR_ALLOWED_ORIGINS QUESTARR_IMAGE QUESTARR_BIND_IP QUESTARR_WEB_PORT QUESTARR_CONTAINER_PORT QUESTARR_DATA_ROOT QUESTARR_LIBRARY_ROOT QUESTARR_SQLITE_DB_PATH QUESTARR_JWT_SECRET QUESTARR_IGDB_CLIENT_ID QUESTARR_IGDB_CLIENT_SECRET
    export ENABLE_YOUTARR YOUTARR_URL YOUTARR_API_KEY YOUTARR_IMAGE YOUTARR_DB_IMAGE YOUTARR_BIND_IP YOUTARR_WEB_PORT YOUTARR_CONTAINER_PORT YOUTARR_OUTPUT_ROOT YOUTARR_CONFIG_ROOT YOUTARR_JOBS_ROOT YOUTARR_IMAGES_ROOT YOUTARR_DB_HOST YOUTARR_DB_PORT YOUTARR_DB_NAME YOUTARR_DB_USER YOUTARR_DB_PASSWORD YOUTARR_DB_ROOT_PASSWORD YOUTARR_LOGIN_ENABLED YOUTARR_ADMIN_USERNAME YOUTARR_ADMIN_PASSWORD YOUTARR_TRUST_PROXY YOUTARR_LOG_LEVEL YOUTARR_PLEX_URL
    export TRACEARR_URL TRACEARR_API_KEY TRACEARR_IMAGE TRACEARR_BIND_IP TRACEARR_PORT TRACEARR_DB_PASSWORD TRACEARR_POSTGRES_DATABASE TRACEARR_POSTGRES_USER TRACEARR_POSTGRES_PASSWORD TRACEARR_DATABASE_URL TRACEARR_JWT_SECRET TRACEARR_COOKIE_SECRET TRACEARR_LOG_LEVEL TRACEARR_CORS_ORIGIN
    export PULSARR_API_KEY BOOKORBIT_TOKEN BAZARR_API_KEY TINYMEDIAMANAGER_API_KEY TIDARR_URL TIDARR_API_KEY
    export TRANSMISSION_PASSWORD QBITTORRENT_PASSWORD PROWLARR_PASSWORD RADARR_PASSWORD RADARR4K_PASSWORD SONARR_PASSWORD SONARR4K_PASSWORD LIDARR_PASSWORD BAZARR_PASSWORD PULSARR_PASSWORD BOOKORBIT_PASSWORD TINYMEDIAMANAGER_PASSWORD
}

write_compose_env_file() {
    local env_file="${STACKARR_COMPOSE_ENV_FILE:-$(stackarr_compose_project_dir)/.env}"

    command -v python3 >/dev/null 2>&1 || {
        warn "Compose env file skipped because python3 is unavailable"
        return 0
    }

    prepare_compose_runtime_file
    ensure_dir "$(dirname "$env_file")"

    python3 - "$env_file" <<'PY'
import os
import re
import sys
from pathlib import Path

target = Path(sys.argv[1])
include = re.compile(
    r"^(APP_ROOT|CONFIG_ROOT|STATE_ROOT|LOG_ROOT|MEDIA_ROOT|MUSIC_ROOT|DOWNLOADS_ROOT|BOOKS_ROOT|GAMES_ROOT|BACKUP_ROOT|BACKUP_STAGING_ROOT|"
    r"COMPOSE_PROJECT_NAME|TIMEZONE|PUID|PGID|USERNAME|PASSWORD|USER_EMAIL|PREFERRED_TORRENT_CLIENT|"
    r"STACKARR_.*|ENABLE_.*|PLEX_.*|JELLYFIN_.*|BOOKORBIT_.*|IMMICH_.*|ROMM_.*|QUESTARR_.*|YOUTARR_.*|DATABASE_.*|SEERR_.*|PULSARR_.*|MAINTAINERR_.*|CLEANUPARR_.*|AGREGARR_.*|TRACEARR_.*|BAZARR_.*|"
    r"PROWLARR_.*|RADARR.*|SONARR.*|LIDARR_.*|TIDARR_.*|TINYMEDIAMANAGER_.*|"
    r"TRANSMISSION_.*|QBITTORRENT_.*|RECYCLARR_.*|FLARESOLVERR_.*|"
    r"BACKUP_.*|UPDATE_.*|DOWNLOAD_.*|CLOUDFLARE_.*|CLOUDFLARED_.*)$"
)
context_only = {
    "COMPOSE_PROJECT_NAME",
    "STACKARR_CHANNEL",
    "STACKARR_CLI_BIN",
    "STACKARR_COMPOSE_ENV_FILE",
    "STACKARR_COMPOSE_FILE",
    "STACKARR_COMPOSE_PROJECT_DIR",
    "STACKARR_CONTAINER_NAME",
    "STACKARR_DATABASE_DIR",
    "STACKARR_DATABASE_FILE",
    "STACKARR_PLEX_HOST",
    "STACKARR_REPO_ROOT",
    "STACKARR_REVISION",
    "STACKARR_RUN_SOURCE",
    "STACKARR_RUNTIME",
    "STACKARR_SCHEDULER_ENABLED",
    "STACKARR_TASK_ID",
    "STACKARR_UPDATE_TASK_ID",
    "STACKARR_VERSION",
}

def quote(value: str) -> str:
    escaped = value.replace("\\", "\\\\").replace('"', '\\"').replace("\n", "\\n").replace("$", "$$")
    return f'"{escaped}"'

lines = [
    "# Generated by Stackarr. Do not commit this file.",
    "# It keeps Docker Compose interpolation aligned with runtime settings.",
]

for key in sorted(os.environ):
    if include.match(key) and key not in context_only:
        lines.append(f"{key}={quote(os.environ[key])}")

tmp = target.with_suffix(target.suffix + ".tmp")
tmp.write_text("\n".join(lines) + "\n", encoding="utf-8")
tmp.chmod(0o600)
tmp.replace(target)
PY
}

prompt_default() {
    local prompt="$1"
    local default="$2"
    local answer
    read -r -p "$prompt [$default]: " answer
    if [[ -z "$answer" ]]; then
        printf '%s
' "$default"
    else
        printf '%s
' "$answer"
    fi
}

prompt_secret_default() {
    local prompt="$1"
    local default="$2"
    local answer
    read -r -s -p "$prompt: " answer
    printf '\n' >&2
    if [[ -z "$answer" ]]; then
        printf '%s\n' "$default"
    else
        printf '%s\n' "$answer"
    fi
}

prompt_choice() {
    local prompt="$1"
    local default="$2"
    shift 2
    local options=("$@")
    local answer normalized option

    while true; do
        read -r -p "$prompt [$default]: " answer
        if [[ -z "$answer" ]]; then
            printf '%s\n' "$default"
            return 0
        fi

        normalized="$(lowercase "$answer")"
        for option in "${options[@]}"; do
            if [[ "$normalized" == "$(lowercase "$option")" ]]; then
                printf '%s\n' "$option"
                return 0
            fi
        done

        warn "Please choose one of: ${options[*]}"
    done
}

confirm() {
    local prompt="$1"
    local default="${2:-yes}"
    local answer

    if [[ "$default" == "yes" ]]; then
        read -r -p "$prompt [Y/n]: " answer
        [[ -z "$answer" || "$answer" =~ ^[Yy]$ ]]
    else
        read -r -p "$prompt [y/N]: " answer
        [[ "$answer" =~ ^[Yy]$ ]]
    fi
}

random_secret() {
    local length="${1:-32}"
    local secret

    # `head` exits early after collecting enough bytes, so disable pipefail
    # inside this subshell to avoid treating `tr`'s SIGPIPE as a hard failure.
    secret="$(
        set +o pipefail
        LC_ALL=C tr -dc 'A-Za-z0-9' </dev/urandom | head -c "$length"
    )"
    printf '%s\n' "$secret"
}

random_hex_secret() {
    local bytes="${1:-32}"

    if command -v openssl >/dev/null 2>&1; then
        openssl rand -hex "$bytes"
        return 0
    fi

    if command -v python3 >/dev/null 2>&1; then
        python3 -c 'import secrets, sys; print(secrets.token_hex(int(sys.argv[1])))' "$bytes"
        return 0
    fi

    if command -v node >/dev/null 2>&1; then
        node -e 'const crypto = require("node:crypto"); process.stdout.write(crypto.randomBytes(Number(process.argv[1])).toString("hex"))' "$bytes"
        return 0
    fi

    local chars=$((bytes * 2))
    (
        set +o pipefail
        LC_ALL=C tr -dc 'a-f0-9' </dev/urandom | head -c "$chars"
    )
    printf '\n'
}

lowercase() {
    printf '%s' "$1" | tr '[:upper:]' '[:lower:]'
}

urlencode_component() {
    local value="$1"

    if command -v python3 >/dev/null 2>&1; then
        python3 -c 'import sys, urllib.parse; print(urllib.parse.quote(sys.argv[1], safe=""))' "$value"
        return 0
    fi

    if command -v node >/dev/null 2>&1; then
        node -e 'process.stdout.write(encodeURIComponent(process.argv[1]))' "$value"
        return 0
    fi

    fail "Missing python3 or node for URL encoding database credentials"
}

bookorbit_database_url_is_managed() {
    local value="${1:-}"
    local user="${2:-bookorbit}"
    local database="${3:-bookorbit}"
    local encoded_user encoded_database
    local postgres_prefix postgresql_prefix database_suffix database_suffix_without_port

    [[ -n "$value" ]] || return 0

    encoded_user="$(urlencode_component "$user")"
    encoded_database="$(urlencode_component "$database")"
    postgres_prefix="postgres://$encoded_user:"
    postgresql_prefix="postgresql://$encoded_user:"
    database_suffix="@database:5432/$encoded_database"
    database_suffix_without_port="@database/$encoded_database"

    case "$value" in
        "$postgres_prefix"*"$database_suffix"|"$postgresql_prefix"*"$database_suffix"|"$postgres_prefix"*"$database_suffix_without_port"|"$postgresql_prefix"*"$database_suffix_without_port")
            return 0
            ;;
    esac

    return 1
}

password_is_portable() {
    [[ "${1:-}" =~ ^[A-Za-z0-9._-]{8,}$ ]]
}

selected_torrent_client() {
    case "$(lowercase "${PREFERRED_TORRENT_CLIENT:-transmission}")" in
        qbittorrent|qbit|qb)
            printf 'qbittorrent\n'
            ;;
        *)
            printf 'transmission\n'
            ;;
    esac
}

stackarr_runtime_is_container() {
    [[ "${STACKARR_RUNTIME:-}" == "docker" && -f "/.dockerenv" ]]
}

service_default_port() {
    case "$1" in
        sonarr)
            printf '%s\n' "8989"
            ;;
        sonarr4k)
            printf '%s\n' "8990"
            ;;
        radarr)
            printf '%s\n' "7878"
            ;;
        radarr4k)
            printf '%s\n' "7879"
            ;;
        prowlarr)
            printf '%s\n' "9696"
            ;;
        lidarr)
            printf '%s\n' "8686"
            ;;
        seerr)
            printf '%s\n' "5055"
            ;;
        pulsarr)
            printf '%s\n' "3003"
            ;;
        maintainerr)
            printf '%s\n' "${MAINTAINERR_PORT:-6246}"
            ;;
        agregarr)
            printf '%s\n' "${AGREGARR_PORT:-7171}"
            ;;
        tracearr)
            printf '%s\n' "${TRACEARR_PORT:-3000}"
            ;;
        transmission)
            printf '%s\n' "9091"
            ;;
        qbittorrent)
            printf '%s\n' "${QBITTORRENT_WEBUI_PORT:-8081}"
            ;;
        bazarr)
            printf '%s\n' "6767"
            ;;
        flaresolverr)
            printf '%s\n' "8191"
            ;;
        plex)
            printf '%s\n' "32400"
            ;;
        jellyfin)
            printf '%s\n' "8096"
            ;;
        tinymediamanager)
            printf '%s\n' "4000"
            ;;
        tidarr)
            printf '%s\n' "8484"
            ;;
        bookorbit)
            printf '%s\n' "${BOOKORBIT_WEB_PORT:-7582}"
            ;;
        immich)
            printf '%s\n' "${IMMICH_WEB_PORT:-2283}"
            ;;
        romm)
            printf '%s\n' "${ROMM_WEB_PORT:-7583}"
            ;;
        questarr)
            printf '%s\n' "${QUESTARR_WEB_PORT:-7584}"
            ;;
        youtarr)
            printf '%s\n' "${YOUTARR_WEB_PORT:-3087}"
            ;;
        *)
            return 1
            ;;
    esac
}

service_container_port() {
    case "$1" in
        radarr4k)
            printf '%s\n' "7878"
            ;;
        sonarr4k)
            printf '%s\n' "8989"
            ;;
        bookorbit)
            printf '%s\n' "${BOOKORBIT_CONTAINER_PORT:-7582}"
            ;;
        immich)
            printf '%s\n' "${IMMICH_CONTAINER_PORT:-2283}"
            ;;
        romm)
            printf '%s\n' "${ROMM_CONTAINER_PORT:-8080}"
            ;;
        questarr)
            printf '%s\n' "${QUESTARR_CONTAINER_PORT:-5000}"
            ;;
        youtarr)
            printf '%s\n' "${YOUTARR_CONTAINER_PORT:-3011}"
            ;;
        *)
            service_default_port "$1"
            ;;
    esac
}

service_url() {
    local service="$1"
    local configured_url="$2"
    local fallback_port="$3"
    local port
    local resolved_port

    if [[ -z "$configured_url" ]]; then
        if stackarr_runtime_is_container; then
            port="$(service_container_port "$service" || true)"
        elif [[ -z "$fallback_port" ]]; then
            port="$(service_default_port "$service" || true)"
        else
            port="$fallback_port"
        fi
        configured_url="http://127.0.0.1:${port}"
    fi

    if ! stackarr_runtime_is_container; then
        printf '%s\n' "$configured_url"
        return 0
    fi

    if [[ -n "$configured_url" ]] && [[ "$configured_url" =~ ^(https?://)(127\.0\.0\.1|localhost)(:[0-9]+)?(/.*)?$ ]]; then
        resolved_port="$(service_container_port "$service" || true)"
        resolved_port="${resolved_port:-${fallback_port:-$(service_default_port "$service")}}"
        if [[ -z "$resolved_port" ]]; then
            printf '%s\n' "$configured_url"
            return 0
        fi

        printf '%s%s:%s%s\n' "${BASH_REMATCH[1]}" "$service" "${resolved_port#:}" "${BASH_REMATCH[4]:-}"
        return 0
    fi

    printf '%s\n' "$configured_url"
}

torrent_client_enabled() {
    local candidate="$1"
    [[ "$(selected_torrent_client)" == "$(lowercase "$candidate")" ]]
}

inactive_torrent_client() {
    if torrent_client_enabled transmission; then
        printf 'qbittorrent\n'
    else
        printf 'transmission\n'
    fi
}

selected_media_server_profiles() {
    case "$(lowercase "${PLEX_INSTALL_MODE:-native}")" in
        docker)
            printf 'plex\n'
            ;;
    esac

    case "$(lowercase "${JELLYFIN_INSTALL_MODE:-disabled}")" in
        docker)
            printf 'jellyfin\n'
            ;;
    esac
}

flag_enabled() {
    local value="${1:-true}"
    case "$(lowercase "$value")" in
        1|true|yes|on)
            return 0
            ;;
        *)
            return 1
            ;;
    esac
}

database_mode_is_postgres() {
    case "$(lowercase "${STACKARR_DATABASE_MODE:-app-default}")" in
        postgres|postgresql|pg)
            return 0
            ;;
        *)
            return 1
            ;;
    esac
}

database_required() {
    if database_mode_is_postgres; then
        return 0
    fi

    if flag_enabled "${ENABLE_BOOKORBIT:-false}"; then
        return 0
    fi

    if flag_enabled "${ENABLE_IMMICH:-false}"; then
        return 0
    fi

    if flag_enabled "${ENABLE_ROMM:-false}"; then
        return 0
    fi

    if flag_enabled "${ENABLE_SEERR:-false}"; then
        return 0
    fi

    if flag_enabled "${ENABLE_PULSARR:-false}" && [[ "$(lowercase "${PULSARR_DB_TYPE:-sqlite}")" == "postgres" ]]; then
        return 0
    fi

    if flag_enabled "${ENABLE_TRACEARR:-false}"; then
        return 0
    fi

    return 1
}

database_init_env_args() {
    local key

    printf -- '-e\nDATABASE_HOST=127.0.0.1\n'
    printf -- '-e\nDATABASE_CONTAINER_PORT=5432\n'

    for key in \
        DATABASE_SUPERUSER DATABASE_SUPERUSER_PASSWORD DATABASE_NAME STACKARR_DATABASE_MODE \
        ENABLE_MOVIES ENABLE_TV_SHOWS ENABLE_4K_SERVARR ENABLE_BAZARR ENABLE_LIDARR ENABLE_BOOKORBIT ENABLE_IMMICH ENABLE_ROMM ENABLE_SEERR ENABLE_PULSARR ENABLE_TRACEARR PULSARR_DB_TYPE \
        STACKARR_POSTGRES_DATABASE STACKARR_POSTGRES_MAIN_DATABASE STACKARR_POSTGRES_LOG_DATABASE STACKARR_POSTGRES_USER STACKARR_POSTGRES_PASSWORD \
        BOOKORBIT_POSTGRES_DATABASE BOOKORBIT_POSTGRES_USER BOOKORBIT_POSTGRES_PASSWORD \
        IMMICH_DB_USERNAME IMMICH_DB_DATABASE_NAME IMMICH_DB_PASSWORD IMMICH_DB_VECTOR_EXTENSION \
        ROMM_DB_NAME ROMM_DB_USER ROMM_DB_PASSWORD \
        SEERR_POSTGRES_DATABASE SEERR_POSTGRES_USER SEERR_POSTGRES_PASSWORD \
        PULSARR_POSTGRES_DATABASE PULSARR_POSTGRES_USER PULSARR_POSTGRES_PASSWORD \
        BAZARR_POSTGRES_DATABASE BAZARR_POSTGRES_USER BAZARR_POSTGRES_PASSWORD \
        TRACEARR_POSTGRES_DATABASE TRACEARR_POSTGRES_USER TRACEARR_POSTGRES_PASSWORD TRACEARR_DB_PASSWORD \
        PROWLARR_POSTGRES_MAIN_DATABASE PROWLARR_POSTGRES_LOG_DATABASE PROWLARR_POSTGRES_USER PROWLARR_POSTGRES_PASSWORD \
        RADARR_POSTGRES_MAIN_DATABASE RADARR_POSTGRES_LOG_DATABASE RADARR_POSTGRES_USER RADARR_POSTGRES_PASSWORD \
        RADARR4K_POSTGRES_MAIN_DATABASE RADARR4K_POSTGRES_LOG_DATABASE RADARR4K_POSTGRES_USER RADARR4K_POSTGRES_PASSWORD \
        SONARR_POSTGRES_MAIN_DATABASE SONARR_POSTGRES_LOG_DATABASE SONARR_POSTGRES_USER SONARR_POSTGRES_PASSWORD \
        SONARR4K_POSTGRES_MAIN_DATABASE SONARR4K_POSTGRES_LOG_DATABASE SONARR4K_POSTGRES_USER SONARR4K_POSTGRES_PASSWORD \
        LIDARR_POSTGRES_MAIN_DATABASE LIDARR_POSTGRES_LOG_DATABASE LIDARR_POSTGRES_USER LIDARR_POSTGRES_PASSWORD; do
        printf -- '-e\n%s\n' "$key"
    done
}

run_shared_database_init() {
    local env_args=()
    local arg

    while IFS= read -r arg; do
        [[ -n "$arg" ]] || continue
        env_args+=("$arg")
    done < <(database_init_env_args)

    stackarr_compose --profile database exec -T "${env_args[@]}" database sh -s < "$ROOT_DIR/scripts/database-init.sh"
}

remove_database_init_sidecar() {
    if command -v docker >/dev/null 2>&1; then
        docker rm -f database-init >/dev/null 2>&1 || true
    fi
}

ensure_shared_database() {
    stackarr_compose --profile database up -d --wait database
    run_shared_database_init
    remove_database_init_sidecar
}

reconcile_running_shared_database() {
    local running_services

    if ! running_services="$(stackarr_compose --profile database ps --services --status running)"; then
        warn "Unable to inspect the shared database before updating Stackarr"
        return 1
    fi
    if ! grep -qx 'database' <<< "$running_services"; then
        warn "The shared database is not running; the Stackarr controller was left unchanged"
        return 1
    fi
    if ! run_shared_database_init; then
        warn "Shared database access reconciliation failed"
        return 1
    fi

    remove_database_init_sidecar
}

ensure_database_if_required() {
    if ! database_required; then
        remove_database_init_sidecar
        return 0
    fi

    ensure_shared_database
}

database_backed_servarr_services() {
    printf '%s\n' "prowlarr"
    flag_enabled "${ENABLE_MOVIES:-false}" && printf '%s\n' "radarr"
    flag_enabled "${ENABLE_TV_SHOWS:-false}" && printf '%s\n' "sonarr"
    if flag_enabled "${ENABLE_4K_SERVARR:-false}"; then
        flag_enabled "${ENABLE_MOVIES:-false}" && printf '%s\n' "radarr4k"
        flag_enabled "${ENABLE_TV_SHOWS:-false}" && printf '%s\n' "sonarr4k"
    fi
    flag_enabled "${ENABLE_LIDARR:-false}" && printf '%s\n' "lidarr"
}

servarr_service_url() {
    case "$1" in
        prowlarr)
            service_url prowlarr "${PROWLARR_URL:-http://127.0.0.1:9696}" 9696
            ;;
        radarr)
            service_url radarr "${RADARR_URL:-http://127.0.0.1:7878}" 7878
            ;;
        radarr4k)
            service_url radarr4k "${RADARR_4K_URL:-${RADARR4K_URL:-http://127.0.0.1:7879}}" 7879
            ;;
        sonarr)
            service_url sonarr "${SONARR_URL:-http://127.0.0.1:8989}" 8989
            ;;
        sonarr4k)
            service_url sonarr4k "${SONARR_4K_URL:-${SONARR4K_URL:-http://127.0.0.1:8990}}" 8990
            ;;
        lidarr)
            service_url lidarr "${LIDARR_URL:-http://127.0.0.1:8686}" 8686
            ;;
        *)
            return 1
            ;;
    esac
}

recover_database_startup_failures() {
    local service url recent_logs

    database_required || return 0

    while IFS= read -r service; do
        [[ -n "$service" ]] || continue
        stackarr_compose ps --services --status running 2>/dev/null | grep -qx "$service" || continue
        url="$(servarr_service_url "$service")" || continue
        http_url_is_reachable "$url" && continue

        recent_logs="$(stackarr_compose logs --tail=250 "$service" 2>&1 || true)"
        if [[ "$recent_logs" == *"database system is starting up"* ]] && [[ "$recent_logs" == *"Non-recoverable failure"* ]]; then
            warn "$service is stuck after starting before the database was ready; restarting it"
            stackarr_compose restart "$service"
        fi
    done < <(database_backed_servarr_services)
}

optional_service_enabled() {
    local service="$1"

    case "$service" in
        movies)
            flag_enabled "$ENABLE_MOVIES"
            ;;
        tv)
            flag_enabled "$ENABLE_TV_SHOWS"
            ;;
        radarr4k)
            flag_enabled "$ENABLE_4K_SERVARR" && flag_enabled "$ENABLE_MOVIES"
            ;;
        sonarr4k)
            flag_enabled "$ENABLE_4K_SERVARR" && flag_enabled "$ENABLE_TV_SHOWS"
            ;;
        bazarr)
            flag_enabled "$ENABLE_BAZARR"
            ;;
        lidarr)
            flag_enabled "$ENABLE_LIDARR"
            ;;
        bookorbit)
            flag_enabled "$ENABLE_BOOKORBIT"
            ;;
        immich)
            flag_enabled "$ENABLE_IMMICH"
            ;;
        romm)
            flag_enabled "$ENABLE_ROMM"
            ;;
        questarr)
            flag_enabled "$ENABLE_QUESTARR"
            ;;
        youtarr|youtarr-db)
            flag_enabled "$ENABLE_YOUTARR"
            ;;
        tinymediamanager)
            flag_enabled "$ENABLE_TINYMEDIAMANAGER"
            ;;
        recyclarr)
            flag_enabled "$ENABLE_RECYCLARR"
            ;;
        flaresolverr)
            flag_enabled "$ENABLE_FLARESOLVERR"
            ;;
        tidarr)
            flag_enabled "$ENABLE_TIDARR"
            ;;
        seerr)
            flag_enabled "$ENABLE_SEERR"
            ;;
        pulsarr)
            flag_enabled "$ENABLE_PULSARR"
            ;;
        maintainerr)
            flag_enabled "$ENABLE_MAINTAINERR"
            ;;
        cleanuparr)
            flag_enabled "$ENABLE_CLEANUPARR"
            ;;
        agregarr)
            flag_enabled "$ENABLE_AGREGARR"
            ;;
        tracearr)
            flag_enabled "$ENABLE_TRACEARR"
            ;;
        *)
            return 0
            ;;
    esac
}

stackarr_web_enabled() {
    case "$(lowercase "${STACKARR_WEB_ENABLED:-false}")" in
        1|true|yes|on)
            return 0
            ;;
        *)
            return 1
            ;;
    esac
}

compose_profile_args() {
    local profile

    if database_required; then
        printf -- '--profile\n%s\n' "database"
    fi
    printf -- '--profile\n%s\n' "$(selected_torrent_client)"
    if stackarr_web_enabled; then
        printf -- '--profile\nstackarr\n'
    fi
    while IFS= read -r profile; do
        [[ -n "$profile" ]] || continue
        printf -- '--profile\n%s\n' "$profile"
    done < <(selected_media_server_profiles)
    for profile in movies tv radarr4k sonarr4k bazarr lidarr bookorbit immich romm questarr youtarr tinymediamanager recyclarr flaresolverr tidarr seerr pulsarr maintainerr cleanuparr agregarr tracearr; do
        if optional_service_enabled "$profile"; then
            printf -- '--profile\n%s\n' "$profile"
        fi
    done
}

remove_inactive_torrent_client_container() {
    local inactive

    inactive="$(inactive_torrent_client)"
    stackarr_compose --profile "$inactive" rm -f -s "$inactive" >/dev/null 2>&1 || true
}

remove_disabled_optional_containers() {
    local service

    for service in movies tv radarr4k sonarr4k bazarr lidarr bookorbit immich romm questarr youtarr tinymediamanager recyclarr flaresolverr tidarr seerr pulsarr maintainerr cleanuparr agregarr tracearr; do
        if ! optional_service_enabled "$service"; then
            stackarr_compose --profile "$service" rm -f -s "$service" >/dev/null 2>&1 || true
        fi
    done

    if ! optional_service_enabled immich; then
        stackarr_compose --profile immich rm -f -s immich-ml >/dev/null 2>&1 || true
        if command -v docker >/dev/null 2>&1; then
            docker rm -f immich-redis immich-postgres >/dev/null 2>&1 || true
        fi
    fi

    if ! optional_service_enabled romm; then
        stackarr_compose --profile romm rm -f -s mariadb mysql romm-db >/dev/null 2>&1 || true
    fi

    if ! optional_service_enabled youtarr; then
        stackarr_compose --profile youtarr rm -f -s youtarr-db >/dev/null 2>&1 || true
    fi
}

parse_api_key_xml() {
    local file="$1"
    [[ -f "$file" ]] || return 1
    sed -n 's:.*<ApiKey>\(.*\)</ApiKey>.*:\1:p' "$file" | head -1
}

read_plist_pref() {
    local file="$1"
    local key="$2"

    [[ -f "$file" ]] || return 1

    python3 - "$file" "$key" <<'PY'
import plistlib
import sys
from pathlib import Path

path = Path(sys.argv[1])
key = sys.argv[2]

with path.open("rb") as fh:
    data = plistlib.load(fh)

value = data.get(key, "")
if value is None:
    value = ""
if value != "":
    print(value)
PY
}

read_native_plex_pref() {
    local key="$1"

    read_plist_pref "$PLEX_PREFS_PATH" "$key"
}

default_route_interface() {
    route -n get default 2>/dev/null | awk '/interface:/{print $2; exit}'
}

is_virtual_network_interface() {
    case "$1" in
        ""|lo*|bridge*|utun*|awdl*|llw*|gif*|stf*|ap*|anpi*)
            return 0
            ;;
        *)
            return 1
            ;;
    esac
}

wait_for_http() {
    local name="$1"
    local url="$2"
    local attempts="${3:-45}"
    local attempt=1
    local status="000"

    while [[ "$attempt" -le "$attempts" ]]; do
        status="$(curl -s -o /dev/null -w '%{http_code}' --max-time 5 "$url" 2>/dev/null || echo 000)"
        if [[ "$status" =~ ^(200|301|302|303|307|401|403)$ ]]; then
            ok "$name is reachable"
            return 0
        fi
        sleep 2
        attempt=$((attempt + 1))
    done

    fail "$name did not become reachable at $url"
}

http_url_is_reachable() {
    local url="$1"
    local status="000"

    status="$(curl -s -o /dev/null -w '%{http_code}' --max-time 5 "$url" 2>/dev/null || echo 000)"
    [[ "$status" =~ ^(200|301|302|303|307|401|403)$ ]]
}

ensure_docker_runtime() {
    require_command docker
    configure_docker_environment

    docker info >/dev/null 2>&1 || fail "Docker runtime is not ready. Start a Docker-compatible engine before running Stackarr."
    ok "Docker runtime is ready"
}

wait_for_docker_runtime() {
    local timeout="${1:-600}"
    local interval="${2:-5}"
    local deadline=$((SECONDS + timeout))

    require_command docker
    configure_docker_environment

    if docker info >/dev/null 2>&1; then
        ok "Docker runtime is ready"
        return 0
    fi

    warn "Docker runtime is not ready yet; waiting up to ${timeout} seconds"
    while [[ "$SECONDS" -lt "$deadline" ]]; do
        sleep "$interval"
        if docker info >/dev/null 2>&1; then
            ok "Docker runtime is ready"
            return 0
        fi
    done

    fail "Docker runtime did not become ready within ${timeout} seconds. The startup agent will retry."
}

stackarr_compose_project_dir() {
    if [[ -n "${STACKARR_COMPOSE_PROJECT_DIR:-}" ]]; then
        printf '%s\n' "$STACKARR_COMPOSE_PROJECT_DIR"
        return 0
    fi

    if [[ -n "${STATE_ROOT:-}" ]]; then
        printf '%s\n' "$STATE_ROOT/compose"
        return 0
    fi

    printf '%s\n' "$ROOT_DIR"
}

stackarr_compose_file() {
    if [[ -n "${STACKARR_COMPOSE_FILE:-}" ]]; then
        printf '%s\n' "$STACKARR_COMPOSE_FILE"
        return 0
    fi

    printf '%s/docker-compose.yml\n' "$(stackarr_compose_project_dir)"
}

prepare_compose_runtime_file() {
    local source_file="$ROOT_DIR/docker-compose.yml"
    local agregarr_guard_source="$ROOT_DIR/scripts/agregarr-placeholder-guard.cjs"
    local project_dir compose_file agregarr_guard_target

    project_dir="$(stackarr_compose_project_dir)"
    compose_file="$(stackarr_compose_file)"
    agregarr_guard_target="$project_dir/agregarr-placeholder-guard.cjs"

    [[ -f "$source_file" ]] || fail "Missing compose file: $source_file"
    [[ -f "$agregarr_guard_source" ]] || fail "Missing Agregarr placeholder guard: $agregarr_guard_source"
    ensure_dir "$project_dir"

    if [[ "$compose_file" != "$source_file" ]]; then
        cp "$source_file" "$compose_file"
    fi
    if [[ "$agregarr_guard_target" != "$agregarr_guard_source" ]]; then
        cp "$agregarr_guard_source" "$agregarr_guard_target"
    fi
    chmod 0644 "$agregarr_guard_target"
}

stackarr_compose() {
    local project_dir compose_file

    configure_docker_environment
    prepare_compose_runtime_file
    project_dir="$(stackarr_compose_project_dir)"
    compose_file="$(stackarr_compose_file)"

    docker compose \
        --project-name "${COMPOSE_PROJECT_NAME:-stackarr}" \
        --project-directory "$project_dir" \
        -f "$compose_file" \
        "$@"
}

ensure_dir() {
    mkdir -p "$1"
}

wait_for_directories() {
    local label="$1"
    local timeout="$2"
    local interval="${3:-2}"
    shift 3

    local elapsed=0
    local dir
    local missing=()

    while true; do
        missing=()
        for dir in "$@"; do
            [[ -d "$dir" ]] || missing+=("$dir")
        done

        if [[ "${#missing[@]}" -eq 0 ]]; then
            ok "$label is ready"
            return 0
        fi

        if (( elapsed >= timeout )); then
            fail "Timed out waiting for $label: ${missing[*]}"
        fi

        if (( elapsed == 0 )); then
            warn "$label not ready yet, waiting for: ${missing[*]}"
        fi

        sleep "$interval"
        elapsed=$((elapsed + interval))
    done
}

wait_for_stackarr_storage() {
    local timeout="${STACKARR_STORAGE_WAIT_SECONDS:-180}"
    local required=()

    [[ -n "${DOWNLOADS_ROOT:-}" ]] && required+=("$DOWNLOADS_ROOT")

    if [[ -n "${MEDIA_ROOT:-}" ]]; then
        required+=(
            "$MEDIA_ROOT/Movies"
            "$MEDIA_ROOT/TV Shows"
        )
    fi
    [[ -n "${MUSIC_ROOT:-}" ]] && required+=("$MUSIC_ROOT")
    if flag_enabled "${ENABLE_ROMM:-false}" && [[ -n "${GAMES_ROOT:-}" ]]; then
        required+=("$GAMES_ROOT")
    fi

    case "$(lowercase "${ENABLE_BACKUP:-true}")" in
        0|false|no|off|disabled)
            ;;
        *)
            [[ -n "${BACKUP_ROOT:-}" ]] && required+=("$BACKUP_ROOT")
            ;;
    esac

    [[ "${#required[@]}" -eq 0 ]] && return 0

    wait_for_directories "Stackarr storage" "$timeout" 2 "${required[@]}"
}

refresh_stackarr_web_storage_mounts() {
    case "$(lowercase "${STACKARR_WEB_ENABLED:-false}")" in
        1|true|yes|on)
            ;;
        *)
            return 0
            ;;
    esac

    local compose_args=("$@")
    local path
    local missing=()

    if ! stackarr_compose "${compose_args[@]}" ps --services --status running 2>/dev/null | grep -qx 'app'; then
        return 0
    fi

    for path in "${MEDIA_ROOT:-}" "${MUSIC_ROOT:-}" "${GAMES_ROOT:-}" "${DOWNLOADS_ROOT:-}" "${BACKUP_ROOT:-}"; do
        [[ -n "$path" ]] || continue
        [[ -e "$path" ]] || continue

        if ! stackarr_compose "${compose_args[@]}" exec -T app test -e "$path" >/dev/null 2>&1; then
            missing+=("$path")
        fi
    done

    [[ "${#missing[@]}" -eq 0 ]] && return 0

    warn "Stackarr web storage mount stale, recreating UI container for: ${missing[*]}"
    write_compose_env_file
    stackarr_compose "${compose_args[@]}" up -d --force-recreate --no-deps app
}

canonical_dir() {
    local input="$1"
    if [[ -d "$input" ]]; then
        (cd "$input" 2>/dev/null && pwd -P)
    else
        return 1
    fi
}

is_subpath() {
    local child="$1"
    local parent="$2"
    local child_real parent_real

    child_real="$(canonical_dir "$child")" || return 1
    parent_real="$(canonical_dir "$parent")" || return 1

    [[ "$child_real" == "$parent_real" || "$child_real" == "$parent_real"/* ]]
}

find_cloudflared_bin() {
    local candidate

    if candidate="$(command -v cloudflared 2>/dev/null)"; then
        printf '%s\n' "$candidate"
        return 0
    fi

    for candidate in \
        "/opt/homebrew/bin/cloudflared" \
        "/usr/local/bin/cloudflared" \
        "/opt/homebrew/opt/cloudflared/bin/cloudflared" \
        "/usr/local/opt/cloudflared/bin/cloudflared"
    do
        if [[ -x "$candidate" ]]; then
            printf '%s\n' "$candidate"
            return 0
        fi
    done

    return 1
}

set_env_value() {
    local key="$1"
    local value="$2"
    local db_file
    db_file="$(default_stackarr_database_file)"
    local writer="$ROOT_DIR/scripts/runtime-config-write.cjs"

    [[ -f "$writer" ]] || fail "Missing $writer"
    command -v node >/dev/null 2>&1 || fail "Missing command: node"

    if [[ -n "${STACKARR_DATABASE_URL:-}" ]] && ! stackarr_runtime_is_container; then
        if stackarr_compose exec -T app bash -lc '
            node "$STACKARR_REPO_ROOT/stackarr/scripts/runtime-config-write.cjs" "$1" "$2"
            source "$STACKARR_REPO_ROOT/stackarr/lib/common.sh"
            load_env
            write_compose_env_file
        ' stackarr-runtime-config "$key" "$value"; then
            export "$key=$value"
            return 0
        fi
        warn "Stackarr app-assisted settings write failed; trying the host database client"
    fi

    STACKARR_DATABASE_FILE="$db_file" node "$writer" "$key" "$value"
    export "$key=$value"
}

compose_service_port_mappings() {
    local service="$1"
    local compose_file="${2:-$ROOT_DIR/docker-compose.yml}"

    [[ -f "$compose_file" ]] || return 1

    awk -v service="$service" '
        $0 == "  " service ":" {
            in_service = 1
            in_ports = 0
            next
        }
        in_service && $0 ~ /^  [^ ]/ {
            in_service = 0
            in_ports = 0
        }
        in_service && $0 == "    ports:" {
            in_ports = 1
            next
        }
        in_service && in_ports && $0 ~ /^    [A-Za-z0-9_-]+:/ {
            in_ports = 0
        }
        in_service && in_ports && $0 ~ /^[[:space:]]*-[[:space:]]*"/ {
            line = $0
            sub(/^[[:space:]]*-[[:space:]]*"/, "", line)
            sub(/".*$/, "", line)
            print line
        }
    ' "$compose_file"
}
