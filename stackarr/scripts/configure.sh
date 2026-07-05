#!/bin/bash
set -euo pipefail

ROOT_DIR="$(cd "$(dirname "$0")/.." && pwd)"
# shellcheck source=lib/common.sh
source "$ROOT_DIR/lib/common.sh"

FORCE=false
case "${1:-}" in
    "")
        ;;
    --force)
        FORCE=true
        ;;
    *)
        fail "Usage: stackarr configure [--force]"
        ;;
esac

load_env
ensure_docker_runtime
ensure_dir "$STATE_ROOT"
DONE_FILE="$STATE_ROOT/configure.done"
TORRENT_ARCHIVE_HOOK_SOURCE="$ROOT_DIR/scripts/hooks/archive-torrent.sh"
TORRENT_ARCHIVE_HOOK_DEST="$CONFIG_ROOT/hooks/archive-torrent.sh"

if [[ -f "$DONE_FILE" && "$FORCE" != true ]]; then
    warn "Configuration already completed. Use --force to re-run."
    exit 0
fi

print_header "Stackarr Configure"

RADARR_URL="$(service_url radarr "$RADARR_URL" 7878)"
RADARR_4K_URL="$(service_url radarr4k "$RADARR_4K_URL" 7879)"
SONARR_URL="$(service_url sonarr "$SONARR_URL" 8989)"
SONARR_4K_URL="$(service_url sonarr4k "$SONARR_4K_URL" 8990)"
PROWLARR_URL="$(service_url prowlarr "$PROWLARR_URL" 9696)"
LIDARR_URL="$(service_url lidarr "$LIDARR_URL" 8686)"
BAZARR_URL="$(service_url bazarr "$BAZARR_URL" 6767)"
SEERR_URL="$(service_url seerr "$SEERR_URL" 5055)"
PULSARR_URL="$(service_url pulsarr "$PULSARR_URL" "${PULSARR_PORT:-3003}")"
MAINTAINERR_URL="$(service_url maintainerr "$MAINTAINERR_URL" "${MAINTAINERR_PORT:-6246}")"
TRACEARR_URL="$(service_url tracearr "$TRACEARR_URL" "${TRACEARR_PORT:-3000}")"
ROMM_URL="$(service_url romm "${ROMM_URL:-http://127.0.0.1:${ROMM_WEB_PORT:-7583}}" "${ROMM_WEB_PORT:-7583}")"
FLARESOLVERR_URL="$(service_url flaresolverr "${FLARESOLVERR_URL:-http://127.0.0.1:8191}" 8191)"
TRANSMISSION_URL="$(service_url transmission "$TRANSMISSION_URL" 9091)/transmission/web/"
QBITTORRENT_URL="$(service_url qbittorrent "$QBITTORRENT_URL" "${QBITTORRENT_WEBUI_PORT:-8081}")"

preferred_torrent_client() {
    case "${PREFERRED_TORRENT_CLIENT:-transmission}" in
        qbittorrent|qbit|qb)
            printf 'qbittorrent\n'
            ;;
        *)
            printf 'transmission\n'
            ;;
    esac
}

torrent_client_priority() {
    local client="$1"

    if [[ "$client" == "$(preferred_torrent_client)" ]]; then
        printf '1\n'
    else
        printf '2\n'
    fi
}

wait_for_api_key() {
    local name="$1"
    local file="$2"
    local attempts="${3:-45}"
    local attempt=1
    local key=""

    while [[ "$attempt" -le "$attempts" ]]; do
        key="$(parse_api_key_xml "$file" || true)"
        if [[ -n "$key" ]]; then
            printf '%s\n' "$key"
            return 0
        fi
        sleep 2
        attempt=$((attempt + 1))
    done

    fail "Could not read $name API key from $file"
}

read_seerr_api_key() {
    local file="$CONFIG_ROOT/seerr/settings.json"

    [[ -f "$file" ]] || return 1

    python3 - "$file" <<'PY'
import json
import sys
from pathlib import Path

data = json.loads(Path(sys.argv[1]).read_text())
key = ((data.get("main") or {}).get("apiKey") or "").strip()
if key:
    print(key)
PY
}

native_plex_setting_value_from_xml() {
    local xml="$1"
    local setting_id="$2"

    python3 - "$setting_id" "$xml" <<'PY'
import sys
import xml.etree.ElementTree as ET

setting_id = sys.argv[1]
xml = sys.argv[2]
root = ET.fromstring(xml)

for node in root.findall("Setting"):
    if node.get("id") == setting_id:
        print(node.get("value", ""))
        break
PY
}

native_plex_summary_from_root_xml() {
    local xml="$1"

    python3 - "$xml" <<'PY'
import sys
import xml.etree.ElementTree as ET

xml = sys.argv[1]
root = ET.fromstring(xml)
for key in ("machineIdentifier", "platform", "platformVersion", "version"):
    print(f"{key}={root.get(key, '')}")
PY
}

native_plex_summary_from_cloud_xml() {
    local xml="$1"
    local machine_identifier="$2"

    python3 - "$machine_identifier" "$xml" <<'PY'
import sys
import xml.etree.ElementTree as ET

machine_identifier = sys.argv[1]
xml = sys.argv[2]
root = ET.fromstring(xml)

for node in root.findall("Device"):
    provides = [item.strip() for item in (node.get("provides") or "").split(",") if item.strip()]
    if node.get("clientIdentifier") == machine_identifier and "server" in provides:
        for key in ("clientIdentifier", "platform", "platformVersion", "productVersion"):
            print(f"{key}={node.get(key, '')}")
        break
PY
}

summary_field() {
    local summary="$1"
    local key="$2"

    printf '%s\n' "$summary" | sed -n "s/^${key}=//p" | head -1
}

configure_native_plex_publish_state() {
    local token prefs_xml root_xml cloud_xml
    local current_interface desired_interface publish_enabled manual_mode manual_port
    local interface_updated should_refresh
    local local_summary cloud_summary
    local local_machine local_platform local_platform_version local_version
    local cloud_platform cloud_platform_version cloud_version

    token="$(read_native_plex_pref "PlexOnlineToken" || true)"
    if [[ -z "$token" ]]; then
        warn "Native Plex publish refresh skipped because PlexOnlineToken is missing"
        return 0
    fi

    prefs_xml="$(curl -fsS "http://127.0.0.1:32400/:/prefs?X-Plex-Token=$token" 2>/dev/null || true)"
    if [[ -z "$prefs_xml" ]]; then
        warn "Native Plex publish refresh skipped because the native Plex API is not reachable on localhost:32400"
        return 0
    fi

    current_interface="$(native_plex_setting_value_from_xml "$prefs_xml" "PreferredNetworkInterface")"
    desired_interface="$(default_route_interface || true)"
    interface_updated=false

    if [[ -n "$desired_interface" ]] && ! is_virtual_network_interface "$desired_interface"; then
        if [[ -z "$current_interface" ]] || is_virtual_network_interface "$current_interface"; then
            if curl -fsS -X PUT "http://127.0.0.1:32400/:/prefs?PreferredNetworkInterface=$desired_interface&X-Plex-Token=$token" >/dev/null 2>&1; then
                ok "Native Plex preferred network interface set to $desired_interface"
                interface_updated=true
                prefs_xml="$(curl -fsS "http://127.0.0.1:32400/:/prefs?X-Plex-Token=$token" 2>/dev/null || printf '%s' "$prefs_xml")"
            else
                warn "Could not set native Plex preferred network interface to $desired_interface"
            fi
        fi
    fi

    publish_enabled="$(native_plex_setting_value_from_xml "$prefs_xml" "PublishServerOnPlexOnlineKey")"
    manual_mode="$(native_plex_setting_value_from_xml "$prefs_xml" "ManualPortMappingMode")"
    manual_port="$(native_plex_setting_value_from_xml "$prefs_xml" "ManualPortMappingPort")"

    root_xml="$(curl -fsS "http://127.0.0.1:32400/?X-Plex-Token=$token" 2>/dev/null || true)"
    if [[ -z "$root_xml" ]]; then
        warn "Native Plex publish verification skipped because the native Plex root endpoint is not reachable"
        return 0
    fi

    local_summary="$(native_plex_summary_from_root_xml "$root_xml")"
    local_machine="$(summary_field "$local_summary" "machineIdentifier")"
    local_platform="$(summary_field "$local_summary" "platform")"
    local_platform_version="$(summary_field "$local_summary" "platformVersion")"
    local_version="$(summary_field "$local_summary" "version")"

    cloud_xml="$(curl -fsS "https://plex.tv/api/resources?includeHttps=1" -H "X-Plex-Token: $token" 2>/dev/null || true)"
    if [[ -z "$cloud_xml" ]]; then
        warn "Native Plex cloud verification skipped because plex.tv could not be reached"
        return 0
    fi

    cloud_summary="$(native_plex_summary_from_cloud_xml "$cloud_xml" "$local_machine")"
    cloud_platform="$(summary_field "$cloud_summary" "platform")"
    cloud_platform_version="$(summary_field "$cloud_summary" "platformVersion")"
    cloud_version="$(summary_field "$cloud_summary" "productVersion")"

    should_refresh="$interface_updated"
    if [[ -z "$cloud_summary" || "$cloud_platform" != "$local_platform" || "$cloud_platform_version" != "$local_platform_version" || "$cloud_version" != "$local_version" ]]; then
        should_refresh=true
    fi

    if [[ "$should_refresh" != true ]]; then
        ok "Native Plex published server metadata matches the live server"
        return 0
    fi

    if [[ "$publish_enabled" != "1" ]]; then
        warn "Native Plex publish verification found a mismatch, but Plex publishing is disabled"
        return 0
    fi

    if ! curl -fsS -X PUT "http://127.0.0.1:32400/:/prefs?PublishServerOnPlexOnlineKey=0&X-Plex-Token=$token" >/dev/null 2>&1; then
        warn "Could not temporarily unpublish the native Plex server to refresh cloud metadata"
        return 0
    fi

    if [[ "$manual_mode" == "1" && -n "$manual_port" ]]; then
        curl -fsS -X PUT "http://127.0.0.1:32400/:/prefs?ManualPortMappingMode=1&ManualPortMappingPort=$manual_port&X-Plex-Token=$token" >/dev/null 2>&1 || true
    fi

    if ! curl -fsS -X PUT "http://127.0.0.1:32400/:/prefs?PublishServerOnPlexOnlineKey=1&X-Plex-Token=$token" >/dev/null 2>&1; then
        warn "Could not republish the native Plex server after refreshing cloud metadata"
        return 0
    fi

    sleep 2
    cloud_xml="$(curl -fsS "https://plex.tv/api/resources?includeHttps=1" -H "X-Plex-Token: $token" 2>/dev/null || true)"
    if [[ -z "$cloud_xml" ]]; then
        warn "Native Plex publish refresh completed, but cloud verification could not be re-checked"
        return 0
    fi

    cloud_summary="$(native_plex_summary_from_cloud_xml "$cloud_xml" "$local_machine")"
    cloud_platform="$(summary_field "$cloud_summary" "platform")"
    cloud_platform_version="$(summary_field "$cloud_summary" "platformVersion")"
    cloud_version="$(summary_field "$cloud_summary" "productVersion")"

    if [[ -n "$cloud_summary" && "$cloud_platform" == "$local_platform" && "$cloud_platform_version" == "$local_platform_version" && "$cloud_version" == "$local_version" ]]; then
        ok "Native Plex published server metadata refreshed"
    else
        warn "Native Plex cloud metadata still differs from the live server after refresh"
    fi
}

api_post_json() {
    local label="$1"
    local url="$2"
    local api_key="$3"
    local payload="$4"
    local body http_code

    if [[ -z "$api_key" ]]; then
        warn "$label skipped because the API key is unavailable"
        return 0
    fi

    body="$(mktemp)"
    http_code="$(curl -sS -o "$body" -w '%{http_code}' -H 'Content-Type: application/json' -H "X-Api-Key: $api_key" -d "$payload" "$url" || echo 000)"

    if [[ "$http_code" =~ ^2 ]]; then
        ok "$label"
        rm -f "$body"
        return 0
    fi

    if grep -qiE 'already exists|already configured as a root folder|duplicate|must be unique|should be unique|has already been taken' "$body"; then
        warn "$label already configured"
        rm -f "$body"
        return 0
    fi

    warn "$label failed (HTTP $http_code)"
    rm -f "$body"
    return 1
}

trigger_prowlarr_sync() {
    local body http_code

    body="$(mktemp)"
    http_code="$(curl -sS -o "$body" -w '%{http_code}' -H 'Content-Type: application/json' -H "X-Api-Key: $PROWLARR_KEY" -d '{"name":"ApplicationIndexerSync"}' "$PROWLARR_URL/api/v1/command" || echo 000)"

    if [[ "$http_code" =~ ^2 ]]; then
        ok "Prowlarr app indexer sync triggered"
        rm -f "$body"
        return 0
    fi

    if grep -qi 'Sequence contains no matching element' "$body"; then
        warn "Prowlarr app indexer sync skipped because Prowlarr is not ready for application syncing yet"
        rm -f "$body"
        return 0
    fi

    warn "Prowlarr app indexer sync failed (HTTP $http_code)"
    rm -f "$body"
    return 1
}

api_put_json() {
    local label="$1"
    local url="$2"
    local api_key="$3"
    local payload="$4"
    local body http_code

    if [[ -z "$api_key" ]]; then
        warn "$label skipped because the API key is unavailable"
        return 0
    fi

    body="$(mktemp)"
    http_code="$(curl -sS -o "$body" -w '%{http_code}' -X PUT -H 'Content-Type: application/json' -H "X-Api-Key: $api_key" -d "$payload" "$url" || echo 000)"

    if [[ "$http_code" =~ ^2 ]]; then
        ok "$label"
        rm -f "$body"
        return 0
    fi

    warn "$label failed (HTTP $http_code)"
    rm -f "$body"
    return 1
}

api_delete() {
    local label="$1"
    local url="$2"
    local api_key="$3"
    local body http_code

    if [[ -z "$api_key" ]]; then
        warn "$label skipped because the API key is unavailable"
        return 0
    fi

    body="$(mktemp)"
    http_code="$(curl -sS -o "$body" -w '%{http_code}' -X DELETE -H "X-Api-Key: $api_key" "$url" || echo 000)"

    if [[ "$http_code" =~ ^2 ]]; then
        ok "$label"
        rm -f "$body"
        return 0
    fi

    warn "$label failed (HTTP $http_code)"
    rm -f "$body"
    return 1
}

first_json_id() {
    grep -o '"id"[[:space:]]*:[[:space:]]*[0-9]*' | head -1 | grep -o '[0-9]*'
}

json_has_string() {
    local url="$1"
    local api_key="$2"
    local pattern="$3"

    curl -fsS "$url" -H "X-Api-Key: $api_key" 2>/dev/null | grep -Fq "$pattern"
}

ensure_root_folder() {
    local label="$1"
    local list_url="$2"
    local create_url="$3"
    local api_key="$4"
    local path="$5"
    local payload="$6"

    if json_has_string "$list_url" "$api_key" "\"path\": \"$path\"" || json_has_string "$list_url" "$api_key" "\"path\":\"$path\""; then
        warn "$label already configured"
        return 0
    fi

    api_post_json "$label" "$create_url" "$api_key" "$payload" || true
}

json_id_by_name() {
    local url="$1"
    local api_key="$2"
    local target_name="$3"
    local current

    current="$(curl -fsS "$url" -H "X-Api-Key: $api_key" 2>/dev/null)" || return 1
    python3 - "$target_name" "$current" <<'PY'
import json
import sys

target = sys.argv[1]
data = json.loads(sys.argv[2])
for item in data:
    if item.get("name") == target:
        print(item.get("id", ""))
        break
PY
}

json_name_by_id() {
    local url="$1"
    local api_key="$2"
    local target_id="$3"
    local current

    current="$(curl -fsS "$url" -H "X-Api-Key: $api_key" 2>/dev/null)" || return 1
    python3 - "$target_id" "$current" <<'PY'
import json
import sys

target = int(sys.argv[1])
data = json.loads(sys.argv[2])
for item in data:
    if item.get("id") == target:
        print(item.get("name", ""))
        break
PY
}

profile_id_by_names() {
    local url="$1"
    local api_key="$2"
    shift 2
    local name profile_id

    for name in "$@"; do
        profile_id="$(json_id_by_name "$url" "$api_key" "$name" || true)"
        if [[ -n "$profile_id" ]]; then
            printf '%s\n' "$profile_id"
            return 0
        fi
    done

    return 1
}

ensure_lidarr_metadata_profile() {
    local label="$1"
    local list_url="$2"
    local create_url="$3"
    local update_base_url="$4"
    local api_key="$5"
    local source_name="$6"
    local target_name="$7"
    local current result action profile_id payload

    if [[ -z "$api_key" ]]; then
        warn "$label skipped because the API key is unavailable"
        return 0
    fi

    current="$(curl -fsS "$list_url" -H "X-Api-Key: $api_key" 2>/dev/null)" || {
        warn "$label failed because metadata profiles could not be read"
        return 1
    }

    result="$(python3 - "$source_name" "$target_name" "$current" <<'PY'
import copy
import json
import sys

source_name = sys.argv[1]
target_name = sys.argv[2]
profiles = json.loads(sys.argv[3])

source = next((profile for profile in profiles if profile.get("name") == source_name), None) or (profiles[0] if profiles else None)
if source is None:
    print("missing_source")
    print("")
    print("")
    raise SystemExit(0)

target = next((profile for profile in profiles if profile.get("name") == target_name), None)
payload = copy.deepcopy(target if target is not None else source)
existing = copy.deepcopy(target) if target is not None else None
payload["name"] = target_name

allowed_primary = {"Album", "EP", "Single"}
for item in payload.get("primaryAlbumTypes", []):
    item["allowed"] = item.get("albumType", {}).get("name") in allowed_primary

for item in payload.get("secondaryAlbumTypes", []):
    item["allowed"] = item.get("albumType", {}).get("name") == "Studio"
for item in payload.get("releaseStatuses", []):
    item["allowed"] = item.get("releaseStatus", {}).get("name") == "Official"

action = "create"
profile_id = ""
if target is not None:
    profile_id = str(target.get("id", ""))
    action = "update" if payload != existing else "unchanged"
    payload["id"] = target.get("id")
else:
    payload.pop("id", None)

print(action)
print(profile_id)
print(json.dumps(payload, separators=(",", ":")))
PY
)"

    action="$(printf '%s
' "$result" | sed -n '1p')"
    profile_id="$(printf '%s
' "$result" | sed -n '2p')"
    payload="$(printf '%s
' "$result" | sed -n '3p')"

    case "$action" in
        create) api_post_json "$label" "$create_url" "$api_key" "$payload" || true ;;
        update)
            if [[ -z "$profile_id" ]]; then
                warn "$label failed because the existing metadata profile ID is missing"
                return 1
            fi
            api_put_json "$label" "$update_base_url/$profile_id" "$api_key" "$payload" || true
            ;;
        unchanged) warn "$label already configured" ;;
        missing_source) warn "$label skipped because source metadata profile '$source_name' is missing" ;;
        *) warn "$label failed while building the metadata profile payload"; return 1 ;;
    esac
}

ensure_quality_profile_variant() {
    local label="$1"
    local list_url="$2"
    local create_url="$3"
    local update_base_url="$4"
    local api_key="$5"
    local source_name="$6"
    local target_name="$7"
    local allowed_names_csv="$8"
    local current result action profile_id payload

    current="$(curl -fsS "$list_url" -H "X-Api-Key: $api_key" 2>/dev/null)" || {
        warn "$label failed because quality profiles could not be read"
        return 1
    }

    result="$(python3 - "$source_name" "$target_name" "$allowed_names_csv" "$current" <<'PY'
import copy
import json
import sys

source_name = sys.argv[1]
target_name = sys.argv[2]
allowed_names = {name.strip() for name in sys.argv[3].split(",") if name.strip()}
profiles = json.loads(sys.argv[4])

source = next((profile for profile in profiles if profile.get("name") == source_name), None)
if source is None:
    print("missing_source")
    print("")
    print("")
    raise SystemExit(0)

target = next((profile for profile in profiles if profile.get("name") == target_name), None)
payload = copy.deepcopy(target if target is not None else source)
existing = copy.deepcopy(target) if target is not None else None

payload["name"] = target_name
payload["upgradeAllowed"] = True

cutoff = None
for item in payload.get("items", []):
    item_name = item.get("quality", {}).get("name") or item.get("name") or ""
    child_items = item.get("items") or []

    if child_items:
        any_child_allowed = False
        first_allowed_child_id = None
        for child in child_items:
            child_name = child.get("quality", {}).get("name") or child.get("name") or ""
            child_allowed = item_name in allowed_names or child_name in allowed_names
            child["allowed"] = child_allowed
            if child_allowed:
                any_child_allowed = True
                if first_allowed_child_id is None:
                    first_allowed_child_id = child.get("quality", {}).get("id")

        item["allowed"] = any_child_allowed
        if first_allowed_child_id is not None:
            cutoff = item.get("id") or first_allowed_child_id
    else:
        allowed = item_name in allowed_names
        item["allowed"] = allowed
        if allowed and item.get("quality", {}).get("id") is not None:
            cutoff = item["quality"]["id"]

if cutoff is not None:
    payload["cutoff"] = cutoff

action = "create"
profile_id = ""
if target is not None:
    profile_id = str(target.get("id", ""))
    action = "update" if payload != existing else "unchanged"
    payload["id"] = target.get("id")
else:
    payload.pop("id", None)

print(action)
print(profile_id)
print(json.dumps(payload, separators=(",", ":")))
PY
)"

    action="$(printf '%s\n' "$result" | sed -n '1p')"
    profile_id="$(printf '%s\n' "$result" | sed -n '2p')"
    payload="$(printf '%s\n' "$result" | sed -n '3p')"

    case "$action" in
        create)
            api_post_json "$label" "$create_url" "$api_key" "$payload" || true
            ;;
        update)
            if [[ -z "$profile_id" ]]; then
                warn "$label failed because the existing profile ID is missing"
                return 1
            fi
            api_put_json "$label" "$update_base_url/$profile_id" "$api_key" "$payload" || true
            ;;
        unchanged)
            warn "$label already configured"
            ;;
        missing_source)
            warn "$label skipped because source profile '$source_name' is missing"
            ;;
        *)
            warn "$label failed while building the quality profile payload"
            return 1
            ;;
    esac
}

ensure_custom_format_release_group() {
    local label="$1"
    local list_url="$2"
    local create_url="$3"
    local update_base_url="$4"
    local api_key="$5"
    local target_name="$6"
    local regex="$7"
    local include_in_rename="${8:-false}"
    local current result action format_id payload

    if [[ -z "$api_key" ]]; then
        warn "$label skipped because the API key is unavailable"
        return 0
    fi

    current="$(curl -fsS "$list_url" -H "X-Api-Key: $api_key" 2>/dev/null)" || {
        warn "$label failed because custom formats could not be read"
        return 1
    }

    result="$(python3 - "$target_name" "$regex" "$include_in_rename" "$current" <<'PY'
import json
import sys

target_name = sys.argv[1]
regex = sys.argv[2]
include_in_rename = sys.argv[3].lower() == "true"
formats = json.loads(sys.argv[4])

payload = {
    "name": target_name,
    "includeCustomFormatWhenRenaming": include_in_rename,
    "specifications": [
        {
            "name": target_name,
            "implementation": "ReleaseGroupSpecification",
            "implementationName": "Release Group",
            "infoLink": "https://wiki.servarr.com/radarr/settings#custom-formats-2",
            "negate": False,
            "required": True,
            "fields": [
                {
                    "order": 0,
                    "name": "value",
                    "label": "Regular Expression",
                    "helpText": "Custom Format RegEx is Case Insensitive",
                    "value": regex,
                    "type": "textbox",
                    "advanced": False,
                    "privacy": "normal",
                    "isFloat": False,
                }
            ],
        }
    ],
}

existing = next((item for item in formats if item.get("name") == target_name), None)
if existing is None:
    print("create")
    print("")
    print(json.dumps(payload, separators=(",", ":")))
    raise SystemExit(0)

payload["id"] = existing.get("id")
print("update" if payload != existing else "unchanged")
print(existing.get("id", ""))
print(json.dumps(payload, separators=(",", ":")))
PY
)"

    action="$(printf '%s\n' "$result" | sed -n '1p')"
    format_id="$(printf '%s\n' "$result" | sed -n '2p')"
    payload="$(printf '%s\n' "$result" | sed -n '3p')"

    case "$action" in
        create)
            api_post_json "$label" "$create_url" "$api_key" "$payload" || true
            ;;
        update)
            if [[ -z "$format_id" ]]; then
                warn "$label failed because the existing custom format ID is missing"
                return 1
            fi
            api_put_json "$label" "$update_base_url/$format_id" "$api_key" "$payload" || true
            ;;
        unchanged)
            warn "$label already configured"
            ;;
        *)
            warn "$label failed while building the custom format payload"
            return 1
            ;;
    esac
}

ensure_custom_format_release_title() {
    local label="$1"
    local list_url="$2"
    local create_url="$3"
    local update_base_url="$4"
    local api_key="$5"
    local target_name="$6"
    local regex="$7"
    local negate="${8:-false}"
    local include_in_rename="${9:-false}"
    local current result action format_id payload

    if [[ -z "$api_key" ]]; then
        warn "$label skipped because the API key is unavailable"
        return 0
    fi

    current="$(curl -fsS "$list_url" -H "X-Api-Key: $api_key" 2>/dev/null)" || {
        warn "$label failed because custom formats could not be read"
        return 1
    }

    result="$(python3 - "$target_name" "$regex" "$negate" "$include_in_rename" "$current" <<'PY'
import json
import sys

target_name = sys.argv[1]
regex = sys.argv[2]
negate = sys.argv[3].lower() == "true"
include_in_rename = sys.argv[4].lower() == "true"
formats = json.loads(sys.argv[5])

payload = {
    "name": target_name,
    "includeCustomFormatWhenRenaming": include_in_rename,
    "specifications": [
        {
            "name": target_name,
            "implementation": "ReleaseTitleSpecification",
            "implementationName": "Release Title",
            "infoLink": "https://wiki.servarr.com/sonarr/settings#custom-formats",
            "negate": negate,
            "required": True,
            "fields": [
                {
                    "order": 0,
                    "name": "value",
                    "label": "Regular Expression",
                    "helpText": "Custom Format RegEx is Case Insensitive",
                    "value": regex,
                    "type": "textbox",
                    "advanced": False,
                    "privacy": "normal",
                    "isFloat": False,
                }
            ],
        }
    ],
}

existing = next((item for item in formats if item.get("name") == target_name), None)
if existing is None:
    print("create")
    print("")
    print(json.dumps(payload, separators=(",", ":")))
    raise SystemExit(0)

payload["id"] = existing.get("id")
print("update" if payload != existing else "unchanged")
print(existing.get("id", ""))
print(json.dumps(payload, separators=(",", ":")))
PY
)"

    action="$(printf '%s\n' "$result" | sed -n '1p')"
    format_id="$(printf '%s\n' "$result" | sed -n '2p')"
    payload="$(printf '%s\n' "$result" | sed -n '3p')"

    case "$action" in
        create)
            api_post_json "$label" "$create_url" "$api_key" "$payload" || true
            ;;
        update)
            if [[ -z "$format_id" ]]; then
                warn "$label failed because the existing custom format ID is missing"
                return 1
            fi
            api_put_json "$label" "$update_base_url/$format_id" "$api_key" "$payload" || true
            ;;
        unchanged)
            warn "$label already configured"
            ;;
        *)
            warn "$label failed while building the custom format payload"
            return 1
            ;;
    esac
}

ensure_request_quality_profile() {
    local label="$1"
    local list_url="$2"
    local create_url="$3"
    local update_base_url="$4"
    local custom_format_url="$5"
    local api_key="$6"
    local source_name="$7"
    local target_name="$8"
    local allowed_names_csv="$9"
    local zero_scores="${10:-false}"
    local required_format_name="${11:-}"
    local required_format_score="${12:-0}"
    local min_format_score="${13:-0}"
    local cutoff_format_score="${14:-0}"
    local current current_formats result action profile_id payload

    if [[ -z "$api_key" ]]; then
        warn "$label skipped because the API key is unavailable"
        return 0
    fi

    current="$(curl -fsS "$list_url" -H "X-Api-Key: $api_key" 2>/dev/null)" || {
        warn "$label failed because quality profiles could not be read"
        return 1
    }

    current_formats="$(curl -fsS "$custom_format_url" -H "X-Api-Key: $api_key" 2>/dev/null)" || {
        warn "$label failed because custom formats could not be read"
        return 1
    }

    result="$(python3 - "$source_name" "$target_name" "$allowed_names_csv" "$zero_scores" "$required_format_name" "$required_format_score" "$min_format_score" "$cutoff_format_score" "$current" "$current_formats" <<'PY'
import copy
import json
import sys

source_name = sys.argv[1]
target_name = sys.argv[2]
allowed_names = {name.strip() for name in sys.argv[3].split(",") if name.strip()}
zero_scores = sys.argv[4].lower() == "true"
required_format_name = sys.argv[5]
required_format_score = int(sys.argv[6] or 0)
min_format_score = int(sys.argv[7] or 0)
cutoff_format_score = int(sys.argv[8] or 0)
profiles = json.loads(sys.argv[9])
custom_formats = json.loads(sys.argv[10])

target = next((profile for profile in profiles if profile.get("name") == target_name), None)
source = next((profile for profile in profiles if profile.get("name") == source_name), None)
if source is None and target is not None:
    source = target

if source is None:
    print("missing_source")
    print("")
    print("")
    raise SystemExit(0)

payload = copy.deepcopy(source)
existing = copy.deepcopy(target) if target is not None else None

payload["name"] = target_name
payload["upgradeAllowed"] = True
if target is not None:
    payload["id"] = target.get("id")
else:
    payload.pop("id", None)

cutoff = None
for item in payload.get("items", []):
    item_name = item.get("quality", {}).get("name") or item.get("name") or ""
    child_items = item.get("items") or []

    if child_items:
        any_child_allowed = False
        first_allowed_child_id = None
        for child in child_items:
            child_name = child.get("quality", {}).get("name") or child.get("name") or ""
            child_allowed = item_name in allowed_names or child_name in allowed_names
            child["allowed"] = child_allowed
            if child_allowed:
                any_child_allowed = True
                if first_allowed_child_id is None:
                    first_allowed_child_id = child.get("quality", {}).get("id")

        item["allowed"] = any_child_allowed
        if first_allowed_child_id is not None:
            cutoff = item.get("id") or first_allowed_child_id
    else:
        allowed = item_name in allowed_names
        item["allowed"] = allowed
        if allowed and item.get("quality", {}).get("id") is not None:
            cutoff = item["quality"]["id"]

if cutoff is not None:
    payload["cutoff"] = cutoff

if zero_scores:
    for format_item in payload.get("formatItems", []):
        format_item["score"] = 0
    payload["minFormatScore"] = 0
    payload["cutoffFormatScore"] = 0
    payload["minUpgradeFormatScore"] = 1

if required_format_name:
    required_format = next((item for item in custom_formats if item.get("name") == required_format_name), None)
    if required_format is None:
        print("missing_format")
        print("")
        print("")
        raise SystemExit(0)

    existing_item = next(
        (
            item
            for item in payload.get("formatItems", [])
            if item.get("format") == required_format.get("id") or item.get("name") == required_format_name
        ),
        None,
    )
    if existing_item is None:
        payload.setdefault("formatItems", []).append(
            {
                "format": required_format.get("id"),
                "name": required_format_name,
                "score": required_format_score,
            }
        )
    else:
        existing_item["format"] = required_format.get("id")
        existing_item["name"] = required_format_name
        existing_item["score"] = required_format_score

    payload["minFormatScore"] = min_format_score
    payload["cutoffFormatScore"] = cutoff_format_score
    payload["minUpgradeFormatScore"] = max(1, min_format_score)

action = "create"
profile_id = ""
if target is not None:
    profile_id = str(target.get("id", ""))
    action = "update" if payload != existing else "unchanged"

print(action)
print(profile_id)
print(json.dumps(payload, separators=(",", ":")))
PY
)"

    action="$(printf '%s\n' "$result" | sed -n '1p')"
    profile_id="$(printf '%s\n' "$result" | sed -n '2p')"
    payload="$(printf '%s\n' "$result" | sed -n '3p')"

    case "$action" in
        create)
            api_post_json "$label" "$create_url" "$api_key" "$payload" || true
            ;;
        update)
            if [[ -z "$profile_id" ]]; then
                warn "$label failed because the existing profile ID is missing"
                return 1
            fi
            api_put_json "$label" "$update_base_url/$profile_id" "$api_key" "$payload" || true
            ;;
        unchanged)
            warn "$label already configured"
            ;;
        missing_source)
            warn "$label skipped because source profile '$source_name' is missing"
            ;;
        missing_format)
            warn "$label skipped because required custom format '$required_format_name' is missing"
            ;;
        *)
            warn "$label failed while building the request profile payload"
            return 1
            ;;
    esac
}

ensure_quality_profile_custom_formats() {
    local label="$1"
    local profile_list_url="$2"
    local profile_update_base_url="$3"
    local custom_format_url="$4"
    local api_key="$5"
    local profile_name="$6"
    local format_scores_csv="$7"
    local min_format_score="${8:-}"
    local cutoff_format_score="${9:-}"
    local min_upgrade_format_score="${10:-}"
    local current current_formats result action profile_id payload

    if [[ -z "$api_key" ]]; then
        warn "$label skipped because the API key is unavailable"
        return 0
    fi

    current="$(curl -fsS "$profile_list_url" -H "X-Api-Key: $api_key" 2>/dev/null)" || {
        warn "$label failed because quality profiles could not be read"
        return 1
    }

    current_formats="$(curl -fsS "$custom_format_url" -H "X-Api-Key: $api_key" 2>/dev/null)" || {
        warn "$label failed because custom formats could not be read"
        return 1
    }

    result="$(python3 - "$profile_name" "$format_scores_csv" "$min_format_score" "$cutoff_format_score" "$min_upgrade_format_score" "$current" "$current_formats" <<'PY'
import json
import sys

profile_name = sys.argv[1]
format_scores_csv = sys.argv[2]
min_format_score = sys.argv[3]
cutoff_format_score = sys.argv[4]
min_upgrade_format_score = sys.argv[5]
profiles = json.loads(sys.argv[6])
custom_formats = json.loads(sys.argv[7])

target = next((profile for profile in profiles if profile.get("name") == profile_name), None)
if target is None:
    print("missing_profile")
    print("")
    print("")
    raise SystemExit(0)

format_lookup = {item.get("name"): item for item in custom_formats}
desired = []
for part in format_scores_csv.split(","):
    part = part.strip()
    if not part:
        continue
    if ":" not in part:
        print("invalid_spec")
        print("")
        print("")
        raise SystemExit(0)
    name, score = part.rsplit(":", 1)
    name = name.strip()
    score = int(score.strip())
    custom_format = format_lookup.get(name)
    if custom_format is None:
        print("missing_format")
        print(name)
        print("")
        raise SystemExit(0)
    desired.append((name, custom_format.get("id"), score))

payload = json.loads(json.dumps(target))
existing = json.loads(json.dumps(target))

format_items = payload.get("formatItems") or []
by_name = {}
for item in format_items:
    item_name = item.get("name")
    if item_name:
        by_name[item_name] = item

for name, format_id, score in desired:
    item = by_name.get(name)
    if item is None:
        format_items.append({"format": format_id, "name": name, "score": score})
    else:
        item["format"] = format_id
        item["name"] = name
        item["score"] = score

payload["formatItems"] = format_items

if min_format_score != "":
    payload["minFormatScore"] = int(min_format_score)
if cutoff_format_score != "":
    payload["cutoffFormatScore"] = int(cutoff_format_score)
if min_upgrade_format_score != "":
    payload["minUpgradeFormatScore"] = int(min_upgrade_format_score)

print("update" if payload != existing else "unchanged")
print(str(target.get("id", "")))
print(json.dumps(payload, separators=(",", ":")))
PY
)"

    action="$(printf '%s\n' "$result" | sed -n '1p')"
    profile_id="$(printf '%s\n' "$result" | sed -n '2p')"
    payload="$(printf '%s\n' "$result" | sed -n '3p')"

    case "$action" in
        update)
            if [[ -z "$profile_id" ]]; then
                warn "$label failed because the existing profile ID is missing"
                return 1
            fi
            api_put_json "$label" "$profile_update_base_url/$profile_id" "$api_key" "$payload" || true
            ;;
        unchanged)
            warn "$label already configured"
            ;;
        missing_profile)
            warn "$label skipped because profile '$profile_name' is missing"
            ;;
        missing_format)
            warn "$label skipped because one of the required custom formats is missing"
            ;;
        invalid_spec)
            warn "$label failed because the format score list is invalid"
            ;;
        *)
            warn "$label failed while building the quality profile custom format payload"
            return 1
            ;;
    esac
}

ensure_quality_definition_caps() {
    local label="$1"
    local list_url="$2"
    local update_base_url="$3"
    local api_key="$4"
    local rules_csv="$5"
    local current updates_line

    if [[ -z "$api_key" ]]; then
        warn "$label skipped because the API key is unavailable"
        return 0
    fi

    current="$(curl -fsS "$list_url" -H "X-Api-Key: $api_key" 2>/dev/null)" || {
        warn "$label failed because quality definitions could not be read"
        return 1
    }

    updates_line="$(python3 - "$rules_csv" "$current" <<'PY'
import json
import sys

rules = {}
for part in sys.argv[1].split(","):
    part = part.strip()
    if not part:
        continue
    pieces = [item.strip() for item in part.split(":")]
    if len(pieces) == 3:
        name, max_size, preferred_size = pieces
        rules[name] = {
            "minSize": None,
            "maxSize": float(max_size),
            "preferredSize": float(preferred_size),
        }
    elif len(pieces) == 4:
        name, min_size, max_size, preferred_size = pieces
        rules[name] = {
            "minSize": float(min_size),
            "maxSize": float(max_size),
            "preferredSize": float(preferred_size),
        }
    else:
        raise SystemExit("invalid")

definitions = json.loads(sys.argv[2])
for item in definitions:
    name = item.get("quality", {}).get("name")
    if name not in rules:
        continue

    desired = rules[name]
    desired_min = item.get("minSize") if desired["minSize"] is None else desired["minSize"]
    current_min = item.get("minSize")
    current_max = item.get("maxSize")
    current_preferred = item.get("preferredSize")
    if current_min == desired_min and current_max == desired["maxSize"] and current_preferred == desired["preferredSize"]:
        continue

    if desired["minSize"] is not None:
        item["minSize"] = desired["minSize"]
    item["maxSize"] = desired["maxSize"]
    item["preferredSize"] = desired["preferredSize"]
    print(
        "{}\t{}\t{}".format(
            item.get("id", ""),
            name,
            json.dumps(item, separators=(",", ":")),
        )
    )
PY
)"

    if [[ -z "$updates_line" ]]; then
        warn "$label already configured"
        return 0
    fi

    while IFS=$'\t' read -r definition_id definition_name payload; do
        [[ -n "$definition_id" ]] || continue
        api_put_json "$label ($definition_name)" "$update_base_url/$definition_id" "$api_key" "$payload" || true
    done <<< "$updates_line"
}

delete_named_quality_profile() {
    local label="$1"
    local list_url="$2"
    local delete_base_url="$3"
    local api_key="$4"
    local name="$5"
    local existing_id=""

    existing_id="$(json_id_by_name "$list_url" "$api_key" "$name" || true)"
    if [[ -n "$existing_id" ]]; then
        api_delete "$label" "$delete_base_url/$existing_id" "$api_key" || true
    fi
}

migrate_items_to_quality_profile() {
    local label="$1"
    local profile_list_url="$2"
    local item_list_url="$3"
    local item_update_base_url="$4"
    local api_key="$5"
    local source_names_csv="$6"
    local target_name="$7"
    local profiles_file items_file updates

    if [[ -z "$api_key" ]]; then
        warn "$label skipped because the API key is unavailable"
        return 0
    fi

    profiles_file="$(mktemp)"
    items_file="$(mktemp)"

    if ! curl -fsS "$profile_list_url" -H "X-Api-Key: $api_key" >"$profiles_file" 2>/dev/null; then
        warn "$label failed because quality profiles could not be read"
        rm -f "$profiles_file" "$items_file"
        return 1
    fi

    if ! curl -fsS "$item_list_url" -H "X-Api-Key: $api_key" >"$items_file" 2>/dev/null; then
        warn "$label failed because items could not be read"
        rm -f "$profiles_file" "$items_file"
        return 1
    fi

    updates="$(python3 - "$source_names_csv" "$target_name" "$profiles_file" "$items_file" <<'PY'
import json
import sys
from pathlib import Path

source_names = [name.strip() for name in sys.argv[1].split(",") if name.strip()]
target_name = sys.argv[2]
profiles = json.loads(Path(sys.argv[3]).read_text())
items = json.loads(Path(sys.argv[4]).read_text())

profile_ids = {item.get("name"): item.get("id") for item in profiles}
target_id = profile_ids.get(target_name)
if target_id is None:
    raise SystemExit(0)

source_ids = {profile_ids[name] for name in source_names if name in profile_ids and profile_ids[name] != target_id}
for item in items:
    if item.get("qualityProfileId") not in source_ids:
        continue
    item["qualityProfileId"] = target_id
    print("{}\t{}".format(item.get("id"), json.dumps(item, separators=(",", ":"))))
PY
)"
    rm -f "$profiles_file" "$items_file"

    if [[ -z "$updates" ]]; then
        warn "$label already configured"
        return 0
    fi

    while IFS=$'\t' read -r item_id payload; do
        [[ -n "$item_id" ]] || continue
        api_put_json "$label item $item_id" "$item_update_base_url/$item_id" "$api_key" "$payload" || true
    done <<< "$updates"
}

apply_movie_monitoring_policy() {
    local label="$1"
    local item_list_url="$2"
    local item_update_base_url="$3"
    local api_key="$4"
    local seerr_db="$5"
    local is_4k="${6:-false}"
    local items_file requested_file updates

    if [[ -z "$api_key" ]]; then
        warn "$label skipped because the API key is unavailable"
        return 0
    fi

    items_file="$(mktemp)"
    requested_file="$(mktemp)"

    if ! curl -fsS "$item_list_url" -H "X-Api-Key: $api_key" >"$items_file" 2>/dev/null; then
        warn "$label failed because movies could not be read"
        rm -f "$items_file" "$requested_file"
        return 1
    fi

    python3 - "$seerr_db" "$requested_file" "$is_4k" <<'PY' || true
import sqlite3
import sys
from pathlib import Path

db_path = Path(sys.argv[1])
out_path = Path(sys.argv[2])
is_4k = sys.argv[3].lower() == "true"

ids = set()
if db_path.exists():
    conn = sqlite3.connect(db_path)
    column = "externalServiceId4k" if is_4k else "externalServiceId"
    for (value,) in conn.execute(
        f"""
        select m.{column}
        from media_request mr
        join media m on m.id = mr.mediaId
        where mr.type = 'movie' and mr.status in (1, 2, 3)
        """
    ):
        if value is not None:
            ids.add(int(value))

out_path.write_text(",".join(str(item) for item in sorted(ids)), encoding="utf-8")
PY

    updates="$(python3 - "$items_file" "$requested_file" <<'PY'
import json
import re
import sys
from pathlib import Path

items = json.loads(Path(sys.argv[1]).read_text())
requested_ids = {
    int(value)
    for value in Path(sys.argv[2]).read_text().split(",")
    if value.strip().isdigit()
}

h265_pattern = re.compile(r"(?:[xh][ ._-]?265|\bhevc\b|\bh\.?265\b)", re.IGNORECASE)
h264_pattern = re.compile(r"(?:[xh][ ._-]?264|\bh\.?264\b|\bavc\b)", re.IGNORECASE)

def blob(movie):
    movie_file = movie.get("movieFile") or {}
    parts = [
        movie_file.get("sceneName") or "",
        movie_file.get("relativePath") or "",
        json.dumps(movie_file.get("mediaInfo") or {}, separators=(",", ":")),
    ]
    return " ".join(parts)

for movie in items:
    movie_id = movie.get("id")
    movie_file = movie.get("movieFile") or {}
    text = blob(movie)
    has_file = bool(movie.get("movieFileId") or movie_file.get("id"))

    desired = False
    if movie_id in requested_ids and not has_file:
        desired = True
    elif has_file and h264_pattern.search(text) and not h265_pattern.search(text):
        desired = True

    if bool(movie.get("monitored")) == desired:
        continue

    movie["monitored"] = desired
    print("{}\t{}".format(movie_id, json.dumps(movie, separators=(",", ":"))))
PY
)"
    rm -f "$items_file" "$requested_file"

    if [[ -z "$updates" ]]; then
        warn "$label already configured"
        return 0
    fi

    while IFS=$'\t' read -r item_id payload; do
        [[ -n "$item_id" ]] || continue
        api_put_json "$label item $item_id" "$item_update_base_url/$item_id" "$api_key" "$payload" || true
    done <<< "$updates"
}

apply_series_monitoring_policy() {
    local label="$1"
    local item_list_url="$2"
    local item_update_base_url="$3"
    local api_key="$4"
    local seerr_db="$5"
    local is_4k="${6:-false}"
    local items_file requested_file updates

    if [[ -z "$api_key" ]]; then
        warn "$label skipped because the API key is unavailable"
        return 0
    fi

    items_file="$(mktemp)"
    requested_file="$(mktemp)"

    if ! curl -fsS "$item_list_url" -H "X-Api-Key: $api_key" >"$items_file" 2>/dev/null; then
        warn "$label failed because series could not be read"
        rm -f "$items_file" "$requested_file"
        return 1
    fi

    python3 - "$seerr_db" "$requested_file" "$is_4k" <<'PY' || true
import sqlite3
import sys
from pathlib import Path

db_path = Path(sys.argv[1])
out_path = Path(sys.argv[2])
is_4k = sys.argv[3].lower() == "true"

ids = set()
if db_path.exists():
    conn = sqlite3.connect(db_path)
    column = "externalServiceId4k" if is_4k else "externalServiceId"
    for (value,) in conn.execute(
        f"""
        select m.{column}
        from media_request mr
        join media m on m.id = mr.mediaId
        where mr.type = 'tv'
        """
    ):
        if value is not None:
            ids.add(int(value))

out_path.write_text(",".join(str(item) for item in sorted(ids)), encoding="utf-8")
PY

    updates="$(python3 - "$items_file" "$requested_file" <<'PY'
import json
import sys
from pathlib import Path

items = json.loads(Path(sys.argv[1]).read_text())
requested_ids = {
    int(value)
    for value in Path(sys.argv[2]).read_text().split(",")
    if value.strip().isdigit()
}

for series in items:
    desired = series.get("id") in requested_ids
    if bool(series.get("monitored")) == desired:
        continue

    series["monitored"] = desired
    print("{}\t{}".format(series.get("id"), json.dumps(series, separators=(",", ":"))))
PY
)"
    rm -f "$items_file" "$requested_file"

    if [[ -z "$updates" ]]; then
        warn "$label already configured"
        return 0
    fi

    while IFS=$'\t' read -r item_id payload; do
        [[ -n "$item_id" ]] || continue
        api_put_json "$label item $item_id" "$item_update_base_url/$item_id" "$api_key" "$payload" || true
    done <<< "$updates"
}

build_prowlarr_indexer_payload() {
    local schema_name="$1"
    local app_profile_id="$2"
    local tag_ids_csv="${3:-}"
    local schema_file="$4"
    local current_file="$5"

    python3 - "$schema_name" "$app_profile_id" "$tag_ids_csv" "$schema_file" "$current_file" <<'PY'
import json
import sys
from pathlib import Path

schema_name = sys.argv[1]
app_profile_id = int(sys.argv[2])
tag_ids = [int(value) for value in sys.argv[3].split(",") if value]
schema = json.loads(Path(sys.argv[4]).read_text())
current = json.loads(Path(sys.argv[5]).read_text())

schema_item = next((item for item in schema if item.get("name") == schema_name), None)
if schema_item is None:
    print("missing")
    print("")
    print("")
    sys.exit(0)

definition_name = schema_item.get("definitionName")
existing = next(
    (
        item
        for item in current
        if item.get("definitionName") == definition_name or item.get("name") == schema_name
    ),
    None,
)

desired_tags = sorted(dict.fromkeys(tag_ids))

def enforce_seeded_torrents(payload):
    changed = False
    if payload.get("protocol") != "torrent":
        return changed

    for field in payload.get("fields") or []:
        if field.get("name") == "torrentBaseSettings.appMinimumSeeders" and field.get("value") != 1:
            field["value"] = 1
            changed = True

    return changed

if existing is None:
    payload = dict(schema_item)
    payload.pop("id", None)
    payload["appProfileId"] = app_profile_id
    payload["tags"] = desired_tags
    payload["enable"] = True
    enforce_seeded_torrents(payload)
    print("create")
    print("")
    print(json.dumps(payload, separators=(",", ":")))
    sys.exit(0)

changed = False
payload = dict(existing)
if payload.get("appProfileId") != app_profile_id:
    payload["appProfileId"] = app_profile_id
    changed = True
if sorted(payload.get("tags") or []) != desired_tags:
    payload["tags"] = desired_tags
    changed = True
if payload.get("enable") is not True:
    payload["enable"] = True
    changed = True
if enforce_seeded_torrents(payload):
    changed = True

print("update" if changed else "unchanged")
print(payload.get("id", ""))
print(json.dumps(payload, separators=(",", ":")))
PY
}

ensure_prowlarr_indexer() {
    local label="$1"
    local schema_name="$2"
    local tag_ids_csv="${3:-}"
    local schema_file current_file result action indexer_id payload

    schema_file="$(mktemp)"
    current_file="$(mktemp)"

    if ! curl -fsS "$PROWLARR_URL/api/v1/indexer/schema" -H "X-Api-Key: $PROWLARR_KEY" > "$schema_file" 2>/dev/null; then
        warn "$label failed because the Prowlarr schema could not be read"
        rm -f "$schema_file" "$current_file"
        return 1
    fi

    if ! curl -fsS "$PROWLARR_URL/api/v1/indexer" -H "X-Api-Key: $PROWLARR_KEY" > "$current_file" 2>/dev/null; then
        warn "$label failed because current Prowlarr indexers could not be read"
        rm -f "$schema_file" "$current_file"
        return 1
    fi

    result="$(build_prowlarr_indexer_payload "$schema_name" "$PROWLARR_APP_PROFILE_ID" "$tag_ids_csv" "$schema_file" "$current_file")"
    rm -f "$schema_file" "$current_file"

    action="$(printf '%s\n' "$result" | sed -n '1p')"
    indexer_id="$(printf '%s\n' "$result" | sed -n '2p')"
    payload="$(printf '%s\n' "$result" | sed -n '3p')"

    case "$action" in
        create)
            api_post_json "$label" "$PROWLARR_URL/api/v1/indexer" "$PROWLARR_KEY" "$payload" || true
            ;;
        update)
            if [[ -z "$indexer_id" ]]; then
                warn "$label failed because the existing Prowlarr indexer ID is missing"
                return 1
            fi
            api_put_json "$label" "$PROWLARR_URL/api/v1/indexer/$indexer_id" "$PROWLARR_KEY" "$payload" || true
            ;;
        unchanged)
            warn "$label already configured"
            ;;
        missing)
            warn "$label skipped because '$schema_name' is not available in this Prowlarr build"
            ;;
        *)
            warn "$label failed while building the indexer payload"
            return 1
            ;;
    esac
}

ensure_seerr_service() {
    local label="$1"
    local list_url="$2"
    local create_url="$3"
    local update_base_url="$4"
    local api_key="$5"
    local name="$6"
    local payload="$7"
    local existing_id=""

    existing_id="$(json_id_by_name "$list_url" "$api_key" "$name" || true)"
    if [[ -n "$existing_id" ]]; then
        api_put_json "$label" "$update_base_url/$existing_id" "$api_key" "$payload" || true
    else
        api_post_json "$label" "$create_url" "$api_key" "$payload" || true
    fi
}

ensure_prowlarr_application() {
    local label="$1"
    local list_url="$2"
    local create_url="$3"
    local update_base_url="$4"
    local api_key="$5"
    local name="$6"
    local payload="$7"
    local existing_id=""

    existing_id="$(json_id_by_name "$list_url" "$api_key" "$name" || true)"
    if [[ -n "$existing_id" ]]; then
        api_put_json "$label" "$update_base_url/$existing_id" "$api_key" "$payload" || true
    else
        api_post_json "$label" "$create_url" "$api_key" "$payload" || true
    fi
}

delete_named_service() {
    local label="$1"
    local list_url="$2"
    local delete_base_url="$3"
    local api_key="$4"
    local name="$5"
    local existing_id=""

    existing_id="$(json_id_by_name "$list_url" "$api_key" "$name" || true)"
    if [[ -n "$existing_id" ]]; then
        api_delete "$label" "$delete_base_url/$existing_id" "$api_key" || true
    fi
}

ensure_download_client() {
    local label="$1"
    local list_url="$2"
    local create_url="$3"
    local delete_base_url="$4"
    local api_key="$5"
    local name="$6"
    local payload="$7"
    local existing_id=""

    existing_id="$(json_id_by_name "$list_url" "$api_key" "$name" || true)"
    if [[ -n "$existing_id" ]]; then
        api_delete "$label existing client removed" "$delete_base_url/$existing_id" "$api_key" || true
    fi

    api_post_json "$label" "$create_url" "$api_key" "$payload" || true
}

ensure_notification() {
    local label="$1"
    local list_url="$2"
    local create_url="$3"
    local delete_base_url="$4"
    local api_key="$5"
    local name="$6"
    local payload="$7"
    local existing_id=""

    existing_id="$(json_id_by_name "$list_url" "$api_key" "$name" || true)"
    if [[ -n "$existing_id" ]]; then
        api_delete "$label existing notification removed" "$delete_base_url/$existing_id" "$api_key" || true
    fi

    api_post_json "$label" "$create_url" "$api_key" "$payload" || true
}

sync_torrent_archive_hook() {
    ensure_dir "$CONFIG_ROOT/hooks"
    ensure_dir "$CONFIG_ROOT/transmission/torrents"
    ensure_dir "$CONFIG_ROOT/qbittorrent/qBittorrent/BT_backup"
    ensure_dir "$STATE_ROOT/torrent-archive/Movies"
    ensure_dir "$STATE_ROOT/torrent-archive/TV Shows"

    cp "$TORRENT_ARCHIVE_HOOK_SOURCE" "$TORRENT_ARCHIVE_HOOK_DEST"
    chmod 755 "$TORRENT_ARCHIVE_HOOK_DEST"
    ok "Torrent archive hook synced"
}

configure_servarr_auth() {
    local label="$1"
    local url="$2"
    local api_key="$3"
    local auth_password="${4:-${PASSWORD:-}}"
    local current payload

    if [[ -z "$api_key" ]]; then
        warn "$label skipped because the API key is unavailable"
        return 0
    fi

    if [[ -z "${USERNAME:-}" || -z "$auth_password" ]]; then
        warn "$label skipped because USERNAME or the selected password is empty"
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

configure_servarr_naming_flag() {
    local label="$1"
    local url="$2"
    local api_key="$3"
    local field_name="$4"
    local current payload

    current="$(curl -fsS "$url" -H "X-Api-Key: $api_key" 2>/dev/null)" || {
        warn "$label settings could not be read"
        return 1
    }

    payload="$(python3 - "$field_name" "$current" <<'PY'
import json
import sys

field_name = sys.argv[1]
data = json.loads(sys.argv[2])

if data.get(field_name) is not True:
    data[field_name] = True

print(json.dumps(data))
PY
)"

    api_put_json "$label" "$url" "$api_key" "$payload" || true
}

configure_servarr_download_handling() {
    local label="$1"
    local url="$2"
    local api_key="$3"
    local enabled="${4:-true}"
    local current payload

    if [[ -z "$api_key" ]]; then
        warn "$label skipped because the API key is unavailable"
        return 0
    fi

    current="$(curl -fsS "$url" -H "X-Api-Key: $api_key" 2>/dev/null)" || {
        warn "$label settings could not be read"
        return 1
    }

    payload="$(python3 - "$current" "$enabled" <<'PY'
import json
import sys

data = json.loads(sys.argv[1])
enabled = sys.argv[2].lower() == "true"

data["enableCompletedDownloadHandling"] = enabled
data.setdefault("downloadClientWorkingFolders", "_UNPACK_|_FAILED_")
data.setdefault("autoRedownloadFailed", False)
data.setdefault("autoRedownloadFailedFromInteractiveSearch", False)

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
        warn "Bazarr UI auth skipped because USERNAME or BAZARR_PASSWORD is empty"
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
            if line != desired:
                out.append(desired)
                changed = True
            else:
                out.append(line)
            continue
        if stripped.startswith("username:"):
            found_username = True
            desired = f"  username: '{username}'"
            if line != desired:
                out.append(desired)
                changed = True
            else:
                out.append(line)
            continue
        if stripped.startswith("password:"):
            found_password = True
            desired = f"  password: '{password_hash}'"
            if line != desired:
                out.append(desired)
                changed = True
            else:
                out.append(line)
            continue

    out.append(line)

if in_auth:
    emit_missing()

if changed:
    path.write_text("\n".join(out) + "\n")

print("changed" if changed else "unchanged")
PY
)"

    if [[ "$result" == "unchanged" ]]; then
        warn "Bazarr UI auth already configured"
        return 0
    fi

    stackarr_compose restart bazarr >/dev/null
    wait_for_http "Bazarr" "$BAZARR_URL"
    ok "Bazarr UI auth configured"
}

extract_qbittorrent_temp_password() {
    local output

    output="$(stackarr_compose logs --no-color qbittorrent 2>/dev/null || true)"
    python3 - "$output" <<'PY'
import re
import sys

text = sys.argv[1]

for line in text.splitlines():
    match = re.search(r"temporary password.*?:\s*(\S+)", line, flags=re.IGNORECASE)
    if match:
        print(match.group(1))
        raise SystemExit(0)

raise SystemExit(1)
PY
}

qbittorrent_login() {
    local username="$1"
    local password="$2"
    local cookie_file="$3"
    local body

    body="$(curl -sS -c "$cookie_file" \
        -H "Referer: $QBITTORRENT_URL/" \
        -H "Origin: $QBITTORRENT_URL" \
        --data-urlencode "username=$username" \
        --data-urlencode "password=$password" \
        "$QBITTORRENT_URL/api/v2/auth/login" 2>/dev/null || true)"

    [[ "$body" == "Ok." ]]
}

ensure_qbittorrent_category() {
    local cookie_file="$1"
    local category="$2"
    local save_path="$3"
    local code

    code="$(curl -sS -o /dev/null -w '%{http_code}' -b "$cookie_file" \
        -H "Referer: $QBITTORRENT_URL/" \
        -H "Origin: $QBITTORRENT_URL" \
        --data-urlencode "category=$category" \
        --data-urlencode "savePath=$save_path" \
        "$QBITTORRENT_URL/api/v2/torrents/createCategory" 2>/dev/null || echo 000)"

    if [[ ! "$code" =~ ^(200|409)$ ]]; then
        warn "qBittorrent category '$category' could not be created"
        return 1
    fi

    code="$(curl -sS -o /dev/null -w '%{http_code}' -b "$cookie_file" \
        -H "Referer: $QBITTORRENT_URL/" \
        -H "Origin: $QBITTORRENT_URL" \
        --data-urlencode "category=$category" \
        --data-urlencode "savePath=$save_path" \
        "$QBITTORRENT_URL/api/v2/torrents/editCategory" 2>/dev/null || echo 000)"

    if [[ ! "$code" =~ ^2 ]]; then
        warn "qBittorrent category '$category' could not be updated"
        return 1
    fi
}

configure_qbittorrent_settings() {
    local cookie_file bootstrap_password payload config_result
    local desired_incomplete="/downloads/$DOWNLOAD_INCOMPLETE_NAME"
    local desired_complete="/downloads/$DOWNLOAD_COMPLETE_NAME"
    local config_file="$CONFIG_ROOT/qbittorrent/qBittorrent/qBittorrent.conf"

    ensure_dir "$DOWNLOADS_ROOT/$DOWNLOAD_INCOMPLETE_NAME"
    ensure_dir "$DOWNLOADS_ROOT/$DOWNLOAD_COMPLETE_NAME"
    ensure_dir "$DOWNLOADS_ROOT/$DOWNLOAD_COMPLETE_NAME/$RADARR_CATEGORY"
    ensure_dir "$DOWNLOADS_ROOT/$DOWNLOAD_COMPLETE_NAME/$SONARR_CATEGORY"
    ensure_dir "$DOWNLOADS_ROOT/$DOWNLOAD_COMPLETE_NAME/$LIDARR_CATEGORY"
    if optional_service_enabled radarr4k; then
        ensure_dir "$DOWNLOADS_ROOT/$DOWNLOAD_COMPLETE_NAME/$RADARR_4K_CATEGORY"
    fi
    if optional_service_enabled sonarr4k; then
        ensure_dir "$DOWNLOADS_ROOT/$DOWNLOAD_COMPLETE_NAME/$SONARR_4K_CATEGORY"
    fi

    if [[ -f "$config_file" ]]; then
        config_result="$(python3 - "$config_file" <<'PY'
import sys
from pathlib import Path

path = Path(sys.argv[1])
lines = path.read_text().splitlines()
changed = False
in_bittorrent = False
found_ratio = False
found_action = False

def emit_missing():
    global changed
    if not found_ratio:
        changed = True
    if not found_action:
        changed = True

for line in lines:
    stripped = line.strip()

    if stripped.startswith("[") and stripped.endswith("]"):
        if in_bittorrent:
            emit_missing()
        in_bittorrent = stripped == "[BitTorrent]"
        if in_bittorrent:
            found_ratio = False
            found_action = False
        continue

    if in_bittorrent and stripped.startswith("Session\\GlobalMaxRatio="):
        found_ratio = True
        if line != "Session\\GlobalMaxRatio=0":
            changed = True
        continue

    if in_bittorrent and stripped.startswith("Session\\ShareLimitAction="):
        found_action = True
        if line != "Session\\ShareLimitAction=Pause":
            changed = True
        continue

if in_bittorrent:
    emit_missing()

print("changed" if changed else "unchanged")
PY
)"

        if [[ "$config_result" == "changed" ]]; then
            stackarr_compose stop qbittorrent >/dev/null
            python3 - "$config_file" <<'PY'
import sys
from pathlib import Path

path = Path(sys.argv[1])
lines = path.read_text().splitlines()
out = []
in_bittorrent = False
found_ratio = False
found_action = False

def emit_missing():
    if not found_ratio:
        out.append("Session\\GlobalMaxRatio=0")
    if not found_action:
        out.append("Session\\ShareLimitAction=Pause")

for line in lines:
    stripped = line.strip()

    if stripped.startswith("[") and stripped.endswith("]"):
        if in_bittorrent:
            emit_missing()
        in_bittorrent = stripped == "[BitTorrent]"
        if in_bittorrent:
            found_ratio = False
            found_action = False
        out.append(line)
        continue

    if in_bittorrent and stripped.startswith("Session\\GlobalMaxRatio="):
        found_ratio = True
        out.append("Session\\GlobalMaxRatio=0")
        continue

    if in_bittorrent and stripped.startswith("Session\\ShareLimitAction="):
        found_action = True
        out.append("Session\\ShareLimitAction=Pause")
        continue

    out.append(line)

if in_bittorrent:
    emit_missing()

path.write_text("\n".join(out) + "\n")
PY
            stackarr_compose start qbittorrent >/dev/null
            wait_for_http "qBittorrent" "$QBITTORRENT_URL"
        fi
    fi

    cookie_file="$(mktemp)"
    if ! qbittorrent_login "$USERNAME" "$QBITTORRENT_PASSWORD" "$cookie_file"; then
        bootstrap_password="$(extract_qbittorrent_temp_password || true)"
        if [[ -z "$bootstrap_password" ]]; then
            rm -f "$cookie_file"
            warn "qBittorrent temporary password not found in container logs"
            return 1
        fi

        if ! qbittorrent_login "admin" "$bootstrap_password" "$cookie_file"; then
            rm -f "$cookie_file"
            warn "qBittorrent bootstrap login failed"
            return 1
        fi
    fi

    payload="$(python3 - "$desired_complete" "$desired_incomplete" "$USERNAME" "$QBITTORRENT_PASSWORD" "${QBITTORRENT_TORRENT_PORT:-6881}" <<'PY'
import json
import sys

save_path = sys.argv[1]
temp_path = sys.argv[2]
username = sys.argv[3]
password = sys.argv[4]
listen_port = int(sys.argv[5])

preferences = {
    "save_path": save_path,
    "temp_path_enabled": True,
    "temp_path": temp_path,
    "use_category_paths_in_manual_mode": True,
    "start_paused_enabled": False,
    "web_ui_local_host_auth": False,
    "web_ui_username": username,
    "web_ui_password": password,
    "listen_port": listen_port,
    "upnp": False,
    "random_port": False,
}

print(json.dumps(preferences, separators=(",", ":")))
PY
)"

    curl -fsS -b "$cookie_file" \
        -H "Referer: $QBITTORRENT_URL/" \
        -H "Origin: $QBITTORRENT_URL" \
        --data-urlencode "json=$payload" \
        "$QBITTORRENT_URL/api/v2/app/setPreferences" >/dev/null || {
        rm -f "$cookie_file"
        warn "qBittorrent preferences could not be updated"
        return 1
    }

    rm -f "$cookie_file"
    cookie_file="$(mktemp)"
    if ! qbittorrent_login "$USERNAME" "$QBITTORRENT_PASSWORD" "$cookie_file"; then
        rm -f "$cookie_file"
        warn "qBittorrent did not accept the configured shared credentials"
        return 1
    fi

    ensure_qbittorrent_category "$cookie_file" "$RADARR_CATEGORY" "/downloads/$DOWNLOAD_COMPLETE_NAME/$RADARR_CATEGORY" || true
    ensure_qbittorrent_category "$cookie_file" "$SONARR_CATEGORY" "/downloads/$DOWNLOAD_COMPLETE_NAME/$SONARR_CATEGORY" || true
    ensure_qbittorrent_category "$cookie_file" "$LIDARR_CATEGORY" "/downloads/$DOWNLOAD_COMPLETE_NAME/$LIDARR_CATEGORY" || true
    if optional_service_enabled radarr4k; then
        ensure_qbittorrent_category "$cookie_file" "$RADARR_4K_CATEGORY" "/downloads/$DOWNLOAD_COMPLETE_NAME/$RADARR_4K_CATEGORY" || true
    fi
    if optional_service_enabled sonarr4k; then
        ensure_qbittorrent_category "$cookie_file" "$SONARR_4K_CATEGORY" "/downloads/$DOWNLOAD_COMPLETE_NAME/$SONARR_4K_CATEGORY" || true
    fi

    rm -f "$cookie_file"
    ok "qBittorrent settings updated from Stackarr runtime config"
}

wire_recyclarr_keys() {
    local file="$CONFIG_ROOT/recyclarr/recyclarr.yml"

    ensure_dir "$CONFIG_ROOT/recyclarr/configs"
    cat > "$file" <<'EOF'
# Stackarr manages Recyclarr config in ./configs/*.yml.
# This root file intentionally stays empty.
EOF
    ok "Recyclarr config layout prepared"
}

configure_recyclarr_template() {
    local file="$1"
    local base_url="$2"
    local api_key="$3"
    local quality_type="$4"
    local quality_preset="$5"

    [[ -f "$file" ]] || {
        warn "Recyclarr template missing at $file"
        return 1
    }

    python3 - "$file" "$base_url" "$api_key" "$quality_type" "$quality_preset" <<'PY'
from pathlib import Path
import re
import sys

path = Path(sys.argv[1])
base_url = sys.argv[2]
api_key = sys.argv[3]
quality_type = sys.argv[4]
quality_preset = (sys.argv[5] or "lite").strip().lower()
text = path.read_text()

HD_LITE_QUALITIES = [
    ("HDTV-720p", 6, 60, 45),
    ("WEBDL-720p", 6, 70, 50),
    ("WEBRip-720p", 6, 70, 50),
    ("Bluray-720p", 8, 90, 60),
    ("HDTV-1080p", 8, 85, 65),
    ("WEBDL-1080p", 8, 95, 72),
    ("WEBRip-1080p", 8, 95, 72),
    ("Bluray-1080p", 10, 100, 80),
]
HD_BALANCED_QUALITIES = [
    ("HDTV-720p", 6, 60, 45),
    ("WEBDL-720p", 6, 70, 50),
    ("WEBRip-720p", 6, 70, 50),
    ("Bluray-720p", 8, 90, 60),
    ("HDTV-1080p", 8, 95, 70),
    ("WEBDL-1080p", 8, 110, 80),
    ("WEBRip-1080p", 8, 110, 80),
    ("Bluray-1080p", 12, 140, 100),
]
UHD_LITE_QUALITIES = HD_LITE_QUALITIES + [
    ("HDTV-2160p", 20, 220, 170),
    ("WEBDL-2160p", 20, 260, 200),
    ("WEBRip-2160p", 20, 260, 200),
    ("Bluray-2160p", 28, 320, 250),
]
UHD_BALANCED_QUALITIES = HD_BALANCED_QUALITIES + [
    ("HDTV-2160p", 20, 260, 190),
    ("WEBDL-2160p", 20, 300, 230),
    ("WEBRip-2160p", 20, 300, 230),
    ("Bluray-2160p", 28, 360, 280),
]


def wants_4k(path_name: str) -> bool:
    return "2160" in path_name or "uhd" in path_name or "4k" in path_name


def quality_rules():
    balanced = quality_preset in {"balanced", "standard", "hd", "quality"}
    if wants_4k(path.name):
        return UHD_BALANCED_QUALITIES if balanced else UHD_LITE_QUALITIES
    return HD_BALANCED_QUALITIES if balanced else HD_LITE_QUALITIES


def quality_definition_block():
    lines = [
        "    quality_definition:",
        f"      type: {quality_type}",
        "      qualities:",
    ]
    for name, min_size, max_size, preferred_size in quality_rules():
        lines.extend([
            f"        - name: {name}",
            f"          min: {min_size}",
            f"          max: {max_size}",
            f"          preferred: {preferred_size}",
        ])
    return "\n".join(lines) + "\n\n"


text, base_count = re.subn(r'(^\s*base_url:\s*).+$', lambda match: match.group(1) + base_url, text, count=1, flags=re.MULTILINE)
text, key_count = re.subn(r'(^\s*api_key:\s*).+$', lambda match: match.group(1) + api_key, text, count=1, flags=re.MULTILINE)
definition = quality_definition_block()
text, quality_count = re.subn(
    r'(?m)^    quality_definition:\n(?:      .*\n|        .*\n)*\n?',
    definition,
    text,
    count=1,
)
if quality_count != 1:
    text = re.sub(r'(?m)^    quality_profiles:\n', definition + "    quality_profiles:\n", text, count=1)

if base_count != 1 or key_count != 1:
    raise SystemExit(f"Could not update placeholders in {path}")

path.write_text(text)
PY
}

sync_recyclarr_profiles() {
    local output_file
    local radarr_hd_file="$CONFIG_ROOT/recyclarr/configs/radarr-hd.yml"
    local radarr_4k_file="$CONFIG_ROOT/recyclarr/configs/radarr-4k.yml"
    local sonarr_hd_file="$CONFIG_ROOT/recyclarr/configs/sonarr-hd.yml"
    local sonarr_4k_file="$CONFIG_ROOT/recyclarr/configs/sonarr-4k.yml"
    local sync_args=()

    if ! optional_service_enabled recyclarr; then
        warn "Recyclarr sync skipped because Recyclarr is disabled"
        return 0
    fi

    wire_recyclarr_keys

    output_file="$(mktemp)"
    if ! stackarr_compose exec -T recyclarr /app/recyclarr/recyclarr config create -f \
        -t "hd-bluray-web" \
        -t "uhd-bluray-web" \
        -t "web-1080p" \
        -t "web-2160p" >"$output_file" 2>&1; then
        warn "Recyclarr template generation failed"
        sed -n '1,12p' "$output_file"
        rm -f "$output_file"
        return 1
    fi
    rm -f "$output_file"

    cp "$CONFIG_ROOT/recyclarr/configs/hd-bluray-web.yml" "$radarr_hd_file"
    cp "$CONFIG_ROOT/recyclarr/configs/web-1080p.yml" "$sonarr_hd_file"

    configure_recyclarr_template "$radarr_hd_file" "http://radarr:7878" "$RADARR_KEY" "movie" "$STACKARR_MOVIE_PROFILE_PRESET" || return 1
    configure_recyclarr_template "$sonarr_hd_file" "http://sonarr:8989" "$SONARR_KEY" "series" "$STACKARR_TV_PROFILE_PRESET" || return 1
    sync_args=(-c /config/configs/radarr-hd.yml -c /config/configs/sonarr-hd.yml)
    if optional_service_enabled radarr4k; then
        cp "$CONFIG_ROOT/recyclarr/configs/uhd-bluray-web.yml" "$radarr_4k_file"
        configure_recyclarr_template "$radarr_4k_file" "http://radarr4k:7878" "$RADARR_4K_KEY" "movie" "$STACKARR_MOVIE_4K_PROFILE_PRESET" || return 1
        sync_args+=(-c /config/configs/radarr-4k.yml)
    else
        rm -f "$radarr_4k_file"
    fi
    if optional_service_enabled sonarr4k; then
        cp "$CONFIG_ROOT/recyclarr/configs/web-2160p.yml" "$sonarr_4k_file"
        configure_recyclarr_template "$sonarr_4k_file" "http://sonarr4k:8989" "$SONARR_4K_KEY" "series" "$STACKARR_TV_4K_PROFILE_PRESET" || return 1
        sync_args+=(-c /config/configs/sonarr-4k.yml)
    else
        rm -f "$sonarr_4k_file"
    fi
    ok "Recyclarr template configs written"

    output_file="$(mktemp)"
    if ! stackarr_compose exec -T recyclarr /app/recyclarr/recyclarr sync "${sync_args[@]}" >"$output_file" 2>&1; then
        warn "Recyclarr sync failed"
        sed -n '1,20p' "$output_file"
        rm -f "$output_file"
        return 1
    fi
    rm -f "$output_file"

    ok "Recyclarr quality profiles synced"
}

media_profile_name_from_preset() {
    local preset="$1"
    local resolution="$2"

    case "$(lowercase "$preset")" in
        balanced|standard|hd|quality)
            if [[ "$resolution" == "4k" ]]; then
                printf '4K\n'
            else
                printf 'HD\n'
            fi
            ;;
        *)
            if [[ "$resolution" == "4k" ]]; then
                printf '4K Lite\n'
            else
                printf 'HD Lite\n'
            fi
            ;;
    esac
}

music_profile_name_from_preset() {
    case "$(lowercase "$1")" in
        lossy|lossy-256|lossy256)
            printf 'Lossy 256+\n'
            ;;
        *)
            printf 'Lossless\n'
            ;;
    esac
}

radarr_download_payload() {
    local category="$1"
    local priority

    priority="$(torrent_client_priority transmission)"
    cat <<EOF
{"enable":true,"protocol":"torrent","priority":${priority},"name":"Transmission","implementation":"Transmission","configContract":"TransmissionSettings","fields":[{"name":"host","value":"transmission"},{"name":"port","value":9091},{"name":"useSsl","value":false},{"name":"urlBase","value":"/transmission/"},{"name":"username","value":"$USERNAME"},{"name":"password","value":"$TRANSMISSION_PASSWORD"},{"name":"movieCategory","value":"$category"}],"removeCompletedDownloads":true,"removeFailedDownloads":true}
EOF
}

qbittorrent_download_payload() {
    local category_field="$1"
    local imported_category_field="$2"
    local recent_priority_field="$3"
    local older_priority_field="$4"
    local category="$5"
    local priority

    priority="$(torrent_client_priority qbittorrent)"

    cat <<EOF
{"enable":true,"protocol":"torrent","priority":${priority},"name":"qBittorrent","implementation":"QBittorrent","configContract":"QBittorrentSettings","fields":[{"name":"host","value":"qbittorrent"},{"name":"port","value":${QBITTORRENT_WEBUI_PORT:-8081}},{"name":"useSsl","value":false},{"name":"urlBase","value":""},{"name":"username","value":"$USERNAME"},{"name":"password","value":"$QBITTORRENT_PASSWORD"},{"name":"$category_field","value":"$category"},{"name":"$imported_category_field","value":""},{"name":"$recent_priority_field","value":0},{"name":"$older_priority_field","value":0},{"name":"initialState","value":0},{"name":"sequentialOrder","value":false},{"name":"firstAndLast","value":false},{"name":"contentLayout","value":0}],"removeCompletedDownloads":true,"removeFailedDownloads":true}
EOF
}

radarr_qbittorrent_download_payload() {
    local category="$1"
    qbittorrent_download_payload "movieCategory" "movieImportedCategory" "recentMoviePriority" "olderMoviePriority" "$category"
}

sonarr_download_payload() {
    local category="$1"
    local priority

    priority="$(torrent_client_priority transmission)"
    cat <<EOF
{"enable":true,"protocol":"torrent","priority":${priority},"name":"Transmission","implementation":"Transmission","configContract":"TransmissionSettings","fields":[{"name":"host","value":"transmission"},{"name":"port","value":9091},{"name":"useSsl","value":false},{"name":"urlBase","value":"/transmission/"},{"name":"username","value":"$USERNAME"},{"name":"password","value":"$TRANSMISSION_PASSWORD"},{"name":"tvCategory","value":"$category"}],"removeCompletedDownloads":true,"removeFailedDownloads":true}
EOF
}

sonarr_qbittorrent_download_payload() {
    local category="$1"
    qbittorrent_download_payload "tvCategory" "tvImportedCategory" "recentTvPriority" "olderTvPriority" "$category"
}

lidarr_download_payload() {
    local priority

    priority="$(torrent_client_priority transmission)"
    cat <<EOF
{"enable":true,"protocol":"torrent","priority":${priority},"name":"Transmission","implementation":"Transmission","configContract":"TransmissionSettings","fields":[{"name":"host","value":"transmission"},{"name":"port","value":9091},{"name":"useSsl","value":false},{"name":"urlBase","value":"/transmission/"},{"name":"username","value":"$USERNAME"},{"name":"password","value":"$TRANSMISSION_PASSWORD"},{"name":"musicCategory","value":"$LIDARR_CATEGORY"}],"removeCompletedDownloads":true,"removeFailedDownloads":true}
EOF
}

lidarr_qbittorrent_download_payload() {
    qbittorrent_download_payload "musicCategory" "musicImportedCategory" "recentMusicPriority" "olderMusicPriority" "$LIDARR_CATEGORY"
}

radarr_torrent_archive_notification_payload() {
    cat <<EOF
{"name":"Stackarr Torrent Archive","implementation":"CustomScript","configContract":"CustomScriptSettings","onGrab":false,"onDownload":true,"onUpgrade":true,"onRename":false,"onMovieAdded":false,"onMovieDelete":false,"onMovieFileDelete":false,"onMovieFileDeleteForUpgrade":false,"onHealthIssue":false,"includeHealthWarnings":false,"onHealthRestored":false,"onApplicationUpdate":false,"onManualInteractionRequired":false,"fields":[{"name":"path","value":"/stackarr-hooks/archive-torrent.sh"}],"tags":[]}
EOF
}

sonarr_torrent_archive_notification_payload() {
    cat <<EOF
{"name":"Stackarr Torrent Archive","implementation":"CustomScript","configContract":"CustomScriptSettings","onGrab":false,"onDownload":true,"onUpgrade":true,"onImportComplete":false,"onRename":false,"onSeriesAdd":false,"onSeriesDelete":false,"onEpisodeFileDelete":false,"onEpisodeFileDeleteForUpgrade":false,"onHealthIssue":false,"includeHealthWarnings":false,"onHealthRestored":false,"onApplicationUpdate":false,"onManualInteractionRequired":false,"fields":[{"name":"path","value":"/stackarr-hooks/archive-torrent.sh"}],"tags":[]}
EOF
}

lidarr_rootfolder_payload() {
    local quality_profile_id="$1"
    local metadata_profile_id="$2"
    cat <<EOF
{"path":"/music","name":"Music","defaultMetadataProfileId":${metadata_profile_id},"defaultQualityProfileId":${quality_profile_id}}
EOF
}

flaresolverr_proxy_payload() {
    local tag_id="$1"
    cat <<EOF
{"name":"FlareSolverr","implementation":"FlareSolverr","configContract":"FlareSolverrSettings","fields":[{"name":"host","value":"http://flaresolverr:8191"},{"name":"requestTimeout","value":60}],"tags":[${tag_id}]}
EOF
}

prowlarr_app_payload() {
    local name="$1"
    local implementation="$2"
    local base_url="$3"
    local api_key="$4"
    local categories="$5"
    # Stackarr owns the synced Prowlarr application records and keeps them tagless.
    # Use indexer tags and indexer proxies for routing; app tags can hide every indexer from Servarr sync.
    cat <<EOF
{"name":"$name","implementation":"$implementation","configContract":"${implementation}Settings","syncLevel":"fullSync","fields":[{"name":"prowlarrUrl","value":"http://prowlarr:9696"},{"name":"baseUrl","value":"$base_url"},{"name":"apiKey","value":"$api_key"},{"name":"syncCategories","value":${categories}}],"tags":[]}
EOF
}

seerr_radarr_payload() {
    local name="$1"
    local hostname="$2"
    local service_port="$3"
    local api_key="$4"
    local profile_id="$5"
    local profile_name="$6"
    local is_4k="$7"
    local is_default="$8"
    local external_url="$9"
    cat <<EOF
{"name":"$name","hostname":"$hostname","port":${service_port},"apiKey":"$api_key","useSsl":false,"baseUrl":"","activeProfileId":${profile_id},"activeProfileName":"$profile_name","activeDirectory":"/movies","is4k":${is_4k},"minimumAvailability":"inCinemas","isDefault":${is_default},"externalUrl":"$external_url","syncEnabled":true,"preventSearch":false}
EOF
}

seerr_sonarr_payload() {
    local name="$1"
    local hostname="$2"
    local service_port="$3"
    local api_key="$4"
    local profile_id="$5"
    local profile_name="$6"
    local is_4k="$7"
    local is_default="$8"
    local external_url="$9"
    cat <<EOF
{"name":"$name","hostname":"$hostname","port":${service_port},"apiKey":"$api_key","useSsl":false,"baseUrl":"","activeProfileId":${profile_id},"activeProfileName":"$profile_name","activeDirectory":"/tv","activeAnimeProfileId":${profile_id},"activeAnimeProfileName":"$profile_name","activeAnimeDirectory":"/tv","is4k":${is_4k},"enableSeasonFolders":true,"isDefault":${is_default},"externalUrl":"$external_url","syncEnabled":true,"preventSearch":false}
EOF
}

ensure_prowlarr_tag() {
    local label="$1"
    local body code payload tag_id

    payload="$(printf '{"label":"%s"}' "$label")"
    body="$(mktemp)"
    code="$(curl -sS -o "$body" -w '%{http_code}' -H 'Content-Type: application/json' -H "X-Api-Key: $PROWLARR_KEY" -d "$payload" "$PROWLARR_URL/api/v1/tag" || echo 000)"
    if [[ "$code" =~ ^2 ]]; then
        tag_id="$(first_json_id < "$body" || true)"
    fi
    rm -f "$body"

    if [[ -z "${tag_id:-}" ]]; then
        tag_id="$(curl -fsS "$PROWLARR_URL/api/v1/tag" -H "X-Api-Key: $PROWLARR_KEY" 2>/dev/null | awk -v label="\"label\": \"$label\"" -v compact="\"label\":\"$label\"" '
            index($0, label) || index($0, compact) {capture=1}
            capture && match($0, /"id"[[:space:]]*:[[:space:]]*[0-9]+/) {
                value=substr($0, RSTART, RLENGTH)
                gsub(/[^0-9]/, "", value)
                print value
                exit
            }
        ' || true)"
    fi

    [[ -n "${tag_id:-}" ]] || return 1
    printf '%s\n' "$tag_id"
}

configure_pulsarr_stack() {
    if ! optional_service_enabled pulsarr; then
        warn "Pulsarr configuration skipped because Pulsarr is disabled"
        return 0
    fi

    python3 - <<'PY'
import json
import os
import plistlib
import http.cookiejar
import urllib.error
import urllib.parse
import urllib.request
from pathlib import Path
import xml.etree.ElementTree as ET

PULSARR = f"http://127.0.0.1:{os.environ.get('PULSARR_PORT', '3003')}"
CONFIG_ROOT = Path(os.environ.get('CONFIG_ROOT', ''))
PLEX_PREFS_PATH = Path(os.environ.get('PLEX_PREFS_PATH', ''))
USERNAME = os.environ.get('USERNAME', 'stackarr').strip() or 'stackarr'
PASSWORD = os.environ.get('PULSARR_PASSWORD') or os.environ.get('PASSWORD', '')
USER_EMAIL = os.environ.get('USER_EMAIL', '').strip()
PLEX_SERVER_URL = os.environ.get('PULSARR_PLEX_SERVER_URL', 'http://host.docker.internal:32400').strip() or 'http://host.docker.internal:32400'
RADARR_DEFAULT_PROFILE = os.environ.get('STACKARR_MOVIE_DEFAULT_PROFILE', 'HD Lite').strip() or 'HD Lite'
SONARR_DEFAULT_PROFILE = os.environ.get('STACKARR_TV_DEFAULT_PROFILE', 'HD Lite').strip() or 'HD Lite'
COOKIE_JAR = http.cookiejar.CookieJar()
OPENER = urllib.request.build_opener(urllib.request.HTTPCookieProcessor(COOKIE_JAR))
SESSION_COOKIE = ''


def note(kind, message):
    print(f"{kind}: {message}")


def request(method, path, payload=None, ok=(200, 201, 204, 409)):
    data = None
    headers = {}
    global SESSION_COOKIE
    if SESSION_COOKIE:
        headers['Cookie'] = SESSION_COOKIE
    if payload is not None:
        data = json.dumps(payload).encode()
        headers['Content-Type'] = 'application/json'
    req = urllib.request.Request(f"{PULSARR}{path}", data=data, headers=headers, method=method)
    try:
        with OPENER.open(req, timeout=20) as resp:
            body = resp.read().decode() or '{}'
            cookies = []
            for header in resp.headers.get_all('Set-Cookie', []):
                cookie = header.split(';', 1)[0].strip()
                if cookie:
                    cookies.append(cookie)
            if cookies:
                SESSION_COOKIE = '; '.join(cookies)
            return resp.status, json.loads(body) if body else {}
    except urllib.error.HTTPError as exc:
        body = exc.read().decode() or '{}'
        if exc.code in ok:
            try:
                return exc.code, json.loads(body)
            except Exception:
                return exc.code, {'message': body}
        raise RuntimeError(f"{method} {path} failed with HTTP {exc.code}: {body[:200]}") from exc


def arr_key(name):
    path = CONFIG_ROOT / name / 'config.xml'
    if not path.exists():
        return ''
    try:
        return (ET.parse(path).getroot().findtext('ApiKey') or '').strip()
    except Exception:
        return ''


def plex_prefs():
    if not PLEX_PREFS_PATH.exists():
        return {}
    try:
        with PLEX_PREFS_PATH.open('rb') as fh:
            return plistlib.load(fh)
    except Exception:
        return {}


def plex_email_and_token():
    prefs = plex_prefs()
    email = ''
    for key in ('PlexOnlineMail', 'PlexOnlineUsername'):
        value = str(prefs.get(key) or '').strip()
        if '@' in value:
            email = value
            break
    token = str(prefs.get('PlexOnlineToken') or '').strip()
    return email, token


def upsert_instance(service, payload):
    status, items = request('GET', f'/v1/{service}/instances', ok=(200,))
    if not isinstance(items, list):
        items = items.get('instances', [])
    matching = [item for item in items if item.get('baseUrl') == payload['baseUrl'] and item.get('apiKey') == payload['apiKey']]
    existing = next((item for item in matching if item.get('name') == payload['name']), None) or (matching[0] if matching else None)
    if existing:
        request('PUT', f"/v1/{service}/instances/{existing['id']}", payload, ok=(200, 204))
        for item in items:
            if item.get('id') != existing.get('id') and item.get('baseUrl') == payload['baseUrl'] and str(item.get('name', '')).lower().startswith('stackarr'):
                request('DELETE', f"/v1/{service}/instances/{item['id']}", ok=(200, 204, 404))
        return existing['id'], 'updated'
    status, created = request('POST', f'/v1/{service}/instances', payload, ok=(200, 201))
    return created.get('id'), 'created'


def login():
    if not PASSWORD:
        return False

    status, _ = request('POST', '/v1/users/login', {
        'login': USERNAME,
        'password': PASSWORD,
    }, ok=(200,))
    if status == 200:
        note('OK', 'Pulsarr authenticated with shared Stackarr credentials')
        return True

    return False


def configure_plex(token, ready):
    if not token:
        note('WARN', 'Pulsarr Plex token bootstrap skipped because native Plex token is missing; sign in to Plex or configure Pulsarr manually.')
        return
    update = {
        'plexTokens': [token],
        'plexServerUrl': PLEX_SERVER_URL,
        '_isReady': bool(ready),
    }
    request('PUT', '/v1/config', update, ok=(200, 204))
    note('OK', f"Pulsarr Plex token/server bootstrap updated ({PLEX_SERVER_URL})")


def users_by_lookup():
    status, payload = request('GET', '/v1/users/users/list', ok=(200,))
    users = payload.get('users', []) if isinstance(payload, dict) else []
    lookup = {}
    for user in users:
        user_id = user.get('id')
        if user_id is None:
            continue
        for key in ('name', 'display_name', 'alias', 'plex_uuid'):
            value = str(user.get(key) or '').strip()
            if value:
                lookup[value.lower()] = user_id
    return lookup


def migrate_user_condition_values(condition, lookup):
    if not isinstance(condition, dict):
        return condition, False

    if isinstance(condition.get('conditions'), list):
        changed = False
        migrated_conditions = []
        for child in condition['conditions']:
            migrated, child_changed = migrate_user_condition_values(child, lookup)
            migrated_conditions.append(migrated)
            changed = changed or child_changed
        if changed:
            migrated = dict(condition)
            migrated['conditions'] = migrated_conditions
            return migrated, True
        return condition, False

    if condition.get('field') != 'user':
        return condition, False

    value = condition.get('value')

    def migrate_one(item):
        if isinstance(item, int):
            return item
        if isinstance(item, str):
            return lookup.get(item.strip().lower(), item)
        return item

    if isinstance(value, list):
        migrated_value = []
        seen = set()
        for item in value:
            migrated_item = migrate_one(item)
            key = (type(migrated_item).__name__, str(migrated_item).lower())
            if key not in seen:
                migrated_value.append(migrated_item)
                seen.add(key)
    else:
        migrated_value = migrate_one(value)

    if migrated_value == value:
        return condition, False

    migrated = dict(condition)
    migrated['value'] = migrated_value
    return migrated, True


def migrate_pulsarr_user_router_rules():
    try:
        lookup = users_by_lookup()
        if not lookup:
            return
        status, payload = request('GET', '/v1/content-router/rules', ok=(200,))
        rules = payload.get('rules', []) if isinstance(payload, dict) else []
        migrated = 0
        for rule in rules:
            condition = rule.get('condition')
            new_condition, changed = migrate_user_condition_values(condition, lookup)
            if not changed:
                continue
            request('PUT', f"/v1/content-router/rules/{rule['id']}", {'condition': new_condition}, ok=(200, 204))
            migrated += 1
        if migrated:
            note('OK', f'Migrated {migrated} Pulsarr user router rule(s) from usernames to durable user IDs')
    except Exception as exc:
        note('WARN', f'Pulsarr user router rule migration skipped: {exc}')


try:
    plex_email, plex_token = plex_email_and_token()
    email = USER_EMAIL or plex_email
    if not email:
        note('WARN', 'Pulsarr admin email not configured and no signed-in Plex account email was discoverable; set USER_EMAIL or sign in to Plex before first-run automation.')
    elif len(PASSWORD) < 8:
        note('WARN', "Pulsarr admin creation skipped because PASSWORD is missing or shorter than Pulsarr's 8-character minimum.")
    else:
        status, _ = request('POST', '/v1/users/create-admin', {
            'username': USERNAME,
            'password': PASSWORD,
            'email': email,
        }, ok=(201, 409))
        note('OK', 'Pulsarr admin account created from shared Stackarr credentials' if status == 201 else 'Pulsarr admin account already exists')

    if not login():
        note('WARN', 'Pulsarr Arr wiring skipped because admin login failed')
        raise SystemExit(0)

    radarr_key = arr_key('radarr')
    sonarr_key = arr_key('sonarr')
    if not radarr_key or not sonarr_key:
        configure_plex(plex_token, ready=False)
        note('WARN', 'Pulsarr Arr wiring skipped because Radarr or Sonarr API keys are not ready')
        raise SystemExit(0)

    radarr_id, radarr_action = upsert_instance('radarr', {
        'name': 'Radarr',
        'baseUrl': 'http://radarr:7878',
        'apiKey': radarr_key,
        'rootFolder': '/movies',
        'qualityProfile': RADARR_DEFAULT_PROFILE,
        'bypassIgnored': False,
        'searchOnAdd': True,
        'minimumAvailability': 'released',
        'monitor': 'movieOnly',
        'tags': [],
        'isDefault': True,
    })
    sonarr_id, sonarr_action = upsert_instance('sonarr', {
        'name': 'Sonarr',
        'baseUrl': 'http://sonarr:8989',
        'apiKey': sonarr_key,
        'rootFolder': '/tv',
        'qualityProfile': SONARR_DEFAULT_PROFILE,
        'bypassIgnored': False,
        'seasonMonitoring': 'all',
        'monitorNewItems': 'all',
        'searchOnAdd': True,
        'createSeasonFolders': False,
        'tags': [],
        'isDefault': True,
        'seriesType': 'standard',
    })
    note('OK', f'Pulsarr Arr instances {radarr_action}/{sonarr_action}')
    configure_plex(plex_token, ready=True)
    migrate_pulsarr_user_router_rules()
except Exception as exc:
    note('WARN', f'Pulsarr configuration skipped: {exc}')
PY
}

configure_maintainerr_stack() {
    if ! optional_service_enabled maintainerr; then
        warn "Maintainerr configuration skipped because Maintainerr is disabled"
        return 0
    fi

    python3 - <<'PY'
import json
import os
import plistlib
import urllib.error
import urllib.parse
import urllib.request
from pathlib import Path
import xml.etree.ElementTree as ET

MAINTAINERR = os.environ.get('MAINTAINERR_URL', 'http://127.0.0.1:6246').rstrip('/')
CONFIG_ROOT = Path(os.environ.get('CONFIG_ROOT', ''))
PLEX_PREFS_PATH = Path(os.environ.get('PLEX_PREFS_PATH', ''))
PLEX_INSTALL_MODE = os.environ.get('PLEX_INSTALL_MODE', 'native').strip().lower()
JELLYFIN_INSTALL_MODE = os.environ.get('JELLYFIN_INSTALL_MODE', 'disabled').strip().lower()
PREFERRED_TORRENT_CLIENT = os.environ.get('PREFERRED_TORRENT_CLIENT', 'transmission').strip().lower()
USERNAME = os.environ.get('USERNAME', 'stackarr').strip() or 'stackarr'
QBITTORRENT_PASSWORD = os.environ.get('QBITTORRENT_PASSWORD') or os.environ.get('PASSWORD', '')


def note(kind, message):
    print(f"{kind}: {message}")


def flag(value, default=False):
    if value is None or value == '':
        return default
    return str(value).strip().lower() in ('1', 'true', 'yes', 'on')


def request(method, path, payload=None, ok=(200, 201, 204)):
    data = None
    headers = {}
    if payload is not None:
        data = json.dumps(payload).encode()
        headers['Content-Type'] = 'application/json'
    req = urllib.request.Request(f"{MAINTAINERR}{path}", data=data, headers=headers, method=method)
    try:
        with urllib.request.urlopen(req, timeout=25) as resp:
            body = resp.read().decode()
            parsed = json.loads(body) if body else {}
            if resp.status not in ok:
                raise RuntimeError(f"{method} {path} returned HTTP {resp.status}")
            return parsed
    except urllib.error.HTTPError as exc:
        body = exc.read().decode()
        message = ''
        try:
            parsed = json.loads(body) if body else {}
            message = str(parsed.get('message') or '')
        except Exception:
            pass
        if exc.code in ok:
            return {}
        suffix = f": {message}" if message else ''
        raise RuntimeError(f"{method} {path} failed with HTTP {exc.code}{suffix}") from exc


def normalize_url(url, default_scheme='http'):
    value = (url or '').strip()
    if not value:
        return ''
    if '://' not in value:
        value = f"{default_scheme}://{value}"
    return value.rstrip('/')


def container_url(override, local_url, docker_url, default_port):
    value = normalize_url(override)
    if value:
        return value
    if docker_url:
        return docker_url
    parsed = urllib.parse.urlparse(normalize_url(local_url) or f"http://127.0.0.1:{default_port}")
    hostname = parsed.hostname or 'host.docker.internal'
    if hostname in ('localhost', '127.0.0.1', '::1'):
        hostname = 'host.docker.internal'
    port = parsed.port or default_port
    scheme = parsed.scheme or 'http'
    return f"{scheme}://{hostname}:{port}"


def plex_local_url():
    if PLEX_INSTALL_MODE == 'docker':
        return f"http://127.0.0.1:{os.environ.get('PLEX_DOCKER_PORT', '32400')}"
    return normalize_url(os.environ.get('PLEX_URL', 'http://127.0.0.1:32400'))


def plex_container_url():
    docker_url = 'http://plex:32400' if PLEX_INSTALL_MODE == 'docker' else ''
    return container_url(
        os.environ.get('MAINTAINERR_PLEX_SERVER_URL', ''),
        os.environ.get('PLEX_URL', 'http://127.0.0.1:32400'),
        docker_url,
        32400,
    )


def jellyfin_container_url():
    docker_url = 'http://jellyfin:8096' if JELLYFIN_INSTALL_MODE == 'docker' else ''
    return container_url(
        os.environ.get('MAINTAINERR_JELLYFIN_SERVER_URL', ''),
        os.environ.get('JELLYFIN_URL', 'http://127.0.0.1:8096'),
        docker_url,
        8096,
    )


def qbittorrent_container_url():
    override = normalize_url(os.environ.get('MAINTAINERR_QBITTORRENT_URL', ''))
    if override:
        return override
    return f"http://qbittorrent:{os.environ.get('QBITTORRENT_WEBUI_PORT', '8081')}"


def split_plex_target(url):
    parsed = urllib.parse.urlparse(normalize_url(url))
    port = parsed.port or (443 if parsed.scheme == 'https' else 32400)
    return {
        'hostname': parsed.hostname or 'host.docker.internal',
        'port': port,
        'ssl': 1 if parsed.scheme == 'https' or port == 443 else 0,
    }


def arr_key(name):
    path = CONFIG_ROOT / name / 'config.xml'
    if not path.exists():
        return ''
    try:
        return (ET.parse(path).getroot().findtext('ApiKey') or '').strip()
    except Exception:
        return ''


def read_json_key(path, keys):
    if not path.exists():
        return ''
    try:
        data = json.loads(path.read_text())
    except Exception:
        return ''
    current = data
    for key in keys:
        if not isinstance(current, dict):
            return ''
        current = current.get(key)
    return str(current or '').strip()


def read_plex_token():
    token = os.environ.get('PLEX_TOKEN', '').strip()
    if token:
        return token
    if not PLEX_PREFS_PATH.exists():
        return ''
    try:
        with PLEX_PREFS_PATH.open('rb') as fh:
            prefs = plistlib.load(fh)
        return str(prefs.get('PlexOnlineToken') or '').strip()
    except Exception:
        return ''


def plex_identity(token):
    local_url = plex_local_url()
    if not token or not local_url:
        return 'Plex', ''
    url = f"{local_url}/?X-Plex-Token={urllib.parse.quote(token)}"
    try:
        with urllib.request.urlopen(url, timeout=15) as resp:
            root = ET.fromstring(resp.read())
        name = (
            root.get('friendlyName')
            or root.get('serverName')
            or root.get('name')
            or root.get('machineIdentifier')
            or 'Plex'
        )
        return name, root.get('machineIdentifier') or ''
    except Exception:
        return 'Plex', ''


def configure_plex():
    if PLEX_INSTALL_MODE == 'disabled':
        return False
    token = read_plex_token()
    if not token:
        note('WARN', 'Maintainerr Plex wiring skipped because no Plex token is available')
        return False
    name, machine_id = plex_identity(token)
    target = split_plex_target(plex_container_url())
    request('POST', '/api/settings/plex/token', {'plex_auth_token': token})
    request('PATCH', '/api/settings', {
        'media_server_type': 'plex',
        'plex_name': name,
        'plex_hostname': target['hostname'],
        'plex_port': target['port'],
        'plex_ssl': target['ssl'],
        'plex_machine_id': machine_id,
        'plex_manual_mode': 1,
    })
    note('OK', f"Maintainerr connected to Plex ({name})")
    return True


def configure_jellyfin():
    if JELLYFIN_INSTALL_MODE == 'disabled':
        return False
    api_key = os.environ.get('JELLYFIN_API_KEY', '').strip()
    if not api_key:
        note('WARN', 'Maintainerr Jellyfin wiring skipped because JELLYFIN_API_KEY is not set')
        return False
    result = request('POST', '/api/settings/jellyfin', {
        'jellyfin_url': jellyfin_container_url(),
        'jellyfin_api_key': api_key,
        'jellyfin_user_id': '',
    })
    if result.get('status') == 'NOK':
        note('WARN', f"Maintainerr Jellyfin wiring skipped: {result.get('message', 'connection failed')}")
        return False
    note('OK', 'Maintainerr connected to Jellyfin')
    return True


def upsert_servarr(kind, server_name, url, api_key):
    if not api_key:
        note('WARN', f'Maintainerr {server_name} wiring skipped because the API key is unavailable')
        return
    path = f'/api/settings/{kind}'
    current = request('GET', path, ok=(200,))
    if not isinstance(current, list):
        current = []
    existing = next(
        (
            item for item in current
            if str(item.get('serverName', '')).lower() == server_name.lower()
            or str(item.get('url', '')).rstrip('/').lower() == url.rstrip('/').lower()
        ),
        None,
    )
    payload = {'serverName': server_name, 'url': url, 'apiKey': api_key}
    if existing and existing.get('id') is not None:
        request('PUT', f"{path}/{existing['id']}", payload, ok=(200,))
        note('OK', f'Maintainerr updated {server_name}')
    else:
        request('POST', path, payload, ok=(200, 201))
        note('OK', f'Maintainerr added {server_name}')


def configure_servarr():
    upsert_servarr('radarr', 'Radarr', 'http://radarr:7878', arr_key('radarr'))
    upsert_servarr('sonarr', 'Sonarr', 'http://sonarr:8989', arr_key('sonarr'))
    if flag(os.environ.get('ENABLE_4K_SERVARR', 'false')):
        upsert_servarr('radarr', 'Radarr 4K', 'http://radarr4k:7878', arr_key('radarr4k'))
        upsert_servarr('sonarr', 'Sonarr 4K', 'http://sonarr4k:8989', arr_key('sonarr4k'))


def configure_seerr():
    if not flag(os.environ.get('ENABLE_SEERR', 'false')):
        return
    key = os.environ.get('SEERR_API_KEY', '').strip() or read_json_key(CONFIG_ROOT / 'seerr' / 'settings.json', ['main', 'apiKey'])
    if not key:
        note('WARN', 'Maintainerr Seerr wiring skipped because the Seerr API key is unavailable')
        return
    request('POST', '/api/settings/seerr', {'url': 'http://seerr:5055', 'api_key': key})
    note('OK', 'Maintainerr connected to Seerr')


def configure_download_client():
    if PREFERRED_TORRENT_CLIENT not in ('qbittorrent', 'qbit', 'qb'):
        selected = PREFERRED_TORRENT_CLIENT or 'transmission'
        note('WARN', f'Maintainerr download-client cleanup skipped because Maintainerr currently supports qBittorrent and Stackarr is using {selected}')
        return
    request('POST', '/api/settings/download-client', {
        'download_client_url': qbittorrent_container_url(),
        'download_client_username': USERNAME,
        'download_client_password': QBITTORRENT_PASSWORD,
        'download_client_delete_data': False,
        'download_client_fallback_ratio': 0.5,
    })
    note('OK', 'Maintainerr connected to qBittorrent')


try:
    media_configured = configure_plex()
    if not media_configured:
        media_configured = configure_jellyfin()
    if not media_configured:
        note('WARN', 'Maintainerr media-server wiring skipped; configure Plex or Jellyfin credentials and rerun stackarr configure')
    configure_servarr()
    configure_seerr()
    configure_download_client()
    setup_ready = request('GET', '/api/settings/test/setup', ok=(200,))
    if setup_ready is True:
        note('OK', 'Maintainerr first-run setup is complete')
    else:
        note('WARN', 'Maintainerr first-run setup is still incomplete')
except Exception as exc:
    note('WARN', f'Maintainerr configuration skipped: {exc}')
PY
}

configure_tracearr_stack() {
    if ! optional_service_enabled tracearr; then
        warn "Tracearr configuration skipped because Tracearr is disabled"
        return 0
    fi

    if [[ "${TRACEARR_AUTO_CONFIGURE:-true}" != "true" && "${TRACEARR_AUTO_CONFIGURE:-true}" != "1" ]]; then
        ok "Tracearr auto-configuration disabled; open $TRACEARR_URL and connect your media server manually"
        return 0
    fi

    python3 - <<'PY'
import json
import os
import plistlib
import urllib.error
import urllib.parse
import urllib.request
from pathlib import Path
import xml.etree.ElementTree as ET

TRACEARR = os.environ.get('TRACEARR_URL', 'http://127.0.0.1:3000').rstrip('/')
API = '/api/v1'
CONFIG_ROOT = Path(os.environ.get('CONFIG_ROOT', ''))
PLEX_PREFS_PATH = Path(os.environ.get('PLEX_PREFS_PATH', ''))
PLEX_INSTALL_MODE = os.environ.get('PLEX_INSTALL_MODE', 'native').strip().lower()
JELLYFIN_INSTALL_MODE = os.environ.get('JELLYFIN_INSTALL_MODE', 'disabled').strip().lower()

# Tracearr wiring treats Plex as read-only. It may read the signed-in Plex
# token/prefs or call Plex identity endpoints, but Plex settings must not be
# mutated from this helper.

def note(kind, message):
    print(f"{kind}: {message}")


def flag(value, default=False):
    if value is None or value == '':
        return default
    return str(value).strip().lower() in ('1', 'true', 'yes', 'on')


def request(method, path, payload=None, token='', ok=(200, 201, 204)):
    data = None
    headers = {}
    if token:
        headers['Authorization'] = f'Bearer {token}'
    if payload is not None:
        data = json.dumps(payload).encode()
        headers['Content-Type'] = 'application/json'
    req = urllib.request.Request(f"{TRACEARR}{API}{path}", data=data, headers=headers, method=method)
    try:
        with urllib.request.urlopen(req, timeout=25) as resp:
            body = resp.read().decode()
            parsed = parse_body(body)
            if resp.status not in ok:
                raise RuntimeError(f"{method} {path} returned HTTP {resp.status}")
            return resp.status, parsed
    except urllib.error.HTTPError as exc:
        body = exc.read().decode()
        parsed = parse_body(body)
        if exc.code in ok:
            return exc.code, parsed
        message = str(parsed.get('message') or parsed.get('error') or body[:200] or '').strip()
        suffix = f": {message}" if message else ''
        raise RuntimeError(f"{method} {path} failed with HTTP {exc.code}{suffix}") from exc


def parse_body(body):
    if not body:
        return {}
    try:
        return json.loads(body)
    except Exception:
        return {'message': body}


def normalize_url(url, default_scheme='http'):
    value = (url or '').strip()
    if not value:
        return ''
    if '://' not in value:
        value = f"{default_scheme}://{value}"
    return value.rstrip('/')


def container_url(override, local_url, docker_url, default_port):
    value = normalize_url(override)
    if value:
        return value
    if docker_url:
        return docker_url
    parsed = urllib.parse.urlparse(normalize_url(local_url) or f"http://127.0.0.1:{default_port}")
    hostname = parsed.hostname or 'host.docker.internal'
    if hostname in ('localhost', '127.0.0.1', '::1'):
        hostname = 'host.docker.internal'
    port = parsed.port or default_port
    scheme = parsed.scheme or 'http'
    return f"{scheme}://{hostname}:{port}"


def read_plex_token():
    token = os.environ.get('PLEX_TOKEN', '').strip()
    if token:
        return token
    if not PLEX_PREFS_PATH.exists():
        return ''
    try:
        with PLEX_PREFS_PATH.open('rb') as fh:
            prefs = plistlib.load(fh)
        return str(prefs.get('PlexOnlineToken') or '').strip()
    except Exception:
        return ''


def plex_account_email():
    if not PLEX_PREFS_PATH.exists():
        return ''
    try:
        with PLEX_PREFS_PATH.open('rb') as fh:
            prefs = plistlib.load(fh)
        for key in ('PlexOnlineMail', 'PlexOnlineUsername'):
            value = str(prefs.get(key) or '').strip()
            if '@' in value:
                return value
    except Exception:
        return ''
    return ''


def plex_local_url():
    if PLEX_INSTALL_MODE == 'docker':
        return f"http://127.0.0.1:{os.environ.get('PLEX_DOCKER_PORT', '32400')}"
    return normalize_url(os.environ.get('PLEX_URL', 'http://127.0.0.1:32400'))


def plex_container_url():
    docker_url = 'http://plex:32400' if PLEX_INSTALL_MODE == 'docker' else ''
    return container_url(
        os.environ.get('TRACEARR_PLEX_SERVER_URL', ''),
        os.environ.get('PLEX_URL', 'http://127.0.0.1:32400'),
        docker_url,
        32400,
    )


def jellyfin_container_url():
    docker_url = 'http://jellyfin:8096' if JELLYFIN_INSTALL_MODE == 'docker' else ''
    return container_url(
        os.environ.get('TRACEARR_JELLYFIN_SERVER_URL', ''),
        os.environ.get('JELLYFIN_URL', 'http://127.0.0.1:8096'),
        docker_url,
        8096,
    )


def emby_container_url():
    return container_url(
        os.environ.get('TRACEARR_EMBY_SERVER_URL', ''),
        os.environ.get('EMBY_URL', 'http://127.0.0.1:8096'),
        '',
        8096,
    )


def plex_identity(token):
    name = os.environ.get('TRACEARR_PLEX_SERVER_NAME', '').strip()
    if name:
        return name
    if not token:
        return 'Plex'
    url = f"{plex_local_url()}/?X-Plex-Token={urllib.parse.quote(token)}"
    try:
        with urllib.request.urlopen(url, timeout=15) as resp:
            root = ET.fromstring(resp.read())
        return (
            root.get('friendlyName')
            or root.get('serverName')
            or root.get('name')
            or root.get('machineIdentifier')
            or 'Plex'
        )
    except Exception:
        return 'Plex'


def tracearr_credentials():
    username = os.environ.get('TRACEARR_ADMIN_USERNAME', '').strip() or os.environ.get('USERNAME', 'stackarr').strip() or 'stackarr'
    email = (
        os.environ.get('TRACEARR_ADMIN_EMAIL', '').strip()
        or os.environ.get('USER_EMAIL', '').strip()
        or plex_account_email()
        or 'stackarr@localhost.invalid'
    )
    password = os.environ.get('TRACEARR_ADMIN_PASSWORD', '') or os.environ.get('PASSWORD', '')
    claim_code = os.environ.get('TRACEARR_CLAIM_CODE', '').strip()
    return username, email, password, claim_code


def auth_token(status):
    username, email, password, claim_code = tracearr_credentials()
    if status.get('needsSetup'):
        if not email or not password:
            note('WARN', 'Tracearr owner setup skipped because TRACEARR_ADMIN_EMAIL/USER_EMAIL or a password is missing')
            return ''
        payload = {'username': username, 'email': email, 'password': password}
        if status.get('requiresClaimCode'):
            if not claim_code:
                note('WARN', 'Tracearr owner setup requires TRACEARR_CLAIM_CODE')
                return ''
            payload['claimCode'] = claim_code
        _, result = request('POST', '/auth/signup', payload, ok=(200, 201, 409))
        token = str(result.get('accessToken') or '').strip()
        if token:
            note('OK', 'Tracearr owner account created')
            return token

    if not email or not password:
        note('WARN', 'Tracearr login skipped because TRACEARR_ADMIN_EMAIL/USER_EMAIL or a password is missing')
        return ''
    _, result = request('POST', '/auth/login', {'type': 'local', 'email': email, 'password': password}, ok=(200,))
    token = str(result.get('accessToken') or '').strip()
    if token:
        note('OK', 'Tracearr owner login succeeded')
    return token


def media_server_payload():
    if PLEX_INSTALL_MODE != 'disabled':
        token = read_plex_token()
        if token:
            return {
                'name': plex_identity(token),
                'type': 'plex',
                'url': plex_container_url(),
                'token': token,
            }
        note('WARN', 'Tracearr Plex wiring skipped because no Plex token is available')

    jellyfin_token = os.environ.get('TRACEARR_JELLYFIN_API_KEY', '').strip() or os.environ.get('JELLYFIN_API_KEY', '').strip()
    if JELLYFIN_INSTALL_MODE != 'disabled' and jellyfin_token:
        return {
            'name': os.environ.get('TRACEARR_JELLYFIN_SERVER_NAME', '').strip() or 'Jellyfin',
            'type': 'jellyfin',
            'url': jellyfin_container_url(),
            'token': jellyfin_token,
        }
    if JELLYFIN_INSTALL_MODE != 'disabled':
        note('WARN', 'Tracearr Jellyfin wiring skipped because JELLYFIN_API_KEY is not set')

    emby_token = os.environ.get('TRACEARR_EMBY_API_KEY', '').strip() or os.environ.get('EMBY_API_KEY', '').strip()
    if emby_token:
        return {
            'name': os.environ.get('TRACEARR_EMBY_SERVER_NAME', '').strip() or 'Emby',
            'type': 'emby',
            'url': emby_container_url(),
            'token': emby_token,
        }

    return None


def configure_server(token):
    _, servers = request('GET', '/servers', token=token, ok=(200,))
    items = servers.get('data') if isinstance(servers, dict) else servers
    if not isinstance(items, list):
        items = []
    if items:
        note('OK', 'Tracearr already has a media server configured')
        return

    payload = media_server_payload()
    if not payload:
        note('WARN', 'Tracearr media-server wiring skipped; open Tracearr and connect Plex, Jellyfin, or Emby manually')
        return

    try:
        request('POST', '/servers', payload, token=token, ok=(200, 201, 409))
        note('OK', f"Tracearr connected to {payload['name']}")
    except Exception as exc:
        note('WARN', f'Tracearr media-server wiring skipped: {exc}')


try:
    _, status = request('GET', '/setup/status', ok=(200,))
    if status.get('hasServers'):
        note('OK', 'Tracearr already has a media server configured')
    else:
        token = auth_token(status)
        if token:
            configure_server(token)
        else:
            note('WARN', f'Tracearr manual setup required at {TRACEARR}')
except Exception as exc:
    note('WARN', f'Tracearr configuration skipped: {exc}')
PY
}

configure_romm_stack() {
    if ! optional_service_enabled romm; then
        warn "RomM configuration skipped because RomM is disabled"
        return 0
    fi

    ok "RomM setup is manual; open $ROMM_URL and complete owner setup, library choices, and first scan in RomM"
}

if optional_service_enabled movies; then
    wait_for_http "Radarr" "$RADARR_URL"
fi
if optional_service_enabled radarr4k; then
    wait_for_http "Radarr 4K" "$RADARR_4K_URL"
fi
if optional_service_enabled tv; then
    wait_for_http "Sonarr" "$SONARR_URL"
fi
if optional_service_enabled sonarr4k; then
    wait_for_http "Sonarr 4K" "$SONARR_4K_URL"
fi
if optional_service_enabled pulsarr; then
    wait_for_http "Pulsarr" "$PULSARR_URL/health"
    configure_pulsarr_stack || true
fi
if optional_service_enabled maintainerr; then
    wait_for_http "Maintainerr" "$MAINTAINERR_URL"
    configure_maintainerr_stack || true
    if [[ -n "${MAINTAINERR_CLEANUP_PRESETS:-}" ]]; then
        ok "Maintainerr cleanup preset ideas recorded: $MAINTAINERR_CLEANUP_PRESETS"
    else
        ok "Maintainerr enabled with no cleanup presets configured"
    fi
fi
if optional_service_enabled tracearr; then
    wait_for_http "Tracearr" "$TRACEARR_URL"
    configure_tracearr_stack || true
fi
if optional_service_enabled romm; then
    wait_for_http "RomM" "$ROMM_URL"
    configure_romm_stack || true
fi
wait_for_http "Prowlarr" "$PROWLARR_URL"
if optional_service_enabled lidarr; then
    wait_for_http "Lidarr" "$LIDARR_URL"
fi
if optional_service_enabled seerr; then
    wait_for_http "Seerr" "$SEERR_URL"
fi
if optional_service_enabled flaresolverr; then
    wait_for_http "FlareSolverr" "$FLARESOLVERR_URL"
fi
sync_torrent_archive_hook

if torrent_client_enabled transmission; then
    wait_for_http "Transmission" "$TRANSMISSION_URL"
fi

if torrent_client_enabled qbittorrent; then
    wait_for_http "qBittorrent" "$QBITTORRENT_URL"
fi

"$ROOT_DIR/scripts/downloads.sh" apply --wait --skip-servarr || true

if optional_service_enabled movies; then
    RADARR_KEY="$(wait_for_api_key 'Radarr' "$CONFIG_ROOT/radarr/config.xml")"
else
    RADARR_KEY=""
fi
if optional_service_enabled radarr4k; then
    RADARR_4K_KEY="$(wait_for_api_key 'Radarr 4K' "$CONFIG_ROOT/radarr4k/config.xml")"
else
    RADARR_4K_KEY=""
fi
if optional_service_enabled tv; then
    SONARR_KEY="$(wait_for_api_key 'Sonarr' "$CONFIG_ROOT/sonarr/config.xml")"
else
    SONARR_KEY=""
fi
if optional_service_enabled sonarr4k; then
    SONARR_4K_KEY="$(wait_for_api_key 'Sonarr 4K' "$CONFIG_ROOT/sonarr4k/config.xml")"
else
    SONARR_4K_KEY=""
fi
PROWLARR_KEY="$(wait_for_api_key 'Prowlarr' "$CONFIG_ROOT/prowlarr/config.xml")"
if optional_service_enabled lidarr; then
    LIDARR_KEY="$(wait_for_api_key 'Lidarr' "$CONFIG_ROOT/lidarr/config.xml")"
else
    LIDARR_KEY=""
fi
LIDARR_QUALITY_PROFILE_ID="$(curl -fsS "$LIDARR_URL/api/v1/qualityprofile" -H "X-Api-Key: $LIDARR_KEY" 2>/dev/null | first_json_id || true)"
LIDARR_METADATA_PROFILE_ID="$(curl -fsS "$LIDARR_URL/api/v1/metadataprofile" -H "X-Api-Key: $LIDARR_KEY" 2>/dev/null | first_json_id || true)"
PROWLARR_APP_PROFILE_ID="$(curl -fsS "$PROWLARR_URL/api/v1/appProfile" -H "X-Api-Key: $PROWLARR_KEY" 2>/dev/null | first_json_id || true)"
LIDARR_QUALITY_PROFILE_ID="${LIDARR_QUALITY_PROFILE_ID:-1}"
LIDARR_METADATA_PROFILE_ID="${LIDARR_METADATA_PROFILE_ID:-1}"
PROWLARR_APP_PROFILE_ID="${PROWLARR_APP_PROFILE_ID:-1}"
RADARR_DEFAULT_PROFILE="${STACKARR_MOVIE_DEFAULT_PROFILE:-$(media_profile_name_from_preset "$STACKARR_MOVIE_PROFILE_PRESET" hd)}"
RADARR_4K_DEFAULT_PROFILE="${STACKARR_MOVIE_4K_DEFAULT_PROFILE:-$(media_profile_name_from_preset "$STACKARR_MOVIE_4K_PROFILE_PRESET" 4k)}"
SONARR_DEFAULT_PROFILE="${STACKARR_TV_DEFAULT_PROFILE:-$(media_profile_name_from_preset "$STACKARR_TV_PROFILE_PRESET" hd)}"
SONARR_4K_DEFAULT_PROFILE="${STACKARR_TV_4K_DEFAULT_PROFILE:-$(media_profile_name_from_preset "$STACKARR_TV_4K_PROFILE_PRESET" 4k)}"
LIDARR_DEFAULT_PROFILE="${STACKARR_MUSIC_DEFAULT_PROFILE:-$(music_profile_name_from_preset "$STACKARR_MUSIC_PROFILE_PRESET")}"

if optional_service_enabled lidarr; then
    ensure_lidarr_metadata_profile "Lidarr Stackarr metadata profile configured" "$LIDARR_URL/api/v1/metadataprofile" "$LIDARR_URL/api/v1/metadataprofile" "$LIDARR_URL/api/v1/metadataprofile" "$LIDARR_KEY" "Standard" "Stackarr Music"
    ensure_quality_profile_variant "Lidarr lossless profile configured" "$LIDARR_URL/api/v1/qualityprofile" "$LIDARR_URL/api/v1/qualityprofile" "$LIDARR_URL/api/v1/qualityprofile" "$LIDARR_KEY" "Any" "Lossless" "FLAC,ALAC,APE,WavPack,WAV,FLAC 24bit,ALAC 24bit"
    ensure_quality_profile_variant "Lidarr lossy 256+ profile configured" "$LIDARR_URL/api/v1/qualityprofile" "$LIDARR_URL/api/v1/qualityprofile" "$LIDARR_URL/api/v1/qualityprofile" "$LIDARR_KEY" "Any" "Lossy 256+" "MP3-256,AAC-256,MP3-VBR-V0,AAC-VBR,MP3-320,AAC-320"
    LIDARR_QUALITY_PROFILE_ID="$(profile_id_by_names "$LIDARR_URL/api/v1/qualityprofile" "$LIDARR_KEY" "$LIDARR_DEFAULT_PROFILE" "Lossless" "Any" || true)"
    LIDARR_METADATA_PROFILE_ID="$(profile_id_by_names "$LIDARR_URL/api/v1/metadataprofile" "$LIDARR_KEY" "Stackarr Music" "Standard" || true)"
    LIDARR_QUALITY_PROFILE_ID="${LIDARR_QUALITY_PROFILE_ID:-1}"
    LIDARR_METADATA_PROFILE_ID="${LIDARR_METADATA_PROFILE_ID:-1}"
fi

ensure_root_folder "Radarr root folder set" "$RADARR_URL/api/v3/rootfolder" "$RADARR_URL/api/v3/rootfolder" "$RADARR_KEY" "/movies" '{"path":"/movies"}'
ensure_root_folder "Sonarr root folder set" "$SONARR_URL/api/v3/rootfolder" "$SONARR_URL/api/v3/rootfolder" "$SONARR_KEY" "/tv" '{"path":"/tv"}'
ensure_root_folder "Lidarr root folder set" "$LIDARR_URL/api/v1/rootfolder" "$LIDARR_URL/api/v1/rootfolder" "$LIDARR_KEY" "/music" "$(lidarr_rootfolder_payload "$LIDARR_QUALITY_PROFILE_ID" "$LIDARR_METADATA_PROFILE_ID")"
if optional_service_enabled radarr4k; then
    ensure_root_folder "Radarr 4K root folder set" "$RADARR_4K_URL/api/v3/rootfolder" "$RADARR_4K_URL/api/v3/rootfolder" "$RADARR_4K_KEY" "/movies" '{"path":"/movies"}'
fi
if optional_service_enabled sonarr4k; then
    ensure_root_folder "Sonarr 4K root folder set" "$SONARR_4K_URL/api/v3/rootfolder" "$SONARR_4K_URL/api/v3/rootfolder" "$SONARR_4K_KEY" "/tv" '{"path":"/tv"}'
fi

ensure_notification "Radarr torrent archive notification configured" "$RADARR_URL/api/v3/notification" "$RADARR_URL/api/v3/notification" "$RADARR_URL/api/v3/notification" "$RADARR_KEY" "Stackarr Torrent Archive" "$(radarr_torrent_archive_notification_payload)"
ensure_notification "Sonarr torrent archive notification configured" "$SONARR_URL/api/v3/notification" "$SONARR_URL/api/v3/notification" "$SONARR_URL/api/v3/notification" "$SONARR_KEY" "Stackarr Torrent Archive" "$(sonarr_torrent_archive_notification_payload)"
delete_named_service "Radarr prefer English audio notification removed" "$RADARR_URL/api/v3/notification" "$RADARR_URL/api/v3/notification" "$RADARR_KEY" "Stackarr Prefer English Audio"
delete_named_service "Sonarr prefer English audio notification removed" "$SONARR_URL/api/v3/notification" "$SONARR_URL/api/v3/notification" "$SONARR_KEY" "Stackarr Prefer English Audio"
delete_named_service "Radarr Plex notification removed" "$RADARR_URL/api/v3/notification" "$RADARR_URL/api/v3/notification" "$RADARR_KEY" "Plex"
delete_named_service "Sonarr Plex notification removed" "$SONARR_URL/api/v3/notification" "$SONARR_URL/api/v3/notification" "$SONARR_KEY" "Plex"
if optional_service_enabled radarr4k; then
    ensure_notification "Radarr 4K torrent archive notification configured" "$RADARR_4K_URL/api/v3/notification" "$RADARR_4K_URL/api/v3/notification" "$RADARR_4K_URL/api/v3/notification" "$RADARR_4K_KEY" "Stackarr Torrent Archive" "$(radarr_torrent_archive_notification_payload)"
    delete_named_service "Radarr 4K prefer English audio notification removed" "$RADARR_4K_URL/api/v3/notification" "$RADARR_4K_URL/api/v3/notification" "$RADARR_4K_KEY" "Stackarr Prefer English Audio"
    delete_named_service "Radarr 4K Plex notification removed" "$RADARR_4K_URL/api/v3/notification" "$RADARR_4K_URL/api/v3/notification" "$RADARR_4K_KEY" "Plex"
fi
if optional_service_enabled sonarr4k; then
    ensure_notification "Sonarr 4K torrent archive notification configured" "$SONARR_4K_URL/api/v3/notification" "$SONARR_4K_URL/api/v3/notification" "$SONARR_4K_URL/api/v3/notification" "$SONARR_4K_KEY" "Stackarr Torrent Archive" "$(sonarr_torrent_archive_notification_payload)"
    delete_named_service "Sonarr 4K prefer English audio notification removed" "$SONARR_4K_URL/api/v3/notification" "$SONARR_4K_URL/api/v3/notification" "$SONARR_4K_KEY" "Stackarr Prefer English Audio"
    delete_named_service "Sonarr 4K Plex notification removed" "$SONARR_4K_URL/api/v3/notification" "$SONARR_4K_URL/api/v3/notification" "$SONARR_4K_KEY" "Plex"
fi
if torrent_client_enabled transmission; then
    ensure_download_client "Radarr Transmission client configured" "$RADARR_URL/api/v3/downloadclient" "$RADARR_URL/api/v3/downloadclient" "$RADARR_URL/api/v3/downloadclient" "$RADARR_KEY" "Transmission" "$(radarr_download_payload "$RADARR_CATEGORY")"
    ensure_download_client "Sonarr Transmission client configured" "$SONARR_URL/api/v3/downloadclient" "$SONARR_URL/api/v3/downloadclient" "$SONARR_URL/api/v3/downloadclient" "$SONARR_KEY" "Transmission" "$(sonarr_download_payload "$SONARR_CATEGORY")"
    ensure_download_client "Lidarr Transmission client configured" "$LIDARR_URL/api/v1/downloadclient" "$LIDARR_URL/api/v1/downloadclient" "$LIDARR_URL/api/v1/downloadclient" "$LIDARR_KEY" "Transmission" "$(lidarr_download_payload)"
    configure_servarr_download_handling "Radarr completed download handling enabled" "$RADARR_URL/api/v3/config/downloadclient" "$RADARR_KEY"
    configure_servarr_download_handling "Sonarr completed download handling enabled" "$SONARR_URL/api/v3/config/downloadclient" "$SONARR_KEY"
    configure_servarr_download_handling "Lidarr completed download handling disabled" "$LIDARR_URL/api/v1/config/downloadclient" "$LIDARR_KEY" false

    delete_named_service "Radarr qBittorrent client removed" "$RADARR_URL/api/v3/downloadclient" "$RADARR_URL/api/v3/downloadclient" "$RADARR_KEY" "qBittorrent"
    delete_named_service "Sonarr qBittorrent client removed" "$SONARR_URL/api/v3/downloadclient" "$SONARR_URL/api/v3/downloadclient" "$SONARR_KEY" "qBittorrent"
    delete_named_service "Lidarr qBittorrent client removed" "$LIDARR_URL/api/v1/downloadclient" "$LIDARR_URL/api/v1/downloadclient" "$LIDARR_KEY" "qBittorrent"
    if optional_service_enabled radarr4k; then
        ensure_download_client "Radarr 4K Transmission client configured" "$RADARR_4K_URL/api/v3/downloadclient" "$RADARR_4K_URL/api/v3/downloadclient" "$RADARR_4K_URL/api/v3/downloadclient" "$RADARR_4K_KEY" "Transmission" "$(radarr_download_payload "$RADARR_4K_CATEGORY")"
        configure_servarr_download_handling "Radarr 4K completed download handling enabled" "$RADARR_4K_URL/api/v3/config/downloadclient" "$RADARR_4K_KEY"
        delete_named_service "Radarr 4K qBittorrent client removed" "$RADARR_4K_URL/api/v3/downloadclient" "$RADARR_4K_URL/api/v3/downloadclient" "$RADARR_4K_KEY" "qBittorrent"
    fi
    if optional_service_enabled sonarr4k; then
        ensure_download_client "Sonarr 4K Transmission client configured" "$SONARR_4K_URL/api/v3/downloadclient" "$SONARR_4K_URL/api/v3/downloadclient" "$SONARR_4K_URL/api/v3/downloadclient" "$SONARR_4K_KEY" "Transmission" "$(sonarr_download_payload "$SONARR_4K_CATEGORY")"
        configure_servarr_download_handling "Sonarr 4K completed download handling enabled" "$SONARR_4K_URL/api/v3/config/downloadclient" "$SONARR_4K_KEY"
        delete_named_service "Sonarr 4K qBittorrent client removed" "$SONARR_4K_URL/api/v3/downloadclient" "$SONARR_4K_URL/api/v3/downloadclient" "$SONARR_4K_KEY" "qBittorrent"
    fi
else
    delete_named_service "Radarr Transmission client removed" "$RADARR_URL/api/v3/downloadclient" "$RADARR_URL/api/v3/downloadclient" "$RADARR_KEY" "Transmission"
    delete_named_service "Sonarr Transmission client removed" "$SONARR_URL/api/v3/downloadclient" "$SONARR_URL/api/v3/downloadclient" "$SONARR_KEY" "Transmission"
    delete_named_service "Lidarr Transmission client removed" "$LIDARR_URL/api/v1/downloadclient" "$LIDARR_URL/api/v1/downloadclient" "$LIDARR_KEY" "Transmission"

    ensure_download_client "Radarr qBittorrent client configured" "$RADARR_URL/api/v3/downloadclient" "$RADARR_URL/api/v3/downloadclient" "$RADARR_URL/api/v3/downloadclient" "$RADARR_KEY" "qBittorrent" "$(radarr_qbittorrent_download_payload "$RADARR_CATEGORY")"
    ensure_download_client "Sonarr qBittorrent client configured" "$SONARR_URL/api/v3/downloadclient" "$SONARR_URL/api/v3/downloadclient" "$SONARR_URL/api/v3/downloadclient" "$SONARR_KEY" "qBittorrent" "$(sonarr_qbittorrent_download_payload "$SONARR_CATEGORY")"
    ensure_download_client "Lidarr qBittorrent client configured" "$LIDARR_URL/api/v1/downloadclient" "$LIDARR_URL/api/v1/downloadclient" "$LIDARR_URL/api/v1/downloadclient" "$LIDARR_KEY" "qBittorrent" "$(lidarr_qbittorrent_download_payload)"
    configure_servarr_download_handling "Radarr completed download handling enabled" "$RADARR_URL/api/v3/config/downloadclient" "$RADARR_KEY"
    configure_servarr_download_handling "Sonarr completed download handling enabled" "$SONARR_URL/api/v3/config/downloadclient" "$SONARR_KEY"
    configure_servarr_download_handling "Lidarr completed download handling disabled" "$LIDARR_URL/api/v1/config/downloadclient" "$LIDARR_KEY" false
    if optional_service_enabled radarr4k; then
        delete_named_service "Radarr 4K Transmission client removed" "$RADARR_4K_URL/api/v3/downloadclient" "$RADARR_4K_URL/api/v3/downloadclient" "$RADARR_4K_KEY" "Transmission"
        ensure_download_client "Radarr 4K qBittorrent client configured" "$RADARR_4K_URL/api/v3/downloadclient" "$RADARR_4K_URL/api/v3/downloadclient" "$RADARR_4K_URL/api/v3/downloadclient" "$RADARR_4K_KEY" "qBittorrent" "$(radarr_qbittorrent_download_payload "$RADARR_4K_CATEGORY")"
        configure_servarr_download_handling "Radarr 4K completed download handling enabled" "$RADARR_4K_URL/api/v3/config/downloadclient" "$RADARR_4K_KEY"
    fi
    if optional_service_enabled sonarr4k; then
        delete_named_service "Sonarr 4K Transmission client removed" "$SONARR_4K_URL/api/v3/downloadclient" "$SONARR_4K_URL/api/v3/downloadclient" "$SONARR_4K_KEY" "Transmission"
        ensure_download_client "Sonarr 4K qBittorrent client configured" "$SONARR_4K_URL/api/v3/downloadclient" "$SONARR_4K_URL/api/v3/downloadclient" "$SONARR_4K_URL/api/v3/downloadclient" "$SONARR_4K_KEY" "qBittorrent" "$(sonarr_qbittorrent_download_payload "$SONARR_4K_CATEGORY")"
        configure_servarr_download_handling "Sonarr 4K completed download handling enabled" "$SONARR_4K_URL/api/v3/config/downloadclient" "$SONARR_4K_KEY"
    fi
fi

if optional_service_enabled flaresolverr; then
    FLARE_TAG_ID="$(ensure_prowlarr_tag 'flaresolverr' || true)"
else
    FLARE_TAG_ID=""
    warn "FlareSolverr proxy skipped because FlareSolverr is disabled"
fi
if [[ -n "$FLARE_TAG_ID" ]]; then
    api_post_json "Prowlarr FlareSolverr proxy configured" "$PROWLARR_URL/api/v1/indexerProxy" "$PROWLARR_KEY" "$(flaresolverr_proxy_payload "$FLARE_TAG_ID")" || true
else
    warn "Could not create or read FlareSolverr tag in Prowlarr"
fi

ensure_prowlarr_indexer "Prowlarr YTS indexer configured" "YTS"
ensure_prowlarr_indexer "Prowlarr The Pirate Bay indexer configured" "The Pirate Bay"
ensure_prowlarr_indexer "Prowlarr TorrentQuest indexer configured" "TorrentQuest"
ensure_prowlarr_indexer "Prowlarr RARBG indexer configured" "RARBG"
if [[ -n "$FLARE_TAG_ID" ]]; then
    ensure_prowlarr_indexer "Prowlarr EZTV indexer configured" "EZTV" "$FLARE_TAG_ID"
else
    warn "Skipping EZTV because the FlareSolverr tag is unavailable"
fi
delete_named_service "Prowlarr 1337x indexer removed" "$PROWLARR_URL/api/v1/indexer" "$PROWLARR_URL/api/v1/indexer" "$PROWLARR_KEY" "1337x"

if optional_service_enabled movies; then
    ensure_prowlarr_application "Prowlarr connected to Radarr" "$PROWLARR_URL/api/v1/applications" "$PROWLARR_URL/api/v1/applications" "$PROWLARR_URL/api/v1/applications" "$PROWLARR_KEY" "Radarr" "$(prowlarr_app_payload 'Radarr' 'Radarr' 'http://radarr:7878' "$RADARR_KEY" '[2000,2010,2020,2030,2040,2045,2050,2060,2070,2080]')" || true
fi
if optional_service_enabled radarr4k; then
    ensure_prowlarr_application "Prowlarr connected to Radarr 4K" "$PROWLARR_URL/api/v1/applications" "$PROWLARR_URL/api/v1/applications" "$PROWLARR_URL/api/v1/applications" "$PROWLARR_KEY" "Radarr 4K" "$(prowlarr_app_payload 'Radarr 4K' 'Radarr' 'http://radarr4k:7878' "$RADARR_4K_KEY" '[2000,2010,2020,2030,2040,2045,2050,2060,2070,2080]')" || true
else
    delete_named_service "Prowlarr Radarr 4K application removed" "$PROWLARR_URL/api/v1/applications" "$PROWLARR_URL/api/v1/applications" "$PROWLARR_KEY" "Radarr 4K"
fi
if optional_service_enabled tv; then
    ensure_prowlarr_application "Prowlarr connected to Sonarr" "$PROWLARR_URL/api/v1/applications" "$PROWLARR_URL/api/v1/applications" "$PROWLARR_URL/api/v1/applications" "$PROWLARR_KEY" "Sonarr" "$(prowlarr_app_payload 'Sonarr' 'Sonarr' 'http://sonarr:8989' "$SONARR_KEY" '[5000,5010,5020,5030,5040,5045,5050,5060,5070,5080]')" || true
fi
if optional_service_enabled sonarr4k; then
    ensure_prowlarr_application "Prowlarr connected to Sonarr 4K" "$PROWLARR_URL/api/v1/applications" "$PROWLARR_URL/api/v1/applications" "$PROWLARR_URL/api/v1/applications" "$PROWLARR_KEY" "Sonarr 4K" "$(prowlarr_app_payload 'Sonarr 4K' 'Sonarr' 'http://sonarr4k:8989' "$SONARR_4K_KEY" '[5000,5010,5020,5030,5040,5045,5050,5060,5070,5080]')" || true
else
    delete_named_service "Prowlarr Sonarr 4K application removed" "$PROWLARR_URL/api/v1/applications" "$PROWLARR_URL/api/v1/applications" "$PROWLARR_KEY" "Sonarr 4K"
fi
if optional_service_enabled lidarr; then
    ensure_prowlarr_application "Prowlarr connected to Lidarr" "$PROWLARR_URL/api/v1/applications" "$PROWLARR_URL/api/v1/applications" "$PROWLARR_URL/api/v1/applications" "$PROWLARR_KEY" "Lidarr" "$(prowlarr_app_payload 'Lidarr' 'Lidarr' 'http://lidarr:8686' "$LIDARR_KEY" '[3000,3010,3020,3030,3040]')" || true
fi
trigger_prowlarr_sync || true

sync_recyclarr_profiles || true

SONARR_ENGLISH_ONLY_AUDIO_REGEX='\\b(?:MULTI|DUAL(?:[ ._-]?AUDIO)?|ITA(?:LIAN)?|TRUEFRENCH|FRENCH|GERMAN|DUTCH|SPANISH|LATINO|RUS(?:SIAN)?|POLISH|HINDI|JAP(?:ANESE)?|KOREAN|CHINESE|PT-?BR|PORTUGUESE|TURKISH|UKRAINIAN|CZECH|SWEDISH|NORWEGIAN|DANISH|FINNISH|ARABIC)\\b'
SONARR_ENGLISH_ONLY_SCORE="10000"
SONARR_MULTI_EPISODE_PACK_REGEX='(?:\\bS\\d{1,2}E\\d{1,3}(?:[ ._-]+(?:E)?\\d{1,3}|E\\d{1,3})+\\b|\\b\\d{1,2}x\\d{1,3}(?:[ ._-]+(?:x)?\\d{1,3}|x\\d{1,3})+\\b|\\bS\\d{1,2}\\b(?![ ._-]?E\\d{1,3})|\\bSeason[ ._-]?\\d{1,2}\\b)'
SONARR_MULTI_EPISODE_PACK_SCORE="-100000"
SONARR_X265_REGEX='[xh][ ._-]?265|\\bHEVC(\\b|\\d)'
SONARR_X265_SCORE="10000"
SONARR_X265_ENGLISH_CUTOFF_SCORE="$((SONARR_ENGLISH_ONLY_SCORE + SONARR_X265_SCORE))"
SONARR_H264_MIN_FORMAT_SCORE="$SONARR_ENGLISH_ONLY_SCORE"
RADARR_MOVIE_BUNDLE_PACK_REGEX='\\b(?:complete[ ._-]?collection|box[ ._-]?set|duology|trilogy|tetralogy|pentalogy|hexalogy|(?:[2-9])[ ._-]?in[ ._-]?1)\\b'
RADARR_MOVIE_BUNDLE_PACK_SCORE="-100000"
RADARR_TIGOLE_REGEX='Tigole'
RADARR_TIGOLE_LITE_SCORE="200"
RADARR_TIGOLE_HD_SCORE="250"
RADARR_TIGOLE_4K_SCORE="250"
RADARR_X265_REGEX='[xh][ ._-]?265|\\bHEVC(\\b|\\d)'
RADARR_X265_HD_SCORE="10000"
RADARR_X265_4K_SCORE="10000"
RADARR_H264_MIN_FORMAT_SCORE="0"

ensure_custom_format_release_group "Radarr YTS custom format configured" "$RADARR_URL/api/v3/customformat" "$RADARR_URL/api/v3/customformat" "$RADARR_URL/api/v3/customformat" "$RADARR_KEY" "YTS" "^(YIFY|YTS(\\.(MX|LT|AG))?)$"
ensure_custom_format_release_title "Radarr Tigole custom format configured" "$RADARR_URL/api/v3/customformat" "$RADARR_URL/api/v3/customformat" "$RADARR_URL/api/v3/customformat" "$RADARR_KEY" "Tigole" "$RADARR_TIGOLE_REGEX" "false"
ensure_custom_format_release_title "Radarr x265 custom format configured" "$RADARR_URL/api/v3/customformat" "$RADARR_URL/api/v3/customformat" "$RADARR_URL/api/v3/customformat" "$RADARR_KEY" "x265" "$RADARR_X265_REGEX" "false"
ensure_custom_format_release_title "Radarr movie bundle pack custom format configured" "$RADARR_URL/api/v3/customformat" "$RADARR_URL/api/v3/customformat" "$RADARR_URL/api/v3/customformat" "$RADARR_KEY" "Movie Bundle Pack" "$RADARR_MOVIE_BUNDLE_PACK_REGEX" "false"
ensure_custom_format_release_title "Sonarr x265 custom format configured" "$SONARR_URL/api/v3/customformat" "$SONARR_URL/api/v3/customformat" "$SONARR_URL/api/v3/customformat" "$SONARR_KEY" "x265" "$SONARR_X265_REGEX" "false"
ensure_custom_format_release_title "Sonarr English-only audio custom format configured" "$SONARR_URL/api/v3/customformat" "$SONARR_URL/api/v3/customformat" "$SONARR_URL/api/v3/customformat" "$SONARR_KEY" "English Only Audio" "$SONARR_ENGLISH_ONLY_AUDIO_REGEX" "true"
ensure_custom_format_release_title "Sonarr multi-episode pack custom format configured" "$SONARR_URL/api/v3/customformat" "$SONARR_URL/api/v3/customformat" "$SONARR_URL/api/v3/customformat" "$SONARR_KEY" "Multi-Episode Pack" "$SONARR_MULTI_EPISODE_PACK_REGEX" "false"
if optional_service_enabled radarr4k; then
    ensure_custom_format_release_group "Radarr 4K YTS custom format configured" "$RADARR_4K_URL/api/v3/customformat" "$RADARR_4K_URL/api/v3/customformat" "$RADARR_4K_URL/api/v3/customformat" "$RADARR_4K_KEY" "YTS" "^(YIFY|YTS(\\.(MX|LT|AG))?)$"
    ensure_custom_format_release_title "Radarr 4K Tigole custom format configured" "$RADARR_4K_URL/api/v3/customformat" "$RADARR_4K_URL/api/v3/customformat" "$RADARR_4K_URL/api/v3/customformat" "$RADARR_4K_KEY" "Tigole" "$RADARR_TIGOLE_REGEX" "false"
    ensure_custom_format_release_title "Radarr 4K x265 custom format configured" "$RADARR_4K_URL/api/v3/customformat" "$RADARR_4K_URL/api/v3/customformat" "$RADARR_4K_URL/api/v3/customformat" "$RADARR_4K_KEY" "x265" "$RADARR_X265_REGEX" "false"
    ensure_custom_format_release_title "Radarr 4K x265 custom format configured" "$RADARR_4K_URL/api/v3/customformat" "$RADARR_4K_URL/api/v3/customformat" "$RADARR_4K_URL/api/v3/customformat" "$RADARR_4K_KEY" "x265 (UHD)" "$RADARR_X265_REGEX" "false"
    ensure_custom_format_release_title "Radarr 4K movie bundle pack custom format configured" "$RADARR_4K_URL/api/v3/customformat" "$RADARR_4K_URL/api/v3/customformat" "$RADARR_4K_URL/api/v3/customformat" "$RADARR_4K_KEY" "Movie Bundle Pack" "$RADARR_MOVIE_BUNDLE_PACK_REGEX" "false"
fi
if optional_service_enabled sonarr4k; then
    ensure_custom_format_release_title "Sonarr 4K x265 custom format configured" "$SONARR_4K_URL/api/v3/customformat" "$SONARR_4K_URL/api/v3/customformat" "$SONARR_4K_URL/api/v3/customformat" "$SONARR_4K_KEY" "x265" "$SONARR_X265_REGEX" "false"
    ensure_custom_format_release_title "Sonarr 4K English-only audio custom format configured" "$SONARR_4K_URL/api/v3/customformat" "$SONARR_4K_URL/api/v3/customformat" "$SONARR_4K_URL/api/v3/customformat" "$SONARR_4K_KEY" "English Only Audio" "$SONARR_ENGLISH_ONLY_AUDIO_REGEX" "true"
    ensure_custom_format_release_title "Sonarr 4K multi-episode pack custom format configured" "$SONARR_4K_URL/api/v3/customformat" "$SONARR_4K_URL/api/v3/customformat" "$SONARR_4K_URL/api/v3/customformat" "$SONARR_4K_KEY" "Multi-Episode Pack" "$SONARR_MULTI_EPISODE_PACK_REGEX" "false"
fi

LIDARR_EXPLICIT_REGEX='\b(?:explicit|\[E\]|\(E\))\b'
LIDARR_CLEAN_REGEX='\b(?:clean|edited|radio[ ._-]?edit|censored)\b'
LIDARR_AIFF_REGEX='\bAIFF?\b'
LIDARR_24BIT_REGEX='\b(?:24[ ._-]?bit|24[ ._-]?(?:44|48|88|96|176|192)|(?:44|48|88|96|176|192)[ ._-]?24)\b'
LIDARR_16BIT_REGEX='\b(?:16[ ._-]?bit|16[ ._-]?(?:44|48)|(?:44|48)[ ._-]?16)\b'
if optional_service_enabled lidarr; then
    ensure_custom_format_release_title "Lidarr explicit custom format configured" "$LIDARR_URL/api/v1/customformat" "$LIDARR_URL/api/v1/customformat" "$LIDARR_URL/api/v1/customformat" "$LIDARR_KEY" "Explicit" "$LIDARR_EXPLICIT_REGEX" "false"
    ensure_custom_format_release_title "Lidarr clean custom format configured" "$LIDARR_URL/api/v1/customformat" "$LIDARR_URL/api/v1/customformat" "$LIDARR_URL/api/v1/customformat" "$LIDARR_KEY" "Clean" "$LIDARR_CLEAN_REGEX" "false"
    ensure_custom_format_release_title "Lidarr AIFF custom format configured" "$LIDARR_URL/api/v1/customformat" "$LIDARR_URL/api/v1/customformat" "$LIDARR_URL/api/v1/customformat" "$LIDARR_KEY" "AIFF" "$LIDARR_AIFF_REGEX" "false"
    ensure_custom_format_release_title "Lidarr 24-bit custom format configured" "$LIDARR_URL/api/v1/customformat" "$LIDARR_URL/api/v1/customformat" "$LIDARR_URL/api/v1/customformat" "$LIDARR_KEY" "24-bit" "$LIDARR_24BIT_REGEX" "false"
    ensure_custom_format_release_title "Lidarr 16-bit custom format configured" "$LIDARR_URL/api/v1/customformat" "$LIDARR_URL/api/v1/customformat" "$LIDARR_URL/api/v1/customformat" "$LIDARR_KEY" "16-bit" "$LIDARR_16BIT_REGEX" "false"
    ensure_quality_profile_custom_formats "Lidarr lossless profile preferences configured" "$LIDARR_URL/api/v1/qualityprofile" "$LIDARR_URL/api/v1/qualityprofile" "$LIDARR_URL/api/v1/customformat" "$LIDARR_KEY" "Lossless" "Clean:-100000,Explicit:10000,AIFF:1000,24-bit:500,16-bit:25" "0" "10000" "1"
    ensure_quality_profile_custom_formats "Lidarr lossy 256+ profile preferences configured" "$LIDARR_URL/api/v1/qualityprofile" "$LIDARR_URL/api/v1/qualityprofile" "$LIDARR_URL/api/v1/customformat" "$LIDARR_KEY" "Lossy 256+" "Clean:-100000,Explicit:10000" "0" "10000" "1"
fi

ensure_request_quality_profile "Radarr HD profile configured" "$RADARR_URL/api/v3/qualityprofile" "$RADARR_URL/api/v3/qualityprofile" "$RADARR_URL/api/v3/qualityprofile" "$RADARR_URL/api/v3/customformat" "$RADARR_KEY" "HD Bluray + WEB" "HD" "SDTV,DVD,WEB 480p,Bluray-480p,Bluray-576p,HDTV-720p,WEB 720p,Bluray-720p,HDTV-1080p,WEB 1080p,Bluray-1080p" "false"
ensure_request_quality_profile "Radarr HD Lite profile configured" "$RADARR_URL/api/v3/qualityprofile" "$RADARR_URL/api/v3/qualityprofile" "$RADARR_URL/api/v3/qualityprofile" "$RADARR_URL/api/v3/customformat" "$RADARR_KEY" "HD Bluray + WEB" "HD Lite" "WEB 1080p,Bluray-1080p" "true" "YTS" "100" "1" "100"

ensure_request_quality_profile "Sonarr HD profile configured" "$SONARR_URL/api/v3/qualityprofile" "$SONARR_URL/api/v3/qualityprofile" "$SONARR_URL/api/v3/qualityprofile" "$SONARR_URL/api/v3/customformat" "$SONARR_KEY" "Any" "HD" "SDTV,WEB 480p,DVD,Bluray-480p,Bluray-576p,HDTV-720p,HDTV-1080p,WEB 720p,Bluray-720p,WEB 1080p,Bluray-1080p" "true" "English Only Audio" "$SONARR_ENGLISH_ONLY_SCORE" "$SONARR_ENGLISH_ONLY_SCORE" "$SONARR_ENGLISH_ONLY_SCORE"
ensure_request_quality_profile "Sonarr HD Lite profile configured" "$SONARR_URL/api/v3/qualityprofile" "$SONARR_URL/api/v3/qualityprofile" "$SONARR_URL/api/v3/qualityprofile" "$SONARR_URL/api/v3/customformat" "$SONARR_KEY" "Any" "HD Lite" "WEB 1080p,Bluray-1080p" "false" "English Only Audio" "$SONARR_ENGLISH_ONLY_SCORE" "$SONARR_ENGLISH_ONLY_SCORE" "$SONARR_ENGLISH_ONLY_SCORE"
if optional_service_enabled radarr4k; then
    ensure_request_quality_profile "Radarr 4K profile configured" "$RADARR_4K_URL/api/v3/qualityprofile" "$RADARR_4K_URL/api/v3/qualityprofile" "$RADARR_4K_URL/api/v3/qualityprofile" "$RADARR_4K_URL/api/v3/customformat" "$RADARR_4K_KEY" "UHD Bluray + WEB" "4K" "HDTV-2160p,WEB 2160p,Bluray-2160p" "false"
    ensure_request_quality_profile "Radarr 4K Lite profile configured" "$RADARR_4K_URL/api/v3/qualityprofile" "$RADARR_4K_URL/api/v3/qualityprofile" "$RADARR_4K_URL/api/v3/qualityprofile" "$RADARR_4K_URL/api/v3/customformat" "$RADARR_4K_KEY" "UHD Bluray + WEB" "4K Lite" "WEB 2160p,Bluray-2160p" "true" "YTS" "100" "1" "100"
fi
if optional_service_enabled sonarr4k; then
    ensure_request_quality_profile "Sonarr 4K profile configured" "$SONARR_4K_URL/api/v3/qualityprofile" "$SONARR_4K_URL/api/v3/qualityprofile" "$SONARR_4K_URL/api/v3/qualityprofile" "$SONARR_4K_URL/api/v3/customformat" "$SONARR_4K_KEY" "Any" "4K" "HDTV-2160p,WEB 2160p,Bluray-2160p" "true" "English Only Audio" "$SONARR_ENGLISH_ONLY_SCORE" "$SONARR_ENGLISH_ONLY_SCORE" "$SONARR_ENGLISH_ONLY_SCORE"
    ensure_request_quality_profile "Sonarr 4K Lite profile configured" "$SONARR_4K_URL/api/v3/qualityprofile" "$SONARR_4K_URL/api/v3/qualityprofile" "$SONARR_4K_URL/api/v3/qualityprofile" "$SONARR_4K_URL/api/v3/customformat" "$SONARR_4K_KEY" "WEB-2160p" "4K Lite" "WEB 2160p" "false" "English Only Audio" "$SONARR_ENGLISH_ONLY_SCORE" "$SONARR_ENGLISH_ONLY_SCORE" "$SONARR_ENGLISH_ONLY_SCORE"
fi

ensure_quality_profile_custom_formats "Radarr HD profile safeguards configured" "$RADARR_URL/api/v3/qualityprofile" "$RADARR_URL/api/v3/qualityprofile" "$RADARR_URL/api/v3/customformat" "$RADARR_KEY" "HD" "Movie Bundle Pack:${RADARR_MOVIE_BUNDLE_PACK_SCORE},x265 (HD):${RADARR_X265_HD_SCORE},Tigole:${RADARR_TIGOLE_HD_SCORE}" "$RADARR_H264_MIN_FORMAT_SCORE" "$RADARR_X265_HD_SCORE" "1"
ensure_quality_profile_custom_formats "Radarr HD Lite profile safeguards configured" "$RADARR_URL/api/v3/qualityprofile" "$RADARR_URL/api/v3/qualityprofile" "$RADARR_URL/api/v3/customformat" "$RADARR_KEY" "HD Lite" "Movie Bundle Pack:${RADARR_MOVIE_BUNDLE_PACK_SCORE},YTS:100,x265 (HD):${RADARR_X265_HD_SCORE},Tigole:${RADARR_TIGOLE_LITE_SCORE}" "$RADARR_H264_MIN_FORMAT_SCORE" "$RADARR_X265_HD_SCORE" "1"
ensure_quality_profile_custom_formats "Radarr Any profile h265 gate configured" "$RADARR_URL/api/v3/qualityprofile" "$RADARR_URL/api/v3/qualityprofile" "$RADARR_URL/api/v3/customformat" "$RADARR_KEY" "Any" "Movie Bundle Pack:${RADARR_MOVIE_BUNDLE_PACK_SCORE},x265:${RADARR_X265_HD_SCORE}" "$RADARR_X265_HD_SCORE" "$RADARR_X265_HD_SCORE" "1"

ensure_quality_profile_custom_formats "Sonarr HD profile safeguards configured" "$SONARR_URL/api/v3/qualityprofile" "$SONARR_URL/api/v3/qualityprofile" "$SONARR_URL/api/v3/customformat" "$SONARR_KEY" "HD" "English Only Audio:${SONARR_ENGLISH_ONLY_SCORE},Multi-Episode Pack:${SONARR_MULTI_EPISODE_PACK_SCORE},x265:${SONARR_X265_SCORE}" "$SONARR_H264_MIN_FORMAT_SCORE" "$SONARR_X265_ENGLISH_CUTOFF_SCORE" "1"
ensure_quality_profile_custom_formats "Sonarr HD Lite profile safeguards configured" "$SONARR_URL/api/v3/qualityprofile" "$SONARR_URL/api/v3/qualityprofile" "$SONARR_URL/api/v3/customformat" "$SONARR_KEY" "HD Lite" "English Only Audio:${SONARR_ENGLISH_ONLY_SCORE},Multi-Episode Pack:${SONARR_MULTI_EPISODE_PACK_SCORE},x265:${SONARR_X265_SCORE}" "$SONARR_H264_MIN_FORMAT_SCORE" "$SONARR_X265_ENGLISH_CUTOFF_SCORE" "1"
ensure_quality_profile_custom_formats "Sonarr Any profile h265 gate configured" "$SONARR_URL/api/v3/qualityprofile" "$SONARR_URL/api/v3/qualityprofile" "$SONARR_URL/api/v3/customformat" "$SONARR_KEY" "Any" "Multi-Episode Pack:${SONARR_MULTI_EPISODE_PACK_SCORE},x265:${SONARR_X265_SCORE}" "$SONARR_X265_SCORE" "$SONARR_X265_SCORE" "1"
if optional_service_enabled radarr4k; then
    ensure_quality_profile_custom_formats "Radarr 4K profile safeguards configured" "$RADARR_4K_URL/api/v3/qualityprofile" "$RADARR_4K_URL/api/v3/qualityprofile" "$RADARR_4K_URL/api/v3/customformat" "$RADARR_4K_KEY" "4K" "Movie Bundle Pack:${RADARR_MOVIE_BUNDLE_PACK_SCORE},x265 (UHD):${RADARR_X265_4K_SCORE},Tigole:${RADARR_TIGOLE_4K_SCORE}" "$RADARR_H264_MIN_FORMAT_SCORE" "$RADARR_X265_4K_SCORE" "1"
    ensure_quality_profile_custom_formats "Radarr 4K Lite profile safeguards configured" "$RADARR_4K_URL/api/v3/qualityprofile" "$RADARR_4K_URL/api/v3/qualityprofile" "$RADARR_4K_URL/api/v3/customformat" "$RADARR_4K_KEY" "4K Lite" "Movie Bundle Pack:${RADARR_MOVIE_BUNDLE_PACK_SCORE},YTS:100,x265 (UHD):${RADARR_X265_4K_SCORE},Tigole:${RADARR_TIGOLE_LITE_SCORE}" "$RADARR_H264_MIN_FORMAT_SCORE" "$RADARR_X265_4K_SCORE" "1"
    ensure_quality_profile_custom_formats "Radarr 4K Any profile h265 gate configured" "$RADARR_4K_URL/api/v3/qualityprofile" "$RADARR_4K_URL/api/v3/qualityprofile" "$RADARR_4K_URL/api/v3/customformat" "$RADARR_4K_KEY" "Any" "Movie Bundle Pack:${RADARR_MOVIE_BUNDLE_PACK_SCORE},x265:${RADARR_X265_4K_SCORE}" "$RADARR_X265_4K_SCORE" "$RADARR_X265_4K_SCORE" "1"
fi
if optional_service_enabled sonarr4k; then
    ensure_quality_profile_custom_formats "Sonarr 4K profile safeguards configured" "$SONARR_4K_URL/api/v3/qualityprofile" "$SONARR_4K_URL/api/v3/qualityprofile" "$SONARR_4K_URL/api/v3/customformat" "$SONARR_4K_KEY" "4K" "English Only Audio:${SONARR_ENGLISH_ONLY_SCORE},Multi-Episode Pack:${SONARR_MULTI_EPISODE_PACK_SCORE},x265:${SONARR_X265_SCORE}" "$SONARR_H264_MIN_FORMAT_SCORE" "$SONARR_X265_ENGLISH_CUTOFF_SCORE" "1"
    ensure_quality_profile_custom_formats "Sonarr 4K Lite profile safeguards configured" "$SONARR_4K_URL/api/v3/qualityprofile" "$SONARR_4K_URL/api/v3/qualityprofile" "$SONARR_4K_URL/api/v3/customformat" "$SONARR_4K_KEY" "4K Lite" "English Only Audio:${SONARR_ENGLISH_ONLY_SCORE},Multi-Episode Pack:${SONARR_MULTI_EPISODE_PACK_SCORE},x265:${SONARR_X265_SCORE}" "$SONARR_H264_MIN_FORMAT_SCORE" "$SONARR_X265_ENGLISH_CUTOFF_SCORE" "1"
    ensure_quality_profile_custom_formats "Sonarr 4K Any profile h265 gate configured" "$SONARR_4K_URL/api/v3/qualityprofile" "$SONARR_4K_URL/api/v3/qualityprofile" "$SONARR_4K_URL/api/v3/customformat" "$SONARR_4K_KEY" "Any" "Multi-Episode Pack:${SONARR_MULTI_EPISODE_PACK_SCORE},x265:${SONARR_X265_SCORE}" "$SONARR_X265_SCORE" "$SONARR_X265_SCORE" "1"
fi

migrate_items_to_quality_profile "Radarr HD movies moved to HD" "$RADARR_URL/api/v3/qualityprofile" "$RADARR_URL/api/v3/movie" "$RADARR_URL/api/v3/movie" "$RADARR_KEY" "SD,HD-720p,HD-1080p,Ultra-HD,HD - 720p/1080p,Request,4K,HD Bluray + WEB" "HD"
migrate_items_to_quality_profile "Radarr selected movie profile normalized" "$RADARR_URL/api/v3/qualityprofile" "$RADARR_URL/api/v3/movie" "$RADARR_URL/api/v3/movie" "$RADARR_KEY" "Any,Request Lite,4K Lite" "$RADARR_DEFAULT_PROFILE"
migrate_items_to_quality_profile "Radarr HD collections moved to HD" "$RADARR_URL/api/v3/qualityprofile" "$RADARR_URL/api/v3/collection" "$RADARR_URL/api/v3/collection" "$RADARR_KEY" "SD,HD-720p,HD-1080p,Ultra-HD,HD - 720p/1080p,Request,4K,HD Bluray + WEB" "HD"
migrate_items_to_quality_profile "Radarr selected collection profile normalized" "$RADARR_URL/api/v3/qualityprofile" "$RADARR_URL/api/v3/collection" "$RADARR_URL/api/v3/collection" "$RADARR_KEY" "Any,Request Lite,4K Lite" "$RADARR_DEFAULT_PROFILE"
migrate_items_to_quality_profile "Sonarr HD series moved to HD" "$SONARR_URL/api/v3/qualityprofile" "$SONARR_URL/api/v3/series" "$SONARR_URL/api/v3/series" "$SONARR_KEY" "SD,HD-720p,HD-1080p,Ultra-HD,HD - 720p/1080p,WEB-1080p,Request" "HD"
migrate_items_to_quality_profile "Sonarr selected TV profile normalized" "$SONARR_URL/api/v3/qualityprofile" "$SONARR_URL/api/v3/series" "$SONARR_URL/api/v3/series" "$SONARR_KEY" "Any,Request Lite" "$SONARR_DEFAULT_PROFILE"
if optional_service_enabled radarr4k; then
    migrate_items_to_quality_profile "Radarr 4K movies moved to 4K" "$RADARR_4K_URL/api/v3/qualityprofile" "$RADARR_4K_URL/api/v3/movie" "$RADARR_4K_URL/api/v3/movie" "$RADARR_4K_KEY" "SD,HD-720p,HD-1080p,Ultra-HD,HD - 720p/1080p,Request 4K,UHD Bluray + WEB" "4K"
    migrate_items_to_quality_profile "Radarr selected 4K movie profile normalized" "$RADARR_4K_URL/api/v3/qualityprofile" "$RADARR_4K_URL/api/v3/movie" "$RADARR_4K_URL/api/v3/movie" "$RADARR_4K_KEY" "Any,Request 4K Lite" "$RADARR_4K_DEFAULT_PROFILE"
    migrate_items_to_quality_profile "Radarr 4K collections moved to 4K" "$RADARR_4K_URL/api/v3/qualityprofile" "$RADARR_4K_URL/api/v3/collection" "$RADARR_4K_URL/api/v3/collection" "$RADARR_4K_KEY" "SD,HD-720p,HD-1080p,Ultra-HD,HD - 720p/1080p,Request 4K,UHD Bluray + WEB" "4K"
fi
if optional_service_enabled sonarr4k; then
    migrate_items_to_quality_profile "Sonarr 4K series moved to 4K" "$SONARR_4K_URL/api/v3/qualityprofile" "$SONARR_4K_URL/api/v3/series" "$SONARR_4K_URL/api/v3/series" "$SONARR_4K_KEY" "SD,HD-720p,HD-1080p,Ultra-HD,HD - 720p/1080p,WEB-2160p,Request 4K" "4K"
    migrate_items_to_quality_profile "Sonarr selected 4K TV profile normalized" "$SONARR_4K_URL/api/v3/qualityprofile" "$SONARR_4K_URL/api/v3/series" "$SONARR_4K_URL/api/v3/series" "$SONARR_4K_KEY" "Any,Request 4K Lite" "$SONARR_4K_DEFAULT_PROFILE"
fi

delete_named_quality_profile "Radarr HD old SD profile removed" "$RADARR_URL/api/v3/qualityprofile" "$RADARR_URL/api/v3/qualityprofile" "$RADARR_KEY" "SD"
delete_named_quality_profile "Radarr HD old 720p profile removed" "$RADARR_URL/api/v3/qualityprofile" "$RADARR_URL/api/v3/qualityprofile" "$RADARR_KEY" "HD-720p"
delete_named_quality_profile "Radarr HD old 1080p profile removed" "$RADARR_URL/api/v3/qualityprofile" "$RADARR_URL/api/v3/qualityprofile" "$RADARR_KEY" "HD-1080p"
delete_named_quality_profile "Radarr HD old Ultra-HD profile removed" "$RADARR_URL/api/v3/qualityprofile" "$RADARR_URL/api/v3/qualityprofile" "$RADARR_KEY" "Ultra-HD"
delete_named_quality_profile "Radarr HD old mixed HD profile removed" "$RADARR_URL/api/v3/qualityprofile" "$RADARR_URL/api/v3/qualityprofile" "$RADARR_KEY" "HD - 720p/1080p"
delete_named_quality_profile "Radarr HD old 4K profile removed" "$RADARR_URL/api/v3/qualityprofile" "$RADARR_URL/api/v3/qualityprofile" "$RADARR_KEY" "4K"
delete_named_quality_profile "Radarr HD old 4K Lite profile removed" "$RADARR_URL/api/v3/qualityprofile" "$RADARR_URL/api/v3/qualityprofile" "$RADARR_KEY" "4K Lite"
delete_named_quality_profile "Radarr HD old Recyclarr profile removed" "$RADARR_URL/api/v3/qualityprofile" "$RADARR_URL/api/v3/qualityprofile" "$RADARR_KEY" "HD Bluray + WEB"
delete_named_quality_profile "Radarr HD old Request profile removed" "$RADARR_URL/api/v3/qualityprofile" "$RADARR_URL/api/v3/qualityprofile" "$RADARR_KEY" "Request"
delete_named_quality_profile "Radarr HD old Request Lite profile removed" "$RADARR_URL/api/v3/qualityprofile" "$RADARR_URL/api/v3/qualityprofile" "$RADARR_KEY" "Request Lite"
delete_named_quality_profile "Radarr HD old Any profile removed" "$RADARR_URL/api/v3/qualityprofile" "$RADARR_URL/api/v3/qualityprofile" "$RADARR_KEY" "Any"

if optional_service_enabled radarr4k; then
    delete_named_quality_profile "Radarr 4K old SD profile removed" "$RADARR_4K_URL/api/v3/qualityprofile" "$RADARR_4K_URL/api/v3/qualityprofile" "$RADARR_4K_KEY" "SD"
    delete_named_quality_profile "Radarr 4K old 720p profile removed" "$RADARR_4K_URL/api/v3/qualityprofile" "$RADARR_4K_URL/api/v3/qualityprofile" "$RADARR_4K_KEY" "HD-720p"
    delete_named_quality_profile "Radarr 4K old 1080p profile removed" "$RADARR_4K_URL/api/v3/qualityprofile" "$RADARR_4K_URL/api/v3/qualityprofile" "$RADARR_4K_KEY" "HD-1080p"
    delete_named_quality_profile "Radarr 4K old Ultra-HD profile removed" "$RADARR_4K_URL/api/v3/qualityprofile" "$RADARR_4K_URL/api/v3/qualityprofile" "$RADARR_4K_KEY" "Ultra-HD"
    delete_named_quality_profile "Radarr 4K old mixed HD profile removed" "$RADARR_4K_URL/api/v3/qualityprofile" "$RADARR_4K_URL/api/v3/qualityprofile" "$RADARR_4K_KEY" "HD - 720p/1080p"
    delete_named_quality_profile "Radarr 4K old Recyclarr profile removed" "$RADARR_4K_URL/api/v3/qualityprofile" "$RADARR_4K_URL/api/v3/qualityprofile" "$RADARR_4K_KEY" "UHD Bluray + WEB"
    delete_named_quality_profile "Radarr 4K old Request profile removed" "$RADARR_4K_URL/api/v3/qualityprofile" "$RADARR_4K_URL/api/v3/qualityprofile" "$RADARR_4K_KEY" "Request 4K"
    delete_named_quality_profile "Radarr 4K old Request Lite profile removed" "$RADARR_4K_URL/api/v3/qualityprofile" "$RADARR_4K_URL/api/v3/qualityprofile" "$RADARR_4K_KEY" "Request 4K Lite"
    delete_named_quality_profile "Radarr 4K old Any profile removed" "$RADARR_4K_URL/api/v3/qualityprofile" "$RADARR_4K_URL/api/v3/qualityprofile" "$RADARR_4K_KEY" "Any"
fi

delete_named_quality_profile "Sonarr HD old SD profile removed" "$SONARR_URL/api/v3/qualityprofile" "$SONARR_URL/api/v3/qualityprofile" "$SONARR_KEY" "SD"
delete_named_quality_profile "Sonarr HD old 720p profile removed" "$SONARR_URL/api/v3/qualityprofile" "$SONARR_URL/api/v3/qualityprofile" "$SONARR_KEY" "HD-720p"
delete_named_quality_profile "Sonarr HD old 1080p profile removed" "$SONARR_URL/api/v3/qualityprofile" "$SONARR_URL/api/v3/qualityprofile" "$SONARR_KEY" "HD-1080p"
delete_named_quality_profile "Sonarr HD old Ultra-HD profile removed" "$SONARR_URL/api/v3/qualityprofile" "$SONARR_URL/api/v3/qualityprofile" "$SONARR_KEY" "Ultra-HD"
delete_named_quality_profile "Sonarr HD old mixed HD profile removed" "$SONARR_URL/api/v3/qualityprofile" "$SONARR_URL/api/v3/qualityprofile" "$SONARR_KEY" "HD - 720p/1080p"
delete_named_quality_profile "Sonarr HD old Recyclarr profile removed" "$SONARR_URL/api/v3/qualityprofile" "$SONARR_URL/api/v3/qualityprofile" "$SONARR_KEY" "WEB-1080p"
delete_named_quality_profile "Sonarr HD old Request profile removed" "$SONARR_URL/api/v3/qualityprofile" "$SONARR_URL/api/v3/qualityprofile" "$SONARR_KEY" "Request"
delete_named_quality_profile "Sonarr HD old Request Lite profile removed" "$SONARR_URL/api/v3/qualityprofile" "$SONARR_URL/api/v3/qualityprofile" "$SONARR_KEY" "Request Lite"
delete_named_quality_profile "Sonarr HD old Any profile removed" "$SONARR_URL/api/v3/qualityprofile" "$SONARR_URL/api/v3/qualityprofile" "$SONARR_KEY" "Any"

if optional_service_enabled sonarr4k; then
    delete_named_quality_profile "Sonarr 4K old SD profile removed" "$SONARR_4K_URL/api/v3/qualityprofile" "$SONARR_4K_URL/api/v3/qualityprofile" "$SONARR_4K_KEY" "SD"
    delete_named_quality_profile "Sonarr 4K old 720p profile removed" "$SONARR_4K_URL/api/v3/qualityprofile" "$SONARR_4K_URL/api/v3/qualityprofile" "$SONARR_4K_KEY" "HD-720p"
    delete_named_quality_profile "Sonarr 4K old 1080p profile removed" "$SONARR_4K_URL/api/v3/qualityprofile" "$SONARR_4K_URL/api/v3/qualityprofile" "$SONARR_4K_KEY" "HD-1080p"
    delete_named_quality_profile "Sonarr 4K old Ultra-HD profile removed" "$SONARR_4K_URL/api/v3/qualityprofile" "$SONARR_4K_URL/api/v3/qualityprofile" "$SONARR_4K_KEY" "Ultra-HD"
    delete_named_quality_profile "Sonarr 4K old mixed HD profile removed" "$SONARR_4K_URL/api/v3/qualityprofile" "$SONARR_4K_URL/api/v3/qualityprofile" "$SONARR_4K_KEY" "HD - 720p/1080p"
    delete_named_quality_profile "Sonarr 4K old Recyclarr profile removed" "$SONARR_4K_URL/api/v3/qualityprofile" "$SONARR_4K_URL/api/v3/qualityprofile" "$SONARR_4K_KEY" "WEB-2160p"
    delete_named_quality_profile "Sonarr 4K old Request profile removed" "$SONARR_4K_URL/api/v3/qualityprofile" "$SONARR_4K_URL/api/v3/qualityprofile" "$SONARR_4K_KEY" "Request 4K"
    delete_named_quality_profile "Sonarr 4K old Request Lite profile removed" "$SONARR_4K_URL/api/v3/qualityprofile" "$SONARR_4K_URL/api/v3/qualityprofile" "$SONARR_4K_KEY" "Request 4K Lite"
    delete_named_quality_profile "Sonarr 4K old Any profile removed" "$SONARR_4K_URL/api/v3/qualityprofile" "$SONARR_4K_URL/api/v3/qualityprofile" "$SONARR_4K_KEY" "Any"
fi

SEERR_DB="$CONFIG_ROOT/seerr/db/db.sqlite3"
apply_movie_monitoring_policy "Radarr movie monitoring policy applied" "$RADARR_URL/api/v3/movie" "$RADARR_URL/api/v3/movie" "$RADARR_KEY" "$SEERR_DB" false
apply_series_monitoring_policy "Sonarr series monitoring policy applied" "$SONARR_URL/api/v3/series" "$SONARR_URL/api/v3/series" "$SONARR_KEY" "$SEERR_DB" false
if optional_service_enabled radarr4k; then
    apply_movie_monitoring_policy "Radarr 4K movie monitoring policy applied" "$RADARR_4K_URL/api/v3/movie" "$RADARR_4K_URL/api/v3/movie" "$RADARR_4K_KEY" "$SEERR_DB" true
fi
if optional_service_enabled sonarr4k; then
    apply_series_monitoring_policy "Sonarr 4K series monitoring policy applied" "$SONARR_4K_URL/api/v3/series" "$SONARR_4K_URL/api/v3/series" "$SONARR_4K_KEY" "$SEERR_DB" true
fi

configure_servarr_auth "Radarr UI auth configured" "$RADARR_URL/api/v3/config/host" "$RADARR_KEY" "$RADARR_PASSWORD"
configure_servarr_auth "Sonarr UI auth configured" "$SONARR_URL/api/v3/config/host" "$SONARR_KEY" "$SONARR_PASSWORD"
configure_servarr_auth "Prowlarr UI auth configured" "$PROWLARR_URL/api/v1/config/host" "$PROWLARR_KEY" "$PROWLARR_PASSWORD"
configure_servarr_auth "Lidarr UI auth configured" "$LIDARR_URL/api/v1/config/host" "$LIDARR_KEY" "$LIDARR_PASSWORD"
if optional_service_enabled radarr4k; then
    configure_servarr_auth "Radarr 4K UI auth configured" "$RADARR_4K_URL/api/v3/config/host" "$RADARR_4K_KEY" "$RADARR4K_PASSWORD"
fi
if optional_service_enabled sonarr4k; then
    configure_servarr_auth "Sonarr 4K UI auth configured" "$SONARR_4K_URL/api/v3/config/host" "$SONARR_4K_KEY" "$SONARR4K_PASSWORD"
fi
"$ROOT_DIR/scripts/naming.sh" apply --wait || true
"$ROOT_DIR/scripts/downloads.sh" apply --wait || true
if flag_enabled "${STACKARR_CONFIGURE_SEERR:-false}"; then
    "$ROOT_DIR/scripts/requests.sh" apply --wait || true
else
    warn "Seerr request presets skipped because STACKARR_CONFIGURE_SEERR is false"
fi
"$ROOT_DIR/scripts/bookorbit.sh" credentials apply --wait || true
configure_bazarr_auth || true
configure_native_plex_publish_state || true

echo ""
if optional_service_enabled seerr && flag_enabled "${STACKARR_CONFIGURE_SEERR:-false}"; then
    SEERR_KEY="$(read_seerr_api_key || true)"
elif optional_service_enabled seerr; then
    SEERR_KEY=""
    warn "Seerr app wiring skipped because STACKARR_CONFIGURE_SEERR is false"
else
    SEERR_KEY=""
    warn "Seerr app wiring skipped because Seerr is disabled"
fi
if optional_service_enabled seerr && flag_enabled "${STACKARR_CONFIGURE_SEERR:-false}" && [[ -z "$SEERR_KEY" ]]; then
    warn "Complete Seerr first-run setup in your browser before continuing."
    warn "URL: http://$(hostname -s).local:5055 or http://localhost:5055"
    warn "Use Plex sign-in there, then press Enter here to continue Seerr app wiring."
    if [[ -t 0 ]]; then
        read -r -p "Press Enter once Seerr admin setup is complete... " _
        SEERR_KEY="$(read_seerr_api_key || true)"
    else
        warn "No interactive terminal detected. Skipping the Seerr prompt."
    fi
elif optional_service_enabled seerr; then
    ok "Seerr first-run is already complete"
fi

if [[ -n "$SEERR_KEY" ]]; then
    RADARR_REQUEST_PROFILE_ID="$(profile_id_by_names "$RADARR_URL/api/v3/qualityprofile" "$RADARR_KEY" "HD" "HD Bluray + WEB" "HD-1080p" || true)"
    RADARR_REQUEST_LITE_PROFILE_ID="$(profile_id_by_names "$RADARR_URL/api/v3/qualityprofile" "$RADARR_KEY" "HD Lite" "Request Lite" || true)"
    SONARR_REQUEST_PROFILE_ID="$(profile_id_by_names "$SONARR_URL/api/v3/qualityprofile" "$SONARR_KEY" "HD" "HD - 720p/1080p" "WEB-1080p" || true)"
    SONARR_REQUEST_LITE_PROFILE_ID="$(profile_id_by_names "$SONARR_URL/api/v3/qualityprofile" "$SONARR_KEY" "HD Lite" "Request Lite" || true)"
    if optional_service_enabled radarr4k; then
        RADARR_REQUEST_4K_PROFILE_ID="$(profile_id_by_names "$RADARR_4K_URL/api/v3/qualityprofile" "$RADARR_4K_KEY" "4K" "UHD Bluray + WEB" "Request 4K" || true)"
        RADARR_REQUEST_4K_LITE_PROFILE_ID="$(profile_id_by_names "$RADARR_4K_URL/api/v3/qualityprofile" "$RADARR_4K_KEY" "4K Lite" "Request 4K Lite" || true)"
    fi
    if optional_service_enabled sonarr4k; then
        SONARR_REQUEST_4K_PROFILE_ID="$(profile_id_by_names "$SONARR_4K_URL/api/v3/qualityprofile" "$SONARR_4K_KEY" "4K" "WEB-2160p" "Ultra-HD" || true)"
        SONARR_REQUEST_4K_LITE_PROFILE_ID="$(profile_id_by_names "$SONARR_4K_URL/api/v3/qualityprofile" "$SONARR_4K_KEY" "4K Lite" "Request 4K Lite" || true)"
    fi

    if [[ -z "$RADARR_REQUEST_PROFILE_ID" ]]; then
        RADARR_REQUEST_PROFILE_ID="$(curl -fsS "$RADARR_URL/api/v3/qualityprofile" -H "X-Api-Key: $RADARR_KEY" 2>/dev/null | first_json_id || true)"
        warn "Radarr HD profile not found; falling back to the first available HD profile"
    fi
    if [[ -z "$RADARR_REQUEST_LITE_PROFILE_ID" ]]; then
        RADARR_REQUEST_LITE_PROFILE_ID="$RADARR_REQUEST_PROFILE_ID"
        warn "Radarr HD Lite profile not found; falling back to the normal HD profile"
    fi
    if optional_service_enabled radarr4k && [[ -z "${RADARR_REQUEST_4K_PROFILE_ID:-}" ]]; then
        RADARR_REQUEST_4K_PROFILE_ID="$(curl -fsS "$RADARR_4K_URL/api/v3/qualityprofile" -H "X-Api-Key: $RADARR_4K_KEY" 2>/dev/null | first_json_id || true)"
        warn "Radarr 4K profile not found; falling back to the first available 4K profile"
    fi
    if optional_service_enabled radarr4k && [[ -z "${RADARR_REQUEST_4K_LITE_PROFILE_ID:-}" ]]; then
        RADARR_REQUEST_4K_LITE_PROFILE_ID="$RADARR_REQUEST_4K_PROFILE_ID"
        warn "Radarr 4K Lite profile not found; falling back to the normal 4K profile"
    fi
    if [[ -z "$SONARR_REQUEST_PROFILE_ID" ]]; then
        SONARR_REQUEST_PROFILE_ID="$(curl -fsS "$SONARR_URL/api/v3/qualityprofile" -H "X-Api-Key: $SONARR_KEY" 2>/dev/null | first_json_id || true)"
        warn "Sonarr HD profile not found; falling back to the first available HD profile"
    fi
    if [[ -z "$SONARR_REQUEST_LITE_PROFILE_ID" ]]; then
        SONARR_REQUEST_LITE_PROFILE_ID="$SONARR_REQUEST_PROFILE_ID"
        warn "Sonarr HD Lite profile not found; falling back to the normal HD profile"
    fi
    if optional_service_enabled sonarr4k && [[ -z "${SONARR_REQUEST_4K_PROFILE_ID:-}" ]]; then
        SONARR_REQUEST_4K_PROFILE_ID="$(curl -fsS "$SONARR_4K_URL/api/v3/qualityprofile" -H "X-Api-Key: $SONARR_4K_KEY" 2>/dev/null | first_json_id || true)"
        warn "Sonarr 4K profile not found; falling back to the first available 4K profile"
    fi
    if optional_service_enabled sonarr4k && [[ -z "${SONARR_REQUEST_4K_LITE_PROFILE_ID:-}" ]]; then
        SONARR_REQUEST_4K_LITE_PROFILE_ID="$SONARR_REQUEST_4K_PROFILE_ID"
        warn "Sonarr 4K Lite profile not found; falling back to the normal 4K profile"
    fi

    RADARR_REQUEST_PROFILE_ID="${RADARR_REQUEST_PROFILE_ID:-1}"
    RADARR_REQUEST_LITE_PROFILE_ID="${RADARR_REQUEST_LITE_PROFILE_ID:-$RADARR_REQUEST_PROFILE_ID}"
    SONARR_REQUEST_PROFILE_ID="${SONARR_REQUEST_PROFILE_ID:-1}"
    SONARR_REQUEST_LITE_PROFILE_ID="${SONARR_REQUEST_LITE_PROFILE_ID:-$SONARR_REQUEST_PROFILE_ID}"
    if optional_service_enabled radarr4k; then
        RADARR_REQUEST_4K_PROFILE_ID="${RADARR_REQUEST_4K_PROFILE_ID:-1}"
        RADARR_REQUEST_4K_LITE_PROFILE_ID="${RADARR_REQUEST_4K_LITE_PROFILE_ID:-$RADARR_REQUEST_4K_PROFILE_ID}"
    fi
    if optional_service_enabled sonarr4k; then
        SONARR_REQUEST_4K_PROFILE_ID="${SONARR_REQUEST_4K_PROFILE_ID:-1}"
        SONARR_REQUEST_4K_LITE_PROFILE_ID="${SONARR_REQUEST_4K_LITE_PROFILE_ID:-$SONARR_REQUEST_4K_PROFILE_ID}"
    fi

    RADARR_REQUEST_PROFILE_NAME="$(json_name_by_id "$RADARR_URL/api/v3/qualityprofile" "$RADARR_KEY" "$RADARR_REQUEST_PROFILE_ID" || true)"
    RADARR_REQUEST_LITE_PROFILE_NAME="$(json_name_by_id "$RADARR_URL/api/v3/qualityprofile" "$RADARR_KEY" "$RADARR_REQUEST_LITE_PROFILE_ID" || true)"
    SONARR_REQUEST_PROFILE_NAME="$(json_name_by_id "$SONARR_URL/api/v3/qualityprofile" "$SONARR_KEY" "$SONARR_REQUEST_PROFILE_ID" || true)"
    SONARR_REQUEST_LITE_PROFILE_NAME="$(json_name_by_id "$SONARR_URL/api/v3/qualityprofile" "$SONARR_KEY" "$SONARR_REQUEST_LITE_PROFILE_ID" || true)"
    if optional_service_enabled radarr4k; then
        RADARR_REQUEST_4K_PROFILE_NAME="$(json_name_by_id "$RADARR_4K_URL/api/v3/qualityprofile" "$RADARR_4K_KEY" "$RADARR_REQUEST_4K_PROFILE_ID" || true)"
        RADARR_REQUEST_4K_LITE_PROFILE_NAME="$(json_name_by_id "$RADARR_4K_URL/api/v3/qualityprofile" "$RADARR_4K_KEY" "$RADARR_REQUEST_4K_LITE_PROFILE_ID" || true)"
    fi
    if optional_service_enabled sonarr4k; then
        SONARR_REQUEST_4K_PROFILE_NAME="$(json_name_by_id "$SONARR_4K_URL/api/v3/qualityprofile" "$SONARR_4K_KEY" "$SONARR_REQUEST_4K_PROFILE_ID" || true)"
        SONARR_REQUEST_4K_LITE_PROFILE_NAME="$(json_name_by_id "$SONARR_4K_URL/api/v3/qualityprofile" "$SONARR_4K_KEY" "$SONARR_REQUEST_4K_LITE_PROFILE_ID" || true)"
    fi

    RADARR_REQUEST_PROFILE_NAME="${RADARR_REQUEST_PROFILE_NAME:-Any}"
    RADARR_REQUEST_LITE_PROFILE_NAME="${RADARR_REQUEST_LITE_PROFILE_NAME:-$RADARR_REQUEST_PROFILE_NAME}"
    SONARR_REQUEST_PROFILE_NAME="${SONARR_REQUEST_PROFILE_NAME:-Any}"
    SONARR_REQUEST_LITE_PROFILE_NAME="${SONARR_REQUEST_LITE_PROFILE_NAME:-$SONARR_REQUEST_PROFILE_NAME}"
    if optional_service_enabled radarr4k; then
        RADARR_REQUEST_4K_PROFILE_NAME="${RADARR_REQUEST_4K_PROFILE_NAME:-Any}"
        RADARR_REQUEST_4K_LITE_PROFILE_NAME="${RADARR_REQUEST_4K_LITE_PROFILE_NAME:-$RADARR_REQUEST_4K_PROFILE_NAME}"
    fi
    if optional_service_enabled sonarr4k; then
        SONARR_REQUEST_4K_PROFILE_NAME="${SONARR_REQUEST_4K_PROFILE_NAME:-Any}"
        SONARR_REQUEST_4K_LITE_PROFILE_NAME="${SONARR_REQUEST_4K_LITE_PROFILE_NAME:-$SONARR_REQUEST_4K_PROFILE_NAME}"
    fi

    RADARR_SEERR_PROFILE_ID="$(profile_id_by_names "$RADARR_URL/api/v3/qualityprofile" "$RADARR_KEY" "$RADARR_DEFAULT_PROFILE" "$RADARR_REQUEST_LITE_PROFILE_NAME" "$RADARR_REQUEST_PROFILE_NAME" || true)"
    SONARR_SEERR_PROFILE_ID="$(profile_id_by_names "$SONARR_URL/api/v3/qualityprofile" "$SONARR_KEY" "$SONARR_DEFAULT_PROFILE" "$SONARR_REQUEST_LITE_PROFILE_NAME" "$SONARR_REQUEST_PROFILE_NAME" || true)"
    RADARR_SEERR_PROFILE_ID="${RADARR_SEERR_PROFILE_ID:-$RADARR_REQUEST_LITE_PROFILE_ID}"
    SONARR_SEERR_PROFILE_ID="${SONARR_SEERR_PROFILE_ID:-$SONARR_REQUEST_LITE_PROFILE_ID}"
    RADARR_SEERR_PROFILE_NAME="$(json_name_by_id "$RADARR_URL/api/v3/qualityprofile" "$RADARR_KEY" "$RADARR_SEERR_PROFILE_ID" || true)"
    SONARR_SEERR_PROFILE_NAME="$(json_name_by_id "$SONARR_URL/api/v3/qualityprofile" "$SONARR_KEY" "$SONARR_SEERR_PROFILE_ID" || true)"
    RADARR_SEERR_PROFILE_NAME="${RADARR_SEERR_PROFILE_NAME:-$RADARR_DEFAULT_PROFILE}"
    SONARR_SEERR_PROFILE_NAME="${SONARR_SEERR_PROFILE_NAME:-$SONARR_DEFAULT_PROFILE}"
    if optional_service_enabled radarr4k; then
        RADARR_4K_SEERR_PROFILE_ID="$(profile_id_by_names "$RADARR_4K_URL/api/v3/qualityprofile" "$RADARR_4K_KEY" "$RADARR_4K_DEFAULT_PROFILE" "$RADARR_REQUEST_4K_LITE_PROFILE_NAME" "$RADARR_REQUEST_4K_PROFILE_NAME" || true)"
        RADARR_4K_SEERR_PROFILE_ID="${RADARR_4K_SEERR_PROFILE_ID:-$RADARR_REQUEST_4K_LITE_PROFILE_ID}"
        RADARR_4K_SEERR_PROFILE_NAME="$(json_name_by_id "$RADARR_4K_URL/api/v3/qualityprofile" "$RADARR_4K_KEY" "$RADARR_4K_SEERR_PROFILE_ID" || true)"
        RADARR_4K_SEERR_PROFILE_NAME="${RADARR_4K_SEERR_PROFILE_NAME:-$RADARR_4K_DEFAULT_PROFILE}"
    fi
    if optional_service_enabled sonarr4k; then
        SONARR_4K_SEERR_PROFILE_ID="$(profile_id_by_names "$SONARR_4K_URL/api/v3/qualityprofile" "$SONARR_4K_KEY" "$SONARR_4K_DEFAULT_PROFILE" "$SONARR_REQUEST_4K_LITE_PROFILE_NAME" "$SONARR_REQUEST_4K_PROFILE_NAME" || true)"
        SONARR_4K_SEERR_PROFILE_ID="${SONARR_4K_SEERR_PROFILE_ID:-$SONARR_REQUEST_4K_LITE_PROFILE_ID}"
        SONARR_4K_SEERR_PROFILE_NAME="$(json_name_by_id "$SONARR_4K_URL/api/v3/qualityprofile" "$SONARR_4K_KEY" "$SONARR_4K_SEERR_PROFILE_ID" || true)"
        SONARR_4K_SEERR_PROFILE_NAME="${SONARR_4K_SEERR_PROFILE_NAME:-$SONARR_4K_DEFAULT_PROFILE}"
    fi

    delete_named_service "Seerr old Radarr service removed" "$SEERR_URL/api/v1/settings/radarr" "$SEERR_URL/api/v1/settings/radarr" "$SEERR_KEY" "Radarr"
    delete_named_service "Seerr old Radarr 4K service removed" "$SEERR_URL/api/v1/settings/radarr" "$SEERR_URL/api/v1/settings/radarr" "$SEERR_KEY" "Radarr 4K"
    delete_named_service "Seerr HD service refreshed" "$SEERR_URL/api/v1/settings/radarr" "$SEERR_URL/api/v1/settings/radarr" "$SEERR_KEY" "HD"
    delete_named_service "Seerr 4K service refreshed" "$SEERR_URL/api/v1/settings/radarr" "$SEERR_URL/api/v1/settings/radarr" "$SEERR_KEY" "4K"
    delete_named_service "Seerr old HD Lite service removed" "$SEERR_URL/api/v1/settings/radarr" "$SEERR_URL/api/v1/settings/radarr" "$SEERR_KEY" "HD Lite"
    delete_named_service "Seerr old 4K Lite service removed" "$SEERR_URL/api/v1/settings/radarr" "$SEERR_URL/api/v1/settings/radarr" "$SEERR_KEY" "4K Lite"
    delete_named_service "Seerr old Radarr 1080p Lite service removed" "$SEERR_URL/api/v1/settings/radarr" "$SEERR_URL/api/v1/settings/radarr" "$SEERR_KEY" "Radarr 1080p Lite"
    delete_named_service "Seerr old Radarr 1080p Higher Bitrate service removed" "$SEERR_URL/api/v1/settings/radarr" "$SEERR_URL/api/v1/settings/radarr" "$SEERR_KEY" "Radarr 1080p Higher Bitrate"
    delete_named_service "Seerr old Radarr 4K Lite service removed" "$SEERR_URL/api/v1/settings/radarr" "$SEERR_URL/api/v1/settings/radarr" "$SEERR_KEY" "Radarr 4K Lite"
    delete_named_service "Seerr old Radarr 4K Higher Bitrate service removed" "$SEERR_URL/api/v1/settings/radarr" "$SEERR_URL/api/v1/settings/radarr" "$SEERR_KEY" "Radarr 4K Higher Bitrate"
    delete_named_service "Seerr old Request movie service removed" "$SEERR_URL/api/v1/settings/radarr" "$SEERR_URL/api/v1/settings/radarr" "$SEERR_KEY" "Request"
    delete_named_service "Seerr old Request Lite movie service removed" "$SEERR_URL/api/v1/settings/radarr" "$SEERR_URL/api/v1/settings/radarr" "$SEERR_KEY" "Request Lite"
    delete_named_service "Seerr old Request 4K movie service removed" "$SEERR_URL/api/v1/settings/radarr" "$SEERR_URL/api/v1/settings/radarr" "$SEERR_KEY" "Request 4K"
    delete_named_service "Seerr old Request 4K Lite movie service removed" "$SEERR_URL/api/v1/settings/radarr" "$SEERR_URL/api/v1/settings/radarr" "$SEERR_KEY" "Request 4K Lite"
    delete_named_service "Seerr old Sonarr service removed" "$SEERR_URL/api/v1/settings/sonarr" "$SEERR_URL/api/v1/settings/sonarr" "$SEERR_KEY" "Sonarr"
    delete_named_service "Seerr old Sonarr 4K service removed" "$SEERR_URL/api/v1/settings/sonarr" "$SEERR_URL/api/v1/settings/sonarr" "$SEERR_KEY" "Sonarr 4K"
    delete_named_service "Seerr HD TV service refreshed" "$SEERR_URL/api/v1/settings/sonarr" "$SEERR_URL/api/v1/settings/sonarr" "$SEERR_KEY" "HD"
    delete_named_service "Seerr 4K TV service refreshed" "$SEERR_URL/api/v1/settings/sonarr" "$SEERR_URL/api/v1/settings/sonarr" "$SEERR_KEY" "4K"
    delete_named_service "Seerr old HD Lite TV service removed" "$SEERR_URL/api/v1/settings/sonarr" "$SEERR_URL/api/v1/settings/sonarr" "$SEERR_KEY" "HD Lite"
    delete_named_service "Seerr old 4K Lite TV service removed" "$SEERR_URL/api/v1/settings/sonarr" "$SEERR_URL/api/v1/settings/sonarr" "$SEERR_KEY" "4K Lite"
    delete_named_service "Seerr old Request TV service removed" "$SEERR_URL/api/v1/settings/sonarr" "$SEERR_URL/api/v1/settings/sonarr" "$SEERR_KEY" "Request"
    delete_named_service "Seerr old Request Lite TV service removed" "$SEERR_URL/api/v1/settings/sonarr" "$SEERR_URL/api/v1/settings/sonarr" "$SEERR_KEY" "Request Lite"
    delete_named_service "Seerr old Request 4K TV service removed" "$SEERR_URL/api/v1/settings/sonarr" "$SEERR_URL/api/v1/settings/sonarr" "$SEERR_KEY" "Request 4K"
    delete_named_service "Seerr old Request 4K Lite TV service removed" "$SEERR_URL/api/v1/settings/sonarr" "$SEERR_URL/api/v1/settings/sonarr" "$SEERR_KEY" "Request 4K Lite"
    ensure_seerr_service "Seerr connected to $RADARR_SEERR_PROFILE_NAME" "$SEERR_URL/api/v1/settings/radarr" "$SEERR_URL/api/v1/settings/radarr" "$SEERR_URL/api/v1/settings/radarr" "$SEERR_KEY" "$RADARR_SEERR_PROFILE_NAME" "$(seerr_radarr_payload "$RADARR_SEERR_PROFILE_NAME" "radarr" 7878 "$RADARR_KEY" "$RADARR_SEERR_PROFILE_ID" "$RADARR_SEERR_PROFILE_NAME" false true "http://localhost:7878")"
    ensure_seerr_service "Seerr connected to $SONARR_SEERR_PROFILE_NAME (TV)" "$SEERR_URL/api/v1/settings/sonarr" "$SEERR_URL/api/v1/settings/sonarr" "$SEERR_URL/api/v1/settings/sonarr" "$SEERR_KEY" "$SONARR_SEERR_PROFILE_NAME" "$(seerr_sonarr_payload "$SONARR_SEERR_PROFILE_NAME" "sonarr" 8989 "$SONARR_KEY" "$SONARR_SEERR_PROFILE_ID" "$SONARR_SEERR_PROFILE_NAME" false true "http://localhost:8989")"
    if optional_service_enabled radarr4k; then
        ensure_seerr_service "Seerr connected to $RADARR_4K_SEERR_PROFILE_NAME" "$SEERR_URL/api/v1/settings/radarr" "$SEERR_URL/api/v1/settings/radarr" "$SEERR_URL/api/v1/settings/radarr" "$SEERR_KEY" "$RADARR_4K_SEERR_PROFILE_NAME" "$(seerr_radarr_payload "$RADARR_4K_SEERR_PROFILE_NAME" "radarr4k" 7878 "$RADARR_4K_KEY" "$RADARR_4K_SEERR_PROFILE_ID" "$RADARR_4K_SEERR_PROFILE_NAME" true true "http://localhost:7879")"
    fi
    if optional_service_enabled sonarr4k; then
        ensure_seerr_service "Seerr connected to $SONARR_4K_SEERR_PROFILE_NAME (TV)" "$SEERR_URL/api/v1/settings/sonarr" "$SEERR_URL/api/v1/settings/sonarr" "$SEERR_URL/api/v1/settings/sonarr" "$SEERR_KEY" "$SONARR_4K_SEERR_PROFILE_NAME" "$(seerr_sonarr_payload "$SONARR_4K_SEERR_PROFILE_NAME" "sonarr4k" 8989 "$SONARR_4K_KEY" "$SONARR_4K_SEERR_PROFILE_ID" "$SONARR_4K_SEERR_PROFILE_NAME" true true "http://localhost:8990")"
    fi
else
    if optional_service_enabled seerr && flag_enabled "${STACKARR_CONFIGURE_SEERR:-false}"; then
        warn "Could not read Seerr API key. Re-run 'stackarr configure --force' after Seerr is fully initialized."
    else
        warn "Seerr Arr service wiring was not requested"
    fi
fi

cat > "$DONE_FILE" <<EOF
configured_at=$(date '+%Y-%m-%d %H:%M:%S')
EOF

ok "Base automation complete"
warn "Bazarr still needs subtitle-provider setup."
warn "Tidarr still needs Tidal sign-in and manual addition in Lidarr if you want it enabled."
"$ROOT_DIR/scripts/db-info.sh"
