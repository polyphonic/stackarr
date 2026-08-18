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

tv_season_folders_enabled() {
    python3 - "$NAMING_CONFIG_FILE" <<'PY'
import json
import sys

with open(sys.argv[1], "r", encoding="utf-8") as fh:
    naming = json.load(fh)

print("true" if bool((naming.get("tv") or {}).get("seasonFolders", True)) else "false")
PY
}

reconcile_servarr_series_season_folders() {
    local label="$1"
    local base_url="$2"
    local api_key="$3"
    local desired current result count payload

    if [[ -z "$api_key" ]]; then
        warn "$label season-folder reconciliation skipped because the API key is missing"
        return 1
    fi

    desired="$(tv_season_folders_enabled)"
    current="$(curl -fsS "$base_url/api/v3/series" -H "X-Api-Key: $api_key" 2>/dev/null)" || {
        warn "$label series could not be read for season-folder reconciliation"
        return 1
    }
    result="$(python3 - "$desired" "$current" <<'PY'
import json
import sys

desired = sys.argv[1].lower() == "true"
series = json.loads(sys.argv[2])
series_ids = [item["id"] for item in series if bool(item.get("seasonFolder")) != desired]
print(len(series_ids))
print(json.dumps({"seriesIds": series_ids, "seasonFolder": desired}, separators=(",", ":")))
PY
)"
    count="$(printf '%s\n' "$result" | sed -n '1p')"
    payload="$(printf '%s\n' "$result" | sed -n '2p')"

    if [[ "$count" == 0 ]]; then
        ok "$label series already follow the season-folder policy"
        return 0
    fi

    curl -fsS -X PUT "$base_url/api/v3/series/editor" \
        -H "X-Api-Key: $api_key" \
        -H "Content-Type: application/json" \
        --data "$payload" >/dev/null || {
        warn "$label season-folder policy could not be applied"
        return 1
    }

    ok "$label season-folder policy applied to $count series"
}

reconcile_request_manager_season_folders() {
    local label="$1"
    local base_url="$2"
    local endpoint="$3"
    local api_key="$4"
    local field="$5"
    local desired current updates count id payload

    if [[ -z "$api_key" ]]; then
        warn "$label season-folder reconciliation skipped because the API key is missing"
        return 0
    fi

    desired="$(tv_season_folders_enabled)"
    current="$(curl -fsS "$base_url$endpoint" -H "X-Api-Key: $api_key" 2>/dev/null)" || {
        warn "$label Sonarr defaults could not be read"
        return 1
    }
    updates="$(python3 - "$field" "$desired" "$current" <<'PY'
import json
import sys

field = sys.argv[1]
desired = sys.argv[2].lower() == "true"
payload = json.loads(sys.argv[3])
items = payload if isinstance(payload, list) else payload.get("instances", [])
for item in items:
    if bool(item.get(field)) == desired:
        continue
    item[field] = desired
    print(f"{item['id']}\t{json.dumps(item, separators=(',', ':'))}")
PY
)"

    if [[ -z "$updates" ]]; then
        ok "$label Sonarr defaults already follow the season-folder policy"
        return 0
    fi

    count=0
    while IFS=$'\t' read -r id payload; do
        [[ "$id" =~ ^[0-9]+$ && -n "$payload" ]] || continue
        curl -fsS -X PUT "$base_url$endpoint/$id" \
            -H "X-Api-Key: $api_key" \
            -H "Content-Type: application/json" \
            --data "$payload" >/dev/null || {
            warn "$label Sonarr default $id could not be updated"
            return 1
        }
        count=$((count + 1))
    done <<<"$updates"

    ok "$label season-folder policy applied to $count Sonarr default(s)"
}

apply_request_manager_season_folder_policies() {
    if optional_service_enabled pulsarr; then
        reconcile_request_manager_season_folders \
            "Pulsarr" "$PULSARR_URL" "/v1/sonarr/instances" "$PULSARR_API_KEY" "createSeasonFolders" || true
    fi
    if optional_service_enabled agregarr; then
        reconcile_request_manager_season_folders \
            "Agregarr" "$AGREGARR_URL" "/api/v1/settings/sonarr" "$AGREGARR_API_KEY" "enableSeasonFolders" || true
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
    reconcile_servarr_series_season_folders "Sonarr" "$SONARR_URL" "$sonarr_key" || true
    reconcile_servarr_series_season_folders "Sonarr 4K" "$SONARR_4K_URL" "$sonarr4k_key" || true
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
    PULSARR_URL="$(service_url pulsarr "$PULSARR_URL" "${PULSARR_PORT:-3003}")"
    AGREGARR_URL="$(service_url agregarr "$AGREGARR_URL" "${AGREGARR_PORT:-7171}")"

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
            apply_request_manager_season_folder_policies
            ;;
        *)
            usage
            fail "Unknown naming subcommand: $cmd"
            ;;
    esac
}

main "$@"
