#!/bin/bash
set -euo pipefail

ROOT_DIR="$(cd "$(dirname "$0")/.." && pwd)"
# shellcheck source=lib/common.sh
source "$ROOT_DIR/lib/common.sh"

ACTION="${1:-help}"
shift || true

load_env

PLIST_DIR="$HOME/Library/LaunchAgents"
PLIST_PATH="$PLIST_DIR/com.stackarr.cloudflared.plist"
LAUNCH_DOMAIN="gui/$(id -u)"
LAUNCH_LABEL="com.stackarr.cloudflared"
TOKEN_FILE="$STATE_ROOT/cloudflared-token"
API_TOKEN_FILE="$STATE_ROOT/cloudflare-api-token"
RUN_SCRIPT="$ROOT_DIR/scripts/cloudflare-run.sh"
DEFAULT_METRICS_PORT="42183"
DEFAULT_TUNNEL_NAME="stackarr"
DEFAULT_ACCESS_POLICY_NAME="${CLOUDFLARE_ACCESS_POLICY_NAME:-Email Allowlist}"
LEGACY_ACCESS_POLICY_NAME="Stackarr family allowlist"

usage() {
    fail "Usage: stackarr cloudflare install [--api-token <api-token>] [--route <hostname=service[:access|public]>] [--access-email <email>] [--access-session <duration>] [--no-access]
       stackarr cloudflare start
       stackarr cloudflare stop
       stackarr cloudflare status
       stackarr cloudflare sync
       stackarr cloudflare rotate [--api-token <api-token>]
       stackarr cloudflare delete [--api-token <api-token>]
       stackarr cloudflare uninstall"
}

normalize_hostname() {
    local value="$1"

    value="${value#https://}"
    value="${value#http://}"
    value="${value%%/*}"
    printf '%s\n' "$value"
}

cloudflare_service_url() {
    local service
    service="$(lowercase "$1")"

    case "$service" in
        stackarr|app|dashboard)
            printf 'http://127.0.0.1:%s\n' "${STACKARR_WEB_PORT:-7777}"
            ;;
        pulsarr|requests)
            printf 'http://127.0.0.1:%s\n' "${PULSARR_PORT:-3003}"
            ;;
        maintainerr|cleanup)
            printf 'http://127.0.0.1:%s\n' "${MAINTAINERR_PORT:-6246}"
            ;;
        tracearr|monitoring|analytics)
            printf 'http://127.0.0.1:%s\n' "${TRACEARR_PORT:-3000}"
            ;;
        bookorbit|books)
            printf 'http://127.0.0.1:%s\n' "${BOOKORBIT_WEB_PORT:-7582}"
            ;;
        immich|photos|pics)
            printf 'http://127.0.0.1:%s\n' "${IMMICH_WEB_PORT:-2283}"
            ;;
        romm|games)
            printf 'http://127.0.0.1:%s\n' "${ROMM_WEB_PORT:-7583}"
            ;;
        seerr)
            printf 'http://127.0.0.1:5055\n'
            ;;
        transmission)
            printf 'http://127.0.0.1:9091\n'
            ;;
        qbittorrent)
            printf 'http://127.0.0.1:%s\n' "${QBITTORRENT_WEBUI_PORT:-8081}"
            ;;
        plex)
            printf 'http://127.0.0.1:%s\n' "${PLEX_DOCKER_PORT:-32400}"
            ;;
        jellyfin)
            printf 'http://127.0.0.1:%s\n' "${JELLYFIN_DOCKER_PORT:-8096}"
            ;;
        tinymm|tinymediamanager)
            printf 'http://127.0.0.1:4000\n'
            ;;
        radarr)
            printf 'http://127.0.0.1:7878\n'
            ;;
        sonarr)
            printf 'http://127.0.0.1:8989\n'
            ;;
        lidarr)
            printf 'http://127.0.0.1:8686\n'
            ;;
        prowlarr)
            printf 'http://127.0.0.1:9696\n'
            ;;
        bazarr)
            printf 'http://127.0.0.1:6767\n'
            ;;
        *)
            return 1
            ;;
    esac
}

collect_cloudflare_routes() {
    python3 <<'PY'
import json
import os

def default_access(service):
    return service not in {"immich", "photos", "pics"}

def normalize_access(value, service):
    if isinstance(value, bool):
        return value
    token = str(value or "").strip().lower()
    if token in {"1", "true", "yes", "on", "access", "protected"}:
        return True
    if token in {"0", "false", "no", "off", "public", "mobile", "none"}:
        return False
    return default_access(service)

raw = os.environ.get("CLOUDFLARE_TUNNEL_ROUTES") or ""

try:
    routes = json.loads(raw) if raw else []
except Exception:
    routes = []

if not isinstance(routes, list):
    routes = []

seen = set()
for route in routes:
    if not isinstance(route, dict):
        continue
    hostname = str(route.get("hostname") or "").strip().lower()
    service = str(route.get("service") or "pulsarr").strip().lower()
    if hostname.startswith("https://"):
        hostname = hostname[8:]
    if hostname.startswith("http://"):
        hostname = hostname[7:]
    hostname = hostname.split("/", 1)[0]
    if not hostname or hostname in seen:
        continue
    access = normalize_access(route.get("access"), service)
    seen.add(hostname)
    print(f"{hostname}\t{service}\t{str(access).lower()}")
PY
}

print_cloudflare_route_override() {
    local route="$1"

    python3 - "$route" <<'PY'
import sys

ACCESS_TRUE = {"1", "true", "yes", "on", "access", "protected"}
ACCESS_FALSE = {"0", "false", "no", "off", "public", "mobile", "none"}

def default_access(service):
    return service not in {"immich", "photos", "pics"}

def parse_access(value, service):
    token = str(value or "").strip().lower()
    if token in ACCESS_TRUE:
        return True
    if token in ACCESS_FALSE:
        return False
    return default_access(service)

raw = sys.argv[1].strip()
raw = raw.removeprefix("https://").removeprefix("http://")
if "=" in raw:
    hostname, descriptor = raw.split("=", 1)
else:
    hostname, descriptor = raw, "pulsarr"

hostname = hostname.split("/", 1)[0].strip().lower()
descriptor = descriptor.strip().lower() or "pulsarr"
access_value = None

if "?access=" in descriptor:
    descriptor, access_value = descriptor.split("?access=", 1)

for separator in (":", ","):
    if separator in descriptor:
        left, right = descriptor.rsplit(separator, 1)
        if right in ACCESS_TRUE or right in ACCESS_FALSE:
            descriptor = left
            access_value = right
            break

service = descriptor.strip() or "pulsarr"
access = parse_access(access_value, service)

if hostname:
    print(f"{hostname}\t{service}\t{str(access).lower()}")
PY
}

routes_to_json() {
    local routes_file="$1"

    python3 - "$routes_file" <<'PY'
import json
import pathlib
import sys

def default_access(service):
    return service not in {"immich", "photos", "pics"}

def normalize_access(value, service):
    token = str(value or "").strip().lower()
    if token in {"1", "true", "yes", "on", "access", "protected"}:
        return True
    if token in {"0", "false", "no", "off", "public", "mobile", "none"}:
        return False
    return default_access(service)

routes = []
for line in pathlib.Path(sys.argv[1]).read_text().splitlines():
    parts = line.rstrip("\n").split("\t")
    if len(parts) >= 2 and parts[0] and parts[1]:
        access = normalize_access(parts[2] if len(parts) >= 3 else "", parts[1])
        routes.append({"hostname": parts[0], "service": parts[1], "access": access})
print(json.dumps(routes, separators=(",", ":")))
PY
}

cloudflare_routes_from_tunnel_config() {
    local config_file="$1"

    python3 - "$config_file" <<'PY'
import json
import os
import pathlib
import sys
from urllib.parse import urlparse

path = pathlib.Path(sys.argv[1])

try:
    payload = json.loads(path.read_text())
except Exception:
    payload = {}

result = payload.get("result") if isinstance(payload, dict) else {}
config = result.get("config") if isinstance(result, dict) else {}
ingress = config.get("ingress") if isinstance(config, dict) else []

ports = {
    str(os.environ.get("STACKARR_WEB_PORT") or "7777"): "app",
    str(os.environ.get("PULSARR_PORT") or "3003"): "pulsarr",
    str(os.environ.get("MAINTAINERR_PORT") or "6246"): "maintainerr",
    str(os.environ.get("TRACEARR_PORT") or "3000"): "tracearr",
    str(os.environ.get("BOOKORBIT_WEB_PORT") or "7582"): "bookorbit",
    str(os.environ.get("IMMICH_WEB_PORT") or "2283"): "immich",
    str(os.environ.get("ROMM_WEB_PORT") or "7583"): "romm",
    "5055": "seerr",
    "9091": "transmission",
    str(os.environ.get("QBITTORRENT_WEBUI_PORT") or "8081"): "qbittorrent",
    str(os.environ.get("PLEX_DOCKER_PORT") or "32400"): "plex",
    str(os.environ.get("JELLYFIN_DOCKER_PORT") or "8096"): "jellyfin",
    "4000": "tinymm",
    "7878": "radarr",
    "8989": "sonarr",
    "8686": "lidarr",
    "9696": "prowlarr",
    "6767": "bazarr",
}

def normalize_hostname(value):
    return str(value or "").strip().lower().removeprefix("https://").removeprefix("http://").split("/", 1)[0]

def service_from_url(value):
    text = str(value or "").strip()
    if not text or text.startswith("http_status:"):
        return ""
    parsed = urlparse(text)
    host = (parsed.hostname or "").lower()
    port = str(parsed.port or (443 if parsed.scheme == "https" else 80))
    if host in {"127.0.0.1", "localhost", "::1", "host.docker.internal"}:
        return ports.get(port, "")
    return ports.get(port, "")

seen = set()
for rule in ingress if isinstance(ingress, list) else []:
    if not isinstance(rule, dict):
        continue
    hostname = normalize_hostname(rule.get("hostname"))
    service = service_from_url(rule.get("service"))
    if not hostname or not service or hostname in seen:
        continue
    seen.add(hostname)
    print(f"{hostname}\t{service}")
PY
}

cloudflare_access_apps_summary() {
    local api_token="$1"
    local account_id="$2"
    local output_file="$3"
    local apps_file

    apps_file="$(mktemp)"
    if ! cloudflare_api_request "GET" "/accounts/$account_id/access/apps?per_page=1000" "$apps_file" "" "$api_token"; then
        rm -f "$apps_file"
        return 1
    fi

    python3 - "$apps_file" > "$output_file" <<'PY'
import json
import pathlib
import sys

payload = json.loads(pathlib.Path(sys.argv[1]).read_text())
for app in payload.get("result") or []:
    app_id = str(app.get("id") or "")
    session = str(app.get("session_duration") or "")
    domains = []
    if app.get("domain"):
        domains.append(app.get("domain"))
    for item in app.get("self_hosted_domains") or []:
        if isinstance(item, dict):
            domains.append(item.get("domain") or item.get("hostname") or "")
        else:
            domains.append(item)
    for domain in domains:
        hostname = str(domain or "").strip().lower()
        if hostname:
            print(f"{hostname}\t{app_id}\t{session}")
PY
    rm -f "$apps_file"
}

cloudflare_access_policy_summary() {
    local api_token="$1"
    local account_id="$2"
    local output_file="$3"
    local policies_file

    policies_file="$(mktemp)"
    if ! cloudflare_api_request "GET" "/accounts/$account_id/access/policies?per_page=1000" "$policies_file" "" "$api_token"; then
        rm -f "$policies_file"
        return 1
    fi

    python3 - "$policies_file" "$DEFAULT_ACCESS_POLICY_NAME" > "$output_file" <<'PY'
import json
import pathlib
import sys

payload = json.loads(pathlib.Path(sys.argv[1]).read_text())
target = sys.argv[2]

for policy in payload.get("result") or []:
    if policy.get("name") != target:
        continue
    emails = []
    for item in policy.get("include") or []:
        if not isinstance(item, dict):
            continue
        email = item.get("email")
        if isinstance(email, dict):
            value = email.get("email")
        else:
            value = email
        if value:
            emails.append(str(value).strip().lower())
    session = str(policy.get("session_duration") or "")
    print(",".join(dict.fromkeys(email for email in emails if email)) + "\t" + session)
    break
PY
    rm -f "$policies_file"
}

cloudflare_access_route_count() {
    local routes_file="$1"

    python3 - "$routes_file" <<'PY'
import pathlib
import sys

def default_access(service):
    return service not in {"immich", "photos", "pics"}

def normalize_access(value, service):
    token = str(value or "").strip().lower()
    if token in {"1", "true", "yes", "on", "access", "protected"}:
        return True
    if token in {"0", "false", "no", "off", "public", "mobile", "none"}:
        return False
    return default_access(service)

count = 0
for line in pathlib.Path(sys.argv[1]).read_text().splitlines():
    parts = line.rstrip("\n").split("\t")
    if len(parts) >= 2 and parts[0] and parts[1]:
        count += int(normalize_access(parts[2] if len(parts) >= 3 else "", parts[1]))
print(count)
PY
}

load_cloudflare_state() {
    return 0
}

write_cloudflare_state() {
    local binary="$1"
    local metrics_port="$2"
    local token_file="$3"
    local keep_lan="$4"
    local zone_id="$5"
    local route_managed="$6"
    local account_id="$7"
    local tunnel_id="$8"
    local tunnel_name="$9"

    set_env_value "CLOUDFLARED_BIN" "$binary"
    set_env_value "CLOUDFLARED_METRICS_PORT" "$metrics_port"
    set_env_value "CLOUDFLARED_TOKEN_FILE" "$token_file"
    set_env_value "CLOUDFLARED_KEEP_LAN" "$keep_lan"
    set_env_value "CLOUDFLARE_ZONE_ID" "$zone_id"
    set_env_value "CLOUDFLARE_ROUTE_MANAGED" "$route_managed"
    set_env_value "CLOUDFLARE_ACCOUNT_ID" "$account_id"
    set_env_value "CLOUDFLARED_TUNNEL_ID" "$tunnel_id"
    set_env_value "CLOUDFLARED_TUNNEL_NAME" "$tunnel_name"
}

write_cloudflare_token_file() {
    local token="$1"

    ensure_dir "$STATE_ROOT"

    umask 077
    printf '%s\n' "$token" > "$TOKEN_FILE"
}

write_cloudflare_api_token_file() {
    local token="$1"

    ensure_dir "$STATE_ROOT"

    umask 077
    printf '%s\n' "$token" > "$API_TOKEN_FILE"
    set_env_value "CLOUDFLARE_API_TOKEN" "$token"
}

read_secret_file() {
    local file="$1"

    [[ -f "$file" ]] || return 1
    tr -d '\r\n' < "$file"
}

read_cloudflare_api_token() {
    if [[ -n "${CLOUDFLARE_API_TOKEN:-}" ]]; then
        printf '%s\n' "$CLOUDFLARE_API_TOKEN"
        return 0
    fi

    if [[ -f "$API_TOKEN_FILE" ]]; then
        read_secret_file "$API_TOKEN_FILE"
        return 0
    fi

    return 1
}

read_cloudflare_tunnel_token() {
    local token_path="${CLOUDFLARED_TOKEN_FILE:-$TOKEN_FILE}"

    if [[ -f "$token_path" ]]; then
        read_secret_file "$token_path"
        return 0
    fi

    return 1
}

decode_tunnel_token_field() {
    local token="$1"
    local field="$2"

    python3 - "$token" "$field" <<'PY'
import base64
import json
import sys

token = sys.argv[1]
field = sys.argv[2]
padding = "=" * ((4 - len(token) % 4) % 4)
data = json.loads(base64.urlsafe_b64decode(token + padding))
value = data.get(field, "")
if value:
    print(value)
PY
}

cloudflare_api_request() {
    local method="$1"
    local path="$2"
    local output_file="$3"
    local body="${4:-}"
    local api_token="$5"
    local url="https://api.cloudflare.com/client/v4${path}"
    local status

    if [[ -n "$body" ]]; then
        status="$(curl -sS -o "$output_file" -w '%{http_code}' \
            --request "$method" \
            --header "Authorization: Bearer $api_token" \
            --header "Content-Type: application/json" \
            --data "$body" \
            "$url" || echo 000)"
    else
        status="$(curl -sS -o "$output_file" -w '%{http_code}' \
            --request "$method" \
            --header "Authorization: Bearer $api_token" \
            "$url" || echo 000)"
    fi

    if [[ "$status" =~ ^2 ]]; then
        return 0
    fi

    python3 - "$output_file" "$status" <<'PY'
import json
import pathlib
import sys

path = pathlib.Path(sys.argv[1])
status = sys.argv[2]
message = f"HTTP {status}"
try:
    payload = json.loads(path.read_text())
except Exception:
    payload = None
if isinstance(payload, dict):
    errors = payload.get("errors") or []
    if errors:
        err = errors[0]
        code = err.get("code")
        detail = err.get("message") or payload.get("messages") or ""
        if code:
            message = f"HTTP {status}, code {code}: {detail}"
        elif detail:
            message = f"HTTP {status}: {detail}"
print(message)
PY
    return 1
}

resolve_zone_info() {
    local hostname="$1"
    local api_token="$2"
    local candidate labels_count i suffix output_file

    output_file="$(mktemp)"
    labels_count="$(awk -F'.' '{print NF}' <<< "$hostname")"

    for ((i=0; i<labels_count; i++)); do
        if [[ "$i" -eq 0 ]]; then
            suffix="$hostname"
        else
            suffix="$(cut -d. -f"$((i + 1))"- <<< "$hostname")"
        fi
        [[ -n "$suffix" && "$suffix" == *.* ]] || continue

        if cloudflare_api_request "GET" "/zones?name=$suffix" "$output_file" "" "$api_token"; then
            candidate="$(python3 - "$output_file" "$suffix" <<'PY'
import json
import pathlib
import sys

payload = json.loads(pathlib.Path(sys.argv[1]).read_text())
target = sys.argv[2].lower()
for zone in payload.get("result") or []:
    if (zone.get("name") or "").lower() == target:
        print(f"{zone.get('id', '')}\t{((zone.get('account') or {}).get('id', ''))}")
        break
PY
)"
            if [[ -n "$candidate" ]]; then
                rm -f "$output_file"
                printf '%s\n' "$candidate"
                return 0
            fi
        fi
    done

    rm -f "$output_file"
    return 1
}

resolve_account_id_from_zone_id() {
    local zone_id="$1"
    local api_token="$2"
    local output_file account_id

    output_file="$(mktemp)"
    if ! cloudflare_api_request "GET" "/zones/$zone_id" "$output_file" "" "$api_token"; then
        rm -f "$output_file"
        return 1
    fi

    account_id="$(python3 - "$output_file" <<'PY'
import json
import pathlib
import sys

payload = json.loads(pathlib.Path(sys.argv[1]).read_text())
result = payload.get("result") or {}
print(((result.get("account") or {}).get("id")) or "")
PY
)"
    rm -f "$output_file"

    [[ -n "$account_id" ]] || return 1
    printf '%s\n' "$account_id"
}

find_cloudflare_tunnel_by_name() {
    local api_token="$1"
    local account_id="$2"
    local tunnel_name="$3"
    local output_file result

    output_file="$(mktemp)"
    if ! cloudflare_api_request "GET" "/accounts/$account_id/cfd_tunnel?is_deleted=false&name=$tunnel_name" "$output_file" "" "$api_token"; then
        rm -f "$output_file"
        return 1
    fi

    result="$(python3 - "$output_file" "$tunnel_name" <<'PY'
import json
import pathlib
import sys

payload = json.loads(pathlib.Path(sys.argv[1]).read_text())
target = sys.argv[2]
for tunnel in payload.get("result") or []:
    if tunnel.get("name") == target:
        print(f"{tunnel.get('id', '')}\t{tunnel.get('name', '')}")
        break
PY
)"
    rm -f "$output_file"

    [[ -n "$result" ]] || return 1
    printf '%s\n' "$result"
}

create_cloudflare_tunnel() {
    local api_token="$1"
    local account_id="$2"
    local tunnel_name="$3"
    local output_file body result

    output_file="$(mktemp)"
    body="$(python3 - "$tunnel_name" <<'PY'
import json
import sys

print(json.dumps({
    "name": sys.argv[1],
    "config_src": "cloudflare"
}, separators=(",", ":")))
PY
)"

    if ! cloudflare_api_request "POST" "/accounts/$account_id/cfd_tunnel" "$output_file" "$body" "$api_token"; then
        rm -f "$output_file"
        return 1
    fi

    result="$(python3 - "$output_file" <<'PY'
import json
import pathlib
import sys

payload = json.loads(pathlib.Path(sys.argv[1]).read_text())
result = payload.get("result") or {}
print(f"{result.get('id', '')}\t{result.get('name', '')}\t{result.get('token', '')}")
PY
)"
    rm -f "$output_file"

    [[ -n "$result" ]] || return 1
    printf '%s\n' "$result"
}

fetch_cloudflare_tunnel_details() {
    local api_token="$1"
    local account_id="$2"
    local tunnel_id="$3"
    local output_file result

    output_file="$(mktemp)"
    if ! cloudflare_api_request "GET" "/accounts/$account_id/cfd_tunnel/$tunnel_id" "$output_file" "" "$api_token"; then
        rm -f "$output_file"
        return 1
    fi

    result="$(python3 - "$output_file" <<'PY'
import json
import pathlib
import sys

payload = json.loads(pathlib.Path(sys.argv[1]).read_text())
result = payload.get("result") or {}
print(f"{result.get('id', '')}\t{result.get('name', '')}")
PY
)"
    rm -f "$output_file"

    [[ -n "$result" ]] || return 1
    printf '%s\n' "$result"
}

rename_cloudflare_tunnel() {
    local api_token="$1"
    local account_id="$2"
    local tunnel_id="$3"
    local tunnel_name="$4"
    local output_file body existing resolved_tunnel_id current_name

    [[ -n "$api_token" && -n "$account_id" && -n "$tunnel_id" && -n "$tunnel_name" ]] || return 0

    existing="$(fetch_cloudflare_tunnel_details "$api_token" "$account_id" "$tunnel_id" || true)"
    if [[ -n "$existing" ]]; then
        IFS=$'\t' read -r resolved_tunnel_id current_name <<< "$existing"
        if [[ "$current_name" == "$tunnel_name" ]]; then
            return 0
        fi
    fi

    output_file="$(mktemp)"
    body="$(python3 - "$tunnel_name" <<'PY'
import json
import sys

print(json.dumps({"name": sys.argv[1]}, separators=(",", ":")))
PY
)"

    if cloudflare_api_request "PATCH" "/accounts/$account_id/cfd_tunnel/$tunnel_id" "$output_file" "$body" "$api_token"; then
        ok "Renamed Cloudflare tunnel to '$tunnel_name'"
    else
        warn "Could not rename the Cloudflare tunnel automatically; local Stackarr config will still use '$tunnel_name'"
    fi

    rm -f "$output_file"
}

fetch_cloudflare_tunnel_token() {
    local api_token="$1"
    local account_id="$2"
    local tunnel_id="$3"
    local output_file tunnel_token

    output_file="$(mktemp)"
    if ! cloudflare_api_request "GET" "/accounts/$account_id/cfd_tunnel/$tunnel_id/token" "$output_file" "" "$api_token"; then
        rm -f "$output_file"
        return 1
    fi

    tunnel_token="$(python3 - "$output_file" <<'PY'
import json
import pathlib
import sys

payload = json.loads(pathlib.Path(sys.argv[1]).read_text())
result = payload.get("result") or ""
if isinstance(result, str):
    print(result)
PY
)"
    rm -f "$output_file"

    [[ -n "$tunnel_token" ]] || return 1
    printf '%s\n' "$tunnel_token"
}

ensure_cloudflare_tunnel_credentials() {
    local api_token="$1"
    local account_id="$2"
    local tunnel_id="$3"
    local tunnel_name="$4"
    local resolved_tunnel_id resolved_tunnel_name resolved_tunnel_token
    local existing

    [[ -n "$api_token" ]] || fail "Cloudflare API token is required"
    [[ -n "$account_id" ]] || fail "Could not determine the Cloudflare account ID. Make sure the API token includes Zone Read and provide a hostname in the same zone, or set CLOUDFLARE_ACCOUNT_ID."

    if [[ -n "$tunnel_id" ]]; then
        resolved_tunnel_token="$(fetch_cloudflare_tunnel_token "$api_token" "$account_id" "$tunnel_id" || true)"
        [[ -n "$resolved_tunnel_token" ]] || fail "Could not fetch the Cloudflare connector credential for tunnel $tunnel_id"
        if [[ -z "$tunnel_name" ]]; then
            existing="$(fetch_cloudflare_tunnel_details "$api_token" "$account_id" "$tunnel_id" || true)"
            if [[ -n "$existing" ]]; then
                IFS=$'\t' read -r resolved_tunnel_id resolved_tunnel_name <<< "$existing"
                [[ -n "$resolved_tunnel_name" ]] && tunnel_name="$resolved_tunnel_name"
            fi
        fi
        [[ -n "$tunnel_name" ]] || tunnel_name="$DEFAULT_TUNNEL_NAME"
        printf '%s\t%s\t%s\t%s\n' "$account_id" "$tunnel_id" "$tunnel_name" "$resolved_tunnel_token"
        return 0
    fi

    [[ -n "$tunnel_name" ]] || tunnel_name="$DEFAULT_TUNNEL_NAME"
    existing="$(find_cloudflare_tunnel_by_name "$api_token" "$account_id" "$tunnel_name" || true)"
    if [[ -n "$existing" ]]; then
        IFS=$'\t' read -r resolved_tunnel_id resolved_tunnel_name <<< "$existing"
        resolved_tunnel_token="$(fetch_cloudflare_tunnel_token "$api_token" "$account_id" "$resolved_tunnel_id" || true)"
        [[ -n "$resolved_tunnel_token" ]] || fail "Found Cloudflare tunnel '$resolved_tunnel_name' but could not fetch its connector credential"
        printf '%s\t%s\t%s\t%s\n' "$account_id" "$resolved_tunnel_id" "${resolved_tunnel_name:-$tunnel_name}" "$resolved_tunnel_token"
        return 0
    fi

    existing="$(create_cloudflare_tunnel "$api_token" "$account_id" "$tunnel_name" || true)"
    [[ -n "$existing" ]] || fail "Could not create a new Cloudflare tunnel named '$tunnel_name'"
    IFS=$'\t' read -r resolved_tunnel_id resolved_tunnel_name resolved_tunnel_token <<< "$existing"
    ok "Created Cloudflare tunnel '$resolved_tunnel_name'" >&2
    printf '%s\t%s\t%s\t%s\n' "$account_id" "$resolved_tunnel_id" "$resolved_tunnel_name" "$resolved_tunnel_token"
}

delete_cloudflare_dns_record() {
    local api_token="$1"
    local zone_id="$2"
    local hostname="$3"
    local tunnel_id="$4"
    local list_file delete_file record_id

    [[ -n "$zone_id" && -n "$hostname" ]] || return 0

    list_file="$(mktemp)"
    delete_file="$(mktemp)"

    if ! cloudflare_api_request "GET" "/zones/$zone_id/dns_records?name=$hostname" "$list_file" "" "$api_token"; then
        rm -f "$list_file" "$delete_file"
        warn "Could not inspect Cloudflare DNS records for $hostname during tunnel deletion"
        return 0
    fi

    record_id="$(python3 - "$list_file" "$hostname" "$tunnel_id" <<'PY'
import json
import pathlib
import sys

payload = json.loads(pathlib.Path(sys.argv[1]).read_text())
target = sys.argv[2].lower()
content = f"{sys.argv[3]}.cfargotunnel.com".lower()
for record in payload.get("result") or []:
    if (
        (record.get("name") or "").lower() == target
        and record.get("type") == "CNAME"
        and (record.get("content") or "").lower() == content
    ):
        print(record.get("id", ""))
        break
PY
)"

    if [[ -z "$record_id" ]]; then
        rm -f "$list_file" "$delete_file"
        return 0
    fi

    if cloudflare_api_request "DELETE" "/zones/$zone_id/dns_records/$record_id" "$delete_file" "" "$api_token"; then
        ok "Removed Cloudflare DNS record for $hostname"
    else
        warn "Could not remove the Cloudflare DNS record for $hostname automatically"
    fi

    rm -f "$list_file" "$delete_file"
}

disconnect_cloudflare_tunnel() {
    local api_token="$1"
    local account_id="$2"
    local tunnel_id="$3"
    local output_file

    output_file="$(mktemp)"
    if cloudflare_api_request "DELETE" "/accounts/$account_id/cfd_tunnel/$tunnel_id/connections" "$output_file" "" "$api_token"; then
        ok "Disconnected active Cloudflare tunnel connectors"
    else
        warn "Could not explicitly disconnect Cloudflare tunnel connectors before deletion"
    fi
    rm -f "$output_file"
}

delete_cloudflare_tunnel_remote() {
    local api_token="$1"
    local account_id="$2"
    local tunnel_id="$3"
    local output_file

    output_file="$(mktemp)"
    if cloudflare_api_request "DELETE" "/accounts/$account_id/cfd_tunnel/$tunnel_id" "$output_file" "" "$api_token"; then
        ok "Deleted Cloudflare tunnel $tunnel_id"
    else
        rm -f "$output_file"
        fail "Could not delete Cloudflare tunnel $tunnel_id"
    fi
    rm -f "$output_file"
}

build_tunnel_config_payload() {
    local current_json_file="$1"
    local hostname="$2"
    local service_url="$3"

    python3 - "$current_json_file" "$hostname" "$service_url" <<'PY'
import json
import pathlib
import sys

path = pathlib.Path(sys.argv[1])
hostname = sys.argv[2].lower()
service_url = sys.argv[3]

try:
    payload = json.loads(path.read_text())
except Exception:
    payload = {}

result = payload.get("result") if isinstance(payload, dict) else {}
if not isinstance(result, dict):
    result = {}
config = result.get("config") if isinstance(result.get("config"), dict) else {}
ingress = config.get("ingress")
if not isinstance(ingress, list):
    ingress = []

new_rule = {
    "hostname": hostname,
    "service": service_url,
    "originRequest": {}
}

filtered = []
catchall = None

for rule in ingress:
    if not isinstance(rule, dict):
        continue
    rule_hostname = (rule.get("hostname") or "").lower()
    if rule_hostname == hostname:
        continue
    if "hostname" not in rule:
        catchall = rule
        continue
    filtered.append(rule)

if catchall is None:
    catchall = {"service": "http_status:404"}

filtered.append(new_rule)
filtered.append(catchall)

print(json.dumps({"config": {"ingress": filtered}}, separators=(",", ":")))
PY
}

ensure_cloudflare_dns_record() {
    local api_token="$1"
    local zone_id="$2"
    local hostname="$3"
    local tunnel_id="$4"
    local list_file patch_file record_id record_type record_name existing_count body

    list_file="$(mktemp)"
    patch_file="$(mktemp)"

    cloudflare_api_request "GET" "/zones/$zone_id/dns_records?name=$hostname" "$list_file" "" "$api_token" || {
        rm -f "$list_file" "$patch_file"
        fail "Could not inspect Cloudflare DNS records for $hostname"
    }

    existing_count="$(python3 - "$list_file" "$hostname" <<'PY'
import json
import pathlib
import sys

payload = json.loads(pathlib.Path(sys.argv[1]).read_text())
target = sys.argv[2].lower()
records = [r for r in (payload.get("result") or []) if (r.get("name") or "").lower() == target]
print(len(records))
PY
)"

    if [[ "$existing_count" -gt 0 ]]; then
        record_id="$(python3 - "$list_file" "$hostname" <<'PY'
import json
import pathlib
import sys

payload = json.loads(pathlib.Path(sys.argv[1]).read_text())
target = sys.argv[2].lower()
for record in payload.get("result") or []:
    if (record.get("name") or "").lower() == target and record.get("type") == "CNAME":
        print(record.get("id", ""))
        break
PY
)"
        record_type="$(python3 - "$list_file" "$hostname" <<'PY'
import json
import pathlib
import sys

payload = json.loads(pathlib.Path(sys.argv[1]).read_text())
target = sys.argv[2].lower()
for record in payload.get("result") or []:
    if (record.get("name") or "").lower() == target:
        print(record.get("type", ""))
        break
PY
)"
        record_name="$(python3 - "$list_file" "$hostname" <<'PY'
import json
import pathlib
import sys

payload = json.loads(pathlib.Path(sys.argv[1]).read_text())
target = sys.argv[2].lower()
for record in payload.get("result") or []:
    if (record.get("name") or "").lower() == target:
        print(record.get("name", ""))
        break
PY
)"

        if [[ -z "$record_id" ]]; then
            rm -f "$list_file" "$patch_file"
            fail "Cloudflare DNS already has a non-CNAME record for $record_name ($record_type). Remove it before adding the tunnel route."
        fi

        body="$(python3 - "$hostname" "$tunnel_id" <<'PY'
import json
import sys

hostname = sys.argv[1]
tunnel_id = sys.argv[2]
print(json.dumps({
    "type": "CNAME",
    "name": hostname,
    "content": f"{tunnel_id}.cfargotunnel.com",
    "proxied": True
}, separators=(",", ":")))
PY
)"
        if cloudflare_api_request "PATCH" "/zones/$zone_id/dns_records/$record_id" "$patch_file" "$body" "$api_token"; then
            ok "Updated Cloudflare DNS record for $hostname"
        else
            rm -f "$list_file" "$patch_file"
            fail "Could not update Cloudflare DNS record for $hostname"
        fi
    else
        body="$(python3 - "$hostname" "$tunnel_id" <<'PY'
import json
import sys

hostname = sys.argv[1]
tunnel_id = sys.argv[2]
print(json.dumps({
    "type": "CNAME",
    "name": hostname,
    "content": f"{tunnel_id}.cfargotunnel.com",
    "proxied": True
}, separators=(",", ":")))
PY
)"
        if cloudflare_api_request "POST" "/zones/$zone_id/dns_records" "$patch_file" "$body" "$api_token"; then
            ok "Created Cloudflare DNS record for $hostname"
        else
            rm -f "$list_file" "$patch_file"
            fail "Could not create Cloudflare DNS record for $hostname"
        fi
    fi

    rm -f "$list_file" "$patch_file"
}

ensure_cloudflare_public_hostname() {
    local api_token="$1"
    local account_id="$2"
    local tunnel_id="$3"
    local zone_id="$4"
    local hostname="$5"
    local service_url="$6"
    local config_file update_file payload

    [[ -n "$account_id" && -n "$tunnel_id" ]] || fail "Cloudflare account ID and tunnel ID are required to manage the public hostname"

    config_file="$(mktemp)"
    update_file="$(mktemp)"

    cloudflare_api_request "GET" "/accounts/$account_id/cfd_tunnel/$tunnel_id/configurations" "$config_file" "" "$api_token" || {
        rm -f "$config_file" "$update_file"
        fail "Could not fetch Cloudflare tunnel configuration. Check that the API token has Cloudflare Tunnel Edit permission."
    }

    payload="$(build_tunnel_config_payload "$config_file" "$hostname" "$service_url")"

    if cloudflare_api_request "PUT" "/accounts/$account_id/cfd_tunnel/$tunnel_id/configurations" "$update_file" "$payload" "$api_token"; then
        ok "Updated Cloudflare tunnel ingress for $hostname"
    else
        rm -f "$config_file" "$update_file"
        fail "Could not update Cloudflare tunnel ingress for $hostname"
    fi

    ensure_cloudflare_dns_record "$api_token" "$zone_id" "$hostname" "$tunnel_id"

    rm -f "$config_file" "$update_file"
}

cloudflare_access_enabled() {
    flag_enabled "${CLOUDFLARE_ACCESS_ENABLED:-false}"
}

cloudflare_access_allowed_emails_json() {
    python3 <<'PY'
import json
import os
import re

raw = os.environ.get("CLOUDFLARE_ACCESS_ALLOWED_EMAILS", "")
emails = []
seen = set()
for item in re.split(r"[\s,;]+", raw):
    email = item.strip().lower()
    if not email or "@" not in email or email in seen:
        continue
    seen.add(email)
    emails.append(email)
print(json.dumps(emails, separators=(",", ":")))
PY
}

cloudflare_access_email_count() {
    local emails_json

    emails_json="$(cloudflare_access_allowed_emails_json)"
    python3 - "$emails_json" <<'PY'
import json
import sys

print(len(json.loads(sys.argv[1])))
PY
}

require_cloudflare_access_allowlist() {
    local count

    count="$(cloudflare_access_email_count)"

    [[ "$count" -gt 0 ]] || fail "Cloudflare Access protection needs CLOUDFLARE_ACCESS_ALLOWED_EMAILS set to one or more family email addresses"
}

build_cloudflare_access_app_body() {
    local hostname="$1"
    local route_service="$2"
    local session_duration="${CLOUDFLARE_ACCESS_SESSION_DURATION:-720h}"
    local otp_identity_provider_id="${3:-}"
    local reusable_policy_id="${4:-}"

    python3 - "$hostname" "$route_service" "$session_duration" "$otp_identity_provider_id" "$reusable_policy_id" <<'PY'
import json
import sys

hostname, route_service, session_duration, otp_identity_provider_id, reusable_policy_id = sys.argv[1:6]
service_name = route_service[:1].upper() + route_service[1:]
body = {
    "name": f"Stackarr {service_name}",
    "domain": hostname,
    "type": "self_hosted",
    "session_duration": session_duration or "720h",
    "auto_redirect_to_identity": bool(otp_identity_provider_id)
}
if otp_identity_provider_id:
    body["allowed_idps"] = [otp_identity_provider_id]
if reusable_policy_id:
    body["policies"] = [{"id": reusable_policy_id}]
print(json.dumps(body, separators=(",", ":")))
PY
}

build_cloudflare_access_policy_body() {
    local emails_json="$1"
    local policy_name="${2:-$DEFAULT_ACCESS_POLICY_NAME}"
    local session_duration="${CLOUDFLARE_ACCESS_SESSION_DURATION:-720h}"

    python3 - "$emails_json" "$policy_name" "$session_duration" <<'PY'
import json
import sys

emails = json.loads(sys.argv[1])
policy_name = sys.argv[2]
session_duration = sys.argv[3] or "720h"
include = [{"email": {"email": email}} for email in emails]
print(json.dumps({
    "name": policy_name,
    "decision": "allow",
    "include": include,
    "exclude": [],
    "require": [],
    "session_duration": session_duration
}, separators=(",", ":")))
PY
}

build_cloudflare_access_otp_identity_provider_body() {
    python3 <<'PY'
import json

print(json.dumps({
    "name": "One-time PIN",
    "type": "onetimepin",
    "config": {}
}, separators=(",", ":")))
PY
}

ensure_cloudflare_access_otp_identity_provider() {
    local api_token="$1"
    local account_id="$2"
    local id_file="$3"
    local output_file body identity_provider_id

    [[ -n "$api_token" && -n "$account_id" ]] || fail "Cloudflare Access OTP setup needs an API token and account ID"

    output_file="$(mktemp)"
    if ! cloudflare_api_request "GET" "/accounts/$account_id/access/identity_providers" "$output_file" "" "$api_token"; then
        rm -f "$output_file"
        fail "Could not inspect Cloudflare Access identity providers. Check that the API token includes Zero Trust Access identity provider read/edit permissions."
    fi

    identity_provider_id="$(python3 - "$output_file" <<'PY'
import json
import pathlib
import sys

payload = json.loads(pathlib.Path(sys.argv[1]).read_text())
for provider in payload.get("result") or []:
    provider_type = str(provider.get("type") or "").lower()
    provider_name = str(provider.get("name") or "").lower()
    if provider_type in {"onetimepin", "one-time-pin", "otp"} or provider_name == "one-time pin":
        print(provider.get("id", ""))
        break
PY
)"

    if [[ -n "$identity_provider_id" ]]; then
        printf '%s\n' "$identity_provider_id" > "$id_file"
        rm -f "$output_file"
        ok "Cloudflare Access One-time PIN identity provider is configured"
        return 0
    fi

    body="$(build_cloudflare_access_otp_identity_provider_body)"
    if cloudflare_api_request "POST" "/accounts/$account_id/access/identity_providers" "$output_file" "$body" "$api_token"; then
        identity_provider_id="$(python3 - "$output_file" <<'PY'
import json
import pathlib
import sys

payload = json.loads(pathlib.Path(sys.argv[1]).read_text())
print((payload.get("result") or {}).get("id", ""))
PY
)"
        [[ -n "$identity_provider_id" ]] || fail "Cloudflare Access One-time PIN identity provider did not return an ID"
        printf '%s\n' "$identity_provider_id" > "$id_file"
        ok "Created Cloudflare Access One-time PIN identity provider"
    else
        rm -f "$output_file"
        fail "Could not create Cloudflare Access One-time PIN identity provider. Check that the API token includes Zero Trust Access identity provider edit permissions."
    fi

    rm -f "$output_file"
}

find_cloudflare_access_app_id() {
    local api_token="$1"
    local account_id="$2"
    local hostname="$3"
    local app_record app_id

    app_record="$(find_cloudflare_access_app_record "$api_token" "$account_id" "$hostname" || true)"
    IFS=$'\t' read -r app_id _ <<< "$app_record"

    [[ -n "$app_id" ]] || return 1
    printf '%s\n' "$app_id"
}

find_cloudflare_access_app_record() {
    local api_token="$1"
    local account_id="$2"
    local hostname="$3"
    local output_file app_record

    output_file="$(mktemp)"
    if ! cloudflare_api_request "GET" "/accounts/$account_id/access/apps?search=$hostname" "$output_file" "" "$api_token"; then
        rm -f "$output_file"
        return 1
    fi

    app_record="$(python3 - "$output_file" "$hostname" <<'PY'
import json
import pathlib
import sys

payload = json.loads(pathlib.Path(sys.argv[1]).read_text())
target = sys.argv[2].lower()
for app in payload.get("result") or []:
    domains = []
    domain = app.get("domain")
    if domain:
        domains.append(str(domain).lower())
    for item in app.get("self_hosted_domains") or []:
        if isinstance(item, dict):
            value = item.get("domain") or item.get("hostname")
        else:
            value = item
        if value:
            domains.append(str(value).lower())
    if target in domains:
        print(f"{app.get('id', '')}\t{app.get('name', '')}")
        break
PY
)"
    rm -f "$output_file"

    [[ -n "$app_record" ]] || return 1
    printf '%s\n' "$app_record"
}

find_cloudflare_access_policy_id() {
    local api_token="$1"
    local account_id="$2"
    local app_id="$3"
    local policy_name="$4"
    local output_file policy_id

    output_file="$(mktemp)"
    if ! cloudflare_api_request "GET" "/accounts/$account_id/access/apps/$app_id/policies" "$output_file" "" "$api_token"; then
        rm -f "$output_file"
        return 1
    fi

    policy_id="$(python3 - "$output_file" "$policy_name" <<'PY'
import json
import pathlib
import sys

payload = json.loads(pathlib.Path(sys.argv[1]).read_text())
target = sys.argv[2]
for policy in payload.get("result") or []:
    if policy.get("name") == target:
        print(policy.get("id", ""))
        break
PY
)"
    rm -f "$output_file"

    [[ -n "$policy_id" ]] || return 1
    printf '%s\n' "$policy_id"
}

find_cloudflare_access_reusable_policy_id() {
    local api_token="$1"
    local account_id="$2"
    local policy_name="$3"
    local output_file policy_id

    output_file="$(mktemp)"
    if ! cloudflare_api_request "GET" "/accounts/$account_id/access/policies" "$output_file" "" "$api_token"; then
        rm -f "$output_file"
        return 1
    fi

    policy_id="$(python3 - "$output_file" "$policy_name" <<'PY'
import json
import pathlib
import sys

payload = json.loads(pathlib.Path(sys.argv[1]).read_text())
target = sys.argv[2]
for policy in payload.get("result") or []:
    if policy.get("name") == target:
        print(policy.get("id", ""))
        break
PY
)"
    rm -f "$output_file"

    [[ -n "$policy_id" ]] || return 1
    printf '%s\n' "$policy_id"
}

ensure_cloudflare_access_reusable_policy() {
    local api_token="$1"
    local account_id="$2"
    local policy_file emails_json policy_body policy_id

    [[ -n "$api_token" && -n "$account_id" ]] || fail "Cloudflare Access reusable policy setup needs an API token and account ID"
    require_cloudflare_access_allowlist

    policy_file="$(mktemp)"
    emails_json="$(cloudflare_access_allowed_emails_json)"
    policy_body="$(build_cloudflare_access_policy_body "$emails_json" "$DEFAULT_ACCESS_POLICY_NAME")"
    policy_id="$(find_cloudflare_access_reusable_policy_id "$api_token" "$account_id" "$DEFAULT_ACCESS_POLICY_NAME" || true)"

    if [[ -n "$policy_id" ]]; then
        if cloudflare_api_request "PUT" "/accounts/$account_id/access/policies/$policy_id" "$policy_file" "$policy_body" "$api_token"; then
            ok "Updated reusable Cloudflare Access policy '$DEFAULT_ACCESS_POLICY_NAME'" >&2
        else
            rm -f "$policy_file"
            fail "Could not update reusable Cloudflare Access policy '$DEFAULT_ACCESS_POLICY_NAME'"
        fi
    else
        if cloudflare_api_request "POST" "/accounts/$account_id/access/policies" "$policy_file" "$policy_body" "$api_token"; then
            policy_id="$(python3 - "$policy_file" <<'PY'
import json
import pathlib
import sys

payload = json.loads(pathlib.Path(sys.argv[1]).read_text())
print((payload.get("result") or {}).get("id", ""))
PY
)"
            ok "Created reusable Cloudflare Access policy '$DEFAULT_ACCESS_POLICY_NAME'" >&2
        else
            rm -f "$policy_file"
            fail "Could not create reusable Cloudflare Access policy '$DEFAULT_ACCESS_POLICY_NAME'. Check that the API token includes Zero Trust Access policy edit permissions."
        fi
    fi

    rm -f "$policy_file"

    [[ -n "$policy_id" ]] || fail "Reusable Cloudflare Access policy '$DEFAULT_ACCESS_POLICY_NAME' did not return an ID"
    printf '%s\n' "$policy_id"
}

delete_cloudflare_access_legacy_policy() {
    local api_token="$1"
    local account_id="$2"
    local app_id="$3"
    local hostname="$4"
    local policy_id output_file

    policy_id="$(find_cloudflare_access_policy_id "$api_token" "$account_id" "$app_id" "$LEGACY_ACCESS_POLICY_NAME" || true)"
    [[ -n "$policy_id" ]] || return 0

    output_file="$(mktemp)"
    if cloudflare_api_request "DELETE" "/accounts/$account_id/access/apps/$app_id/policies/$policy_id" "$output_file" "" "$api_token"; then
        ok "Removed legacy Cloudflare Access allowlist for $hostname"
    else
        warn "Could not remove legacy Cloudflare Access allowlist for $hostname"
    fi
    rm -f "$output_file"
}

delete_cloudflare_access_application() {
    local api_token="$1"
    local account_id="$2"
    local hostname="$3"
    local app_record app_id app_name output_file

    app_record="$(find_cloudflare_access_app_record "$api_token" "$account_id" "$hostname" || true)"
    [[ -n "$app_record" ]] || return 0
    IFS=$'\t' read -r app_id app_name <<< "$app_record"
    [[ -n "$app_id" ]] || return 0

    if [[ "$app_name" != Stackarr* ]]; then
        warn "Cloudflare Access app for $hostname is not Stackarr-managed; leaving it in place"
        return 0
    fi

    output_file="$(mktemp)"
    if cloudflare_api_request "DELETE" "/accounts/$account_id/access/apps/$app_id" "$output_file" "" "$api_token"; then
        ok "Removed Cloudflare Access app for public/mobile route $hostname"
    else
        warn "Could not remove Cloudflare Access app for public/mobile route $hostname"
    fi
    rm -f "$output_file"
}

ensure_cloudflare_access_application() {
    local api_token="$1"
    local account_id="$2"
    local hostname="$3"
    local route_service="$4"
    local otp_identity_provider_id="${5:-}"
    local reusable_policy_id="${6:-}"
    local app_file body app_id

    [[ -n "$api_token" && -n "$account_id" ]] || fail "Cloudflare Access setup needs an API token and account ID"
    require_cloudflare_access_allowlist
    [[ -n "$reusable_policy_id" ]] || fail "Cloudflare Access setup needs reusable policy '$DEFAULT_ACCESS_POLICY_NAME'"

    app_file="$(mktemp)"
    body="$(build_cloudflare_access_app_body "$hostname" "$route_service" "$otp_identity_provider_id" "$reusable_policy_id")"
    app_id="$(find_cloudflare_access_app_id "$api_token" "$account_id" "$hostname" || true)"

    if [[ -n "$app_id" ]]; then
        if cloudflare_api_request "PUT" "/accounts/$account_id/access/apps/$app_id" "$app_file" "$body" "$api_token"; then
            ok "Updated Cloudflare Access app for $hostname"
        else
            rm -f "$app_file"
            fail "Could not update Cloudflare Access app for $hostname"
        fi
    else
        if cloudflare_api_request "POST" "/accounts/$account_id/access/apps" "$app_file" "$body" "$api_token"; then
            app_id="$(python3 - "$app_file" <<'PY'
import json
import pathlib
import sys

payload = json.loads(pathlib.Path(sys.argv[1]).read_text())
print((payload.get("result") or {}).get("id", ""))
PY
)"
            ok "Created Cloudflare Access app for $hostname"
        else
            rm -f "$app_file"
            fail "Could not create Cloudflare Access app for $hostname. Check that the API token includes Zero Trust Access application/policy edit permissions."
        fi
    fi

    [[ -n "$app_id" ]] || fail "Cloudflare Access app for $hostname did not return an app ID"

    delete_cloudflare_access_legacy_policy "$api_token" "$account_id" "$app_id" "$hostname"

    rm -f "$app_file"
}

cleanup_cloudflare_local_state() {
    local remove_api_token="${1:-false}"
    local current_token_file="${CLOUDFLARED_TOKEN_FILE:-$TOKEN_FILE}"

    unload_agent
    rm -f "$PLIST_PATH"
    rm -f "$TOKEN_FILE"
    if [[ "$current_token_file" != "$TOKEN_FILE" ]]; then
        rm -f "$current_token_file"
    fi
    if [[ "$remove_api_token" == true ]]; then
        rm -f "$API_TOKEN_FILE"
    fi

    set_env_value "CLOUDFLARED_BIN" ""
    set_env_value "CLOUDFLARED_METRICS_PORT" "$DEFAULT_METRICS_PORT"
    set_env_value "CLOUDFLARED_TOKEN_FILE" ""
    set_env_value "CLOUDFLARED_KEEP_LAN" "true"
    set_env_value "CLOUDFLARE_ZONE_ID" ""
    set_env_value "CLOUDFLARE_ROUTE_MANAGED" "false"
    set_env_value "CLOUDFLARE_ACCOUNT_ID" ""
    set_env_value "CLOUDFLARED_TUNNEL_ID" ""
    set_env_value "CLOUDFLARED_TUNNEL_NAME" "$DEFAULT_TUNNEL_NAME"
    set_env_value "CLOUDFLARE_TUNNEL_ROUTES" ""
    if [[ "$remove_api_token" == true ]]; then
        set_env_value "CLOUDFLARE_API_TOKEN" ""
    fi
}

unload_agent() {
    launchctl bootout "$LAUNCH_DOMAIN" "$PLIST_PATH" 2>/dev/null || launchctl unload "$PLIST_PATH" 2>/dev/null || true
}

load_agent() {
    launchctl bootstrap "$LAUNCH_DOMAIN" "$PLIST_PATH" 2>/dev/null || launchctl load "$PLIST_PATH"
    launchctl enable "$LAUNCH_DOMAIN/$LAUNCH_LABEL" 2>/dev/null || true
    launchctl kickstart -k "$LAUNCH_DOMAIN/$LAUNCH_LABEL" 2>/dev/null || true
}

create_plist() {
    local stackarr_bin

    stackarr_bin="$(find_stackarr_bin || true)"
    [[ -n "$stackarr_bin" ]] || fail "Could not find a stackarr executable"

    ensure_dir "$PLIST_DIR"
    ensure_dir "$LOG_ROOT/launchd"

    cat > "$PLIST_PATH" <<EOF
<?xml version="1.0" encoding="UTF-8"?>
<!DOCTYPE plist PUBLIC "-//Apple//DTD PLIST 1.0//EN" "http://www.apple.com/DTDs/PropertyList-1.0.dtd">
<plist version="1.0">
<dict>
  <key>Label</key>
  <string>$LAUNCH_LABEL</string>
  <key>ProcessType</key>
  <string>Background</string>
  <key>AssociatedBundleIdentifiers</key>
  <array>
    <string>$STACKARR_BUNDLE_IDENTIFIER</string>
  </array>
  <key>WorkingDirectory</key>
  <string>$APP_ROOT</string>
  <key>ProgramArguments</key>
  <array>
    <string>$stackarr_bin</string>
    <string>cloudflare</string>
    <string>run-agent</string>
  </array>
  <key>RunAtLoad</key>
  <true/>
  <key>KeepAlive</key>
  <true/>
  <key>StandardOutPath</key>
  <string>$LOG_ROOT/launchd/cloudflared.out.log</string>
  <key>StandardErrorPath</key>
  <string>$LOG_ROOT/launchd/cloudflared.err.log</string>
</dict>
</plist>
EOF
}

wait_for_tunnel_ready() {
    local metrics_port="$1"
    local ready_url="http://127.0.0.1:${metrics_port}/ready"
    local attempt=1

    while [[ "$attempt" -le 15 ]]; do
        if curl -fsS --max-time 2 "$ready_url" >/dev/null 2>&1; then
            ok "Cloudflare tunnel is running"
            return 0
        fi
        sleep 1
        attempt=$((attempt + 1))
    done

    warn "Cloudflare tunnel launch agent is installed, but readiness did not confirm yet"
    return 1
}

restart_seerr_if_needed() {
    local changed_bind_ip="$1"

    if [[ "$changed_bind_ip" != true ]]; then
        return 0
    fi

    if command -v docker >/dev/null 2>&1 && docker info >/dev/null 2>&1; then
        load_env
        stackarr_compose up -d seerr >/dev/null
        if [[ "${SEERR_BIND_IP:-}" == "127.0.0.1" ]]; then
            ok "Restarted Seerr with localhost-only binding"
        else
            ok "Restarted Seerr with LAN-visible binding"
        fi
    else
        warn "Updated Seerr bind settings. Run 'stackarr up' to apply them."
    fi
}

transmission_is_loopback_only() {
    [[ "${TRANSMISSION_BIND_IP:-127.0.0.1}" == "127.0.0.1" ]]
}

qbittorrent_is_loopback_only() {
    [[ "${QBITTORRENT_BIND_IP:-127.0.0.1}" == "127.0.0.1" ]]
}

print_dashboard_steps() {
    local routes_file="$1"
    local route_managed="${2:-false}"
    local route_hostname route_service route_access route_service_url access_email_count access_route_count

    echo ""
    echo "Cloudflare dashboard settings:"
    if [[ -s "$routes_file" ]]; then
        if [[ "$route_managed" == true ]]; then
            echo "  Published application routes: already created by Stackarr"
        else
            echo "  Published application routes:"
        fi
        while IFS=$'\t' read -r route_hostname route_service route_access; do
            [[ -n "$route_hostname" && -n "$route_service" ]] || continue
            route_service_url="$(cloudflare_service_url "$route_service" || true)"
            if [[ "$route_access" == "true" ]]; then
                echo "    https://$route_hostname -> ${route_service_url:-$route_service} (Access)"
            else
                echo "    https://$route_hostname -> ${route_service_url:-$route_service} (public/mobile)"
            fi
        done < "$routes_file"
    else
        echo "  Published application route: none configured"
        echo "    Add routes in Settings > Connect or pass --route hostname=service[:access|public]"
        echo "    Service type: HTTP"
    fi
    if cloudflare_access_enabled; then
        access_email_count="$(cloudflare_access_email_count)"
        access_route_count="$(cloudflare_access_route_count "$routes_file")"
        echo "  Cloudflare Access app: managed by Stackarr"
        echo "    One-time PIN login with $access_email_count allowed email(s) on $access_route_count protected route(s)"
    else
        echo "  Cloudflare Access app: optional"
        echo "    Enable Protect Routes with Access to add One-time PIN plus an email allowlist before public routes"
    fi
    echo "  Keep download clients and admin apps private unless you explicitly add a route for them"
}

install_cloudflare() {
    local hostname=""
    local cloudflared_bin
    local api_token=""
    local effective_api_token=""
    local tunnel_id=""
    local token=""
    local route_managed=false
    local zone_info=""
    local resolved_zone_id=""
    local resolved_account_id=""
    local credentials=""
    local tunnel_name="$DEFAULT_TUNNEL_NAME"
    local routes_file=""
    local routes_json=""
    local route_count=0
    local access_route_count=0
    local route_override
    local access_idp_file=""
    local access_idp_id=""
    local access_policy_id=""
    local access_session=""
    local disable_access=false
    local -a access_emails=()
    local -a route_overrides=()

    while [[ "$#" -gt 0 ]]; do
        case "$1" in
            --route)
                [[ "$#" -ge 2 ]] || usage
                route_override="${2#https://}"
                route_override="${route_override#http://}"
                route_override="${route_override%%/*}"
                if [[ "$route_override" != *=* ]]; then
                    route_override="$route_override=pulsarr"
                fi
                route_overrides+=("$route_override")
                shift 2
                ;;
            --api-token)
                [[ "$#" -ge 2 ]] || usage
                api_token="$2"
                shift 2
                ;;
            --access-email)
                [[ "$#" -ge 2 ]] || usage
                access_emails+=("$2")
                shift 2
                ;;
            --access-session)
                [[ "$#" -ge 2 ]] || usage
                access_session="$2"
                shift 2
                ;;
            --no-access)
                disable_access=true
                shift
                ;;
            *)
                usage
                ;;
        esac
    done

    load_cloudflare_state

    if [[ "$disable_access" == true ]]; then
        set_env_value "CLOUDFLARE_ACCESS_ENABLED" "false"
    elif [[ "${#access_emails[@]}" -gt 0 ]]; then
        set_env_value "CLOUDFLARE_ACCESS_ENABLED" "true"
        set_env_value "CLOUDFLARE_ACCESS_ALLOWED_EMAILS" "$(IFS=,; printf '%s' "${access_emails[*]}")"
    fi
    if [[ -n "$access_session" ]]; then
        set_env_value "CLOUDFLARE_ACCESS_SESSION_DURATION" "$access_session"
    fi

    if [[ -z "$api_token" ]]; then
        api_token="$(read_cloudflare_api_token || true)"
    fi
    effective_api_token="$api_token"
    [[ -n "$effective_api_token" ]] || fail "Cloudflare API token is required. Create an account token with Cloudflare Tunnel, DNS, Zone Read, Zero Trust, and Access policy permissions."

    routes_file="$(mktemp)"
    if [[ "${#route_overrides[@]}" -gt 0 ]]; then
        for route_override in "${route_overrides[@]}"; do
            print_cloudflare_route_override "$route_override"
        done > "$routes_file"
    else
        collect_cloudflare_routes > "$routes_file"
    fi
    routes_json="$(routes_to_json "$routes_file")"
    route_count="$(grep -cve '^[[:space:]]*$' "$routes_file" || true)"
    access_route_count="$(cloudflare_access_route_count "$routes_file")"
    if [[ "$route_count" -gt 0 ]]; then
        hostname="$(awk -F'\t' 'NF >= 2 && $1 != "" {print $1; exit}' "$routes_file")"
    fi

    if [[ "$route_count" -gt 0 && "$access_route_count" -gt 0 ]] && cloudflare_access_enabled; then
        [[ -n "$effective_api_token" ]] || fail "Cloudflare Access protection needs a Cloudflare API token so routes can be protected before they are published"
        require_cloudflare_access_allowlist
    fi

    cloudflared_bin="$(find_cloudflared_bin || true)"
    [[ -n "$cloudflared_bin" ]] || fail "cloudflared is not installed. Run 'brew install cloudflared' first."

    tunnel_id="${CLOUDFLARED_TUNNEL_ID:-}"
    resolved_zone_id=""
    resolved_account_id=""

    if [[ -n "$hostname" && -n "$effective_api_token" ]]; then
        local local_zone_id=""
        local local_account_id=""
        zone_info="$(resolve_zone_info "$hostname" "$effective_api_token" || true)"
        if [[ -n "$zone_info" ]]; then
            IFS=$'\t' read -r local_zone_id local_account_id <<< "$zone_info"
            if [[ -z "$resolved_zone_id" && -n "$local_zone_id" ]]; then
                resolved_zone_id="$local_zone_id"
                ok "Resolved Cloudflare zone for $hostname"
            fi
            if [[ -z "$resolved_account_id" && -n "$local_account_id" ]]; then
                resolved_account_id="$local_account_id"
            fi
        fi
    fi

    if [[ -z "$resolved_account_id" && -n "$resolved_zone_id" && -n "$effective_api_token" ]]; then
        resolved_account_id="$(resolve_account_id_from_zone_id "$resolved_zone_id" "$effective_api_token" || true)"
    fi

    credentials="$(ensure_cloudflare_tunnel_credentials \
        "$effective_api_token" \
        "$resolved_account_id" \
        "$tunnel_id" \
        "$tunnel_name")"
    IFS=$'\t' read -r resolved_account_id tunnel_id tunnel_name token <<< "$credentials"
    rename_cloudflare_tunnel "$effective_api_token" "$resolved_account_id" "$tunnel_id" "$DEFAULT_TUNNEL_NAME"
    tunnel_name="$DEFAULT_TUNNEL_NAME"

    [[ -n "$token" ]] || fail "Could not determine a Cloudflare connector credential"
    write_cloudflare_token_file "$token"
    write_cloudflare_api_token_file "$effective_api_token"

    if [[ "$route_count" -gt 0 && -n "$effective_api_token" ]]; then
        local route_hostname route_service route_access route_service_url route_zone_id route_account_id
        if [[ "$access_route_count" -gt 0 ]] && cloudflare_access_enabled; then
            access_idp_file="$(mktemp)"
            ensure_cloudflare_access_otp_identity_provider "$effective_api_token" "$resolved_account_id" "$access_idp_file"
            access_idp_id="$(cat "$access_idp_file")"
            [[ -n "$access_idp_id" ]] || fail "Cloudflare Access One-time PIN identity provider did not return an ID"
            access_policy_id="$(ensure_cloudflare_access_reusable_policy "$effective_api_token" "$resolved_account_id")"
            [[ -n "$access_policy_id" ]] || fail "Reusable Cloudflare Access policy did not return an ID"
        fi
        while IFS=$'\t' read -r route_hostname route_service route_access; do
            [[ -n "$route_hostname" && -n "$route_service" ]] || continue
            route_service_url="$(cloudflare_service_url "$route_service")" || fail "Unknown Cloudflare route service '$route_service'"
            zone_info="$(resolve_zone_info "$route_hostname" "$effective_api_token" || true)"
            [[ -n "$zone_info" ]] || fail "Could not resolve the Cloudflare zone for $route_hostname. Use a Cloudflare API token with Zone Read, DNS Edit, and Cloudflare Tunnel Edit."
            IFS=$'\t' read -r route_zone_id route_account_id <<< "$zone_info"
            [[ -n "$route_zone_id" ]] || fail "Could not resolve the Cloudflare zone for $route_hostname"
            if [[ -z "$resolved_zone_id" ]]; then
                resolved_zone_id="$route_zone_id"
            fi
            if [[ -z "$resolved_account_id" && -n "$route_account_id" ]]; then
                resolved_account_id="$route_account_id"
            fi
            if [[ "$route_access" == "true" ]] && cloudflare_access_enabled; then
                ensure_cloudflare_access_application "$effective_api_token" "$resolved_account_id" "$route_hostname" "$route_service" "$access_idp_id" "$access_policy_id"
            else
                delete_cloudflare_access_application "$effective_api_token" "$resolved_account_id" "$route_hostname"
            fi
            ensure_cloudflare_public_hostname "$effective_api_token" "$resolved_account_id" "$tunnel_id" "$route_zone_id" "$route_hostname" "$route_service_url"
        done < "$routes_file"
        rm -f "$access_idp_file"
        route_managed=true
    elif [[ "$route_count" -gt 0 ]]; then
        warn "No Cloudflare API token provided, so public hostname routes still need to be created manually"
    fi

    write_cloudflare_state "$cloudflared_bin" "$DEFAULT_METRICS_PORT" "$TOKEN_FILE" "true" "$resolved_zone_id" "$route_managed" "$resolved_account_id" "$tunnel_id" "$tunnel_name"
    set_env_value "CLOUDFLARE_TUNNEL_ROUTES" "$routes_json"
    create_plist
    unload_agent
    load_agent
    ok "Installed Cloudflare tunnel launch agent"
    wait_for_tunnel_ready "$DEFAULT_METRICS_PORT" || true

    if torrent_client_enabled transmission; then
        if transmission_is_loopback_only; then
            ok "Transmission is still limited to localhost"
        else
            warn "Transmission is exposed beyond localhost. Keep it bound to loopback and protect public routes with Cloudflare Access."
        fi
    fi

    if torrent_client_enabled qbittorrent; then
        if qbittorrent_is_loopback_only; then
            ok "qBittorrent is still limited to localhost"
        else
            warn "qBittorrent is exposed beyond localhost. Keep it bound to loopback and protect public routes with Cloudflare Access."
        fi
    fi

    print_dashboard_steps "$routes_file" "$route_managed"
    rm -f "$routes_file"
}

start_cloudflare() {
    local metrics_port="$DEFAULT_METRICS_PORT"
    local token=""

    load_cloudflare_state

    if [[ ! -f "${CLOUDFLARED_TOKEN_FILE:-$TOKEN_FILE}" ]]; then
        fail "Missing internal Cloudflare connector token. Run 'stackarr cloudflare install --api-token <token>' first."
    fi

    create_plist
    unload_agent
    load_agent
    ok "Started Cloudflare tunnel launch agent"

    if [[ -n "${CLOUDFLARED_METRICS_PORT:-}" ]]; then
        metrics_port="$CLOUDFLARED_METRICS_PORT"
    fi
    wait_for_tunnel_ready "$metrics_port" || true
}

stop_cloudflare() {
    unload_agent
    ok "Stopped Cloudflare tunnel launch agent"
    warn "Cloudflare may take a short while to show the tunnel as disconnected."
}

status_cloudflare() {
    local metrics_port="$DEFAULT_METRICS_PORT"
    local route_managed=false
    local api_token_available=false
    local routes_file route_hostname route_service route_access route_service_url

    print_header "Stackarr Cloudflare"
    load_cloudflare_state
    routes_file="$(mktemp)"
    collect_cloudflare_routes > "$routes_file"

    if [[ -n "${CLOUDFLARED_BIN:-}" && -x "${CLOUDFLARED_BIN:-}" ]]; then
        pass "cloudflared binary found at $CLOUDFLARED_BIN"
    elif find_cloudflared_bin >/dev/null 2>&1; then
        pass "cloudflared binary is installed"
    else
        warning "cloudflared is not installed"
    fi

    if [[ -n "${CLOUDFLARED_TUNNEL_ID:-}" ]]; then
        pass "Cloudflare tunnel runtime config exists"
    else
        warning "Cloudflare tunnel runtime config is missing"
    fi

    if [[ -f "${CLOUDFLARED_TOKEN_FILE:-$TOKEN_FILE}" ]]; then
        pass "Cloudflare connector token file exists"
    else
        warning "Cloudflare connector token file is missing"
    fi

    if [[ -f "$API_TOKEN_FILE" ]]; then
        api_token_available=true
        pass "Cloudflare API token file exists"
    elif [[ -n "${CLOUDFLARE_API_TOKEN:-}" ]]; then
        api_token_available=true
        pass "Cloudflare API token is configured"
    fi

    if [[ -n "${CLOUDFLARED_METRICS_PORT:-}" ]]; then
        metrics_port="$CLOUDFLARED_METRICS_PORT"
    fi

    if [[ "${CLOUDFLARE_ROUTE_MANAGED:-false}" == "true" ]]; then
        route_managed=true
    fi

    if [[ -f "$PLIST_PATH" ]]; then
        pass "Cloudflare launch agent installed"
    else
        warning "Cloudflare launch agent not installed"
    fi

    if launchctl print "$LAUNCH_DOMAIN/$LAUNCH_LABEL" >/dev/null 2>&1; then
        pass "Cloudflare launch agent is loaded"
    else
        warning "Cloudflare launch agent is not loaded"
    fi

    if curl -fsS --max-time 2 "http://127.0.0.1:${metrics_port}/ready" >/dev/null 2>&1; then
        pass "Cloudflare tunnel metrics endpoint is ready"
    else
        warning "Cloudflare tunnel metrics endpoint is not ready"
    fi

    if torrent_client_enabled transmission; then
        if transmission_is_loopback_only; then
            pass "Transmission web UI is localhost-only"
        else
            warning "Transmission web UI is exposed beyond localhost"
        fi
    fi

    if torrent_client_enabled qbittorrent; then
        if qbittorrent_is_loopback_only; then
            pass "qBittorrent web UI is localhost-only"
        else
            warning "qBittorrent web UI is exposed beyond localhost"
        fi
    fi

    if [[ -s "$routes_file" ]]; then
        echo ""
        echo "Public routes:"
        while IFS=$'\t' read -r route_hostname route_service route_access; do
            [[ -n "$route_hostname" && -n "$route_service" ]] || continue
            route_service_url="$(cloudflare_service_url "$route_service" || true)"
            if [[ "$route_access" == "true" ]]; then
                echo "  https://$route_hostname -> ${route_service_url:-$route_service} (Access)"
            else
                echo "  https://$route_hostname -> ${route_service_url:-$route_service} (public/mobile)"
            fi
        done < "$routes_file"
    fi

    if [[ -n "${CLOUDFLARED_TUNNEL_NAME:-}" ]]; then
        echo "Tunnel name: ${CLOUDFLARED_TUNNEL_NAME}"
    fi

    if [[ -n "${CLOUDFLARED_TUNNEL_ID:-}" ]]; then
        echo "Tunnel ID: ${CLOUDFLARED_TUNNEL_ID}"
    fi

    if [[ -n "${CLOUDFLARE_ACCOUNT_ID:-}" ]]; then
        echo "Account ID: ${CLOUDFLARE_ACCOUNT_ID}"
    fi

    if [[ "$route_managed" == true ]]; then
        echo "Route automation: managed by Stackarr"
    elif [[ "$api_token_available" == true ]]; then
        echo "Route automation: API token is available for future automatic route creation"
    fi

    if cloudflare_access_enabled; then
        echo "Access protection: enabled with One-time PIN and $(cloudflare_access_email_count) allowed email(s)"
    else
        echo "Access protection: disabled"
    fi

    echo ""
    echo "Passed:   $PASS"
    echo "Warnings: $WARNINGS"
    echo "Failed:   $FAILS"
    rm -f "$routes_file"
}

sync_cloudflare() {
    local api_token=""
    local token=""
    local account_id=""
    local tunnel_id=""
    local tunnel_name="$DEFAULT_TUNNEL_NAME"
    local details=""
    local config_file routes_raw_file routes_file routes_json access_apps_file policy_file
    local route_count access_route_count first_hostname zone_info zone_id=""
    local emails="" session_duration="" app_session="" policy_line="" email_count=0
    local cloudflared_bin=""

    load_cloudflare_state

    if [[ -f "$API_TOKEN_FILE" ]]; then
        api_token="$(read_secret_file "$API_TOKEN_FILE" || true)"
    else
        api_token="$(read_cloudflare_api_token || true)"
    fi
    [[ -n "$api_token" ]] || fail "Cloudflare API token is required to sync real tunnel and Access settings."

    if [[ -f "$TOKEN_FILE" ]]; then
        token="$(read_secret_file "$TOKEN_FILE" || true)"
    else
        token="$(read_cloudflare_tunnel_token || true)"
    fi

    account_id="${CLOUDFLARE_ACCOUNT_ID:-}"
    tunnel_id="${CLOUDFLARED_TUNNEL_ID:-}"
    if [[ -n "$token" ]]; then
        account_id="$(decode_tunnel_token_field "$token" "a" || true)"
        tunnel_id="$(decode_tunnel_token_field "$token" "t" || true)"
    fi

    if [[ -z "$account_id" ]]; then
        fail "Could not determine Cloudflare account ID from the connector token or runtime config."
    fi

    if [[ -z "$tunnel_id" ]]; then
        details="$(find_cloudflare_tunnel_by_name "$api_token" "$account_id" "${CLOUDFLARED_TUNNEL_NAME:-$DEFAULT_TUNNEL_NAME}" || true)"
        if [[ -n "$details" ]]; then
            IFS=$'\t' read -r tunnel_id tunnel_name <<< "$details"
        fi
    fi
    [[ -n "$tunnel_id" ]] || fail "Could not determine Cloudflare tunnel ID to sync."

    details="$(fetch_cloudflare_tunnel_details "$api_token" "$account_id" "$tunnel_id" || true)"
    if [[ -n "$details" ]]; then
        IFS=$'\t' read -r tunnel_id tunnel_name <<< "$details"
    fi
    [[ -n "$tunnel_name" ]] || tunnel_name="$DEFAULT_TUNNEL_NAME"

    config_file="$(mktemp)"
    routes_raw_file="$(mktemp)"
    routes_file="$(mktemp)"
    access_apps_file="$(mktemp)"
    policy_file="$(mktemp)"

    cloudflare_api_request "GET" "/accounts/$account_id/cfd_tunnel/$tunnel_id/configurations" "$config_file" "" "$api_token" || {
        rm -f "$config_file" "$routes_raw_file" "$routes_file" "$access_apps_file" "$policy_file"
        fail "Could not fetch the real Cloudflare tunnel ingress configuration."
    }
    cloudflare_routes_from_tunnel_config "$config_file" > "$routes_raw_file"

    cloudflare_access_apps_summary "$api_token" "$account_id" "$access_apps_file" || {
        rm -f "$config_file" "$routes_raw_file" "$routes_file" "$access_apps_file" "$policy_file"
        fail "Could not inspect Cloudflare Access apps. Check that the API token can read Zero Trust Access applications."
    }

    python3 - "$routes_raw_file" "$access_apps_file" > "$routes_file" <<'PY'
import pathlib
import sys

routes_file = pathlib.Path(sys.argv[1])
apps_file = pathlib.Path(sys.argv[2])

protected = set()
for line in apps_file.read_text().splitlines():
    parts = line.split("\t")
    if parts and parts[0]:
        protected.add(parts[0].strip().lower())

for line in routes_file.read_text().splitlines():
    parts = line.split("\t")
    if len(parts) < 2 or not parts[0] or not parts[1]:
        continue
    hostname = parts[0].strip().lower()
    service = parts[1].strip().lower()
    access = "true" if hostname in protected else "false"
    print(f"{hostname}\t{service}\t{access}")
PY

    routes_json="$(routes_to_json "$routes_file")"
    route_count="$(grep -cve '^[[:space:]]*$' "$routes_file" || true)"
    access_route_count="$(cloudflare_access_route_count "$routes_file")"

    cloudflare_access_policy_summary "$api_token" "$account_id" "$policy_file" || {
        rm -f "$config_file" "$routes_raw_file" "$routes_file" "$access_apps_file" "$policy_file"
        fail "Could not inspect Cloudflare Access reusable policy. Check that the API token can read Access policies."
    }
    if [[ -s "$policy_file" ]]; then
        policy_line="$(head -n 1 "$policy_file")"
        emails="${policy_line%%$'\t'*}"
        if [[ "$policy_line" == *$'\t'* ]]; then
            session_duration="${policy_line#*$'\t'}"
        fi
    fi
    if [[ -z "$session_duration" ]]; then
        app_session="$(awk -F'\t' '$3 != "" {print $3; exit}' "$access_apps_file")"
        session_duration="${app_session:-720h}"
    fi

    if [[ "$route_count" -gt 0 ]]; then
        first_hostname="$(awk -F'\t' 'NF >= 2 && $1 != "" {print $1; exit}' "$routes_file")"
        zone_info="$(resolve_zone_info "$first_hostname" "$api_token" || true)"
        if [[ -n "$zone_info" ]]; then
            IFS=$'\t' read -r zone_id _ <<< "$zone_info"
        fi
    fi

    cloudflared_bin="$(find_cloudflared_bin || true)"
    [[ -n "$cloudflared_bin" ]] && set_env_value "CLOUDFLARED_BIN" "$cloudflared_bin"
    set_env_value "CLOUDFLARED_METRICS_PORT" "${CLOUDFLARED_METRICS_PORT:-$DEFAULT_METRICS_PORT}"
    [[ -f "$TOKEN_FILE" ]] && set_env_value "CLOUDFLARED_TOKEN_FILE" "$TOKEN_FILE"
    set_env_value "CLOUDFLARED_KEEP_LAN" "${CLOUDFLARED_KEEP_LAN:-true}"
    set_env_value "CLOUDFLARE_ACCOUNT_ID" "$account_id"
    set_env_value "CLOUDFLARED_TUNNEL_ID" "$tunnel_id"
    set_env_value "CLOUDFLARED_TUNNEL_NAME" "$tunnel_name"
    set_env_value "CLOUDFLARE_ROUTE_MANAGED" "true"
    set_env_value "CLOUDFLARE_TUNNEL_ROUTES" "$routes_json"
    [[ -n "$zone_id" ]] && set_env_value "CLOUDFLARE_ZONE_ID" "$zone_id"
    set_env_value "CLOUDFLARE_ACCESS_ENABLED" "$([[ "$access_route_count" -gt 0 ]] && printf true || printf false)"
    set_env_value "CLOUDFLARE_ACCESS_ALLOWED_EMAILS" "$emails"
    set_env_value "CLOUDFLARE_ACCESS_SESSION_DURATION" "${session_duration:-720h}"

    load_env
    write_compose_env_file

    ok "Synced Cloudflare tunnel settings from remote state"
    echo "Tunnel name: $tunnel_name"
    echo "Tunnel ID: $tunnel_id"
    echo "Routes synced: $route_count"
    echo "Access-protected routes: $access_route_count"
    if [[ -n "$emails" ]]; then
        email_count="$(awk -F',' '{print NF}' <<< "$emails")"
    fi
    echo "Allowed emails synced: $email_count"

    rm -f "$config_file" "$routes_raw_file" "$routes_file" "$access_apps_file" "$policy_file"
}

delete_cloudflare() {
    local api_token=""
    local effective_api_token=""
    local hostname=""
    local zone_id=""
    local account_id=""
    local tunnel_name="$DEFAULT_TUNNEL_NAME"
    local tunnel_id=""
    local token=""
    local zone_info=""
    local existing=""
    local local_zone_id=""
    local local_account_id=""
    local routes_file=""
    local route_hostname=""
    local route_service=""
    local route_zone_id=""
    local route_account_id=""

    while [[ "$#" -gt 0 ]]; do
        case "$1" in
            --api-token)
                [[ "$#" -ge 2 ]] || usage
                api_token="$2"
                shift 2
                ;;
            *)
                usage
                ;;
        esac
    done

    load_cloudflare_state

    if [[ -z "$api_token" ]]; then
        api_token="$(read_cloudflare_api_token || true)"
    fi
    effective_api_token="$api_token"
    [[ -n "$effective_api_token" ]] || fail "A Cloudflare API token is required to delete the remote tunnel. Use 'stackarr cloudflare uninstall' for local-only cleanup."

    routes_file="$(mktemp)"
    collect_cloudflare_routes > "$routes_file"
    if [[ -s "$routes_file" ]]; then
        hostname="$(awk -F'\t' 'NF >= 2 && $1 != "" {print $1; exit}' "$routes_file")"
    fi

    if [[ -z "$tunnel_name" && -n "${CLOUDFLARED_TUNNEL_NAME:-}" ]]; then
        tunnel_name="$CLOUDFLARED_TUNNEL_NAME"
    fi

    token="$(read_cloudflare_tunnel_token || true)"
    tunnel_id="${CLOUDFLARED_TUNNEL_ID:-}"
    zone_id="${CLOUDFLARE_ZONE_ID:-}"
    account_id="${CLOUDFLARE_ACCOUNT_ID:-}"

    if [[ -z "$account_id" && -n "$token" ]]; then
        account_id="$(decode_tunnel_token_field "$token" "a")"
    fi
    if [[ -z "$tunnel_id" && -n "$token" ]]; then
        tunnel_id="$(decode_tunnel_token_field "$token" "t")"
    fi

    if [[ -z "$zone_id" && -n "$hostname" ]]; then
        zone_info="$(resolve_zone_info "$hostname" "$effective_api_token" || true)"
        if [[ -n "$zone_info" ]]; then
            IFS=$'\t' read -r local_zone_id local_account_id <<< "$zone_info"
            [[ -z "$zone_id" && -n "$local_zone_id" ]] && zone_id="$local_zone_id"
            [[ -z "$account_id" && -n "$local_account_id" ]] && account_id="$local_account_id"
        fi
    fi

    if [[ -z "$account_id" && -n "$zone_id" ]]; then
        account_id="$(resolve_account_id_from_zone_id "$zone_id" "$effective_api_token" || true)"
    fi

    if [[ -z "$tunnel_id" && -n "$account_id" && -n "$tunnel_name" ]]; then
        existing="$(find_cloudflare_tunnel_by_name "$effective_api_token" "$account_id" "$tunnel_name" || true)"
        if [[ -n "$existing" ]]; then
            IFS=$'\t' read -r tunnel_id tunnel_name <<< "$existing"
        fi
    fi

    [[ -n "$account_id" ]] || fail "Could not determine the Cloudflare account ID for tunnel deletion. Use a Cloudflare API token with Zone Read and save at least one route in Settings > Connect."
    [[ -n "$tunnel_id" ]] || fail "Could not determine the Cloudflare tunnel ID for deletion. Re-run install first."

    stop_cloudflare
    disconnect_cloudflare_tunnel "$effective_api_token" "$account_id" "$tunnel_id"
    if [[ -s "$routes_file" ]]; then
        while IFS=$'\t' read -r route_hostname route_service _route_access; do
            [[ -n "$route_hostname" ]] || continue
            route_zone_id="$zone_id"
            if [[ -z "$route_zone_id" ]]; then
                zone_info="$(resolve_zone_info "$route_hostname" "$effective_api_token" || true)"
                if [[ -n "$zone_info" ]]; then
                    IFS=$'\t' read -r route_zone_id route_account_id <<< "$zone_info"
                fi
            fi
            delete_cloudflare_dns_record "$effective_api_token" "$route_zone_id" "$route_hostname" "$tunnel_id"
        done < "$routes_file"
    fi
    delete_cloudflare_tunnel_remote "$effective_api_token" "$account_id" "$tunnel_id"
    cleanup_cloudflare_local_state false
    rm -f "$routes_file"
    ok "Removed local Cloudflare tunnel state"
}

rotate_cloudflare() {
    local hostname=""
    local api_token=""
    local effective_api_token=""
    local tunnel_name="$DEFAULT_TUNNEL_NAME"
    local tunnel_id=""
    local token=""
    local zone_info=""
    local zone_id=""
    local account_id=""
    local existing=""
    local local_zone_id=""
    local local_account_id=""
    local routes_file=""
    local route_hostname=""
    local route_service=""
    local route_zone_id=""
    local route_account_id=""
    local routes_json=""

    while [[ "$#" -gt 0 ]]; do
        case "$1" in
            --api-token)
                [[ "$#" -ge 2 ]] || usage
                api_token="$2"
                shift 2
                ;;
            *)
                usage
                ;;
        esac
    done

    load_cloudflare_state

    if [[ -z "$api_token" ]]; then
        api_token="$(read_cloudflare_api_token || true)"
    fi
    effective_api_token="$api_token"
    [[ -n "$effective_api_token" ]] || fail "A Cloudflare API token is required to rotate the Cloudflare connector credential. Save Cloudflare API Token in Settings > Connect first."

    routes_file="$(mktemp)"
    collect_cloudflare_routes > "$routes_file"
    routes_json="$(routes_to_json "$routes_file")"
    if [[ -s "$routes_file" ]]; then
        hostname="$(awk -F'\t' 'NF >= 2 && $1 != "" {print $1; exit}' "$routes_file")"
    fi
    [[ -n "$hostname" ]] || fail "At least one Cloudflare route is required to rotate the Cloudflare connector credential. Save a route in Settings > Connect first."

    if [[ -n "${CLOUDFLARED_TUNNEL_NAME:-}" ]]; then
        tunnel_name="$CLOUDFLARED_TUNNEL_NAME"
    fi

    zone_info="$(resolve_zone_info "$hostname" "$effective_api_token" || true)"
    [[ -n "$zone_info" ]] || fail "Could not resolve the Cloudflare zone for $hostname. Use an API token with Zone Read, DNS Edit, and Cloudflare Tunnel Edit."
    IFS=$'\t' read -r local_zone_id local_account_id <<< "$zone_info"
    zone_id="${CLOUDFLARE_ZONE_ID:-$local_zone_id}"
    account_id="${CLOUDFLARE_ACCOUNT_ID:-$local_account_id}"
    [[ -n "$account_id" ]] || account_id="$(resolve_account_id_from_zone_id "$zone_id" "$effective_api_token" || true)"
    [[ -n "$account_id" ]] || fail "Could not determine the Cloudflare account ID for tunnel rotation."

    token="$(read_cloudflare_tunnel_token || true)"
    tunnel_id="${CLOUDFLARED_TUNNEL_ID:-}"
    if [[ -z "$tunnel_id" && -n "$token" ]]; then
        tunnel_id="$(decode_tunnel_token_field "$token" "t")"
    fi

    if [[ -z "$tunnel_id" && -n "$tunnel_name" ]]; then
        existing="$(find_cloudflare_tunnel_by_name "$effective_api_token" "$account_id" "$tunnel_name" || true)"
        if [[ -n "$existing" ]]; then
            IFS=$'\t' read -r tunnel_id tunnel_name <<< "$existing"
        fi
    fi

    stop_cloudflare

    if [[ -n "$tunnel_id" ]]; then
        disconnect_cloudflare_tunnel "$effective_api_token" "$account_id" "$tunnel_id"
        if [[ -s "$routes_file" ]]; then
            while IFS=$'\t' read -r route_hostname route_service _route_access; do
                [[ -n "$route_hostname" ]] || continue
                route_zone_id="$zone_id"
                if [[ -z "$route_zone_id" ]]; then
                    zone_info="$(resolve_zone_info "$route_hostname" "$effective_api_token" || true)"
                    if [[ -n "$zone_info" ]]; then
                        IFS=$'\t' read -r route_zone_id route_account_id <<< "$zone_info"
                    fi
                fi
                delete_cloudflare_dns_record "$effective_api_token" "$route_zone_id" "$route_hostname" "$tunnel_id"
            done < "$routes_file"
        fi
        delete_cloudflare_tunnel_remote "$effective_api_token" "$account_id" "$tunnel_id"
    else
        warn "No existing Cloudflare tunnel found; creating a fresh tunnel"
    fi

    cleanup_cloudflare_local_state false
    set_env_value "CLOUDFLARE_TUNNEL_ROUTES" "$routes_json"
    write_cloudflare_api_token_file "$effective_api_token"
    install_cloudflare --api-token "$effective_api_token"
    rm -f "$routes_file"
    ok "Rotated Cloudflare connector credential for configured routes"
}

uninstall_cloudflare() {
    load_cloudflare_state
    cleanup_cloudflare_local_state true
    ok "Removed Cloudflare tunnel launch agent and local token state"
    warn "Delete any public routes and Access apps in the Cloudflare dashboard if you no longer want them reachable."
}

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

case "$ACTION" in
    run-agent)
        exec "$RUN_SCRIPT"
        ;;
    install)
        print_header "Stackarr Cloudflare"
        install_cloudflare "$@"
        ;;
    start)
        print_header "Stackarr Cloudflare"
        start_cloudflare
        ;;
    stop)
        print_header "Stackarr Cloudflare"
        stop_cloudflare
        ;;
    status)
        status_cloudflare
        ;;
    sync)
        print_header "Stackarr Cloudflare"
        sync_cloudflare
        ;;
    rotate)
        print_header "Stackarr Cloudflare"
        rotate_cloudflare "$@"
        ;;
    delete)
        print_header "Stackarr Cloudflare"
        delete_cloudflare "$@"
        ;;
    uninstall)
        print_header "Stackarr Cloudflare"
        uninstall_cloudflare
        ;;
    *)
        usage
        ;;
esac
