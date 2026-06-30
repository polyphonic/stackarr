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
    case "$ACTION" in
        uninstall)
            set_env_value ENABLE_SCHEDULED_UPDATES false
            $QUIET || ok "Disabled update automation"
            exit 0
            ;;
        install)
            [[ "${UPDATE_TIME:-04:30}" =~ ^([01][0-9]|2[0-3]):([0-5][0-9])$ ]] || fail "UPDATE_TIME must be HH:MM"
            case "$(lowercase "${UPDATE_WEEKDAY:-Sun}")" in
                sun|sunday|0|7|mon|monday|1|tue|tues|tuesday|2|wed|wednesday|3|thu|thur|thurs|thursday|4|fri|friday|5|sat|saturday|6)
                    ;;
                *)
                    fail "UPDATE_WEEKDAY must be a weekday name or number"
                    ;;
            esac
            set_env_value ENABLE_SCHEDULED_UPDATES true
            $QUIET || ok "Enabled update automation in the Stackarr container"
            exit 0
            ;;
    esac
fi

STACKARR_BIN="$(find_stackarr_bin || true)"
[[ -n "$STACKARR_BIN" ]] || fail "Could not find a stackarr executable"
PLIST_DIR="$HOME/Library/LaunchAgents"
PLIST_PATH="$PLIST_DIR/com.stackarr.update.plist"
LAUNCH_DOMAIN="gui/$(id -u)"
ensure_dir "$PLIST_DIR"
ensure_dir "$LOG_ROOT/launchd"

parse_update_weekday() {
    case "$(lowercase "${1:-Sun}")" in
        sun|sunday|0|7)
            printf '0\n'
            ;;
        mon|monday|1)
            printf '1\n'
            ;;
        tue|tues|tuesday|2)
            printf '2\n'
            ;;
        wed|wednesday|3)
            printf '3\n'
            ;;
        thu|thur|thurs|thursday|4)
            printf '4\n'
            ;;
        fri|friday|5)
            printf '5\n'
            ;;
        sat|saturday|6)
            printf '6\n'
            ;;
        *)
            return 1
            ;;
    esac
}

unload_agent() {
    launchctl bootout "$LAUNCH_DOMAIN" "$PLIST_PATH" 2>/dev/null || launchctl unload "$PLIST_PATH" 2>/dev/null || true
}

load_agent() {
    launchctl bootstrap "$LAUNCH_DOMAIN" "$PLIST_PATH" 2>/dev/null || launchctl load "$PLIST_PATH"
    launchctl enable "$LAUNCH_DOMAIN/com.stackarr.update" 2>/dev/null || true
}

if [[ "$ACTION" == "uninstall" ]]; then
    unload_agent
    rm -f "$PLIST_PATH"
    $QUIET || ok "Removed update agent"
    exit 0
fi

[[ "${UPDATE_TIME:-04:30}" =~ ^([01][0-9]|2[0-3]):([0-5][0-9])$ ]] || fail "UPDATE_TIME must be HH:MM"
WEEKDAY="$(parse_update_weekday "${UPDATE_WEEKDAY:-Sun}")" || fail "UPDATE_WEEKDAY must be a weekday name or number"
HOUR="${UPDATE_TIME%%:*}"
MINUTE="${UPDATE_TIME##*:}"

cat > "$PLIST_PATH" <<EOF
<?xml version="1.0" encoding="UTF-8"?>
<!DOCTYPE plist PUBLIC "-//Apple//DTD PLIST 1.0//EN" "http://www.apple.com/DTDs/PropertyList-1.0.dtd">
<plist version="1.0">
<dict>
  <key>Label</key>
  <string>com.stackarr.update</string>
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
    <string>$STACKARR_BIN</string>
    <string>update</string>
    <string>run</string>
  </array>
  <key>StartCalendarInterval</key>
  <dict>
    <key>Weekday</key>
    <integer>$WEEKDAY</integer>
    <key>Hour</key>
    <integer>$HOUR</integer>
    <key>Minute</key>
    <integer>$MINUTE</integer>
  </dict>
  <key>StandardOutPath</key>
  <string>$LOG_ROOT/launchd/update.out.log</string>
  <key>StandardErrorPath</key>
  <string>$LOG_ROOT/launchd/update.err.log</string>
</dict>
</plist>
EOF

unload_agent
load_agent
$QUIET || ok "Installed update agent"
