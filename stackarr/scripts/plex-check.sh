#!/bin/bash
set -euo pipefail

ROOT_DIR="$(cd "$(dirname "$0")/.." && pwd)"
# shellcheck source=lib/common.sh
source "$ROOT_DIR/lib/common.sh"

ISSUES=0

pass() {
    ok "$1"
}

warning() {
    warn "$1"
}

failure() {
    warn "$1"
    ISSUES=$((ISSUES + 1))
}

print_kv() {
    local key="$1"
    local value="${2:-}"
    printf '  %-20s %s\n' "$key" "${value:-<empty>}"
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

native_plex_summary_from_identity_xml() {
    local xml="$1"

    python3 - "$xml" <<'PY'
import sys
import xml.etree.ElementTree as ET

xml = sys.argv[1]
root = ET.fromstring(xml)
for key in ("machineIdentifier", "claimed", "version"):
    print(f"{key}={root.get(key, '')}")
PY
}

native_plex_summary_from_cloud_resources_xml() {
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
        for key in ("clientIdentifier", "platform", "platformVersion", "productVersion", "publicAddress", "lastSeenAt"):
            print(f"{key}={node.get(key, '')}")
        break
PY
}

native_plex_summary_from_devices_xml() {
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
        for key in ("clientIdentifier", "platform", "platformVersion", "productVersion", "version", "lastSeenAt"):
            print(f"{key}={node.get(key, '')}")
        break
PY
}

native_plex_summary_from_servers_xml() {
    local xml="$1"
    local machine_identifier="$2"

    python3 - "$machine_identifier" "$xml" <<'PY'
import sys
import xml.etree.ElementTree as ET

machine_identifier = sys.argv[1]
xml = sys.argv[2]
root = ET.fromstring(xml)

for node in root.findall("Server"):
    if node.get("machineIdentifier") == machine_identifier:
        for key in ("machineIdentifier", "name", "version", "updatedAt", "address", "port", "localAddresses"):
            print(f"{key}={node.get(key, '')}")
        break
PY
}

summary_field() {
    local summary="$1"
    local key="$2"

    printf '%s\n' "$summary" | sed -n "s/^${key}=//p" | head -1
}

print_header "Stackarr Plex Check"
load_env
plex_host="${STACKARR_PLEX_HOST:-127.0.0.1}"
plex_base_url="http://${plex_host}:32400"

token="$(read_native_plex_pref "PlexOnlineToken" || true)"
[[ -n "$token" ]] || fail "Native Plex token missing from $PLEX_PREFS_PATH"

prefs_xml="$(curl -fsS "${plex_base_url}/:/prefs?X-Plex-Token=$token" 2>/dev/null || true)"
root_xml="$(curl -fsS "${plex_base_url}/?X-Plex-Token=$token" 2>/dev/null || true)"
identity_xml="$(curl -fsS "${plex_base_url}/identity?X-Plex-Token=$token" 2>/dev/null || true)"
resources_xml="$(curl -fsS "https://plex.tv/api/resources?includeHttps=1&includeRelay=1&X-Plex-Token=$token" 2>/dev/null || true)"
devices_xml="$(curl -fsS "https://plex.tv/devices.xml?X-Plex-Token=$token" 2>/dev/null || true)"
servers_xml="$(curl -fsS "https://plex.tv/pms/servers.xml?X-Plex-Token=$token" 2>/dev/null || true)"

[[ -n "$prefs_xml" ]] || fail "Could not reach native Plex prefs on ${plex_host}:32400"
[[ -n "$root_xml" ]] || fail "Could not reach native Plex root endpoint on ${plex_host}:32400"
[[ -n "$identity_xml" ]] || fail "Could not reach native Plex identity endpoint on ${plex_host}:32400"
[[ -n "$resources_xml" ]] || fail "Could not reach plex.tv resources"
[[ -n "$devices_xml" ]] || fail "Could not reach plex.tv devices.xml"
[[ -n "$servers_xml" ]] || fail "Could not reach plex.tv pms/servers.xml"

preferred_interface="$(native_plex_setting_value_from_xml "$prefs_xml" "PreferredNetworkInterface")"
local_summary="$(native_plex_summary_from_root_xml "$root_xml")"
identity_summary="$(native_plex_summary_from_identity_xml "$identity_xml")"

local_machine="$(summary_field "$local_summary" "machineIdentifier")"
local_platform="$(summary_field "$local_summary" "platform")"
local_platform_version="$(summary_field "$local_summary" "platformVersion")"
local_version="$(summary_field "$local_summary" "version")"
identity_version="$(summary_field "$identity_summary" "version")"

resources_summary="$(native_plex_summary_from_cloud_resources_xml "$resources_xml" "$local_machine")"
devices_summary="$(native_plex_summary_from_devices_xml "$devices_xml" "$local_machine")"
servers_summary="$(native_plex_summary_from_servers_xml "$servers_xml" "$local_machine")"

echo "Local PMS"
print_kv "machineIdentifier" "$local_machine"
print_kv "platform" "$local_platform"
print_kv "platformVersion" "$local_platform_version"
print_kv "version" "$local_version"
print_kv "identityVersion" "$identity_version"
print_kv "preferredInterface" "$preferred_interface"
echo ""

echo "plex.tv resources"
print_kv "clientIdentifier" "$(summary_field "$resources_summary" "clientIdentifier")"
print_kv "platform" "$(summary_field "$resources_summary" "platform")"
print_kv "platformVersion" "$(summary_field "$resources_summary" "platformVersion")"
print_kv "productVersion" "$(summary_field "$resources_summary" "productVersion")"
print_kv "publicAddress" "$(summary_field "$resources_summary" "publicAddress")"
print_kv "lastSeenAt" "$(summary_field "$resources_summary" "lastSeenAt")"
echo ""

echo "plex.tv devices.xml"
print_kv "clientIdentifier" "$(summary_field "$devices_summary" "clientIdentifier")"
print_kv "platform" "$(summary_field "$devices_summary" "platform")"
print_kv "platformVersion" "$(summary_field "$devices_summary" "platformVersion")"
print_kv "productVersion" "$(summary_field "$devices_summary" "productVersion")"
print_kv "version" "$(summary_field "$devices_summary" "version")"
print_kv "lastSeenAt" "$(summary_field "$devices_summary" "lastSeenAt")"
echo ""

echo "plex.tv pms/servers.xml"
print_kv "machineIdentifier" "$(summary_field "$servers_summary" "machineIdentifier")"
print_kv "name" "$(summary_field "$servers_summary" "name")"
print_kv "version" "$(summary_field "$servers_summary" "version")"
print_kv "updatedAt" "$(summary_field "$servers_summary" "updatedAt")"
print_kv "address" "$(summary_field "$servers_summary" "address")"
print_kv "port" "$(summary_field "$servers_summary" "port")"
print_kv "localAddresses" "$(summary_field "$servers_summary" "localAddresses")"
echo ""

if [[ -z "$preferred_interface" ]]; then
    warning "Preferred network interface is unset"
elif is_virtual_network_interface "$preferred_interface"; then
    warning "Preferred network interface points at virtual adapter '$preferred_interface'"
else
    pass "Preferred network interface is pinned to $preferred_interface"
fi

if [[ -z "$resources_summary" ]]; then
    failure "plex.tv resources does not list the native PMS machine identifier"
elif [[ "$(summary_field "$resources_summary" "platform")" != "$local_platform" || "$(summary_field "$resources_summary" "platformVersion")" != "$local_platform_version" || "$(summary_field "$resources_summary" "productVersion")" != "$local_version" ]]; then
    failure "plex.tv resources disagrees with the live native PMS identity"
else
    pass "plex.tv resources matches the live native PMS identity"
fi

if [[ -z "$devices_summary" ]]; then
    failure "plex.tv devices.xml does not list the native PMS machine identifier"
elif [[ "$(summary_field "$devices_summary" "platform")" != "$local_platform" || "$(summary_field "$devices_summary" "platformVersion")" != "$local_platform_version" || "$(summary_field "$devices_summary" "version")" != "$local_version" ]]; then
    failure "plex.tv devices.xml disagrees with the live native PMS identity"
else
    pass "plex.tv devices.xml matches the live native PMS identity"
fi

if [[ -z "$servers_summary" ]]; then
    failure "plex.tv pms/servers.xml does not list the native PMS machine identifier"
elif [[ "$(summary_field "$servers_summary" "version")" != "$local_version" ]]; then
    failure "plex.tv pms/servers.xml version disagrees with the live native PMS identity"
else
    pass "plex.tv pms/servers.xml version matches the live native PMS identity"
fi

if [[ -n "$identity_version" && "$identity_version" != "$local_version" ]]; then
    failure "Native PMS root and identity endpoints disagree on the server version"
else
    pass "Native PMS root and identity endpoints agree"
fi

echo ""
if (( ISSUES > 0 )); then
    warn "Plex identity check found $ISSUES issue(s)"
    exit 1
fi

ok "Plex identity check passed"
