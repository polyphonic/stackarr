#!/bin/bash
# Independent capture and reconciliation loops: neither waits for backup jobs.
set -euo pipefail
ROOT_DIR="$(cd "$(dirname "$0")/.." && pwd)"
source "$ROOT_DIR/lib/common.sh"

log_archive() { printf '[torrent-archive] %s\n' "$*"; }

run_as_media_owner() {
    # Only private archive working directories are created before dropping to
    # the same UID/GID used by Arr. Captured tracker-bearing bytes stay mode 600.
    exec python3 - "$TORRENT_ARCHIVE_ROOT" "${PUID:-1000}" "${PGID:-1000}" "$ROOT_DIR/scripts/$1" "${@:2}" <<'PY'
import os
from pathlib import Path
import stat
import sys
root = Path(sys.argv[1])
uid, gid = int(sys.argv[2]), int(sys.argv[3])
if not root.is_absolute() or os.path.normpath(str(root)) != str(root):
    raise SystemExit('archive: invalid root')
current = Path('/')
for part in root.parts[1:]:
    current /= part
    if not stat.S_ISDIR(current.lstat().st_mode):
        raise SystemExit('archive: unsafe root')
for name in ('.metadata', '.retired'):
    directory = root / name
    try:
        directory.mkdir(mode=0o700)
    except FileExistsError:
        pass
    info = directory.lstat()
    if not stat.S_ISDIR(info.st_mode):
        raise SystemExit('archive: unsafe working directory')
    if os.geteuid() == 0:
        os.chown(directory, uid, gid)
    elif info.st_uid != os.geteuid():
        raise SystemExit('archive: incorrect working directory owner')
    directory.chmod(0o700)
if os.geteuid() == 0:
    os.setgroups([])
    os.setgid(gid)
    os.setuid(uid)
os.execv(sys.executable, [sys.executable, *sys.argv[4:]])
PY
}

prepare_archive() {
    load_env || return 1
    if ! optional_service_enabled tv && ! optional_service_enabled movies; then
        return 1
    fi
    stackarr_storage_guard || return 1
    stackarr_verify_torrent_archive_root || return 1
    [[ -d "$TORRENT_ARCHIVE_ROOT" && ! -L "$TORRENT_ARCHIVE_ROOT" ]]
}

capture_once() {
    prepare_archive || exit 1
    run_as_media_owner torrent-metadata-capture.py \
        --archive-root "$TORRENT_ARCHIVE_ROOT/.metadata" \
        --transmission-state "$CONFIG_ROOT/transmission/torrents" \
        --qbittorrent-state "$CONFIG_ROOT/qbittorrent/qBittorrent/BT_backup" \
        --passes "${1:-12}" --interval 5 --quiet
}

current_once() {
    owned_pid=''
    trap '[[ -z "$owned_pid" ]] || kill "$owned_pid" 2>/dev/null || true; [[ -z "$owned_pid" ]] || wait "$owned_pid" 2>/dev/null || true; exit 0' TERM INT
    prepare_archive || exit 1
    # Shared physical libraries across standard and 4K instances require a joint
    # ownership snapshot. Capture still runs, but do not retire on a partial view.
    if flag_enabled "${ENABLE_4K_SERVARR:-false}"; then
        log_archive 'retirement held: shared 4K libraries require joint ownership'
        exit 0
    fi
    for instance in sonarr radarr; do
        if [[ "$instance" == sonarr ]]; then
            optional_service_enabled tv || continue
            url="$(service_url sonarr "$SONARR_URL" 8989)"
        else
            optional_service_enabled movies || continue
            url="$(service_url radarr "$RADARR_URL" 7878)"
        fi
        # Do not request full history unless an import has queued a scope.
        [[ -d "$TORRENT_ARCHIVE_ROOT/_Pending/$instance" ]] || continue
        if ! compgen -G "$TORRENT_ARCHIVE_ROOT/_Pending/$instance/*.json" >/dev/null; then continue; fi
        run_as_media_owner torrent-current-inventory.py \
            --archive-root "$TORRENT_ARCHIVE_ROOT" --media-root "$MEDIA_ROOT" \
            --config-root "$CONFIG_ROOT" --instance "$instance" --url "$url" \
            --pending --apply --enrich & owned_pid=$!
        wait "$owned_pid" || log_archive "$instance reconciliation held"
        owned_pid=''
    done
}

case "${1:-}" in
    --capture-once) capture_once 1; exit $? ;;
    --current-once) current_once; exit $? ;;
    '') ;;
    *) printf 'Usage: torrent-archive-worker.sh [--capture-once|--current-once]\n' >&2; exit 2 ;;
esac

capture_loop() {
    local child=''
    trap '[[ -z "$child" ]] || kill "$child" 2>/dev/null || true; exit 0' TERM INT
    while true; do
        capture_once & child=$!
        wait "$child" || log_archive 'capture unavailable; will retry'
        child=''
        sleep 5 & child=$!
        wait "$child" || true
        child=''
    done
}
current_loop() {
    local child=''
    trap '[[ -z "$child" ]] || kill "$child" 2>/dev/null || true; exit 0' TERM INT
    while true; do
        current_once & child=$!
        wait "$child" || log_archive 'current-source check unavailable; will retry'
        child=''
        sleep 60 & child=$!
        wait "$child" || true
        child=''
    done
}
capture_loop & CAPTURE_PID=$!
current_loop & CURRENT_PID=$!
shutdown_archive() {
    trap - TERM INT
    kill "$CAPTURE_PID" "$CURRENT_PID" 2>/dev/null || true
    wait "$CAPTURE_PID" "$CURRENT_PID" 2>/dev/null || true
}
trap shutdown_archive TERM INT
wait -n "$CAPTURE_PID" "$CURRENT_PID"
shutdown_archive
