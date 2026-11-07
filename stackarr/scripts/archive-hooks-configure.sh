#!/bin/bash
# Narrow archive hook provisioning; never applies unrelated Arr preferences.
set -euo pipefail
ROOT_DIR="$(cd "$(dirname "$0")/.." && pwd)"
# shellcheck source=lib/common.sh
source "$ROOT_DIR/lib/common.sh"

mode="${1:-}"
case "$mode" in install|provision|apply) ;; *) fail 'Usage: archive-hooks-configure.sh install|provision|apply' ;; esac
load_env
stackarr_storage_guard
stackarr_verify_torrent_archive_root
hooks="$CONFIG_ROOT/hooks"
mkdir -p "$hooks"

# Arr mounts this directory read-only. A separate wrapper selects the 4K snapshot
# without changing the standard instance's environment or the shared hook.
install_hook_file() {
    local name="$1" mode="$2" temporary
    temporary="$(mktemp "$hooks/.archive-hook.XXXXXX")"
    cp "$ROOT_DIR/scripts/hooks/$name" "$temporary"
    chmod "$mode" "$temporary"
    mv -f "$temporary" "$hooks/$name"
}
install_hook_file torrent-seasons.awk 644
install_hook_file torrent-seasons.sh 755
install_hook_file torrent-seasons.py 644
install_hook_file torrent-verify.awk 644
install_hook_file torrent-verify.sh 755
install_hook_file archive-torrent.sh 755
wrapper="$(mktemp "$hooks/.archive-wrapper.XXXXXX")"
cat > "$wrapper" <<'EOF'
#!/bin/sh
export TORRENT_SONARR_NAMING_CONFIG=/stackarr-hooks/sonarr4k-naming.json
export TORRENT_ARR_INSTANCE=sonarr4k
exec /stackarr-hooks/archive-torrent.sh "$@"
EOF
chmod 755 "$wrapper"
mv -f "$wrapper" "$hooks/archive-torrent-4k.sh"
wrapper="$(mktemp "$hooks/.archive-wrapper.XXXXXX")"
cat > "$wrapper" <<'EOF'
#!/bin/sh
export TORRENT_ARR_INSTANCE=radarr4k
exec /stackarr-hooks/archive-torrent.sh "$@"
EOF
chmod 755 "$wrapper"
mv -f "$wrapper" "$hooks/archive-torrent-radarr4k.sh"

# Notification validation checks that the script exists before naming is applied.
[[ "$mode" != install ]] || exit 0

snapshot() {
    local label="$1" url="$2" key="$3" output="$4" response tmp
    [[ -n "$key" ]] || { warn "$label API key missing; archive naming not provisioned"; return 1; }
    response="$(curl -fsS --max-time 10 -H "X-Api-Key: $key" "$url/api/v3/config/naming")" || {
        warn "$label naming read failed; archive naming not provisioned"; return 1;
    }
    tmp="$(mktemp "$hooks/.naming.XXXXXX")"
    if ! printf '%s' "$response" | python3 -c '
import json, sys
source = json.load(sys.stdin)
assert isinstance(source.get("seasonFolderFormat"), str) and source["seasonFolderFormat"]
assert isinstance(source.get("specialsFolderFormat"), str) and source["specialsFolderFormat"]
json.dump({key: source[key] for key in ("seasonFolderFormat", "specialsFolderFormat")}, sys.stdout)
' > "$tmp"; then
        rm -f "$tmp"
        warn "$label naming response invalid; archive naming not provisioned"
        return 1
    fi
    chmod 644 "$tmp"
    mv -f "$tmp" "$output"
}

notify() {
    local label="$1" url="$2" key="$3" script="$4" current id payload
    [[ -n "$key" ]] || return 1
    current="$(curl -fsS --max-time 10 -H "X-Api-Key: $key" "$url/api/v3/notification")" || return 1
    id="$(printf '%s' "$current" | python3 -c '
import json,sys
matches=[item.get("id") for item in json.load(sys.stdin) if item.get("name")=="Stackarr Torrent Archive"]
if len(matches)==1 and isinstance(matches[0],int): print(matches[0])
')"
    # Existing notification payload must be preserved except its script path and
    # event flags. Do not delete/recreate it (which can lose user customizations).
    [[ -n "$id" ]] || { warn "$label archive notification missing or ambiguous"; return 1; }
    payload="$(printf '%s' "$current" | python3 -c '
import json,sys
items=json.load(sys.stdin)
item=next(x for x in items if x.get("id")==int(sys.argv[1]))
fields=item.get("fields",[])
path=next((x for x in fields if x.get("name")=="path"),None)
assert path is not None
path["value"]=sys.argv[2]
item["onGrab"]=True
item["onDownload"]=True
item["onUpgrade"]=True
print(json.dumps(item))
' "$id" "$script")"
    curl -fsS --max-time 10 -X PUT -H "X-Api-Key: $key" -H 'Content-Type: application/json' \
        --data "$payload" "$url/api/v3/notification/$id" >/dev/null
}

sonarr_url="$(service_url sonarr "$SONARR_URL" 8989)"
sonarr_key="$(parse_api_key_xml "$CONFIG_ROOT/sonarr/config.xml" || true)"
sonarr4k_url="$(service_url sonarr4k "$SONARR_4K_URL" 8990)"
sonarr4k_key="$(parse_api_key_xml "$CONFIG_ROOT/sonarr4k/config.xml" || true)"

if optional_service_enabled tv; then
    snapshot Sonarr "$sonarr_url" "$sonarr_key" "$hooks/sonarr-naming.json"
fi
if optional_service_enabled sonarr4k; then
    snapshot 'Sonarr 4K' "$sonarr4k_url" "$sonarr4k_key" "$hooks/sonarr4k-naming.json"
fi
if [[ "$mode" == apply ]]; then
    radarr_url="$(service_url radarr "$RADARR_URL" 7878)"
    radarr4k_url="$(service_url radarr4k "$RADARR_4K_URL" 7879)"
    if optional_service_enabled movies; then
        notify Radarr "$radarr_url" "$(parse_api_key_xml "$CONFIG_ROOT/radarr/config.xml" || true)" /stackarr-hooks/archive-torrent.sh
    fi
    if optional_service_enabled radarr4k; then
        notify 'Radarr 4K' "$radarr4k_url" "$(parse_api_key_xml "$CONFIG_ROOT/radarr4k/config.xml" || true)" /stackarr-hooks/archive-torrent-radarr4k.sh
    fi
    if optional_service_enabled tv; then
        notify Sonarr "$sonarr_url" "$sonarr_key" /stackarr-hooks/archive-torrent.sh
    fi
    if optional_service_enabled sonarr4k; then
        notify 'Sonarr 4K' "$sonarr4k_url" "$sonarr4k_key" /stackarr-hooks/archive-torrent-4k.sh
    fi
fi
ok 'Archive hooks and per-instance naming provisioned'
