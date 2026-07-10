#!/bin/bash
set -euo pipefail

ROOT_DIR="$(cd "$(dirname "$0")/.." && pwd)"
# shellcheck source=lib/common.sh
source "$ROOT_DIR/lib/common.sh"

ACTION="${1:-install}"
QUIET=false
[[ "${2:-}" == "--quiet" ]] && QUIET=true

load_env

if stackarr_runtime_is_container; then
    if [[ "$ACTION" == "uninstall" ]]; then
        $QUIET || ok "Docker startup is controlled by the container restart policy"
    else
        $QUIET || ok "Docker startup is controlled by restart: unless-stopped"
        $QUIET || warn "Enable Docker Desktop, OrbStack, or your Docker daemon at login if the host should start Stackarr after reboot."
    fi
    exit 0
fi

STACKARR_BIN="$(find_stackarr_bin || true)"
[[ -n "$STACKARR_BIN" ]] || fail "Could not find a stackarr executable"
STACKARR_APP_BUNDLE="$(find_stackarr_app_bundle_for_bin "$STACKARR_BIN" || true)"
PLIST_DIR="$HOME/Library/LaunchAgents"
PLIST_PATH="$PLIST_DIR/com.stackarr.stack.plist"
LAUNCH_DOMAIN="gui/$(id -u)"
ensure_dir "$PLIST_DIR"
ensure_dir "$LOG_ROOT/launchd"

unload_agent() {
    launchctl bootout "$LAUNCH_DOMAIN" "$PLIST_PATH" 2>/dev/null || launchctl unload "$PLIST_PATH" 2>/dev/null || true
}

load_agent() {
    launchctl enable "$LAUNCH_DOMAIN/com.stackarr.stack"
    launchctl bootstrap "$LAUNCH_DOMAIN" "$PLIST_PATH" 2>/dev/null || launchctl load "$PLIST_PATH"
    launchctl print "$LAUNCH_DOMAIN/com.stackarr.stack" >/dev/null 2>&1 || fail "Startup agent was not loaded by launchd"
    launchctl kickstart -k "$LAUNCH_DOMAIN/com.stackarr.stack"
}

if [[ "$ACTION" == "uninstall" ]]; then
    unload_agent
    rm -f "$PLIST_PATH"
    $QUIET || ok "Removed startup agent"
    exit 0
fi

ASSOCIATED_BUNDLE_XML=""
if [[ -n "$STACKARR_APP_BUNDLE" ]]; then
    ASSOCIATED_BUNDLE_XML="  <key>AssociatedBundleIdentifiers</key>
  <array>
    <string>$STACKARR_BUNDLE_IDENTIFIER</string>
  </array>"
fi

cat > "$PLIST_PATH" <<EOF
<?xml version="1.0" encoding="UTF-8"?>
<!DOCTYPE plist PUBLIC "-//Apple//DTD PLIST 1.0//EN" "http://www.apple.com/DTDs/PropertyList-1.0.dtd">
<plist version="1.0">
<dict>
  <key>Label</key>
  <string>com.stackarr.stack</string>
  <key>ProcessType</key>
  <string>Background</string>
$ASSOCIATED_BUNDLE_XML
  <key>WorkingDirectory</key>
  <string>$APP_ROOT</string>
  <key>ProgramArguments</key>
  <array>
    <string>$STACKARR_BIN</string>
    <string>up</string>
  </array>
  <key>EnvironmentVariables</key>
  <dict>
    <key>STACKARR_RUN_SOURCE</key>
    <string>startup</string>
  </dict>
  <key>RunAtLoad</key>
  <true/>
  <key>KeepAlive</key>
  <dict>
    <key>SuccessfulExit</key>
    <false/>
  </dict>
  <key>ThrottleInterval</key>
  <integer>30</integer>
  <key>StandardOutPath</key>
  <string>$LOG_ROOT/launchd/start-stack.out.log</string>
  <key>StandardErrorPath</key>
  <string>$LOG_ROOT/launchd/start-stack.err.log</string>
</dict>
</plist>
EOF

unload_agent
load_agent
$QUIET || ok "Installed startup agent"
