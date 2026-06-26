#!/bin/bash
set -euo pipefail

ROOT_DIR="$(cd "$(dirname "$0")/.." && pwd)"
# shellcheck source=lib/common.sh
source "$ROOT_DIR/lib/common.sh"

REQUESTS_CONFIG_FILE="${STACKARR_REQUESTS_CONFIG_FILE:-$ROOT_DIR/config/requests.json}"
SEERR_URL=""

usage() {
    cat <<'EOF'
Usage:
  stackarr requests apply [--wait]
  stackarr requests clear [--wait]
EOF
}

require_requests_config() {
    [[ -f "$REQUESTS_CONFIG_FILE" ]] || fail "Requests config missing at $REQUESTS_CONFIG_FILE"
}

read_seerr_api_key() {
    python3 - "$CONFIG_ROOT/seerr/settings.json" <<'PY'
import json
import os
import sys
from pathlib import Path

path = Path(sys.argv[1])
if not path.exists():
    raise SystemExit(1)

data = json.loads(path.read_text(encoding="utf-8"))
api_key = data.get("main", {}).get("apiKey", "")
if api_key:
    print(api_key)
    raise SystemExit(0)

raise SystemExit(1)
PY
}

wait_for_api() {
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

    warn "$label endpoint is not ready yet"
    return 1
}

build_seerr_main_payload() {
    local current_json="$1"

    python3 - "$REQUESTS_CONFIG_FILE" "$current_json" <<'PY'
import json
import os
import sys

with open(sys.argv[1], "r", encoding="utf-8") as fh:
    config = json.load(fh)

current = json.loads(sys.argv[2])
global_cfg = config.get("seerr", {}).get("global", {})

for key in ("hideAvailable", "hideBlocklisted", "partialRequestsEnabled", "enableSpecialEpisodes"):
    if key in global_cfg:
        current[key] = bool(global_cfg[key])

print(json.dumps(current, separators=(",", ":")))
PY
}

build_seerr_service_payload() {
    local kind="$1"
    local current_json="$2"

python3 - "$REQUESTS_CONFIG_FILE" "$kind" "$current_json" <<'PY'
import json
import os
import sys

with open(sys.argv[1], "r", encoding="utf-8") as fh:
    config = json.load(fh)

kind = sys.argv[2]
current = json.loads(sys.argv[3])
settings = config.get("seerr", {}).get(kind, {})

if kind == "movies":
    default_service = os.environ.get("STACKARR_MOVIE_DEFAULT_PROFILE") or settings.get("defaultService", "")
    default_4k_service = os.environ.get("STACKARR_MOVIE_4K_DEFAULT_PROFILE") or settings.get("default4kService", "")
else:
    default_service = os.environ.get("STACKARR_TV_DEFAULT_PROFILE") or settings.get("defaultService", "")
    default_4k_service = os.environ.get("STACKARR_TV_4K_DEFAULT_PROFILE") or settings.get("default4kService", "")
sync_enabled = bool(settings.get("syncEnabled", True))
prevent_search = bool(settings.get("preventSearch", False))

for item in current:
    item["syncEnabled"] = sync_enabled
    item["preventSearch"] = prevent_search

    if item.get("is4k"):
        item["isDefault"] = item.get("name") == default_4k_service
    else:
        item["isDefault"] = item.get("name") == default_service

    if kind == "movies" and "minimumAvailability" in settings:
        item["minimumAvailability"] = settings["minimumAvailability"]

    if kind == "tv" and "enableSeasonFolders" in settings:
        item["enableSeasonFolders"] = bool(settings["enableSeasonFolders"])

print(json.dumps(current, separators=(",", ":")))
PY
}

apply_seerr_main_preset() {
    local api_key="$1"
    local current payload

    current="$(curl -fsS "$SEERR_URL/api/v1/settings/main" -H "X-Api-Key: $api_key" 2>/dev/null)" || {
        warn "Seerr main settings could not be read"
        return 1
    }

    payload="$(build_seerr_main_payload "$current")"
    if [[ "$payload" == "$current" ]]; then
        warn "Seerr global request settings already configured"
        return 0
    fi

    curl -fsS -X POST "$SEERR_URL/api/v1/settings/main" \
        -H "X-Api-Key: $api_key" \
        -H "Content-Type: application/json" \
        --data "$payload" >/dev/null || {
        warn "Seerr global request settings could not be updated"
        return 1
    }

    ok "Seerr global request settings applied"
}

apply_seerr_service_group() {
    local label="$1"
    local api_key="$2"
    local endpoint="$3"
    local kind="$4"
    local current payload ids

    current="$(curl -fsS "$SEERR_URL/api/v1/settings/$endpoint" -H "X-Api-Key: $api_key" 2>/dev/null)" || {
        warn "$label could not be read"
        return 1
    }

    payload="$(build_seerr_service_payload "$kind" "$current")"
    if [[ "$payload" == "$current" ]]; then
        warn "$label already configured"
        return 0
    fi

    ids="$(python3 - "$payload" <<'PY'
import json
import sys

for item in json.loads(sys.argv[1]):
    print(item["id"])
PY
)"

    while IFS= read -r id; do
        [[ -n "$id" ]] || continue
        curl -fsS -X PUT "$SEERR_URL/api/v1/settings/$endpoint/$id" \
            -H "X-Api-Key: $api_key" \
            -H "Content-Type: application/json" \
            --data "$(python3 - "$payload" "$id" <<'PY'
import json
import sys

items = json.loads(sys.argv[1])
target_id = int(sys.argv[2])
target = next(item for item in items if item.get("id") == target_id)
print(json.dumps(target, separators=(",", ":")))
PY
)" >/dev/null || {
            warn "$label item $id could not be updated"
            return 1
        }
    done <<<"$ids"

    ok "$label applied"
}

clear_seerr_service_group() {
    local label="$1"
    local api_key="$2"
    local endpoint="$3"
    local current ids

    current="$(curl -fsS "$SEERR_URL/api/v1/settings/$endpoint" -H "X-Api-Key: $api_key" 2>/dev/null)" || {
        warn "$label could not be read"
        return 1
    }

    ids="$(python3 - "$current" <<'PY'
import json
import sys

for item in json.loads(sys.argv[1]):
    item_id = item.get("id")
    if item_id is not None:
        print(item_id)
PY
)"

    if [[ -z "$ids" ]]; then
        warn "$label already empty"
        return 0
    fi

    while IFS= read -r id; do
        [[ -n "$id" ]] || continue
        curl -fsS -X DELETE "$SEERR_URL/api/v1/settings/$endpoint/$id" \
            -H "X-Api-Key: $api_key" >/dev/null || {
            warn "$label item $id could not be removed"
            return 1
        }
    done <<<"$ids"

    ok "$label cleared"
}

apply_requests_preset() {
    local wait_for_ready="$1"
    local seerr_key

    if ! optional_service_enabled seerr; then
        warn "Requests preset skipped because Seerr is disabled"
        return 0
    fi

    seerr_key="$(read_seerr_api_key || true)"
    [[ -n "$seerr_key" ]] || {
        warn "Requests preset skipped because the Seerr API key is not available yet"
        return 0
    }

    if [[ "$wait_for_ready" == "true" ]]; then
        wait_for_http "Seerr" "$SEERR_URL"
        wait_for_api "$SEERR_URL/api/v1/settings/main" "$seerr_key" "Seerr" || return 1
    fi

    apply_seerr_main_preset "$seerr_key" || true
    apply_seerr_service_group "Seerr movie request services" "$seerr_key" "radarr" "movies" || true
    apply_seerr_service_group "Seerr TV request services" "$seerr_key" "sonarr" "tv" || true
}

clear_requests_preset() {
    local wait_for_ready="$1"
    local seerr_key

    if ! optional_service_enabled seerr; then
        warn "Requests clear skipped because Seerr is disabled"
        return 0
    fi

    seerr_key="$(read_seerr_api_key || true)"
    [[ -n "$seerr_key" ]] || {
        warn "Requests clear skipped because the Seerr API key is not available yet"
        return 0
    }

    if [[ "$wait_for_ready" == "true" ]]; then
        wait_for_http "Seerr" "$SEERR_URL"
        wait_for_api "$SEERR_URL/api/v1/settings/main" "$seerr_key" "Seerr" || return 1
    fi

    clear_seerr_service_group "Seerr movie request services" "$seerr_key" "radarr" || true
    clear_seerr_service_group "Seerr TV request services" "$seerr_key" "sonarr" || true
}

main() {
    local cmd="${1:-apply}"
    local wait_for_ready="false"

    shift || true

    while (($#)); do
        case "$1" in
            --wait)
                wait_for_ready="true"
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

    load_env
    SEERR_URL="$(service_url seerr "$SEERR_URL" 5055)"

    case "$cmd" in
        apply)
            require_requests_config
            apply_requests_preset "$wait_for_ready"
            ;;
        clear)
            clear_requests_preset "$wait_for_ready"
            ;;
        *)
            usage
            fail "Unknown requests subcommand: $cmd"
            ;;
    esac
}

main "$@"
