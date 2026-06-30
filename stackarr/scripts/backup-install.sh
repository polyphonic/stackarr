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
        permissions)
            exec "$ROOT_DIR/scripts/permissions.sh" audit
            ;;
        uninstall)
            set_env_value ENABLE_BACKUP false
            $QUIET || ok "Disabled backup automation"
            exit 0
            ;;
        install)
            [[ "${BACKUP_TIME:-02:00}" =~ ^([01][0-9]|2[0-3]):([0-5][0-9])$ ]] || fail "BACKUP_TIME must be HH:MM"
            case "$(lowercase "${BACKUP_SCHEDULE:-weekly}")" in
                daily|weekly)
                    ;;
                *)
                    fail "BACKUP_SCHEDULE must be 'daily' or 'weekly'"
                    ;;
            esac
            case "$(lowercase "${BACKUP_WEEKDAY:-Sun}")" in
                sun|sunday|0|7|mon|monday|1|tue|tues|tuesday|2|wed|wednesday|3|thu|thur|thurs|thursday|4|fri|friday|5|sat|saturday|6)
                    ;;
                *)
                    fail "BACKUP_WEEKDAY must be a weekday name or number"
                    ;;
            esac
            set_env_value ENABLE_BACKUP true
            $QUIET || ok "Enabled backup automation in the Stackarr container"
            $QUIET || warn "Run 'stackarr permissions audit' if Docker or OrbStack folder sharing was changed."
            exit 0
            ;;
    esac
fi

STACKARR_BIN="$(find_stackarr_bin || true)"
[[ -n "$STACKARR_BIN" ]] || fail "Could not find a stackarr executable"

stackarr_app_bundle_for_bin() {
    local bin_path="$1"
    case "$bin_path" in
        *.app/Contents/MacOS/*)
            printf '%s\n' "${bin_path%%.app/Contents/MacOS/*}.app"
            return 0
            ;;
    esac
    return 1
}

STACKARR_APP_BUNDLE="${STACKARR_APP_BUNDLE:-$(stackarr_app_bundle_for_bin "$STACKARR_BIN" || true)}"
PLIST_DIR="$HOME/Library/LaunchAgents"
PLIST_PATH="$PLIST_DIR/com.stackarr.backup.plist"
LAUNCH_DOMAIN="gui/$(id -u)"
BACKUP_AGENT_APP="$STATE_ROOT/launchd/Stackarr Backup Agent.app"
BACKUP_AGENT_BIN="$BACKUP_AGENT_APP/Contents/MacOS/stackarr-backup-agent"
BACKUP_AGENT_STATE_PLIST="$STATE_ROOT/launchd/com.stackarr.backup.plist"
BACKUP_PROGRAM="$STACKARR_BIN"
BACKUP_PROGRAM_MODE="stackarr-backup-run"
BACKUP_PRIVACY_TARGET=""
BACKUP_USES_STACKARR_APP=false
if [[ -n "$STACKARR_APP_BUNDLE" && -d "$STACKARR_APP_BUNDLE" ]]; then
    BACKUP_AGENT_APP="$STACKARR_APP_BUNDLE"
    BACKUP_AGENT_BIN="$STACKARR_BIN"
    BACKUP_PRIVACY_TARGET="$STACKARR_APP_BUNDLE"
    BACKUP_USES_STACKARR_APP=true
fi
ensure_dir "$PLIST_DIR"
ensure_dir "$LOG_ROOT/launchd"
ensure_dir "$STATE_ROOT/launchd"

xml_escape() {
    local value="$1"
    value="${value//&/&amp;}"
    value="${value//</&lt;}"
    value="${value//>/&gt;}"
    printf '%s' "$value"
}

c_string_escape() {
    printf '%s' "$1" | sed 's/\\/\\\\/g; s/"/\\"/g'
}

plist_program_arguments() {
    printf '    <string>%s</string>\n' "$(xml_escape "$BACKUP_PROGRAM")"
    if [[ "$BACKUP_PROGRAM_MODE" == "stackarr-backup-run" ]]; then
        printf '    <string>backup</string>\n'
        printf '    <string>run</string>\n'
    fi
}

create_backup_agent_wrapper() {
    local source_file="$STATE_ROOT/launchd/stackarr-backup-agent.c"
    local tmp_bin="$BACKUP_AGENT_BIN.tmp"
    local escaped_stackarr_bin

    if [[ "$BACKUP_USES_STACKARR_APP" == true ]]; then
        return 0
    fi

    if ! command -v clang >/dev/null 2>&1; then
        warn "Could not build dedicated backup helper because clang is not installed; launchd will run stackarr directly."
        return 1
    fi

    ensure_dir "$BACKUP_AGENT_APP/Contents"
    ensure_dir "$BACKUP_AGENT_APP/Contents/MacOS"

    cat > "$BACKUP_AGENT_APP/Contents/Info.plist" <<EOF
<?xml version="1.0" encoding="UTF-8"?>
<!DOCTYPE plist PUBLIC "-//Apple//DTD PLIST 1.0//EN" "http://www.apple.com/DTDs/PropertyList-1.0.dtd">
<plist version="1.0">
<dict>
  <key>CFBundleExecutable</key>
  <string>stackarr-backup-agent</string>
  <key>CFBundleIdentifier</key>
  <string>com.stackarr.backup-agent</string>
  <key>CFBundleName</key>
  <string>Stackarr Backup Agent</string>
  <key>CFBundlePackageType</key>
  <string>APPL</string>
  <key>CFBundleShortVersionString</key>
  <string>1.0</string>
  <key>CFBundleVersion</key>
  <string>1</string>
  <key>LSBackgroundOnly</key>
  <true/>
</dict>
</plist>
EOF

    escaped_stackarr_bin="$(c_string_escape "$STACKARR_BIN")"
    cat > "$source_file" <<EOF
#include <errno.h>
#include <signal.h>
#include <stdio.h>
#include <stdlib.h>
#include <string.h>
#include <sys/wait.h>
#include <unistd.h>

static pid_t child_pid = -1;

static void forward_signal(int signal_number) {
    if (child_pid > 0) {
        kill(child_pid, signal_number);
    }
}

int main(void) {
    const char *stackarr = "$escaped_stackarr_bin";
    int status = 0;

    signal(SIGINT, forward_signal);
    signal(SIGTERM, forward_signal);
    setenv("STACKARR_RUN_SOURCE", "scheduled", 0);

    child_pid = fork();
    if (child_pid < 0) {
        fprintf(stderr, "Stackarr Backup Agent could not fork: %s\\n", strerror(errno));
        return 127;
    }

    if (child_pid == 0) {
        execl(stackarr, stackarr, "backup", "run", (char *)0);
        fprintf(stderr, "Stackarr Backup Agent could not launch %s: %s\\n", stackarr, strerror(errno));
        _exit(127);
    }

    while (waitpid(child_pid, &status, 0) < 0) {
        if (errno == EINTR) {
            continue;
        }
        fprintf(stderr, "Stackarr Backup Agent could not wait for backup: %s\\n", strerror(errno));
        return 127;
    }

    if (WIFEXITED(status)) {
        return WEXITSTATUS(status);
    }

    if (WIFSIGNALED(status)) {
        int signal_number = WTERMSIG(status);
        signal(signal_number, SIG_DFL);
        raise(signal_number);
        return 128 + signal_number;
    }

    return 1;
}
EOF

    if ! clang -Os -Wall -Wextra "$source_file" -o "$tmp_bin"; then
        rm -f "$tmp_bin"
        warn "Could not build dedicated backup helper; launchd will run stackarr directly."
        return 1
    fi

    mv "$tmp_bin" "$BACKUP_AGENT_BIN"
    chmod 755 "$BACKUP_AGENT_BIN"
    if command -v codesign >/dev/null 2>&1; then
        codesign --force --sign - "$BACKUP_AGENT_APP" >/dev/null 2>&1 || warn "Could not ad-hoc sign the backup helper app."
    fi

    BACKUP_PROGRAM="$BACKUP_AGENT_BIN"
    BACKUP_PROGRAM_MODE="helper"
    BACKUP_PRIVACY_TARGET="$BACKUP_AGENT_APP"
}

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

if [[ "$ACTION" == "permissions" ]]; then
    [[ "$(uname -s)" == "Darwin" ]] || fail "Backup permissions can only be opened automatically on macOS"
    command -v open >/dev/null 2>&1 || fail "The macOS open command is required"
    create_backup_agent_wrapper || true
    if [[ -d "$BACKUP_AGENT_APP" ]]; then
        open -R "$BACKUP_AGENT_APP" >/dev/null 2>&1 || true
    else
        warn "Backup helper app is not installed yet. Run 'stackarr backup install' first."
    fi
    open "x-apple.systempreferences:com.apple.preference.security?Privacy_AllFiles" >/dev/null 2>&1 ||
        open "x-apple.systempreferences:com.apple.preference.security" >/dev/null 2>&1 ||
        fail "Could not open macOS Privacy settings"
    $QUIET || ok "Opened macOS Privacy settings"
    $QUIET || ok "Backup helper app: $BACKUP_AGENT_APP"
    exit 0
fi

if [[ "$ACTION" == "uninstall" ]]; then
    unload_agent
    rm -f "$PLIST_PATH"
    rm -f "$BACKUP_AGENT_STATE_PLIST"
    if [[ "$BACKUP_USES_STACKARR_APP" != true ]]; then
        rm -rf "$BACKUP_AGENT_APP"
    fi
    $QUIET || ok "Removed backup agent"
    exit 0
fi

create_backup_agent_wrapper || true

[[ "$BACKUP_TIME" =~ ^([01][0-9]|2[0-3]):([0-5][0-9])$ ]] || fail "BACKUP_TIME must be HH:MM"
BACKUP_SCHEDULE_NORMALIZED="$(lowercase "${BACKUP_SCHEDULE:-weekly}")"
[[ "$BACKUP_SCHEDULE_NORMALIZED" =~ ^(daily|weekly)$ ]] || fail "BACKUP_SCHEDULE must be 'daily' or 'weekly'"
WEEKDAY="$(parse_backup_weekday "${BACKUP_WEEKDAY:-Sun}")" || fail "BACKUP_WEEKDAY must be a weekday name or number"
HOUR="${BACKUP_TIME%%:*}"
MINUTE="${BACKUP_TIME##*:}"
PROGRAM_ARGUMENTS="$(plist_program_arguments)"
APP_ROOT_PLIST="$(xml_escape "$APP_ROOT")"
LOG_ROOT_PLIST="$(xml_escape "$LOG_ROOT")"
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
  <key>AssociatedBundleIdentifiers</key>
  <array>
    <string>$STACKARR_BUNDLE_IDENTIFIER</string>
  </array>
  <key>WorkingDirectory</key>
  <string>$APP_ROOT_PLIST</string>
  <key>ProgramArguments</key>
  <array>
$PROGRAM_ARGUMENTS
  </array>
$START_CALENDAR_INTERVAL
  <key>StandardOutPath</key>
  <string>$LOG_ROOT_PLIST/launchd/backup.out.log</string>
  <key>StandardErrorPath</key>
  <string>$LOG_ROOT_PLIST/launchd/backup.err.log</string>
</dict>
</plist>
EOF
cp "$PLIST_PATH" "$BACKUP_AGENT_STATE_PLIST"

unload_agent
load_agent
$QUIET || ok "Installed backup agent"
if [[ -n "$BACKUP_PRIVACY_TARGET" ]]; then
    $QUIET || ok "Backup helper app: $BACKUP_PRIVACY_TARGET"
    $QUIET || warn "Grant external-volume access to this app target if the backup root is on an external drive."
fi
