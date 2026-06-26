#!/bin/bash
set -euo pipefail

ROOT_DIR="$(cd "$(dirname "$0")/.." && pwd)"
# shellcheck source=lib/common.sh
source "$ROOT_DIR/lib/common.sh"

DOWNLOADS_CONFIG_FILE="${STACKARR_DOWNLOADS_CONFIG_FILE:-$ROOT_DIR/config/downloads.json}"
RADARR_URL=""
RADARR_4K_URL=""
SONARR_URL=""
SONARR_4K_URL=""
LIDARR_URL=""
TRANSMISSION_URL=""
QBITTORRENT_URL=""
QBITTORRENT_HOST_PORT="${QBITTORRENT_WEBUI_PORT:-8081}"
TRANSMISSION_UNSAFE_PAYLOAD_HOOK_SOURCE="$ROOT_DIR/scripts/hooks/transmission-delete-unsafe.sh"

usage() {
    cat <<'EOF'
Usage:
  stackarr downloads apply [--wait] [--skip-transmission] [--skip-qbittorrent] [--skip-servarr]
EOF
}

configure_download_service_urls() {
    RADARR_URL="$(service_url "radarr" "$RADARR_URL" 7878)"
    RADARR_4K_URL="$(service_url "radarr4k" "$RADARR_4K_URL" 7879)"
    SONARR_URL="$(service_url "sonarr" "$SONARR_URL" 8989)"
    SONARR_4K_URL="$(service_url "sonarr4k" "$SONARR_4K_URL" 8990)"
    LIDARR_URL="$(service_url "lidarr" "$LIDARR_URL" 8686)"
    QBITTORRENT_HOST_PORT="${QBITTORRENT_WEBUI_PORT:-8081}"
    TRANSMISSION_URL="$(service_url "transmission" "$TRANSMISSION_URL" 9091)/transmission/web/"
    QBITTORRENT_URL="$(service_url "qbittorrent" "$QBITTORRENT_URL" "$QBITTORRENT_HOST_PORT")"
}

require_downloads_config() {
    [[ -f "$DOWNLOADS_CONFIG_FILE" ]] || fail "Downloads config missing at $DOWNLOADS_CONFIG_FILE"
}

extract_qbittorrent_temp_password() {
    local output

    output="$(docker compose -f "$ROOT_DIR/docker-compose.yml" logs --no-color qbittorrent 2>/dev/null || true)"
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

    if [[ ! "$code" =~ ^(200|409)$ ]]; then
        warn "qBittorrent category '$category' could not be updated"
        return 1
    fi
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

patch_servarr_download_handling() {
    local label="$1"
    local config_url="$2"
    local api_key="$3"
    local wait_for_ready="$4"
    local current payload

    [[ -n "$api_key" ]] || {
        warn "$label skipped because the API key is missing"
        return 1
    }

    if [[ "$wait_for_ready" == "true" ]]; then
        wait_for_api "$config_url" "$api_key" "$label" || return 1
    fi

    current="$(curl -fsS "$config_url" -H "X-Api-Key: $api_key" 2>/dev/null)" || {
        warn "$label settings could not be read"
        return 1
    }

    payload="$(python3 - "$current" <<'PY'
import json
import sys

data = json.loads(sys.argv[1])

data["enableCompletedDownloadHandling"] = True
data.setdefault("downloadClientWorkingFolders", "_UNPACK_|_FAILED_")
data.setdefault("autoRedownloadFailed", False)
data.setdefault("autoRedownloadFailedFromInteractiveSearch", False)

print(json.dumps(data, separators=(",", ":")))
PY
)"

    curl -fsS -X PUT "$config_url" \
        -H "X-Api-Key: $api_key" \
        -H "Content-Type: application/json" \
        --data "$payload" >/dev/null || {
        warn "$label could not be updated"
        return 1
    }

    ok "$label applied"
}

download_client_priority() {
    local preferred="${1:-transmission}"

    if [[ "$(selected_torrent_client)" == "$preferred" ]]; then
        printf '1\n'
    else
        printf '2\n'
    fi
}

transmission_preferences_payload() {
    local desired_complete="$1"
    local desired_incomplete="$2"
    local desired_watch="$3"

    python3 - "$DOWNLOADS_CONFIG_FILE" "$desired_complete" "$desired_incomplete" "$desired_watch" "$USERNAME" "$PASSWORD" "${TRANSMISSION_TORRENT_PORT:-6881}" <<'PY'
import json
import sys

with open(sys.argv[1], "r", encoding="utf-8") as fh:
    config = json.load(fh)

transmission = config.get("transmission", {})
qbittorrent = config.get("qbittorrent", {})
transmission_queueing = transmission.get("queueing", {})
qbittorrent_queueing = qbittorrent.get("queueing", {})
transmission_network = transmission.get("network", {})
qbittorrent_network = qbittorrent.get("network", {})
transmission_paths = transmission.get("paths", {})
qbittorrent_paths = qbittorrent.get("paths", {})
transmission_blocklist = transmission.get("blocklist", {})
qbittorrent_ip_filter = qbittorrent.get("ipFilter", {})

ratio_limit = transmission.get("ratioLimit", qbittorrent.get("ratioLimit", 0))
idle_seeding_minutes = transmission.get("idleSeedingMinutes", qbittorrent.get("maxInactiveSeedingMinutes", 60))
start_paused_enabled = transmission.get("startPausedEnabled", qbittorrent.get("startPausedEnabled", False))
listen_port = transmission_network.get("listenPort", qbittorrent_network.get("listenPort", int(sys.argv[7])))

preferences = {
    "bind-address-ipv4": "0.0.0.0",
    "bind-address-ipv6": "::",
    "blocklist-enabled": bool(transmission_blocklist.get("enabled", qbittorrent_ip_filter.get("enabled", False))),
    "blocklist-url": transmission_blocklist.get("sourceUrl", qbittorrent_ip_filter.get("sourceUrl", "")),
    "download-dir": sys.argv[2],
    "download-queue-enabled": bool(transmission_queueing.get("downloadQueueEnabled", qbittorrent_queueing.get("enabled", True))),
    "download-queue-size": int(transmission_queueing.get("downloadQueueSize", qbittorrent_queueing.get("maxActiveDownloads", 5))),
    "idle-seeding-limit": 1 if idle_seeding_minutes is None else int(idle_seeding_minutes),
    "idle-seeding-limit-enabled": idle_seeding_minutes is not None,
    "incomplete-dir": sys.argv[3],
    "incomplete-dir-enabled": bool(transmission_paths.get("useIncompleteDir", qbittorrent_paths.get("useTempPath", True))),
    "peer-port": int(listen_port),
    "peer-port-random-on-start": bool(transmission_network.get("randomPort", qbittorrent_network.get("randomPort", False))),
    "port-forwarding-enabled": bool(transmission_network.get("portForwardingEnabled", qbittorrent_network.get("useUPnP", False))),
    "queue-stalled-enabled": bool(transmission_queueing.get("queueStalledEnabled", True)),
    "queue-stalled-minutes": int(transmission_queueing.get("queueStalledMinutes", qbittorrent_queueing.get("slowTorrentInactiveMinutes", 60))),
    "ratio-limit": 0 if ratio_limit is None else float(ratio_limit),
    "ratio-limit-enabled": ratio_limit is not None,
    "rename-partial-files": True,
    "rpc-authentication-required": True,
    "rpc-bind-address": "0.0.0.0",
    "rpc-host-whitelist-enabled": False,
    "rpc-password": sys.argv[6],
    "rpc-username": sys.argv[5],
    "rpc-whitelist-enabled": False,
    "script-torrent-added-enabled": True,
    "script-torrent-added-filename": "/config/hooks/transmission-delete-unsafe.sh",
    "script-torrent-done-enabled": True,
    "script-torrent-done-filename": "/config/hooks/transmission-delete-unsafe.sh",
    "seed-queue-enabled": bool(transmission_queueing.get("seedQueueEnabled", False)),
    "seed-queue-size": int(transmission_queueing.get("seedQueueSize", qbittorrent_queueing.get("maxActiveUploads", 3))),
    "start-added-torrents": not bool(start_paused_enabled),
    "start_paused": bool(start_paused_enabled),
    "watch-dir": sys.argv[4],
    "watch-dir-enabled": bool(transmission_paths.get("watchDirEnabled", False)),
}

print(json.dumps(preferences, separators=(",", ":")))
PY
}

transmission_settings_status() {
    local file="$1"
    local payload="$2"

    python3 - "$file" "$payload" <<'PY'
import json
import sys
from pathlib import Path

path = Path(sys.argv[1])
updates = json.loads(sys.argv[2])
data = json.loads(path.read_text())

changed = False
for key, value in updates.items():
    if data.get(key) != value:
        changed = True
        break

print("changed" if changed else "unchanged")
PY
}

write_transmission_settings() {
    local file="$1"
    local payload="$2"

    python3 - "$file" "$payload" <<'PY'
import json
import sys
from pathlib import Path

path = Path(sys.argv[1])
updates = json.loads(sys.argv[2])
data = json.loads(path.read_text())
data.update(updates)
path.write_text(json.dumps(data, indent=4, sort_keys=True) + "\n")
PY
}

transmission_container_credentials_match() {
    docker compose -f "$ROOT_DIR/docker-compose.yml" exec -T \
        -e STACKARR_EXPECTED_USERNAME="$USERNAME" \
        -e STACKARR_EXPECTED_PASSWORD="$PASSWORD" \
        transmission sh -lc 'test "${USER:-}" = "$STACKARR_EXPECTED_USERNAME" && test "${PASS:-}" = "$STACKARR_EXPECTED_PASSWORD"' >/dev/null 2>&1
}

recreate_transmission_container() {
    docker compose -f "$ROOT_DIR/docker-compose.yml" up -d --force-recreate transmission >/dev/null || {
        warn "Transmission could not be recreated with the current Stackarr credentials"
        return 1
    }
}

apply_transmission_preset() {
    local wait_for_ready="$1"
    local settings_file="$CONFIG_ROOT/transmission/settings.json"
    local unsafe_payload_hook_dest="$CONFIG_ROOT/transmission/hooks/transmission-delete-unsafe.sh"
    local payload status
    local desired_incomplete="/downloads/$DOWNLOAD_INCOMPLETE_NAME"
    local desired_complete="/downloads/$DOWNLOAD_COMPLETE_NAME"
    local desired_watch="/downloads/watch"

    if [[ "$(selected_torrent_client)" != "transmission" ]]; then
        warn "Transmission preset skipped because Transmission is not the selected torrent client"
        return 0
    fi

    if [[ "$wait_for_ready" == "true" ]]; then
        wait_for_http "Transmission" "$TRANSMISSION_URL"
    fi

    [[ -f "$settings_file" ]] || {
        warn "Transmission settings file missing at $settings_file"
        return 1
    }

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
    ensure_dir "$DOWNLOADS_ROOT/watch"
    ensure_dir "$CONFIG_ROOT/transmission/hooks"
    cp "$TRANSMISSION_UNSAFE_PAYLOAD_HOOK_SOURCE" "$unsafe_payload_hook_dest"
    chmod 755 "$unsafe_payload_hook_dest"

    payload="$(transmission_preferences_payload "$desired_complete" "$desired_incomplete" "$desired_watch")"
    status="$(transmission_settings_status "$settings_file" "$payload")"

    if [[ "$status" == "changed" ]] || ! transmission_container_credentials_match; then
        docker compose -f "$ROOT_DIR/docker-compose.yml" stop transmission >/dev/null || {
            warn "Transmission could not be stopped before updating settings"
            return 1
        }

        if [[ "$status" == "changed" ]]; then
            write_transmission_settings "$settings_file" "$payload"
        fi

        recreate_transmission_container || return 1

        if [[ "$wait_for_ready" == "true" ]]; then
            wait_for_http "Transmission" "$TRANSMISSION_URL"
        fi
    fi

    ok "Transmission download preset applied"
}

qbit_ip_filter_meta() {
    python3 - "$DOWNLOADS_CONFIG_FILE" <<'PY'
import json
import sys

with open(sys.argv[1], "r", encoding="utf-8") as fh:
    config = json.load(fh)

ip_filter = config.get("qbittorrent", {}).get("ipFilter", {})
values = [
    "true" if ip_filter.get("enabled", False) else "false",
    ip_filter.get("sourceUrl", ""),
    ip_filter.get("path", "/config/qBittorrent/ipfilter.p2p"),
]

print("\t".join(values))
PY
}

container_config_path_to_host() {
    local container_path="$1"

    case "$container_path" in
        /config/*)
            printf '%s/qbittorrent/%s\n' "$CONFIG_ROOT" "${container_path#/config/}"
            ;;
        *)
            return 1
            ;;
    esac
}

sync_qbittorrent_ip_filter() {
    local enabled source_url container_path host_path temp_file

    IFS=$'\t' read -r enabled source_url container_path <<<"$(qbit_ip_filter_meta)"

    if [[ "$enabled" != "true" ]]; then
        return 0
    fi

    if [[ -z "$source_url" ]]; then
        warn "qBittorrent IP filter is enabled but no source URL is configured"
        return 1
    fi

    host_path="$(container_config_path_to_host "$container_path")" || {
        warn "qBittorrent IP filter path must live under /config"
        return 1
    }

    ensure_dir "$(dirname "$host_path")"
    temp_file="$(mktemp)"

    if ! curl -fsSL "$source_url" -o "$temp_file"; then
        rm -f "$temp_file"
        warn "qBittorrent IP filter could not be downloaded"
        return 1
    fi

    if ! python3 - "$temp_file" "$host_path" <<'PY'
import gzip
import sys
from pathlib import Path

src = Path(sys.argv[1])
dest = Path(sys.argv[2])
data = src.read_bytes()

if data[:2] == b"\x1f\x8b":
    data = gzip.decompress(data)

dest.write_bytes(data)
PY
    then
        rm -f "$temp_file"
        warn "qBittorrent IP filter could not be prepared"
        return 1
    fi

    rm -f "$temp_file"
    ok "qBittorrent IP filter synced"
}

qbittorrent_preferences_payload() {
    local desired_complete="$1"
    local desired_incomplete="$2"

    python3 - "$DOWNLOADS_CONFIG_FILE" "$desired_complete" "$desired_incomplete" "$USERNAME" "$PASSWORD" "${QBITTORRENT_TORRENT_PORT:-6881}" <<'PY'
import json
import sys

with open(sys.argv[1], "r", encoding="utf-8") as fh:
    config = json.load(fh)

qbittorrent = config.get("qbittorrent", {})
queueing = qbittorrent.get("queueing", {})
network = qbittorrent.get("network", {})
paths = qbittorrent.get("paths", {})
ip_filter = qbittorrent.get("ipFilter", {})

ratio_limit = qbittorrent.get("ratioLimit", 1.0)
ratio_action = str(qbittorrent.get("ratioLimitAction", "pause")).strip().lower()
max_seeding_minutes = qbittorrent.get("maxSeedingMinutes", 240)
max_inactive_seeding_minutes = qbittorrent.get("maxInactiveSeedingMinutes", 60)
ratio_action_map = {
    "pause": 0,
}

preferences = {
    "save_path": sys.argv[2],
    "temp_path_enabled": bool(paths.get("useTempPath", True)),
    "temp_path": sys.argv[3],
    "use_category_paths_in_manual_mode": bool(paths.get("useCategoryPathsInManualMode", True)),
    "start_paused_enabled": bool(qbittorrent.get("startPausedEnabled", False)),
    "web_ui_local_host_auth": False,
    "web_ui_username": sys.argv[4],
    "web_ui_password": sys.argv[5],
    "listen_port": int(network.get("listenPort", int(sys.argv[6]))),
    "upnp": bool(network.get("useUPnP", False)),
    "random_port": bool(network.get("randomPort", False)),
    "queueing_enabled": bool(queueing.get("enabled", True)),
    "max_active_downloads": int(queueing.get("maxActiveDownloads", 3)),
    "max_active_torrents": int(queueing.get("maxActiveTorrents", 5)),
    "max_active_uploads": int(queueing.get("maxActiveUploads", 3)),
    "dont_count_slow_torrents": bool(queueing.get("slowTorrentsDontCount", False)),
    "slow_torrent_dl_rate_threshold": int(queueing.get("slowTorrentDownloadRateKiB", 2)),
    "slow_torrent_ul_rate_threshold": int(queueing.get("slowTorrentUploadRateKiB", 2)),
    "slow_torrent_inactive_timer": int(queueing.get("slowTorrentInactiveMinutes", 60)),
    "max_ratio_enabled": ratio_limit is not None,
    "max_ratio": 0 if ratio_limit is None else float(ratio_limit),
    "max_ratio_act": ratio_action_map.get(ratio_action, 0),
    "max_seeding_time_enabled": max_seeding_minutes is not None,
    "max_seeding_time": -1 if max_seeding_minutes is None else int(max_seeding_minutes),
    "max_inactive_seeding_time_enabled": max_inactive_seeding_minutes is not None,
    "max_inactive_seeding_time": -1 if max_inactive_seeding_minutes is None else int(max_inactive_seeding_minutes),
    "ip_filter_enabled": bool(ip_filter.get("enabled", False)),
    "ip_filter_path": ip_filter.get("path", "/config/qBittorrent/ipfilter.p2p"),
    "ip_filter_trackers": bool(ip_filter.get("applyToTrackers", False)),
}

print(json.dumps(preferences, separators=(",", ":")))
PY
}

apply_qbittorrent_preset() {
    local wait_for_ready="$1"
    local cookie_file bootstrap_password payload
    local desired_incomplete="/downloads/$DOWNLOAD_INCOMPLETE_NAME"
    local desired_complete="/downloads/$DOWNLOAD_COMPLETE_NAME"

    if [[ "$(selected_torrent_client)" != "qbittorrent" ]]; then
        warn "qBittorrent preset skipped because qBittorrent is not the selected torrent client"
        return 0
    fi

    if [[ "$wait_for_ready" == "true" ]]; then
        wait_for_http "qBittorrent" "$QBITTORRENT_URL"
    fi

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

    sync_qbittorrent_ip_filter || true

    cookie_file="$(mktemp)"
    if ! qbittorrent_login "$USERNAME" "$PASSWORD" "$cookie_file"; then
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

    payload="$(qbittorrent_preferences_payload "$desired_complete" "$desired_incomplete")"
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
    if ! qbittorrent_login "$USERNAME" "$PASSWORD" "$cookie_file"; then
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
    ok "qBittorrent download preset applied"
}

build_servarr_client_payload() {
    local current_json="$1"
    local recent_priority_field="$2"
    local older_priority_field="$3"
    local priority="$4"

    python3 - "$DOWNLOADS_CONFIG_FILE" "$current_json" "$recent_priority_field" "$older_priority_field" "$priority" <<'PY'
import json
import sys

with open(sys.argv[1], "r", encoding="utf-8") as fh:
    config = json.load(fh)

current = json.loads(sys.argv[2])
recent_priority_field = sys.argv[3]
older_priority_field = sys.argv[4]
priority = int(sys.argv[5])
qbittorrent = config.get("servarr", {}).get("qbittorrent", {})

initial_state_map = {
    "start": 0,
    "forcestart": 1,
    "stopped": 2,
}
content_layout_map = {
    "default": 0,
    "original": 1,
    "subfolder": 2,
}

payload = json.loads(json.dumps(current))
payload["removeCompletedDownloads"] = bool(qbittorrent.get("removeCompletedDownloads", True))
payload["removeFailedDownloads"] = bool(qbittorrent.get("removeFailedDownloads", True))
payload["priority"] = priority

field_values = {
    "initialState": initial_state_map.get(str(qbittorrent.get("initialState", "start")).replace(" ", "").lower(), 0),
    "sequentialOrder": bool(qbittorrent.get("sequentialOrder", False)),
    "firstAndLast": bool(qbittorrent.get("firstAndLastFirst", False)),
    "contentLayout": content_layout_map.get(str(qbittorrent.get("contentLayout", "original")).replace(" ", "").lower(), 0),
    recent_priority_field: int(qbittorrent.get("recentPriority", 0)),
    older_priority_field: int(qbittorrent.get("olderPriority", 0)),
}

for field in payload.get("fields", []):
    name = field.get("name")
    if name in field_values:
        field["value"] = field_values[name]

print(json.dumps(payload, separators=(",", ":")))
PY
}

build_servarr_qbittorrent_create_payload() {
    local category_field="$1"
    local imported_category_field="$2"
    local recent_priority_field="$3"
    local older_priority_field="$4"
    local category_value="$5"
    local priority="$6"

    python3 - "$DOWNLOADS_CONFIG_FILE" "$category_field" "$imported_category_field" "$recent_priority_field" "$older_priority_field" "$category_value" "$priority" "$USERNAME" "$PASSWORD" "${QBITTORRENT_WEBUI_PORT:-8081}" <<'PY'
import json
import sys

with open(sys.argv[1], "r", encoding="utf-8") as fh:
    config = json.load(fh)

category_field = sys.argv[2]
imported_category_field = sys.argv[3]
recent_priority_field = sys.argv[4]
older_priority_field = sys.argv[5]
category_value = sys.argv[6]
priority = int(sys.argv[7])
username = sys.argv[8]
password = sys.argv[9]
qbittorrent_port = int(sys.argv[10])
qbittorrent = config.get("servarr", {}).get("qbittorrent", {})

initial_state_map = {
    "start": 0,
    "forcestart": 1,
    "stopped": 2,
}
content_layout_map = {
    "default": 0,
    "original": 1,
    "subfolder": 2,
}

payload = {
    "enable": True,
    "protocol": "torrent",
    "priority": priority,
    "name": "qBittorrent",
    "implementation": "QBittorrent",
    "configContract": "QBittorrentSettings",
    "fields": [
        {"name": "host", "value": "qbittorrent"},
        {"name": "port", "value": qbittorrent_port},
        {"name": "useSsl", "value": False},
        {"name": "urlBase", "value": ""},
        {"name": "username", "value": username},
        {"name": "password", "value": password},
        {"name": category_field, "value": category_value},
        {"name": imported_category_field, "value": ""},
        {"name": recent_priority_field, "value": int(qbittorrent.get("recentPriority", 0))},
        {"name": older_priority_field, "value": int(qbittorrent.get("olderPriority", 0))},
        {"name": "initialState", "value": initial_state_map.get(str(qbittorrent.get("initialState", "start")).replace(" ", "").lower(), 0)},
        {"name": "sequentialOrder", "value": bool(qbittorrent.get("sequentialOrder", False))},
        {"name": "firstAndLast", "value": bool(qbittorrent.get("firstAndLastFirst", False))},
        {"name": "contentLayout", "value": content_layout_map.get(str(qbittorrent.get("contentLayout", "original")).replace(" ", "").lower(), 0)},
    ],
    "removeCompletedDownloads": bool(qbittorrent.get("removeCompletedDownloads", True)),
    "removeFailedDownloads": bool(qbittorrent.get("removeFailedDownloads", True)),
}

print(json.dumps(payload, separators=(",", ":")))
PY
}

build_servarr_transmission_client_payload() {
    local current_json="$1"
    local category_field="$2"
    local category_value="$3"
    local priority="$4"

    python3 - "$DOWNLOADS_CONFIG_FILE" "$current_json" "$category_field" "$category_value" "$USERNAME" "$PASSWORD" "$priority" <<'PY'
import json
import sys

with open(sys.argv[1], "r", encoding="utf-8") as fh:
    config = json.load(fh)

current = json.loads(sys.argv[2])
category_field = sys.argv[3]
category_value = sys.argv[4]
username = sys.argv[5]
password = sys.argv[6]
priority = int(sys.argv[7])
transmission = config.get("servarr", {}).get("transmission", {})

payload = json.loads(json.dumps(current))
payload["removeCompletedDownloads"] = bool(transmission.get("removeCompletedDownloads", True))
payload["removeFailedDownloads"] = bool(transmission.get("removeFailedDownloads", True))
payload["priority"] = priority

field_values = {
    "host": "transmission",
    "port": 9091,
    "useSsl": False,
    "urlBase": "/transmission/",
    "username": username,
    "password": password,
    category_field: category_value,
}

for field in payload.get("fields", []):
    name = field.get("name")
    if name in field_values:
        field["value"] = field_values[name]

print(json.dumps(payload, separators=(",", ":")))
PY
}

build_servarr_transmission_create_payload() {
    local category_field="$1"
    local category_value="$2"
    local priority="$3"

    python3 - "$DOWNLOADS_CONFIG_FILE" "$category_field" "$category_value" "$USERNAME" "$PASSWORD" "$priority" <<'PY'
import json
import sys

with open(sys.argv[1], "r", encoding="utf-8") as fh:
    config = json.load(fh)

category_field = sys.argv[2]
category_value = sys.argv[3]
username = sys.argv[4]
password = sys.argv[5]
priority = int(sys.argv[6])
transmission = config.get("servarr", {}).get("transmission", {})

payload = {
    "enable": True,
    "protocol": "torrent",
    "priority": priority,
    "name": "Transmission",
    "implementation": "Transmission",
    "configContract": "TransmissionSettings",
    "fields": [
        {"name": "host", "value": "transmission"},
        {"name": "port", "value": 9091},
        {"name": "useSsl", "value": False},
        {"name": "urlBase", "value": "/transmission/"},
        {"name": "username", "value": username},
        {"name": "password", "value": password},
        {"name": category_field, "value": category_value},
    ],
    "removeCompletedDownloads": bool(transmission.get("removeCompletedDownloads", True)),
    "removeFailedDownloads": bool(transmission.get("removeFailedDownloads", True)),
}

print(json.dumps(payload, separators=(",", ":")))
PY
}

find_servarr_client() {
    local list_url="$1"
    local api_key="$2"
    local client_name="$3"
    local response

    response="$(curl -fsS "$list_url" -H "X-Api-Key: $api_key" 2>/dev/null)" || return 1
    [[ -n "$response" ]] || return 1

    response="$(python3 - "$response" "$client_name" <<'PY'
import json
import sys

items = json.loads(sys.argv[1])
target_name = sys.argv[2]
target = next((item for item in items if item.get("name") == target_name), None)
if target is None:
    raise SystemExit(1)

print(json.dumps(target, separators=(",", ":")))
PY
)" || return 1

    printf '%s\n' "$response"
}

servarr_client_id() {
    python3 - "$1" <<'PY'
import json
import sys

current = json.loads(sys.argv[1])
print(current.get("id", ""))
PY
}

patch_servarr_qbittorrent_client() {
    local label="$1"
    local list_url="$2"
    local update_base_url="$3"
    local api_key="$4"
    local category_field="$5"
    local category_value="$6"
    local imported_category_field="$7"
    local recent_priority_field="$8"
    local older_priority_field="$9"
    local wait_for_ready="${10}"
    local current payload client_id

    [[ -n "$api_key" ]] || {
        warn "$label skipped because the API key is missing"
        return 1
    }

    if [[ "$wait_for_ready" == "true" ]]; then
        wait_for_api "$list_url" "$api_key" "$label" || return 1
    fi

    if ! current="$(find_servarr_client "$list_url" "$api_key" "qBittorrent")"; then
        payload="$(build_servarr_qbittorrent_create_payload "$category_field" "$imported_category_field" "$recent_priority_field" "$older_priority_field" "$category_value" "$(download_client_priority qbittorrent)")" || true
        if [[ -n "$payload" ]] && curl -fsS -X POST "$update_base_url" -H "X-Api-Key: $api_key" -H "Content-Type: application/json" --data "$payload" >/dev/null; then
            ok "$label created"
            return 0
        fi

        warn "$label skipped because the qBittorrent client is not configured yet"
        return 1
    fi

    payload="$(build_servarr_client_payload "$current" "$recent_priority_field" "$older_priority_field" "$(download_client_priority qbittorrent)")"
    if [[ "$payload" == "$current" ]]; then
        warn "$label already configured"
        return 0
    fi

    client_id="$(servarr_client_id "$current")"

    if [[ -z "$client_id" ]]; then
        warn "$label skipped because the qBittorrent client ID is missing"
        return 1
    fi

    curl -fsS -X PUT "$update_base_url/$client_id" \
        -H "X-Api-Key: $api_key" \
        -H "Content-Type: application/json" \
        --data "$payload" >/dev/null || {
        warn "$label could not be updated"
        return 1
    }

    ok "$label applied"
}

apply_servarr_qbittorrent_presets() {
    local wait_for_ready="$1"
    local radarr_key radarr4k_key sonarr_key sonarr4k_key lidarr_key

    if [[ "$(selected_torrent_client)" != "qbittorrent" ]]; then
        warn "Servarr qBittorrent preset skipped because qBittorrent is not the selected torrent client"
        return 0
    fi

    radarr_key="$(parse_api_key_xml "$CONFIG_ROOT/radarr/config.xml" || true)"
    sonarr_key="$(parse_api_key_xml "$CONFIG_ROOT/sonarr/config.xml" || true)"
    lidarr_key="$(parse_api_key_xml "$CONFIG_ROOT/lidarr/config.xml" || true)"

    patch_servarr_qbittorrent_client "Radarr qBittorrent client preset" "$RADARR_URL/api/v3/downloadclient" "$RADARR_URL/api/v3/downloadclient" "$radarr_key" "movieCategory" "$RADARR_CATEGORY" "movieImportedCategory" "recentMoviePriority" "olderMoviePriority" "$wait_for_ready" || true
    patch_servarr_qbittorrent_client "Sonarr qBittorrent client preset" "$SONARR_URL/api/v3/downloadclient" "$SONARR_URL/api/v3/downloadclient" "$sonarr_key" "tvCategory" "$SONARR_CATEGORY" "tvImportedCategory" "recentTvPriority" "olderTvPriority" "$wait_for_ready" || true
    patch_servarr_qbittorrent_client "Lidarr qBittorrent client preset" "$LIDARR_URL/api/v1/downloadclient" "$LIDARR_URL/api/v1/downloadclient" "$lidarr_key" "musicCategory" "$LIDARR_CATEGORY" "musicImportedCategory" "recentMusicPriority" "olderMusicPriority" "$wait_for_ready" || true
    patch_servarr_download_handling "Radarr completed download handling" "$RADARR_URL/api/v3/config/downloadclient" "$radarr_key" "$wait_for_ready" || true
    patch_servarr_download_handling "Sonarr completed download handling" "$SONARR_URL/api/v3/config/downloadclient" "$sonarr_key" "$wait_for_ready" || true
    patch_servarr_download_handling "Lidarr completed download handling" "$LIDARR_URL/api/v1/config/downloadclient" "$lidarr_key" "$wait_for_ready" || true
    if optional_service_enabled radarr4k; then
        radarr4k_key="$(parse_api_key_xml "$CONFIG_ROOT/radarr4k/config.xml" || true)"
        patch_servarr_qbittorrent_client "Radarr 4K qBittorrent client preset" "$RADARR_4K_URL/api/v3/downloadclient" "$RADARR_4K_URL/api/v3/downloadclient" "$radarr4k_key" "movieCategory" "$RADARR_4K_CATEGORY" "movieImportedCategory" "recentMoviePriority" "olderMoviePriority" "$wait_for_ready" || true
        patch_servarr_download_handling "Radarr 4K completed download handling" "$RADARR_4K_URL/api/v3/config/downloadclient" "$radarr4k_key" "$wait_for_ready" || true
    fi
    if optional_service_enabled sonarr4k; then
        sonarr4k_key="$(parse_api_key_xml "$CONFIG_ROOT/sonarr4k/config.xml" || true)"
        patch_servarr_qbittorrent_client "Sonarr 4K qBittorrent client preset" "$SONARR_4K_URL/api/v3/downloadclient" "$SONARR_4K_URL/api/v3/downloadclient" "$sonarr4k_key" "tvCategory" "$SONARR_4K_CATEGORY" "tvImportedCategory" "recentTvPriority" "olderTvPriority" "$wait_for_ready" || true
        patch_servarr_download_handling "Sonarr 4K completed download handling" "$SONARR_4K_URL/api/v3/config/downloadclient" "$sonarr4k_key" "$wait_for_ready" || true
    fi
}

patch_servarr_transmission_client() {
    local label="$1"
    local list_url="$2"
    local update_base_url="$3"
    local api_key="$4"
    local category_field="$5"
    local category_value="$6"
    local wait_for_ready="$7"
    local current payload client_id

    [[ -n "$api_key" ]] || {
        warn "$label skipped because the API key is unavailable"
        return 1
    }

    if [[ "$wait_for_ready" == "true" ]]; then
        wait_for_api "$list_url" "$api_key" "$label" || return 1
    fi

    if ! current="$(find_servarr_client "$list_url" "$api_key" "Transmission")"; then
        payload="$(build_servarr_transmission_create_payload "$category_field" "$category_value" "$(download_client_priority transmission)")" || true
        if [[ -n "$payload" ]] && curl -fsS -X POST "$update_base_url" -H "X-Api-Key: $api_key" -H "Content-Type: application/json" --data "$payload" >/dev/null; then
            ok "$label created"
            return 0
        fi

        warn "$label skipped because the Transmission client is not configured yet"
        return 1
    fi

    payload="$(build_servarr_transmission_client_payload "$current" "$category_field" "$category_value" "$(download_client_priority transmission)")"
    if [[ "$payload" == "$current" ]]; then
        warn "$label already configured"
        return 0
    fi

    client_id="$(servarr_client_id "$current")"

    if [[ -z "$client_id" ]]; then
        warn "$label skipped because the Transmission client ID is missing"
        return 1
    fi

    curl -fsS -X PUT "$update_base_url/$client_id" \
        -H "X-Api-Key: $api_key" \
        -H "Content-Type: application/json" \
        --data "$payload" >/dev/null || {
        warn "$label could not be updated"
        return 1
    }

    ok "$label applied"
}

apply_servarr_transmission_presets() {
    local wait_for_ready="$1"
    local radarr_key radarr4k_key sonarr_key sonarr4k_key lidarr_key

    if [[ "$(selected_torrent_client)" != "transmission" ]]; then
        warn "Servarr Transmission preset skipped because Transmission is not the selected torrent client"
        return 0
    fi

    radarr_key="$(parse_api_key_xml "$CONFIG_ROOT/radarr/config.xml" || true)"
    sonarr_key="$(parse_api_key_xml "$CONFIG_ROOT/sonarr/config.xml" || true)"
    lidarr_key="$(parse_api_key_xml "$CONFIG_ROOT/lidarr/config.xml" || true)"

    patch_servarr_transmission_client "Radarr Transmission client preset" "$RADARR_URL/api/v3/downloadclient" "$RADARR_URL/api/v3/downloadclient" "$radarr_key" "movieCategory" "$RADARR_CATEGORY" "$wait_for_ready" || true
    patch_servarr_transmission_client "Sonarr Transmission client preset" "$SONARR_URL/api/v3/downloadclient" "$SONARR_URL/api/v3/downloadclient" "$sonarr_key" "tvCategory" "$SONARR_CATEGORY" "$wait_for_ready" || true
    patch_servarr_transmission_client "Lidarr Transmission client preset" "$LIDARR_URL/api/v1/downloadclient" "$LIDARR_URL/api/v1/downloadclient" "$lidarr_key" "musicCategory" "$LIDARR_CATEGORY" "$wait_for_ready" || true
    patch_servarr_download_handling "Radarr completed download handling" "$RADARR_URL/api/v3/config/downloadclient" "$radarr_key" "$wait_for_ready" || true
    patch_servarr_download_handling "Sonarr completed download handling" "$SONARR_URL/api/v3/config/downloadclient" "$sonarr_key" "$wait_for_ready" || true
    patch_servarr_download_handling "Lidarr completed download handling" "$LIDARR_URL/api/v1/config/downloadclient" "$lidarr_key" "$wait_for_ready" || true
    if optional_service_enabled radarr4k; then
        radarr4k_key="$(parse_api_key_xml "$CONFIG_ROOT/radarr4k/config.xml" || true)"
        patch_servarr_transmission_client "Radarr 4K Transmission client preset" "$RADARR_4K_URL/api/v3/downloadclient" "$RADARR_4K_URL/api/v3/downloadclient" "$radarr4k_key" "movieCategory" "$RADARR_4K_CATEGORY" "$wait_for_ready" || true
        patch_servarr_download_handling "Radarr 4K completed download handling" "$RADARR_4K_URL/api/v3/config/downloadclient" "$radarr4k_key" "$wait_for_ready" || true
    fi
    if optional_service_enabled sonarr4k; then
        sonarr4k_key="$(parse_api_key_xml "$CONFIG_ROOT/sonarr4k/config.xml" || true)"
        patch_servarr_transmission_client "Sonarr 4K Transmission client preset" "$SONARR_4K_URL/api/v3/downloadclient" "$SONARR_4K_URL/api/v3/downloadclient" "$sonarr4k_key" "tvCategory" "$SONARR_4K_CATEGORY" "$wait_for_ready" || true
        patch_servarr_download_handling "Sonarr 4K completed download handling" "$SONARR_4K_URL/api/v3/config/downloadclient" "$sonarr4k_key" "$wait_for_ready" || true
    fi
}

main() {
    local cmd="${1:-apply}"
    local wait_for_ready="false"
    local skip_transmission="false"
    local skip_qbittorrent="false"
    local skip_servarr="false"

    shift || true

    while (($#)); do
        case "$1" in
            --wait)
                wait_for_ready="true"
                ;;
            --skip-transmission)
                skip_transmission="true"
                ;;
            --skip-qbittorrent)
                skip_qbittorrent="true"
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

    require_downloads_config
    load_env
    configure_download_service_urls

    case "$cmd" in
        apply)
            if [[ "$skip_transmission" != "true" ]]; then
                apply_transmission_preset "$wait_for_ready"
            fi
            if [[ "$skip_qbittorrent" != "true" ]]; then
                apply_qbittorrent_preset "$wait_for_ready"
            fi
            if [[ "$skip_servarr" != "true" ]]; then
                apply_servarr_transmission_presets "$wait_for_ready"
                apply_servarr_qbittorrent_presets "$wait_for_ready"
            fi
            ;;
        *)
            usage
            fail "Unknown downloads subcommand: $cmd"
            ;;
    esac
}

main "$@"
