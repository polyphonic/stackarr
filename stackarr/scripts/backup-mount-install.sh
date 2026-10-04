#!/bin/bash
# Install only the mount-table responder, not a backup scheduler or whole runtime.
set -Eeuo pipefail
umask 077

usage() { echo 'Usage: backup-mount-install.sh install|uninstall STATE_ROOT BACKUP_ROOT' >&2; exit 2; }
[[ $# == 3 ]] || usage
mode="$1"; state="$2"; root="$3"
[[ "$mode" == install || "$mode" == uninstall ]] || usage
[[ "$(uname -s)" == Darwin ]] || { echo 'macOS host only' >&2; exit 1; }
[[ "$state" == /* && "$state" != *$'\n'* && "$state" != *$'\r'* ]] || usage
source_script="$(cd "$(dirname "$0")" && pwd)/backup-mount-bridge.sh"
# Keep the allowlist rooted in the installed configuration, not request data.
[[ "$root" == /Volumes/* && "$root" != *$'\n'* && "$root" != *$'\r'* && "$root" != *//* && "$root" != */ ]] || usage
suffix="${root#/Volumes/}"
[[ -n "$suffix" ]] || usage
IFS=/ read -r -a parts <<< "$suffix"
for part in "${parts[@]}"; do [[ -n "$part" && "$part" != . && "$part" != .. ]] || usage; done
agent="$HOME/Library/LaunchAgents/com.stackarr.backup-mount.plist"
helper="$state/host-runtime/scripts/backup-mount-bridge.sh"
domain="gui/$(id -u)"
launchctl bootout "$domain" "$agent" >/dev/null 2>&1 || true
if [[ "$mode" == uninstall ]]; then
    rm -f "$agent" "$helper"
    echo 'Removed Stackarr backup mount responder'
    exit 0
fi
mkdir -p "$(dirname "$agent")" "$(dirname "$helper")" "$state/backup-mount-bridge"
chmod 700 "$state/backup-mount-bridge"
tmp="$helper.tmp.$$"
trap 'rm -f "$tmp"' EXIT
cp "$source_script" "$tmp"
chmod 700 "$tmp"
mv -f "$tmp" "$helper"
xml() {
    local v="$1"
    v="${v//&/&amp;}"; v="${v//</&lt;}"; v="${v//>/&gt;}"
    printf '%s' "$v"
}
plist_tmp="$agent.tmp.$$"
trap 'rm -f "$tmp" "$plist_tmp"' EXIT
cat > "$plist_tmp" <<EOF
<?xml version="1.0" encoding="UTF-8"?>
<!DOCTYPE plist PUBLIC "-//Apple//DTD PLIST 1.0//EN" "http://www.apple.com/DTDs/PropertyList-1.0.dtd">
<plist version="1.0"><dict>
<key>Label</key><string>com.stackarr.backup-mount</string>
<key>ProgramArguments</key><array>
<string>/bin/bash</string><string>$(xml "$helper")</string>
<string>respond</string><string>$(xml "$state")</string><string>$(xml "$root")</string>
</array>
<key>StartInterval</key><integer>2</integer>
<key>ThrottleInterval</key><integer>1</integer>
<key>RunAtLoad</key><true/>
</dict></plist>
EOF
chmod 600 "$plist_tmp"
plutil -lint "$plist_tmp" >/dev/null
mv -f "$plist_tmp" "$agent"
launchctl bootstrap "$domain" "$agent"
echo 'Installed Stackarr backup mount responder (no backup schedule changed)'
