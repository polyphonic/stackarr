#!/bin/bash
set -euo pipefail

ROOT_DIR="$(cd "$(dirname "$0")/.." && pwd)"
# shellcheck source=lib/common.sh
source "$ROOT_DIR/lib/common.sh"

NAMING_CONFIG_FILE="${STACKARR_NAMING_CONFIG_FILE:-$ROOT_DIR/config/naming.json}"

usage() {
    cat <<'EOF'
Usage:
  stackarr naming apply [--wait] [--skip-tmm] [--skip-servarr]
  stackarr naming prestart
EOF
}

require_naming_config() {
    [[ -f "$NAMING_CONFIG_FILE" ]] || fail "Naming config missing at $NAMING_CONFIG_FILE"
}

json_section_merge() {
    local current_json="$1"
    local section="$2"

    python3 - "$NAMING_CONFIG_FILE" "$section" "$current_json" <<'PY'
import json
import sys

config_path = sys.argv[1]
section = sys.argv[2]
current_json = sys.argv[3]

with open(config_path, "r", encoding="utf-8") as fh:
    config = json.load(fh)

overrides = config[section]
current = json.loads(current_json)
current.update(overrides)

print(json.dumps(current, separators=(",", ":")))
PY
}

patch_tmm_file() {
    local section="$1"
    local target_file="$2"

    if [[ ! -f "$target_file" ]]; then
        warn "TinyMediaManager preset skipped because $target_file is missing"
        return 1
    fi

    python3 - "$NAMING_CONFIG_FILE" "$section" "$target_file" <<'PY'
import json
import os
import tempfile
import sys

config_path = sys.argv[1]
section = sys.argv[2]
target_path = sys.argv[3]

with open(config_path, "r", encoding="utf-8") as fh:
    config = json.load(fh)

with open(target_path, "r", encoding="utf-8") as fh:
    data = json.load(fh)

data.update(config["tinymediamanager"][section])

directory = os.path.dirname(target_path)
fd, tmp_path = tempfile.mkstemp(prefix=".stackarr-", suffix=".json", dir=directory)
try:
    with os.fdopen(fd, "w", encoding="utf-8") as fh:
        json.dump(data, fh, indent=2)
        fh.write("\n")
    os.replace(tmp_path, target_path)
finally:
    if os.path.exists(tmp_path):
        os.unlink(tmp_path)
PY
}

apply_tmm_presets() {
    local movies_file="$CONFIG_ROOT/tinymediamanager/data/movies.json"
    local tv_file="$CONFIG_ROOT/tinymediamanager/data/tvShows.json"

    patch_tmm_file "movies" "$movies_file" || true
    patch_tmm_file "tvShows" "$tv_file" || true
    ok "TinyMediaManager naming preset synced"
}

wait_for_servarr() {
    local url="$1"
    local api_key="$2"
    local label="$3"
    local attempts="${4:-45}"
    local sleep_seconds="${5:-2}"
    local i

    for ((i = 1; i <= attempts; i++)); do
        if curl -fsS "$url" -H "X-Api-Key: $api_key" >/dev/null 2>&1; then
            return 0
        fi
        sleep "$sleep_seconds"
    done

    warn "$label naming endpoint is not ready yet"
    return 1
}

apply_servarr_preset() {
    local label="$1"
    local url="$2"
    local api_key="$3"
    local section="$4"
    local wait_for_ready="$5"
    local current payload

    if [[ -z "$api_key" ]]; then
        warn "$label naming skipped because the API key is missing"
        return 1
    fi

    if [[ "$wait_for_ready" == "true" ]]; then
        wait_for_servarr "$url" "$api_key" "$label" || return 1
    fi

    current="$(curl -fsS "$url" -H "X-Api-Key: $api_key" 2>/dev/null)" || {
        warn "$label naming settings could not be read"
        return 1
    }

    payload="$(json_section_merge "$current" "$section")"
    curl -fsS -X PUT "$url" \
        -H "X-Api-Key: $api_key" \
        -H "Content-Type: application/json" \
        --data "$payload" >/dev/null || {
        warn "$label naming settings could not be updated"
        return 1
    }

    ok "$label naming preset applied"
}

restart_tmm_if_running() {
    if ! command -v docker >/dev/null 2>&1; then
        return 0
    fi

    if stackarr_compose ps --status running --services 2>/dev/null | grep -Fxq "tinymediamanager"; then
        stackarr_compose restart tinymediamanager >/dev/null 2>&1 || {
            warn "TinyMediaManager restart failed after preset sync"
            return 1
        }
        ok "TinyMediaManager restarted to load the naming preset"
    fi
}

apply_servarr_presets() {
    local wait_for_ready="$1"
    local radarr_key radarr4k_key sonarr_key sonarr4k_key

    radarr_key="$(parse_api_key_xml "$CONFIG_ROOT/radarr/config.xml" || true)"
    radarr4k_key="$(parse_api_key_xml "$CONFIG_ROOT/radarr4k/config.xml" || true)"
    sonarr_key="$(parse_api_key_xml "$CONFIG_ROOT/sonarr/config.xml" || true)"
    sonarr4k_key="$(parse_api_key_xml "$CONFIG_ROOT/sonarr4k/config.xml" || true)"

    apply_servarr_preset "Radarr" "$RADARR_URL/api/v3/config/naming" "$radarr_key" "radarr" "$wait_for_ready" || true
    apply_servarr_preset "Radarr 4K" "$RADARR_4K_URL/api/v3/config/naming" "$radarr4k_key" "radarr" "$wait_for_ready" || true
    apply_servarr_preset "Sonarr" "$SONARR_URL/api/v3/config/naming" "$sonarr_key" "sonarr" "$wait_for_ready" || true
    apply_servarr_preset "Sonarr 4K" "$SONARR_4K_URL/api/v3/config/naming" "$sonarr4k_key" "sonarr" "$wait_for_ready" || true
}

main() {
    local cmd="${1:-apply}"
    local wait_for_ready="false"
    local skip_tmm="false"
    local skip_servarr="false"

    shift || true

    while (($#)); do
        case "$1" in
            --wait)
                wait_for_ready="true"
                ;;
            --skip-tmm)
                skip_tmm="true"
                ;;
            --skip-servarr)
                skip_servarr="true"
                ;;
            --help|-h)
                usage
                return 0
                ;;
            *)
                fail "Unknown option: $1"
                ;;
        esac
        shift
    done

    require_naming_config
    load_env
    RADARR_URL="$(service_url radarr "$RADARR_URL" 7878)"
    RADARR_4K_URL="$(service_url radarr4k "$RADARR_4K_URL" 7879)"
    SONARR_URL="$(service_url sonarr "$SONARR_URL" 8989)"
    SONARR_4K_URL="$(service_url sonarr4k "$SONARR_4K_URL" 8990)"

    case "$cmd" in
        prestart)
            apply_tmm_presets
            ;;
        apply)
            if [[ "$skip_tmm" != "true" ]]; then
                apply_tmm_presets
                restart_tmm_if_running || true
            fi
            if [[ "$skip_servarr" != "true" ]]; then
                apply_servarr_presets "$wait_for_ready"
            fi
            ;;
        *)
            usage
            fail "Unknown naming subcommand: $cmd"
            ;;
    esac
}

main "$@"
