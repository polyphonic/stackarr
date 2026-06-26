#!/bin/bash
set -euo pipefail

ROOT_DIR="$(cd "$(dirname "$0")/.." && pwd)"
# shellcheck source=lib/common.sh
source "$ROOT_DIR/lib/common.sh"

ACTION="${1:-install}"
QUIET=false
[[ "${2:-}" == "--quiet" ]] && QUIET=true

load_env
STACKARR_BIN="$(find_stackarr_bin || true)"
[[ -n "$STACKARR_BIN" ]] || fail "Could not find a stackarr executable"
PLIST_DIR="$HOME/Library/LaunchAgents"
PLIST_PATH="$PLIST_DIR/com.stackarr.backup.plist"
LAUNCH_DOMAIN="gui/$(id -u)"
ensure_dir "$PLIST_DIR"
ensure_dir "$LOG_ROOT/launchd"

parse_backup_weekday() {
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
    launchctl enable "$LAUNCH_DOMAIN/com.stackarr.backup" 2>/dev/null || true
}

if [[ "$ACTION" == "uninstall" ]]; then
    unload_agent
    rm -f "$PLIST_PATH"
    $QUIET || ok "Removed backup agent"
    exit 0
fi

[[ "$BACKUP_TIME" =~ ^([01][0-9]|2[0-3]):([0-5][0-9])$ ]] || fail "BACKUP_TIME must be HH:MM"
BACKUP_SCHEDULE_NORMALIZED="$(lowercase "${BACKUP_SCHEDULE:-weekly}")"
[[ "$BACKUP_SCHEDULE_NORMALIZED" =~ ^(daily|weekly)$ ]] || fail "BACKUP_SCHEDULE must be 'daily' or 'weekly'"
WEEKDAY="$(parse_backup_weekday "${BACKUP_WEEKDAY:-Sun}")" || fail "BACKUP_WEEKDAY must be a weekday name or number"
HOUR="${BACKUP_TIME%%:*}"
MINUTE="${BACKUP_TIME##*:}"
if [[ "$BACKUP_SCHEDULE_NORMALIZED" == "weekly" ]]; then
    START_CALENDAR_INTERVAL="  <key>StartCalendarInterval</key>
  <dict>
    <key>Weekday</key>
    <integer>$WEEKDAY</integer>
    <key>Hour</key>
    <integer>$HOUR</integer>
    <key>Minute</key>
    <integer>$MINUTE</integer>
  </dict>"
else
    START_CALENDAR_INTERVAL="  <key>StartCalendarInterval</key>
  <dict>
    <key>Hour</key>
    <integer>$HOUR</integer>
    <key>Minute</key>
    <integer>$MINUTE</integer>
  </dict>"
fi

cat > "$PLIST_PATH" <<EOF
<?xml version="1.0" encoding="UTF-8"?>
<!DOCTYPE plist PUBLIC "-//Apple//DTD PLIST 1.0//EN" "http://www.apple.com/DTDs/PropertyList-1.0.dtd">
<plist version="1.0">
<dict>
  <key>Label</key>
  <string>com.stackarr.backup</string>
  <key>ProcessType</key>
  <string>Background</string>
  <key>WorkingDirectory</key>
  <string>$APP_ROOT</string>
  <key>ProgramArguments</key>
  <array>
    <string>$STACKARR_BIN</string>
    <string>backup</string>
    <string>run</string>
  </array>
$START_CALENDAR_INTERVAL
  <key>StandardOutPath</key>
  <string>$LOG_ROOT/launchd/backup.out.log</string>
  <key>StandardErrorPath</key>
  <string>$LOG_ROOT/launchd/backup.err.log</string>
</dict>
</plist>
EOF

unload_agent
load_agent
$QUIET || ok "Installed backup agent"
