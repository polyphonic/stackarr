#!/bin/bash
set -euo pipefail

ROOT_DIR="$(cd "$(dirname "$0")/.." && pwd)"
# shellcheck source=lib/common.sh
source "$ROOT_DIR/lib/common.sh"

PASS=0
WARNINGS=0
FAILS=0

pass() {
    ok "$1"
    PASS=$((PASS + 1))
}

warning() {
    warn "$1"
    WARNINGS=$((WARNINGS + 1))
}

failure() {
    warn "$1"
    FAILS=$((FAILS + 1))
}

print_header "Stackarr Doctor"

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

check_native_plex_identity_health() {
    local token prefs_xml root_xml cloud_xml current_interface
    local local_summary cloud_summary
    local local_machine local_platform local_platform_version local_version
    local cloud_platform cloud_platform_version cloud_version

    token="$(read_native_plex_pref "PlexOnlineToken" || true)"
    if [[ -z "$token" ]]; then
        warning "Native Plex token missing; skipping Plex publish metadata checks"
        return 0
    fi

    prefs_xml="$(curl -fsS "http://127.0.0.1:32400/:/prefs?X-Plex-Token=$token" 2>/dev/null || true)"
    if [[ -z "$prefs_xml" ]]; then
        warning "Native Plex API is not reachable on localhost:32400; skipping Plex publish metadata checks"
        return 0
    fi

    current_interface="$(native_plex_setting_value_from_xml "$prefs_xml" "PreferredNetworkInterface")"
    if [[ -z "$current_interface" ]]; then
        warning "Native Plex preferred network interface is unset; virtual Docker or VPN adapters can confuse client discovery. Run 'stackarr configure --force' or set it in Plex > Settings > Network."
    elif is_virtual_network_interface "$current_interface"; then
        warning "Native Plex preferred network interface points at virtual adapter '$current_interface'; run 'stackarr configure --force' or set it to your main LAN adapter."
    else
        pass "Native Plex preferred network interface is pinned to $current_interface"
    fi

    fsevent_updates="$(native_plex_setting_value_from_xml "$prefs_xml" "FSEventLibraryUpdatesEnabled")"
    fsevent_partial_scans="$(native_plex_setting_value_from_xml "$prefs_xml" "FSEventLibraryPartialScanEnabled")"
    if [[ "$fsevent_updates" == "1" && "$fsevent_partial_scans" == "1" ]]; then
        pass "Native Plex filesystem-change library scans are enabled"
    else
        warning "Native Plex filesystem-change library scans are not fully enabled; enable 'Scan my library automatically' and 'Run a partial scan when changes are detected' in Plex."
    fi

    root_xml="$(curl -fsS "http://127.0.0.1:32400/?X-Plex-Token=$token" 2>/dev/null || true)"
    if [[ -z "$root_xml" ]]; then
        warning "Native Plex root endpoint is not reachable; skipping Plex cloud metadata comparison"
        return 0
    fi

    local_summary="$(native_plex_summary_from_root_xml "$root_xml")"
    local_machine="$(summary_field "$local_summary" "machineIdentifier")"
    local_platform="$(summary_field "$local_summary" "platform")"
    local_platform_version="$(summary_field "$local_summary" "platformVersion")"
    local_version="$(summary_field "$local_summary" "version")"

    cloud_xml="$(curl -fsS "https://plex.tv/api/resources?includeHttps=1" -H "X-Plex-Token: $token" 2>/dev/null || true)"
    if [[ -z "$cloud_xml" ]]; then
        warning "plex.tv could not be reached; skipping Plex cloud metadata comparison"
        return 0
    fi

    cloud_summary="$(native_plex_summary_from_cloud_xml "$cloud_xml" "$local_machine")"
    if [[ -z "$cloud_summary" ]]; then
        failure "plex.tv does not currently list this native Plex server; clients may rely on stale discovery data and mobile apps may fail"
        return 0
    fi

    cloud_platform="$(summary_field "$cloud_summary" "platform")"
    cloud_platform_version="$(summary_field "$cloud_summary" "platformVersion")"
    cloud_version="$(summary_field "$cloud_summary" "productVersion")"

    if [[ "$cloud_platform" == "$local_platform" && "$cloud_platform_version" == "$local_platform_version" && "$cloud_version" == "$local_version" ]]; then
        pass "plex.tv metadata matches the live native Plex server"
    else
        failure "plex.tv metadata differs from the live native Plex server; mobile apps may show 'server outdated'. Run 'stackarr configure --force'."
    fi
}

service_port_localhost_only() {
    local service="$1"
    local container_port="$2"
    local mapping

    mapping="$(stackarr_compose port "$service" "$container_port" 2>/dev/null | head -1 || true)"
    [[ "$mapping" == 127.0.0.1:* ]]
}

if command -v docker >/dev/null 2>&1 && docker info >/dev/null 2>&1; then
    pass "Docker runtime is ready"
else
    failure "Docker runtime is not ready"
fi

DB_FILE="${STACKARR_DATABASE_FILE:-$(default_stackarr_database_file)}"
if [[ -f "$DB_FILE" ]]; then
    pass "Stackarr runtime config database exists"
else
    warn "Stackarr runtime config database is missing; defaults will be used until setup or init writes config"
fi
load_env
STACKARR_BIN="$(find_stackarr_bin || true)"

for dir in "${MEDIA_ROOT:-}" "${MUSIC_ROOT:-}" "${CONFIG_ROOT:-}" "${DOWNLOADS_ROOT:-}" "${BACKUP_ROOT:-}"; do
    [[ -n "$dir" ]] || continue
    if [[ -d "$dir" ]]; then
        pass "Directory exists: $dir"
    else
        failure "Directory missing: $dir"
    fi
done

if stackarr_compose config >/dev/null 2>&1; then
    pass "docker-compose.yml parses"
else
    failure "docker-compose.yml failed to parse"
fi

if [[ -d "${PLEX_CONFIG_PATH:-}" ]]; then
    pass "Native Plex config path exists"
else
    warning "Native Plex config path missing: ${PLEX_CONFIG_PATH:-unset}"
fi

if [[ -f "${PLEX_PREFS_PATH:-}" ]]; then
    pass "Native Plex preferences plist exists"
else
    warning "Native Plex preferences plist missing: ${PLEX_PREFS_PATH:-unset}"
fi

if [[ -d "${PLEX_CONFIG_PATH:-}" ]] && [[ -d "${BACKUP_ROOT:-}" ]] && is_subpath "${BACKUP_ROOT:-}" "${PLEX_CONFIG_PATH:-}"; then
    failure "Backup root is inside the Plex Media Server data directory"
fi

if pgrep -x "Plex Media Server" >/dev/null 2>&1; then
    pass "Plex Media Server process detected"
else
    warning "Plex Media Server process not detected"
fi

if [[ -f "${PLEX_PREFS_PATH:-}" ]]; then
    check_native_plex_identity_health
fi

if [[ -f "$HOME/Library/LaunchAgents/com.stackarr.stack.plist" ]]; then
    pass "Startup launch agent installed"
    if [[ -n "${STACKARR_BUNDLE_IDENTIFIER:-}" ]] && grep -Fq "<string>$STACKARR_BUNDLE_IDENTIFIER</string>" "$HOME/Library/LaunchAgents/com.stackarr.stack.plist"; then
        pass "Startup launch agent is associated with the Stackarr app bundle"
    else
        warning "Startup launch agent is not associated with the Stackarr app bundle. Reinstall it with 'stackarr startup install'."
    fi
    if [[ -n "${STACKARR_BIN:-}" ]] && grep -Fq "<string>$STACKARR_BIN</string>" "$HOME/Library/LaunchAgents/com.stackarr.stack.plist"; then
        pass "Startup launch agent points at this Stackarr executable"
    else
        warning "Startup launch agent points at a different Stackarr executable. Reinstall it with 'stackarr startup install'."
    fi
else
    warning "Startup launch agent not installed"
fi

if [[ -f "$HOME/Library/LaunchAgents/com.stackarr.backup.plist" ]]; then
    pass "Backup launch agent installed"
    BACKUP_AGENT_BIN="${STATE_ROOT:-}/launchd/Stackarr Backup Agent.app/Contents/MacOS/stackarr-backup-agent"
    if [[ -n "${STACKARR_BUNDLE_IDENTIFIER:-}" ]] && grep -Fq "<string>$STACKARR_BUNDLE_IDENTIFIER</string>" "$HOME/Library/LaunchAgents/com.stackarr.backup.plist"; then
        pass "Backup launch agent is associated with the Stackarr app bundle"
    else
        warning "Backup launch agent is not associated with the Stackarr app bundle. Reinstall it with 'stackarr backup install'."
    fi
    if [[ -n "${STACKARR_BIN:-}" ]] && grep -Fq "<string>$STACKARR_BIN</string>" "$HOME/Library/LaunchAgents/com.stackarr.backup.plist"; then
        pass "Backup launch agent points at this Stackarr executable"
    elif [[ -x "$BACKUP_AGENT_BIN" ]] && grep -Fq "<string>$BACKUP_AGENT_BIN</string>" "$HOME/Library/LaunchAgents/com.stackarr.backup.plist"; then
        pass "Backup launch agent uses the dedicated Stackarr Backup Agent helper"
    else
        warning "Backup launch agent points at a different Stackarr executable. Reinstall it with 'stackarr backup install'."
    fi
else
    warning "Backup launch agent not installed"
fi

if [[ -f "$HOME/Library/LaunchAgents/com.stackarr.update.plist" ]]; then
    pass "Update launch agent installed"
    if [[ -n "${STACKARR_BUNDLE_IDENTIFIER:-}" ]] && grep -Fq "<string>$STACKARR_BUNDLE_IDENTIFIER</string>" "$HOME/Library/LaunchAgents/com.stackarr.update.plist"; then
        pass "Update launch agent is associated with the Stackarr app bundle"
    else
        warning "Update launch agent is not associated with the Stackarr app bundle. Reinstall it with 'stackarr update install'."
    fi
    if [[ -n "${STACKARR_BIN:-}" ]] && grep -Fq "<string>$STACKARR_BIN</string>" "$HOME/Library/LaunchAgents/com.stackarr.update.plist"; then
        pass "Update launch agent points at this Stackarr executable"
    else
        warning "Update launch agent points at a different Stackarr executable. Reinstall it with 'stackarr update install'."
    fi
else
    warning "Update launch agent not installed"
fi

if torrent_client_enabled transmission; then
    if service_port_localhost_only "transmission" "9091"; then
        pass "Transmission web UI is localhost-only"
    else
        pass "Transmission web UI is exposed beyond localhost (intentional)"
    fi
else
    pass "Transmission is not selected for this install"
fi

if torrent_client_enabled qbittorrent; then
    if service_port_localhost_only "qbittorrent" "${QBITTORRENT_WEBUI_PORT:-8081}"; then
        pass "qBittorrent web UI is localhost-only"
    else
        warning "qBittorrent web UI is exposed beyond localhost"
    fi
else
    pass "qBittorrent is not selected for this install"
fi

CLOUDFLARED_PLIST="$HOME/Library/LaunchAgents/com.stackarr.cloudflared.plist"
CLOUDFLARED_TOKEN_PATH="${CLOUDFLARED_TOKEN_FILE:-${STATE_ROOT:-$HOME/Library/Application Support/Stackarr/state}/cloudflared-token}"
if [[ -f "$CLOUDFLARED_PLIST" || -n "${CLOUDFLARED_TUNNEL_ID:-}" ]]; then

    if find_cloudflared_bin >/dev/null 2>&1; then
        pass "cloudflared is installed"
    else
        warning "Cloudflare tunnel is configured, but cloudflared is not installed"
    fi

    if [[ -f "$CLOUDFLARED_PLIST" ]]; then
        pass "Cloudflare tunnel launch agent installed"
    else
        warning "Cloudflare tunnel runtime config exists but launch agent is missing"
    fi

    if [[ -f "$CLOUDFLARED_TOKEN_PATH" ]]; then
        pass "Cloudflare connector token file exists"
    else
        warning "Cloudflare connector token file is missing"
    fi

    if launchctl print "gui/$(id -u)/com.stackarr.cloudflared" >/dev/null 2>&1; then
        pass "Cloudflare tunnel launch agent is loaded"
    else
        warning "Cloudflare tunnel launch agent is not loaded"
    fi

    if curl -fsS --max-time 2 "http://127.0.0.1:42183/ready" >/dev/null 2>&1; then
        pass "Cloudflare tunnel metrics endpoint is ready"
    else
        warning "Cloudflare tunnel metrics endpoint is not ready"
    fi

    if [[ "${SEERR_BIND_IP:-}" != "127.0.0.1" ]]; then
        pass "Seerr is LAN-accessible while Cloudflare is enabled"
    else
        warning "Seerr is still localhost-only even though Cloudflare is configured"
    fi
fi

if command -v tailscale >/dev/null 2>&1; then
    if tailscale status >/dev/null 2>&1; then
        pass "Tailscale is installed"
    else
        warning "Tailscale is installed but not connected"
    fi
else
    warning "Tailscale not installed"
fi

echo ""
echo "Passed:   $PASS"
echo "Warnings: $WARNINGS"
echo "Failed:   $FAILS"

[[ "$FAILS" -eq 0 ]]
